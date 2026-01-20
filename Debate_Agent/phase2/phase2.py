import json
from google import genai
from google.genai import types
import pathlib
import os

from phase2_subAgent.Check_safety import llm_moderator_check_safety
from phase2_subAgent.Eval_assess_step import llm_evaluator_assess_step
from phase2_subAgent.Eval_assess_closing import llm_evaluator_assess_closing
from phase2_subAgent.Gen_intro import llm_moderator_generate_intro
from phase2_subAgent.Generate_Summary import llm_moderator_generate_summary
from phase2_subAgent.Debater_Generate_Attack import llm_debater_generate_attack

def run_debate_session_logic(session_profile, lecture_material):

    # 1. 설정값 파싱
    dialogue_style = session_profile.get('mode_configuration', {}).get('dialogue_style')

    # 학습 주제 및 키워드 추출
    topic_info = session_profile.get('content_context', {}).get('target_topic', {})
    topic_keyword = topic_info.get('keyword')
    topic_description = topic_info.get('description')

    # 규칙 및 난이도 설정
    rules = session_profile.get('session_rules', {})
    max_turns = rules.get('max_turns')
    difficulty = rules.get('difficulty_parameter', {}).get('level')

    # 2. 상태 변수 초기화
    history = []
    evaluation_logs = []
    current_score = 50
    turn_count = 0  # 0부터 시작 (실제 턴 표기는 +1 하여 사용)
    WINNING_THRESHOLD = 70

    retry_count = 0
    MAX_RETRIES = 3

    print("=== [", dialogue_style, "] 세션을 시작합니다. (난이도:", difficulty, ") ===")

    # 3. 오프닝 (사회자 LLM)
    intro_response_str = llm_moderator_generate_intro(topic_keyword, rules, topic_description, dialogue_style)
    intro_response = json.loads(intro_response_str)
    intro_message = intro_response.get("message")

    print("\n[사회자]:", intro_message)

    history.append({"role": "system", "content": intro_message, "turn": "Opening"})

    user_input = input("\n[나 (입론)]: ")

    # 4. 메인 토론 루프
    while turn_count < max_turns:

        # Step 4-1. 안전성 검사
        print("\n(시스템: 발언 안전성 검사 중...)")
        safety_check_str = llm_moderator_check_safety(user_input, topic_keyword, topic_description)
        safety_check = json.loads(safety_check_str)

        if safety_check.get('is_valid') == False:
            retry_count += 1

            warning_msg = safety_check.get('reason')
            print("([사회자]: 경고!", warning_msg, "(감점 -5점)")

            if retry_count >= MAX_RETRIES:
                print(f"\n[사회자]: 부적절한 입력이 {MAX_RETRIES}회 반복되어 세션을 강제 종료합니다.")
                final_status = "ABORT"
                break

            current_score = max(0, current_score - 5)
            user_input = input(f"[나 (다시 입력) - {retry_count}/{MAX_RETRIES}]: ")
            continue

        retry_count = 0

        current_turn_display = turn_count + 1
        history.append({"role": "user", "content": user_input, "turn": current_turn_display})

        # Step 4-2. 논리 평가
        print("(시스템: 논리 및 내용 평가 중...)")
        last_attack = history[-2]['content'] if len(history) > 2 else "Initial Argument"
        eval_result_str = llm_evaluator_assess_step(user_input, last_attack, lecture_material, dialogue_style, difficulty)
        eval_result = json.loads(eval_result_str)

        score_change = eval_result.get('score_delta', 0)
        current_score = max(0, min(100, current_score + score_change))

        evaluation_logs.append({
            "turn": current_turn_display,  
            "score_now": current_score,
            "reason": eval_result.get('rationale', '')
        })

        # Step 4-3. 콜드 게임 체크
        if current_score <= 20:
            print("\n[사회자]: 점수가 너무 낮아 더 이상 토론 진행이 어렵습니다. (Cold Game)")
            final_status = "COLD_GAME"
            break

        # Step 4-4. 반박 공격
        print("(시스템: Debater 반박 생성 중...)")
        debater_response_str = llm_debater_generate_attack(user_input, history, lecture_material, difficulty, dialogue_style)
        debater_response = json.loads(debater_response_str)
        debater_msg = debater_response.get('argument', '')

        print("\n[Debater]:", debater_msg)

        history.append({"role": "assistant", "content": debater_msg, "turn": current_turn_display})

        # Step 4-5. 다음 턴 준비
        turn_count += 1

        if turn_count < max_turns:
            user_input = input(f"\n[나 (반론 {turn_count + 1}/{max_turns})]: ")

    # 5. 마무리 단계
    if 'final_status' not in locals():
        print("\n[사회자]: 정해진 토론 시간이 끝났습니다. 최후 변론을 해주세요.")

        final_user_speech = input("[나 (최종 발언)]: ")
        
        history.append({"role": "user", "content": final_user_speech, "turn": "Final"})
        # Step 5-1. 최종 평가
        print("\n(시스템: 최종 평가 진행 중...)")
        final_eval_str = llm_evaluator_assess_closing(final_user_speech, history, lecture_material, difficulty, dialogue_style)
        final_eval = json.loads(final_eval_str)
        current_score = max(0, min(100, current_score + final_eval.get('score_delta', 0)))

        # 최종 평가 로그 추가
        evaluation_logs.append({
            "turn": "Final",
            "user_speech": final_user_speech,
            "score_now": current_score,
            "reason": final_eval.get('final_impression', '')
        })

        # Step 5-2. 승패 판정
        if current_score >= WINNING_THRESHOLD:
            final_status = "WIN"
        else:
            final_status = "LOSS"

        # Step 5-3. 결과 요약
        print("(시스템: 토론 전체 요약 생성 중...)")
        summary_context_str = llm_moderator_generate_summary(history, evaluation_logs, final_status)
        summary_context = json.loads(summary_context_str)

        print("\n" + "="*30)
        print("    결과:", final_status, "(최종 점수:", current_score, "점)")
        print("="*30)
        print("[총평]:", summary_context.get('summary_text', ''))

    # 6. 최종 결과 반환
    if 'summary_context' in locals(): 
        return final_status, evaluation_logs, summary_context, history
    else: 
        # 강제 종료된 경우 summary_context가 없음 -> 이를 처리하기 위함
        return final_status, evaluation_logs, None, history