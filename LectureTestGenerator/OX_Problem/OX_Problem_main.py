from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json
import sys

# 프로젝트 루트, Common, 그리고 OX_Problem 폴더를 경로에 추가
current_dir = os.path.dirname(os.path.abspath(__file__))
root_path = os.path.abspath(os.path.join(current_dir, '..'))
common_path = os.path.abspath(os.path.join(current_dir, '..', 'Common'))

if root_path not in sys.path:
    sys.path.append(root_path)
if common_path not in sys.path:
    sys.path.append(common_path)
if current_dir not in sys.path:
    sys.path.append(current_dir)

from Common.Prior_Profile_Gen_Agent import Execute_Generator_PriorProfile
from Common.generate_FeedBack import Generator_feedBack
from Generate_OX.Generate_OX import Generate_OX
from Gen_OX_feedBack.Gen_OX_FeedBack import Gen_OX_feedBack
from datetime import datetime

# 문제 생성까지만
def Workflow_OX_Problem_Generation(lecture_material, prev_userProfile=None):
    exam_type = "OX_Problem"
    
    # 1. 사전 Profile 제작
    print("\n[Step 1] 사용자 학습 프로필 생성/수정 단계")
    user_profile = Execute_Generator_PriorProfile(prev_userProfile, exam_type)
    print(">> 사용자 프로필 확정 완료.")
    
    # 2. 문제 개수 결정 (UI 시뮬레이션)
    print("\n[Step 2] 생성할 OX 문제 개수 결정")
    while True:
        try:
            target_problem_count_input = input("생성할 OX 문제 개수를 입력하세요 (최대 15개, 기본 10개): ").strip()
            target_problem_count = int(target_problem_count_input or 10)
            if 1 <= target_problem_count <= 15:
                break
            print("!! 1에서 15 사이의 숫자를 입력해주세요.")
        except ValueError:
            print("!! 올바른 숫자를 입력해주세요.")
    print(f">> 목표 문제 수: {target_problem_count}개")

    # 3. OX 문제 생성
    print("\n[Step 2] OX 문제 생성 단계")
    generated_ox_problems = Generate_OX(user_profile, lecture_material, target_problem_count)
    print(">> OX 문제 생성 완료.")

    return {
        "user_profile": user_profile,
        "generated_ox_problems": generated_ox_problems
    }

# 사용자 응답 수집 로직 분리
def Collect_User_Answers(generated_ox_problems):
    print("\n[사용자 응답 수집 시작]")
    user_answers = {}
    for problem in generated_ox_problems.get('ox_problems', []):
        p_id = problem['id']
        question = problem['question_content']
        print(f"\n[문제 {p_id}] {question}")
        while True:
            user_input = input("답변을 입력하세요 (O 또는 X): ").strip().upper()
            if user_input in ['O', 'X']:
                user_answers[p_id] = user_input
                break
            print("!! 'O' 또는 'X'만 입력해주세요.")
    print(">> 사용자 응답 수집 완료.")
    return user_answers

# 피드백 생성 호출까지 담당 (사용자 응답은 외부에서 받음)
def Workflow_OX_Problem_Feedback(generated_ox_problems, user_profile, user_answers, lecture_material):
    exam_type = "OX_Problem"
    
    # 1. OX 채점 결과 생성
    print("\n[Step 1] OX 채점 및 기초 피드백 생성")
    grading_data = Gen_OX_feedBack(generated_ox_problems, user_answers)
    
    # 2. 통합 피드백 생성 에이전트 호출 (Common)
    print("[Step 2] 통합 학습 결과 로그 및 피드백 생성")
    current_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    feedback_data = Generator_feedBack(
        test_log_data=grading_data, 
        exam_type=exam_type,
        source_material=lecture_material,
        timestamp=current_timestamp
    )
    print(">> 최종 피드백 생성 완료.")

    return {
        "user_profile": user_profile,
        "generated_ox_problems": generated_ox_problems,
        "grading_data": grading_data,
        "feedback_data": feedback_data # 공통 피드백 프로파일은 여기 부분
    }

# 실제로는 Workflow_OX_Problem_Generation() -> Collect_User_Answers() -> Workflow_OX_Problem_Feedback() 순으로 호출
if __name__ == "__main__":
    lecture_material = "/Users/jhkim/Desktop/LectureTestGenerator/SamSung(260109).pdf"
    prev_userProfile = None
    
    # 1. 문제 생성 Workflow
    print("\n[Step 1] 문제 생성 Workflow 시작...")
    gen_result = Workflow_OX_Problem_Generation(lecture_material, prev_userProfile)
    user_profile = gen_result["user_profile"]
    generated_ox_problems = gen_result["generated_ox_problems"]
    
    # 2. 사용자 응답 수집 (분리된 함수 호출)
    user_answers = Collect_User_Answers(generated_ox_problems)
    
    # 3. 피드백 생성 Workflow
    print("\n[Step 2] 피드백 생성 Workflow 시작...")
    feedback_result = Workflow_OX_Problem_Feedback(generated_ox_problems, user_profile, user_answers, lecture_material)
    grading_data = feedback_result["grading_data"]

    # 나중에 활용하는 데이터는 이거임 (공통 피드백 프로파일)
    feedback_data = feedback_result["feedback_data"]

    print("\n" + "="*50)
    print("최종 결과 요약:")
    print("\n[1] User Profile:")
    print(json.dumps(user_profile, indent=4, ensure_ascii=False))
    print("\n[2] Generated OX Problems:")
    print(json.dumps(generated_ox_problems, indent=4, ensure_ascii=False))
    print("\n[3] User Answers:")
    print(json.dumps(user_answers, indent=4, ensure_ascii=False))
    print("\n[4] Grading Data:")
    print(json.dumps(grading_data, indent=4, ensure_ascii=False))
    print("\n[5] Final Feedback Data:")
    print(json.dumps(feedback_data, indent=4, ensure_ascii=False))
    print("\n" + "="*50)