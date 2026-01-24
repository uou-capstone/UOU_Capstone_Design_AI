from google import genai
from google.genai import types
import json
import sys
import os

# 현재 파일의 디렉토리를 경로에 추가하여 서브 에이전트 임포트 가능하게 함
current_file_dir = os.path.dirname(os.path.abspath(__file__))
if current_file_dir not in sys.path:
    sys.path.append(current_file_dir)

# 모듈 임포트 확인: ShortAnswerPlanner, ShortAnswerWriter, ShortAnswerValidator
from Gen_ShortAnswer_SubAgent.ShortAnswerPlanner import ShortAnswerPlanner
from Gen_ShortAnswer_SubAgent.ShortAnswerWriter import ShortAnswerWriter
from Gen_ShortAnswer_SubAgent.ShortAnswerValidator import ShortAnswerValidator

def Generate_ShortAnswer(user_profile, lecture_material, target_problem_count=5):
    
    # [Step 1] ShortAnswer Planner: 무엇을 낼지 계획
    print(f"\n단답형/서술형 출제 계획 수립 시작 (목표 문항 수: {target_problem_count})...")
    # 강의 자료에서 Profile의 의도(깊이, 유형)에 맞는 핵심 개념 추출 및 단답/서술 비중 수립
    concept_plan_str = ShortAnswerPlanner(
        lecture_material=lecture_material, 
        user_profile=user_profile,
        target_count=target_problem_count
    )
    concept_plan = json.loads(concept_plan_str)
    print(">> 출제 계획 수립 완료.")

    # [Step 2] Generation & Validation Loop (Max 3)
    current_feedback = None # 초기 피드백은 없음
    generated_json = None   # 결과물을 담을 변수
    
    MAX_RETRIES = 3
    
    for attempt in range(MAX_RETRIES):
        print(f"\n 문제 생성 및 검증 진행 중...")
        
        # 2-1. ShortAnswer Writer: 계획과 피드백을 반영하여 JSON 생성
        print("   - Writer 호출: 문제 생성 중...")
        generated_json_str = ShortAnswerWriter(
            source_text=lecture_material,      # 강의 자료 원문
            plan=concept_plan,                 # 출제 계획
            feedback=current_feedback,         # 이전 턴의 피드백
            prior_content=generated_json,      # 이전 턴의 문제 세트
            num_problems=target_problem_count, # 목표 개수
            profile=user_profile               # 스타일 가이드
        )

        generated_json = json.loads(generated_json_str)

        # 2-2. ShortAnswer Validator: 품질 검증
        print("   - Validator 호출: 품질 검증 중...")
        # Fact Check, 모범 답안의 정확성, 키워드 적절성 확인
        validation_result_str = ShortAnswerValidator(
            target_content=generated_json, 
            source=lecture_material,      
            guideline=user_profile,        
            required_count=target_problem_count
        )

        validation_result = json.loads(validation_result_str)

        # 2-3. Decision Making
        if validation_result.get('is_valid') == True:
            print(">> 검증 통과! 최종 결과물을 반환합니다.")
            # 검증 통과 시 루프 즉시 종료 및 반환
            return generated_json
        else:
            print(f">> 검증 실패, 피드백 반영 후 재생성합니다.")
            # 검증 실패 시 피드백을 업데이트하고 루프 재실행
            current_feedback = validation_result.get('feedback_message', "No feedback provided.")
            continue

    # [Fallback] 최대 횟수 초과 시, 마지막으로 생성된 결과라도 반환
    print("\n>> 최대 재시도 횟수에 도달했습니다. 현재까지의 결과물을 반환합니다.")
    return generated_json

if __name__ == "__main__":
    # 테스트용 가짜 입력값 설정
    test_user_profile = {
        "learning_goal": {
            "focus_areas": [
                "삼성전자 실적",
                "삼성전자 전망"
            ],
            "target_depth": "Deep Understanding",
            "question_modality": "Conceptual"
        },
        "user_status": {
            "proficiency_level": "Intermediate",
            "weakness_focus": True
        },
        "interaction_style": {
            "language_preference": "Korean_with_Korean_Terms",
            "scenario_based": True
        },
        "feedback_preference": {
            "strictness": "Strict",
            "explanation_depth": "Detailed_with_Examples"
        },
        "scope_boundary": "Lecture_Material_Only"
    }
    
    # 실제 존재하는 PDF 경로 또는 텍스트 입력 가능
    test_lecture_material = "/Users/jhkim/Desktop/LectureTestGenerator/SamSung(260109).pdf"
    
    # 사용자로부터 목표 문제 수 입력받기 (숫자만 허용)
    while True:
        try:
            target_problem_count = int(input("생성할 단답형/서술형 문제 수를 입력하세요: "))
            if target_problem_count > 0:
                break
            else:
                print("양수를 입력해주세요.")
        except ValueError:
            print("올바른 숫자를 입력해주세요.")
    
    print("\n=== 단답형/서술형 문제 생성 테스트 시작 ===")
    try:
        final_result = Generate_ShortAnswer(
            user_profile=test_user_profile,
            lecture_material=test_lecture_material,
            target_problem_count=target_problem_count
        )
        
        print("\n=== 최종 생성된 JSON 결과 ===")
        print(json.dumps(final_result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        print(f"\n[오류 발생] {e}")
