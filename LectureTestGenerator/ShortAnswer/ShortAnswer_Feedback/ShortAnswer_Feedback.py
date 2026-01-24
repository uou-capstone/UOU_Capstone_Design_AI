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

# ShortAnswerGrader 모듈 동적으로 임포트
grader_path = os.path.join(current_file_dir, "ShortAnswer_Feedback_SubAgent", "ShortAnswer_Grader", "ShortAnswerGrader.py")
spec = importlib.util.spec_from_file_location("ShortAnswerGrader", grader_path)
grader_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grader_module)
ShortAnswerGrader = grader_module.ShortAnswerGrader

def Gen_ShortAnswer_feedBack(short_answer_object, user_answers_text):
    
    evaluation_items = []
    
    for problem in short_answer_object["short_answer_problems"]:
        p_id = problem["id"]
        user_response = user_answers_text.get(str(p_id), "") # 사용자의 주관식 입력 텍스트
        
        # 주관식은 로직만으로 채점 불가 -> Agent_ShortAnswerGrader 호출
        grader_output_str = ShortAnswerGrader(
            problem_context=problem,       # (질문, 모범 답안, 핵심 키워드, 의도)
            user_response=user_response    # 사용자 입력
        )
        
        grader_output = json.loads(grader_output_str)
        
        item = {
            "question_id": p_id,
            "result_status": grader_output["result_status"], # Correct / Incorrect / Partial_Correct
            "question_content": problem["question_content"],
            "user_response": user_response,
            "related_topic": grader_output["related_topic"],
            "feedback_message": grader_output["feedback_message"]
        }
        evaluation_items.append(item)
        
    return { "evaluation_items": evaluation_items }

# 테스트용 코드
if __name__ == "__main__":
    short_answer_object = {
        "short_answer_problems": [
            {
                "id": 1,
                "type": "Short_Keyword",
                "question_content": "지도학습(Supervised Learning) 과정에서 모델이 훈련 데이터에는 지나치게 잘 맞지만, 테스트 데이터에서는 성능이 떨어지는 현상을 무엇이라 하는가?",
                "model_answer": "Overfitting (과적합)",
                "key_keywords": ["Overfitting", "과적합"],
                "intent_diagnosis": "머신러닝의 대표적인 문제 상황인 과적합의 정의를 정확한 용어로 인출할 수 있는지 확인합니다."
            },
            {
                "id": 2,
                "type": "Descriptive",
                "question_content": "Boehm이 정의한 Verification(검증)과 Validation(확인)의 차이점을 '제품(Product)'이라는 단어를 포함하여 서술하시오.",
                "model_answer": "Verification은 'Are we building the product right?'에 답하는 과정으로 명세 준수 여부를 확인하며, Validation은 'Are we building the right product?'에 답하는 과정으로 사용자 니즈 충족 여부를 확인한다.",
                "key_keywords": ["Product right", "Right product", "명세", "사용자 니즈"],
                "intent_diagnosis": "V&V의 개념적 차이를 단순 암기가 아닌, 핵심 문구(Right Product vs Product Right)를 사용하여 논리적으로 설명할 수 있는지 평가합니다."
            }
        ]
    }
    
    user_answers_text = {
        "1": "Overfitting",
        "2": "Verification은 제품을 올바르게 만드는 것이고, Validation은 올바른 제품을 만드는 것이다."
    }
    
    print("\n 단답형/서술형 피드백 생성 시작...")
    log_data_object = Gen_ShortAnswer_feedBack(short_answer_object, user_answers_text)
    print(">> 단답형/서술형 피드백 생성 완료.")
    print(">> 단답형/서술형 피드백 결과:")
    print(json.dumps(log_data_object, indent=4, ensure_ascii=False))
