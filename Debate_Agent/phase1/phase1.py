import json
from google import genai
from google.genai import types
import pathlib
import os
from phase1_subAgent.Generate_Question import generate_question
from phase1_subAgent.Fill_Settings import fill_settings
from phase1_subAgent.Intent_Analysis import intent_analysis
from phase1_subAgent.Generate_Summary import format_session_summary
from phase1_subAgent.Check_Status import Check_Status

def Execute_Debate_Mode_Setup(lecture_material):

    current_session_profile = {
        "mode_configuration": { 
            "dialogue_style": "Debate_Mode", 
            "interaction_goal": None,        
            "goal_description": None         
        },
        "content_context": { 
            "target_topic": {
                "keyword": None,             
                "description": None          
            },
            "knowledge_boundary": "Lecture_Only" 
        },
        "session_rules": { 
            "max_turns": None,               
            "difficulty_parameter": { 
                "level": None,               
                "custom_constraints": []     
            }
        }
    }

    MAX_STAGNATION = 3
    stagnation_count = 0 
    
    while True:
        
        # 최초 값 채우기 루프
        while True:
            status_result = Check_Status(current_session_profile)

            if status_result.get("status") == "COMPLETE":
                stagnation_count = 0 
                break 
            
            if stagnation_count >= MAX_STAGNATION:
                print("설정을 완료하지 못했습니다. 초기화하거나 종료합니다.")
                return None
            
            # 질문 생성 (반드시 출력은 result.text여야 함)
            question = generate_question(
                missing_fields=status_result.get("missing_fields"), 
                lecture_material=lecture_material
            )
            
            # 값 불러오기
            question = json.loads(question)
            question_text = question.get("question_text")
            question_recommand = question.get("recommendations")

            # 값 출력하기
            print(question_text)

            if question_recommand:
                print(f"추천: {question_recommand}")
            
            # user 입력받기
            user_response = input("사용자: ")
            

            prev_profile_str = str(current_session_profile)

            update_result = fill_settings(current_session_profile, user_response)

            # 값 불러오기
            update_result = json.loads(update_result)
            
            # false가 나온경우
            if not update_result.get("is_valid"):
                stagnation_count += 1
                print("이해하지 못했습니다. 다시 말씀해 주세요.")
                continue
            
            # 업데이트된 profile 가져오기
            new_profile = update_result.get("new_profile")
            
            # true가 나왔는데 업데이트 된게 없는 경우
            if str(new_profile) == prev_profile_str:
                stagnation_count += 1
                print("설정이 변경되지 않았습니다. 구체적으로 말씀해 주세요.")
                continue
            
            # 정상적으로 업데이트 된 경우
            stagnation_count = 0
            current_session_profile = new_profile


        while True:
            summary = format_session_summary(current_session_profile)
            
            print(f"이 설정으로 토론을 시작하시겠습니까?\n{summary}")
            user_response = input("사용자(승인/수정): ")

            intent_analysis_result = intent_analysis(user_response)
            
            # 값 불러오기
            intent_analysis_result = json.loads(intent_analysis_result)
            intent = intent_analysis_result.get("intent")

            if intent == "APPROVE":
                final_check = Check_Status(current_session_profile)
                
                if final_check.get("status") == "INCOMPLETE":
                    print("수정 과정에서 필수 정보가 누락되었습니다. 다시 입력 단계로 돌아갑니다.")
                    break # 최초 루프로 되돌아감
                
                return current_session_profile

            elif intent == "MODIFY":
                update_result = fill_settings(current_session_profile, intent_analysis_result.get("Modifications"))
                
                # 값 불러오기
                update_result = json.loads(update_result)

                if update_result.get("is_valid"):
                    current_session_profile = update_result.get("new_profile")
                    print("설정이 수정되었습니다.")
                else:
                    print("수정 사항을 명확히 인식하지 못했습니다.")
                continue

            else:
                print("다시 말씀해 주세요. (예: '좋아', '어디를 수정해줘')")
