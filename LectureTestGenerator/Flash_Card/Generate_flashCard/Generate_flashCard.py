from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

from Gen_flashCard_SubAgent.ConceptPlanner import Agent_ConceptPlanner
from Gen_flashCard_SubAgent.CardWriter import Agent_CardWriter
from Gen_flashCard_SubAgent.QualityValidator import Agent_QualityValidator

def Generate_flashCard(user_profile, lecture_material, target_card_count=15):
    
    # [Step 1] Concept Planner: 무엇을 낼지 계획
    print(f"\n[Step 1] 핵심 개념 추출 및 출제 계획 수립 중... (목표 카드 수: {target_card_count})")
    # 강의 자료에서 Profile의 의도(심층 이해, 범위 등)에 맞는 핵심 개념 추출
    concept_plan = Agent_ConceptPlanner(
        source_text=lecture_material, 
        profile=user_profile,
        target_count=target_card_count
    )
    print(">> 출제 계획 수립 완료.")

    # [Step 2] Generation & Validation Loop (Max 3)
    current_feedback = None # 초기 피드백은 없음
    generated_json = None   # 결과물을 담을 변수
    
    MAX_RETRIES = 3
    
    for attempt in range(MAX_RETRIES):
        print(f"\n[Step 2-{attempt+1}] 플래시 카드 생성 및 검증 시도 (Attempt {attempt+1}/{MAX_RETRIES})")
        
        # 2-1. Card Writer: 계획과 피드백을 반영하여 JSON 생성 (Self-Schema Awareness)
        # *Writer는 이미 정의된 'flash_card' 스키마를 알고 있다고 가정함
        print("  - 카드 생성 중...")
        generated_json_str = Agent_CardWriter(
            source_text=lecture_material,    # 강의 자료 원문 참조
            plan=concept_plan,               # 출제 계획
            feedback=current_feedback,       # 이전 턴의 피드백 (없으면 null)
            prior_content = generated_json, # 이전 턴의 플래시 카드 (없으면 null)
            num_cards=target_card_count,     # 목표 개수
            profile=user_profile             # 스타일 가이드(언어, 시나리오 등)
        )

        generated_json = json.loads(generated_json_str)
        print(f"  - {len(generated_json['flash_cards'])}개의 카드 생성 완료.")

        # 2-2. Quality Validator: 품질 검증
        print("  - 품질 검증 중...")
        validation_result_str = Agent_QualityValidator(
            target_content=generated_json, # 방금 만든 카드 내용
            source =lecture_material,  # 원본 강의 자료 (Fact Check용)
            guideline=user_profile,        # 스타일 준수 여부 확인
            required_count=target_card_count
        )

        validation_result = json.loads(validation_result_str)
        
        # 2-3. Decision Making
        if validation_result['is_valid'] == True:
            # 검증 통과 시 루프 즉시 종료 및 반환
            print(">> 품질 검증 통과! 최종 결과물을 반환합니다.")
            return generated_json
        else:
            # 검증 실패 시 피드백을 업데이트하고 루프 재실행
            # 예: "3번 카드의 설명이 강의 자료와 다릅니다. 수식 유도를 더 포함하세요."
            print(f"  !! 품질 검증 미통과: {validation_result['feedback_message']}")
            current_feedback = validation_result['feedback_message']
            print("  - 피드백을 반영하여 재생성을 시도합니다.")
            continue

    # [Fallback] 최대 횟수 초과 시, 마지막으로 생성된 결과라도 반환 (혹은 에러 처리)
    # (일반적으로는 마지막 피드백을 반영하려고 노력한 결과를 반환함)
    print(f"\n!! 최대 재시도 횟수({MAX_RETRIES})에 도달했습니다. 현재까지의 결과물을 반환합니다.")

    # 딕셔너리 형태로 변환하여 반환
    return generated_json