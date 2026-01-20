import sys
import os
import argparse
import json

# 각 페이즈 폴더를 sys.path에 추가하여 내부 subAgent 임포트가 가능하도록 설정
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(current_dir, 'phase1'))
sys.path.append(os.path.join(current_dir, 'phase2'))
sys.path.append(os.path.join(current_dir, 'phase3'))

# 각 페이즈의 메인 함수 임포트
# sys.path에 추가했으므로 파일명으로 직접 임포트 가능
try:
    from phase1 import Execute_Debate_Mode_Setup
    from phase2 import run_debate_session_logic
    from phase3 import Execute_Debate_Mode_Phase3
except ImportError as e:
    # 패키지 구조에 따라 다를 수 있으므로 폴더명.파일명 방식도 시도
    from phase1.phase1 import Execute_Debate_Mode_Setup
    from phase2.phase2 import run_debate_session_logic
    from phase3.phase3 import Execute_Debate_Mode_Phase3

def main():
    # CLI 인자 설정
    parser = argparse.ArgumentParser(description="Debate Agent Main Script")
    parser.add_argument("lecture_mat", type=str, help="강의 자료 내용 또는 강의 자료 파일 경로")
    args = parser.parse_args()

    lecture_material = args.lecture_mat

    print("=== Debate Agent 시작 ===")

    # Phase 1: 세션 설정 및 준비
    print("\n[Phase 1] 세션 설정을 시작합니다...")
    session_profile = Execute_Debate_Mode_Setup(lecture_material)
    
    if not session_profile:
        print("세션 설정이 완료되지 않아 종료합니다.")
        return

    # Phase 2: 토론 진행
    print("\n[Phase 2] 토론 세션을 시작합니다...")
    final_status, evaluation_logs, summary_context, history = run_debate_session_logic(session_profile, lecture_material)

    # Phase 3: 최종 평가 로그 생성 및 출력
    print("\n[Phase 3] 최종 평가 보고서를 생성 중입니다...")
    final_output = Execute_Debate_Mode_Phase3(final_status, evaluation_logs, summary_context, history)

    print("\n=== 최종 결과 ===")
    print(final_output)
    print("=== Debate Agent 종료 ===")

if __name__ == "__main__":
    main()
