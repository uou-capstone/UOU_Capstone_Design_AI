from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json
import sys
import os
import importlib.util

# 현재 파일의 디렉토리를 경로에 추가하여 서브 에이전트 임포트 가능하게 함
current_file_dir = os.path.dirname(os.path.abspath(__file__))
if current_file_dir not in sys.path:
    sys.path.append(current_file_dir)

# 숫자로 시작하는 모듈명을 동적으로 임포트
grader_path = os.path.join(current_file_dir, "5_Choice_Feedback_SubAgent", "5_Choice_Grader", "FiveChoiceGrader.py")
spec = importlib.util.spec_from_file_location("FiveChoiceGrader", grader_path)
grader_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grader_module)
FiveChoiceGrader = grader_module.FiveChoiceGrader

def Gen_5_Choice_feedBack(mcq_problem_object, user_answers):
    
    evaluation_items = []
    
    # 생성된 모든 문제에 대해 순회
    for problem in mcq_problem_object["mcq_problems"]:
        p_id = problem["id"]
        # 사용자 답변(선지 번호) 가져오기 (없을 경우 0 또는 None 처리)
        user_choice_id = user_answers.get(p_id, None) 
        
        # 선지 정보 조회 helper (사용자가 답변한 선지의 내용과 의도를 가져옴)
        # 선택하지 않았거나 잘못된 ID일 경우에 대한 예외 처리 포함
        selected_option = next((opt for opt in problem["options"] if opt["id"] == user_choice_id), None)
        
        # 1. Deterministic Grading (1차 채점)
        result_status = "Incorrect" # 기본값
        user_response_text = "No Answer"

        if selected_option:
            user_response_text = f"{selected_option['id']}. {selected_option['content']}" # 로그용 텍스트 구성
            
            if user_choice_id == problem["correct_answer"]:
                result_status = "Correct" # 정답인 경우
            else:
                result_status = "Incorrect" # 오답인 경우
        
        # 2. Feedback Generation via Agent (2차 피드백 생성)
        # 단순 정답 및 오답 여부뿐만 아니라, '선택한 오답 선지의 함정 의도(intent)'를 분석하여 피드백 생성
        grader_output_str = FiveChoiceGrader(
            problem_context=problem,       # 문제 전체 맥락 (발문, 정답, 전체 의도 등)
            user_choice_id=user_choice_id, # 사용자가 선택한 번호
            selected_option=selected_option, # 사용자가 선택한 선지 객체 (내용 + 함정 의도)
            result_status=result_status    # 채점 결과
        )
        
        grader_output = json.loads(grader_output_str)
        # 3. Item Assembly (학생 log 오브젝트를 출력할 수 있게 준비)
        item = {
            "question_id": p_id,
            "result_status": result_status,
            "question_content": problem["question_content"],
            "user_response": user_response_text,
            "related_topic": grader_output["related_topic"],     
            "feedback_message": grader_output["feedback_message"]
        }
        evaluation_items.append(item)
        
    # 4. Final Output Construction
    log_data_object = {
        "evaluation_items": evaluation_items
    }
    
    return log_data_object

# 테스트용 코드
# 실제 사용시는, Gen_5_Choice_feedBack()만 사용한다
if __name__ == "__main__":
    mcq_problem_object = {
        "mcq_problems": [
            {
                "id": 1,
                "question_content": "소프트웨어 공학에서 Verification과 Validation의 차이를 가장 잘 설명한 것은?",
                "options": [
                    {
                        "id": 1,
                        "content": "Verification은 '올바른 제품'을, Validation은 '제품을 올바르게'를 의미한다.",
                        "intent": "Verification과 Validation의 정의가 서로 바뀌어 있는 함정"
                    },
                    {
                        "id": 2,
                        "content": "Verification은 '제품을 올바르게', Validation은 '올바른 제품'을 의미한다.",
                        "intent": "정답: Verification과 Validation의 정확한 정의"
                    },
                    {
                        "id": 3,
                        "content": "Verification과 Validation은 동일한 개념이다.",
                        "intent": "두 개념을 혼동하는 함정"
                    },
                    {
                        "id": 4,
                        "content": "Verification은 테스트를, Validation은 검증을 의미한다.",
                        "intent": "용어를 잘못 이해한 함정"
                    },
                    {
                        "id": 5,
                        "content": "Verification은 개발 후, Validation은 개발 전에 수행한다.",
                        "intent": "수행 시점을 잘못 이해한 함정"
                    }
                ],
                "correct_answer": 2,
                "intent_diagnosis": "소프트웨어 공학의 핵심 개념인 Verification과 Validation의 차이를 정확히 이해하는지 확인합니다."
            },
            {
                "id": 2,
                "question_content": "애자일 선언문의 핵심 가치가 아닌 것은?",
                "options": [
                    {
                        "id": 1,
                        "content": "프로세스와 도구보다 개인과 상호작용",
                        "intent": "애자일 선언문의 실제 가치 중 하나"
                    },
                    {
                        "id": 2,
                        "content": "포괄적인 문서화보다 작동하는 소프트웨어",
                        "intent": "애자일 선언문의 실제 가치 중 하나"
                    },
                    {
                        "id": 3,
                        "content": "계획을 따르기보다 변화에 대응하기",
                        "intent": "애자일 선언문의 실제 가치 중 하나"
                    },
                    {
                        "id": 4,
                        "content": "완벽한 설계보다 빠른 출시",
                        "intent": "정답: 애자일 선언문에 없는 내용으로, 품질을 희생하는 오해를 유발하는 함정"
                    },
                    {
                        "id": 5,
                        "content": "계약 협상보다 고객과의 협력",
                        "intent": "애자일 선언문의 실제 가치 중 하나"
                    }
                ],
                "correct_answer": 4,
                "intent_diagnosis": "애자일 선언문의 4가지 핵심 가치를 정확히 이해하고 있는지, 그리고 애자일에 대한 일반적인 오해(빠른 출시를 위해 품질을 희생)를 구분할 수 있는지 확인합니다."
            }
        ]
    }
    user_answers = {1: 1, 2: 4}
    print("\n 5지선다 피드백 생성 시작...")
    log_data_object = Gen_5_Choice_feedBack(mcq_problem_object, user_answers)
    print(">> 5지선다 피드백 생성 완료.")
    print(">> 5지선다 피드백 결과:")
    print(json.dumps(log_data_object, indent=4, ensure_ascii=False))