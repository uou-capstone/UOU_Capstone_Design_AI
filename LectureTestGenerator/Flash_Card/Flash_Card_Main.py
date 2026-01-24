from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json
import sys


# 프로젝트 루트, Common, 그리고 Flash_Card 폴더를 경로에 추가
current_dir = os.path.dirname(os.path.abspath(__file__))
root_path = os.path.abspath(os.path.join(current_dir, '..'))
common_path = os.path.abspath(os.path.join(current_dir, '..', 'Common'))
flash_card_gen_path = os.path.abspath(os.path.join(current_dir, 'Generate_flashCard'))

if root_path not in sys.path:
    sys.path.append(root_path)
if common_path not in sys.path:
    sys.path.append(common_path)
if flash_card_gen_path not in sys.path:
    sys.path.append(flash_card_gen_path)

from Common.Prior_Profile_Gen_Agent import Execute_Generator_PriorProfile
from Common.generate_FeedBack import Generator_feedBack
from Generate_flashCard import Generate_flashCard

from datetime import datetime

def Workflow_FlashCard_Generation(lecture_material, prev_userProfile=None):
    exam_type = "Flash_Card"
    
    print(f"\n{'='*20} [Workflow 시작] {'='*20}")
    
    # 1. 사전 Profile 제작
    print("\n[Step 1] 사용자 학습 프로필 생성/수정 단계")
    user_profile = Execute_Generator_PriorProfile(prev_userProfile, exam_type)
    print(">> 사용자 프로필 확정 완료.")

    # 2. 카드 개수 결정 (UI 시뮬레이션)
    print("\n[Step 2] 생성할 플래시 카드 개수 결정")
    while True:
        try:
            target_card_count_input = input("생성할 플래시 카드 개수를 입력하세요 (최대 30개, 기본 15개): ").strip()
            target_card_count = int(target_card_count_input or 15)
            if 1 <= target_card_count <= 30:
                break
            print("!! 1에서 30 사이의 숫자를 입력해주세요.")
        except ValueError:
            print("!! 올바른 숫자를 입력해주세요.")
    print(f">> 목표 카드 수: {target_card_count}개")

    # 3. 플래시 카드 생성
    print("\n[Step 3] 플래시 카드 생성 및 품질 검증 단계 시작")
    generated_cards = Generate_flashCard(
        user_profile=user_profile, 
        lecture_material=lecture_material, 
        target_card_count=target_card_count
    )
    
    # 4. 결과 출력 (UI 표현 시뮬레이션)
    print(f"\n{'='*20} [생성된 플래시 카드] {'='*20}")
    for card in generated_cards.get('flash_cards', []):
        print(f"ID: {card['id']} | [{card['category_tag']}]")
        print(f"  Q: {card['front_content']}")
        print(f"  A: {card['back_content']}")
        print("-" * 50)

    # 5. User 피드백 생성 에이전트 호출
    print("\n[Step 5] 학습 결과 로그 및 피드백 데이터 생성")
    current_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    feedback_data = Generator_feedBack(
        test_log_data=generated_cards, # flash_cards 리스트가 포함된 전체 결과 전달
        exam_type=exam_type,
        source_material=lecture_material,
        timestamp=current_timestamp
    )
    
    print(">> 피드백 데이터 생성 완료.")
    print(f"{'='*20} [Workflow 종료] {'='*20}\n")
    
    return {
        "user_profile": user_profile,
        "generated_cards": generated_cards,
        "feedback_data": feedback_data
    }

def main():
    if len(sys.argv) < 2:
        print("사용법: python Flash_Card_Main.py <강의자료_경로>")
        sys.exit(1)
    
    lecture_material = sys.argv[1]
    
    if not os.path.exists(lecture_material):
        print(f"Error: 파일을 찾을 수 없습니다: {lecture_material}")
        sys.exit(1)

    result = Workflow_FlashCard_Generation(lecture_material)

    # 최종 결과 출력
    print(f"\n{'#'*30} 최종 결과 {'#'*30}")
    
    print("\n[1] User Profile:")
    print(json.dumps(result['user_profile'], indent=2, ensure_ascii=False))
    
    print("\n[2] Generated Cards:")
    print(json.dumps(result['generated_cards'], indent=2, ensure_ascii=False))
    
    print("\n[3] Feedback Data:")
    print(json.dumps(result['feedback_data'], indent=2, ensure_ascii=False))
    
    print(f"\n{'#'*69}")

if __name__ == "__main__":
    main()
