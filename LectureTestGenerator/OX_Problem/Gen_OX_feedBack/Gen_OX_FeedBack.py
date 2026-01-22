from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json
import sys
import os

# 현재 파일의 디렉토리를 경로에 추가하여 서브 에이전트 임포트 가능하게 함
current_file_dir = os.path.dirname(os.path.abspath(__file__))
if current_file_dir not in sys.path:
    sys.path.append(current_file_dir)

from Gen_OX_feedBack_SubAgent.OXGrader import OXGrader

def Gen_OX_feedBack(ox_problem_object, user_answers):
    
    evaluation_items = []
    
    # 생성된 모든 문제에 대해 순회
    for problem in ox_problem_object["ox_problems"]:
        p_id = problem["id"]
        # 사용자 답변 가져오기 (없을 경우 예외 처리 혹은 "No Answer")
        user_choice = user_answers.get(p_id, "No Answer") 
        
        # 1. Deterministic Grading (1차 채점)
        # OX 문제는 정답이 명확하므로 로직으로 즉시 판별
        if user_choice == problem["correct_answer"]:
            result_status = "Correct"
        else:
            result_status = "Incorrect"
            # 부분 점수("Partial_Correct") 로직이 필요하다면 여기에 추가 (OX는 통상 불필요)

        # 2. Feedback Generation via Agent (2차 피드백 생성)
        # 단순 정오답 판별을 넘어, 'intent_diagnosis'를 기반으로 한 교육적 피드백 메시지와 주제 추출 수행
        grader_output_str = OXGrader(
            problem_context=problem,     # 질문, 정답, 출제 의도 포함
            user_choice=user_choice,     # 사용자 선택
            result_status=result_status  # 채점 결과
        )
        # str로 받은 응답을 딕셔너리 형태로 변환
        grader_output = json.loads(grader_output_str)

        # 3. Item Assembly (학생 log 오브젝트를 출력할 수 있게 준비)
        item = {
            "question_id": p_id,
            "result_status": result_status,
            "question_content": problem["question_content"],
            "user_response": user_choice,
            # Agent가 생성한 메타 정보 매핑
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
# 실제 사용시는, Gen_OX_feedBack()만 사용한다
if __name__ == "__main__":
    ox_problem_object = {
        "ox_problems": [
            {
                "id": 1,
                "question_content": "검증(Validation)은 제품을 올바르게 만드는 것에 관한 것이다.",
                "correct_answer": "X",
                "intent_diagnosis": "검증(Verification)과 확인(Validation)의 차이를 구분하는지 확인합니다. Verification은 '제품을 올바르게(Product right)' 만드는 것이고, Validation은 '올바른 제품(Right product)'을 만드는 것입니다."
            },
            {
                "id": 2,
                "question_content": "애자일 방법론은 작동하는 소프트웨어보다 포괄적인 문서화를 강조한다.",
                "correct_answer": "X",
                "intent_diagnosis": "애자일 선언문의 원칙에 대한 이해를 테스트합니다. 애자일은 포괄적인 문서화보다 작동하는 소프트웨어를 더 가치있게 여깁니다."
            }
        ]
    }
    user_answers = {1: "O", 2: "X"}
    print("\n[Step 0] OX 피드백 생성 시작...")
    log_data_object = Gen_OX_feedBack(ox_problem_object, user_answers)
    print(">> OX 피드백 생성 완료.")
    print(">> OX 피드백 결과:")
    print(json.dumps(log_data_object, indent=4, ensure_ascii=False))

