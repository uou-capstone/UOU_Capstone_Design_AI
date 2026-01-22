from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json
# 디렉토리 구조 변경시, 해당 부분 수정해야함
from Prior_Profile_Gen_SubAgent.Update_Profile_Logic import UpdateProfileLogic
from Prior_Profile_Gen_SubAgent.Profile_Agent import ProfileAgent_analyze

# 프로파일 초기화 함수
def initialize_empty_schema():

    return {
        "learning_goal": {
            "focus_areas": [],
            "target_depth": "",
            "question_modality": ""
        },
        "user_status": {
            "proficiency_level": "",
            "weakness_focus": None
        },
        "interaction_style": {
            "language_preference": "",
            "scenario_based": None
        },
        "feedback_preference": {
            "strictness": "",
            "explanation_depth": ""
        },
        "scope_boundary": ""
    }


# 현재 설정중인 프로파일을 보기 좋게 출력하는 역할
def display_currentProfile(current_profile):
    lines = []
    
    # learning_goal
    lines.append("=== 학습 목표 ===")
    focus = ', '.join(current_profile['learning_goal']['focus_areas']) if current_profile['learning_goal']['focus_areas'] else '(미설정)'
    lines.append(f"  집중 학습 영역: {focus}")
    lines.append(f"  목표 이해 수준: {current_profile['learning_goal']['target_depth'] or '(미설정)'}")
    lines.append(f"  문제 출제 스타일: {current_profile['learning_goal']['question_modality'] or '(미설정)'}")
    lines.append("")
    
    # user_status
    lines.append("=== 사용자 상태 ===")
    lines.append(f"  현재 지식 수준: {current_profile['user_status']['proficiency_level'] or '(미설정)'}")
    weakness = current_profile['user_status']['weakness_focus'] if current_profile['user_status']['weakness_focus'] is not None else '(미설정)'
    lines.append(f"  취약점 집중 모드: {weakness}")
    lines.append("")
    
    # interaction_style
    lines.append("=== 상호작용 스타일 ===")
    lines.append(f"  언어 선호: {current_profile['interaction_style']['language_preference'] or '(미설정)'}")
    scenario = current_profile['interaction_style']['scenario_based'] if current_profile['interaction_style']['scenario_based'] is not None else '(미설정)'
    lines.append(f"  시나리오 기반 문제: {scenario}")
    lines.append("")
    
    # feedback_preference
    lines.append("=== 피드백 선호 ===")
    lines.append(f"  채점 엄격도: {current_profile['feedback_preference']['strictness'] or '(미설정)'}")
    lines.append(f"  해설 깊이: {current_profile['feedback_preference']['explanation_depth'] or '(미설정)'}")
    lines.append("")
    
    # scope_boundary
    lines.append("=== 지식 범위 ===")
    lines.append(f"  탐색 범위: {current_profile['scope_boundary'] or '(미설정)'}")
    
    return "\n".join(lines)

def Execute_Generator_PriorProfile(prev_userProfile, exam_type):
    # 1. Context Loading (수정모드 진입 여부 플래그)
    is_modification_mode = False  # 수정 모드 진입 여부 플래그
    if prev_userProfile is not None: # 입력 프로파일이 있다면 수정모드 ON
        current_profile = prev_userProfile
        is_modification_mode = True
    else:
        current_profile = initialize_empty_schema() # 프로파일 초기화 진행

    # 2. Exam Type은 별도로 처리 한다
    if exam_type == "Flash_Card":
        # 만약 프로파일에 feedback_preference 키가 없다면 -> 디폴트값 추가를 위해 초기화
        if current_profile['feedback_preference'] is None:
            current_profile['feedback_preference'] = {}
        # Force default values
        current_profile['feedback_preference']['strictness'] = "Lenient"
        current_profile['feedback_preference']['explanation_depth'] = "Answer_Only"

    # Case 2: Re-generation/Modification Check (Pre-Loop)
    # 최초 생성이 아닐 경우(prev_userProfile 존재), 사용자에게 확인 절차를 거침
    if is_modification_mode:
        MAX_MOD_TURNS = 3
        for _ in range(MAX_MOD_TURNS):
            # 현재 설정된 프로필 내용을 사용자에게 보여줌
            print(f"현재 설정된 프로필:\n{display_currentProfile(current_profile)}")  # display_currentProfile 함수를 통해 프로필을 포맷팅하여 출력
            print("위 설정대로 진행하시겠습니까? 수정이 필요하면 내용을 입력해주세요. (Enter to Pass)")

            user_check = input()

            # 사용자가 입력을 했다면(수정 요청), 프로필을 업데이트하고 다시 확인 루프 진행
            if user_check and user_check.strip() != "":
                current_profile = UpdateProfileLogic(current_profile, user_check)
                # 수정된 내용을 다시 확인받기 위해 루프 계속(continue)
            # 사용자가 별도 입력 없이 넘어갔다면(Pass), 기존 프로필 그대로 반환
            else:
                return current_profile
        
        # 최대 횟수만큼 수정만 반복하고 끝난 경우, 아래 Main Decision Loop로 넘어가서(Fall-through) 검증 수행

    # 3. Main Decision Loop (Case1: 처음부터 프로파일을 작성하는 시나리오에 해당)
    conversation_history = []
    MAX_TURNS = 5

    for current_turn in range(MAX_TURNS):
        # Analyze current profile status
        # (수정이 발생했다면 여기서 변경된 current_profile을 기준으로 다시 분석함)
        # ProfileAgent_analyze는 프로파일내 비어있는 항목있는지 검사, 있다면 그걸 채우기 위한 질문 생성해줌
        agent_response_str = ProfileAgent_analyze(
            current_profile=current_profile,
            exam_type=exam_type,
        )

        # Parse the JSON response string
        agent_response = json.loads(agent_response_str)

        # Case A: Information is missing or unclear
        if agent_response['status'] == "INCOMPLETE":
            missing_info_queries = agent_response['missing_info_queries']

            # Interaction
            print(missing_info_queries)
            user_answer = input()

            # Update Context & Profile
            conversation_history.append({"role": "agent", "content": missing_info_queries})
            conversation_history.append({"role": "user", "content": user_answer})
            # 유저가 입력한 내용을 바탕으로 프로파일을 수정한다
            
            current_profile_str = UpdateProfileLogic(current_profile, user_answer)
            current_profile = json.loads(current_profile_str)
            
            continue
        # Case B: Profile is fully defined
        elif agent_response['status'] == "COMPLETE":
            # 최종 확인 단계 - 이 루프 내에서만 수정/확인 반복
            MAX_FINAL_CHECK_TURNS = 3
            
            for _ in range(MAX_FINAL_CHECK_TURNS):
                # 완성된 프로필을 사용자에게 보여줌
                print(f"프로필 작성이 완료되었습니다:\n{display_currentProfile(current_profile)}")
                print("이대로 진행하시겠습니까? 수정사항이 있다면 입력해주세요. (Enter to confirm)")
                
                user_final_check = input()
                
                # 수정 요청이 있는 경우
                if user_final_check and user_final_check.strip() != "":
                    # 프로필 업데이트
                    current_profile_str = UpdateProfileLogic(current_profile, user_final_check)
                    current_profile = json.loads(current_profile_str)
                    
                    # 대화 이력에 추가
                    conversation_history.append({"role": "user", "content": user_final_check})
                    
                    # 수정된 프로필을 다시 보여주기 위해 최종 확인 루프 계속
                    continue
                
                # 수정사항이 없는 경우 (Enter만 입력)
                else:
                    # 최종 확인 완료, 프로필 반환
                    return current_profile
            
            # 최대 확인 횟수를 초과한 경우에도 현재 프로필 반환
            print("최대 확인 횟수를 초과했습니다. 현재 프로필을 반환합니다.")
            return current_profile

    # Fallback
    print("최대 횟수를 초과했습니다. 현재 프로필을 반환합니다.")
    return current_profile