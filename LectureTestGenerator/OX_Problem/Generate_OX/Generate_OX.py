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

from Generate_OX_SubAgent.OXPlanner import OXPlanner
from Generate_OX_SubAgent.OXWriter import OXWriter
from Generate_OX_SubAgent.OXValidator import OXValidator

def Generate_OX(user_profile, lecture_material, target_problem_count=10):
    
    # [Step 1] OX Planner: 무엇을 낼지 계획
    print(f"\n[Step 1] 핵심 개념 추출 및 O/X 출제 계획 수립 중... (목표 문제 수: {target_problem_count})")
    # 강의 자료에서 Profile의 의도에 맞는 핵심 개념 추출 및 O/X 정답 비율 배분 전략 수립
    concept_plan_str = OXPlanner(
        lecture_material=lecture_material, 
        user_profile=user_profile,
        target_count=target_problem_count
    )
    
    # str로 받은 응답을 딕셔너리 형태로 변환
    concept_plan = json.loads(concept_plan_str)
    print(">> 출제 계획 수립 완료.")

    # [Step 2] Generation & Validation Loop (Max 3)
    current_feedback = None # 초기 피드백은 없음
    generated_json = None   # 결과물을 담을 변수
    
    MAX_RETRIES = 3
    
    for attempt in range(MAX_RETRIES):
        print(f"\n[Step 2-{attempt+1}] O/X 문제 생성 및 검증 시도 (Attempt {attempt+1}/{MAX_RETRIES})")
        
        # 2-1. OX Writer: 계획과 피드백을 반영하여 JSON 생성 (Self-Schema Awareness)
        # *Writer는 이미 정의된 'ox_problems' 스키마를 알고 있다고 가정함
        print("  - O/X 문제 생성 중...")
        generated_json_str = OXWriter(
            lecture_material=lecture_material,      # 강의 자료 원문 참조
            concept_plan=concept_plan,                 # 출제 계획 (O/X 배분 포함)
            current_feedback=current_feedback,         # 이전 턴의 피드백 (없으면 null)
            target_problem_count=target_problem_count, # 목표 개수
            user_profile=user_profile,               # 스타일 가이드(언어, 시나리오, 함정 파기 수준 등)
            prior_content=generated_json            # 이전 턴의 OX 문제 세트 (없으면 null)
        )

        # str로 받은 응답을 딕셔너리 형태로 변환
        generated_json = json.loads(generated_json_str)
        print(f"  - {len(generated_json['ox_problems'])}개의 O/X 문제 생성 완료.")

        # 2-2. OX Validator: 품질 검증
        print("  - 품질 검증 중...")
        # 생성된 문제의 Fact Check (정답이 맞는지) 및 의도(Intent) 서술 적절성 확인
        validation_result_str = OXValidator(
            target_content=generated_json, # 방금 만든 OX 문제 내용
            source =lecture_material,      # 원본 강의 자료 (Fact Check용)
            guideline=user_profile,        # 스타일 준수 여부 확인
            required_count=target_problem_count
        )

        # str로 받은 응답을 딕셔너리 형태로 변환
        validation_result = json.loads(validation_result_str)

        # 2-3. Decision Making
        if validation_result['is_valid'] == True:
            # 검증 통과 시 루프 즉시 종료 및 반환
            print("  - 검증 통과! O/X 문제 생성 완료.")
            return generated_json
        else:
            # 검증 실패 시 피드백을 업데이트하고 루프 재실행
            # 예: "3번 문제의 정답은 O가 아니라 X입니다. 강의 자료 12p에 반대 사례가 존재합니다."
            print(f"  - 검증 실패. 피드백: {validation_result['feedback_message']}")
            current_feedback = validation_result['feedback_message']
            continue

    # [Fallback] 최대 횟수 초과 시, 마지막으로 생성된 결과라도 반환 (혹은 에러 처리)
    print("\n[경고] 최대 재시도 횟수 초과. 마지막 생성 결과를 반환합니다.")
    return generated_json


# 테스트용 코드
# 실제 사용시는, Generate_OX()만 사용한다
if __name__ == "__main__":
    user_profile = {
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
    lecture_material = "/Users/jhkim/Desktop/LectureTestGenerator/SamSung(260109).pdf"
    # 사용자로부터 목표 문제 수 입력받기 (숫자만 허용)
    while True:
        try:
            target_problem_count = int(input("생성할 OX 문제 수를 입력하세요: "))
            if target_problem_count > 0:
                break
            else:
                print("양수를 입력해주세요.")
        except ValueError:
            print("올바른 숫자를 입력해주세요.")

    print("\n[Step 0] OX 문제 생성 시작...")
    generated_json = Generate_OX(user_profile, lecture_material, target_problem_count) # 딕셔너리 형태로 이미 반환됨
    print(">> OX 문제 생성 완료.")
    print(">> OX 문제 결과:")
    print(json.dumps(generated_json, indent=4, ensure_ascii=False)) # 딕셔너리를 CLI환경에서 예쁘게 출력