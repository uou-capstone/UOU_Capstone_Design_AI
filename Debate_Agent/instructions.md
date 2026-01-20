# Debate Agent 매뉴얼

이 문서는 `Debate_Agent` 시스템의 동작 흐름과 각 단계별 실행 코드를 시나리오별로 설명

---

# 정상 시나리오

이 시나리오는 사용자가 모든 입력을 정상적으로 수행하고 토론을 완료하는 과정

## 1. 프로그램 시작 및 인자 검사 (`Debate_Agent_Main.py`)

사용자가 터미널에서 강의 자료를 인자로 주어 프로그램을 실행함.

```python:24:32:Debate_Agent_Main.py
def main():
    # CLI 인자 설정
    parser = argparse.ArgumentParser(description="Debate Agent Main Script")
    parser.add_argument("lecture_mat", type=str, help="강의 자료 내용 또는 강의 자료 파일 경로")
    args = parser.parse_args()

    lecture_material = args.lecture_mat

    print("=== Debate Agent 시작 ===")
```

- **동작**: `argparse`를 통해 `lecture_mat`(강의 자료)를 입력받음.
- **이동**: 이후 `Phase 1` 함수인 `Execute_Debate_Mode_Setup`을 호출하며 제어권이 `phase1/phase1.py`로 넘어감.

## 2. Phase 1: 세션 설정 (`phase1/phase1.py`)

토론을 시작하기 전, 필요한 설정(주제, 난이도, 최대 턴 수 등)을 사용자로부터 입력받아 완성함.

### 2.1 상태 체크 및 질문 생성
```python:42:57:phase1/phase1.py
        # 최초 값 채우기 루프
        while True:
            status_result = Check_Status(current_session_profile)

            if status_result.get("status") == "COMPLETE":
                stagnation_count = 0 
                break 
            
            # ... 생략 ...

            # 질문 생성 (반드시 출력은 result.text여야 함)
            question = generate_question(
                missing_fields=status_result.get("missing_fields"), 
                lecture_material=lecture_material
            )
```
- **파일**: `phase1/phase1.py` -> `phase1_subAgent/Check_Status.py`, `phase1_subAgent/Generate_Question.py`
- **동작**: `Check_Status`가 프로필의 빈 필드를 찾아내면, `generate_question`이 사용자에게 물어볼 질문을 생성함.

### 2.2 사용자 응답 처리 및 프로필 업데이트
```python:71:88:phase1/phase1.py
            # user 입력받기
            user_response = input("사용자: ")
            
            prev_profile_str = str(current_session_profile)

            update_result = fill_settings(current_session_profile, user_response)

            # 값 불러오기
            update_result = json.loads(update_result)
            
            # ... 생략 ...
            
            # 업데이트된 profile 가져오기
            new_profile = update_result.get("new_profile")
```
- **파일**: `phase1/phase1.py` -> `phase1_subAgent/Fill_Settings.py`
- **동작**: 사용자의 입력을 `fill_settings`로 분석하여 `current_session_profile`의 값을 채움.

### 2.3 설정 확정 (의도 분석)
```python:101:120:phase1/phase1.py
        while True:
            summary = format_session_summary(current_session_profile)
            
            print(f"이 설정으로 토론을 시작하시겠습니까?\n{summary}")
            user_response = input("사용자(승인/수정): ")

            intent_analysis_result = intent_analysis(user_response)
            
            # ... 생략 ...
            intent = intent_analysis_result.get("intent")

            if intent == "APPROVE":
                # ... 생략 ...
                return current_session_profile
```
- **파일**: `phase1/phase1.py` -> `phase1_subAgent/Intent_Analysis.py`
- **동작**: 설정이 완료되면 요약을 보여주고, 사용자가 승인(`APPROVE`)하면 `Phase 2`로 넘어감.

## 3. Phase 2: 토론 진행 (`phase2/phase2.py`)

설정된 프로필을 바탕으로 실제 토론이 이루어지는 메인 루프

### 3.1 토론 오프닝
```python:41:48:phase2/phase2.py
    # 3. 오프닝 (사회자 LLM)
    intro_response_str = llm_moderator_generate_intro(topic_keyword, rules, topic_description, dialogue_style)
    intro_response = json.loads(intro_response_str)
    intro_message = intro_response.get("message")

    print("\n[사회자]:", intro_message)

    history.append({"role": "system", "content": intro_message, "turn": "Opening"})
```
- **파일**: `phase2/phase2.py` -> `phase2_subAgent/Gen_intro.py`
- **동작**: 사회자가 토론의 시작을 알리고 주제를 소개함.

### 3.2 발언 안전성 검사
```python:55:60:phase2/phase2.py
        # Step 4-1. 안전성 검사
        print("\n(시스템: 발언 안전성 검사 중...)")
        safety_check_str = llm_moderator_check_safety(user_input, topic_keyword, topic_description)
        safety_check = json.loads(safety_check_str)

        if safety_check.get('is_valid') == False:
```
- **파일**: `phase2/phase2.py` -> `phase2_subAgent/Check_safety.py`
- **동작**: 사용자의 발언이 토론 주제를 벗어나거나 부적절한지 사회자가 검사함.

### 3.3 논리 평가 및 점수 산정
```python:80:87:phase2/phase2.py
        # Step 4-2. 논리 평가
        print("(시스템: 논리 및 내용 평가 중...)")
        last_attack = history[-2]['content'] if len(history) > 2 else "Initial Argument"
        eval_result_str = llm_evaluator_assess_step(user_input, last_attack, lecture_material, dialogue_style, difficulty)
        eval_result = json.loads(eval_result_str)

        score_change = eval_result.get('score_delta', 0)
        current_score = max(0, min(100, current_score + score_change))
```
- **파일**: `phase2/phase2.py` -> `phase2_subAgent/Eval_assess_step.py`
- **동작**: 평가자 LLM이 사용자의 발언을 분석하여 점수(`score_delta`)를 부여함.

### 3.4 상대방(Debater) 반박 생성
```python:101:107:phase2/phase2.py
        # Step 4-4. 반박 공격
        print("(시스템: Debater 반박 생성 중...)")
        debater_response_str = llm_debater_generate_attack(user_input, history, lecture_material, difficulty, dialogue_style)
        debater_response = json.loads(debater_response_str)
        debater_msg = debater_response.get('argument', '')

        print("\n[Debater]:", debater_msg)
```
- **파일**: `phase2/phase2.py` -> `phase2_subAgent/Debater_Generate_Attack.py`
- **동작**: 토론 상대인 `Debater`가 사용자의 논리에 대해 반박을 수행함. 이 루프는 `max_turns`만큼 반복됨.

### 3.5 최종 발언 및 승패 판정
```python:124:142:phase2/phase2.py
        # Step 5-1. 최종 평가
        print("\n(시스템: 최종 평가 진행 중...)")
        final_eval_str = llm_evaluator_assess_closing(final_user_speech, history, lecture_material, difficulty, dialogue_style)
        final_eval = json.loads(final_eval_str)
        current_score = max(0, min(100, current_score + final_eval.get('score_delta', 0)))

        # ... 생략 ...

        # Step 5-2. 승패 판정
        if current_score >= WINNING_THRESHOLD:
            final_status = "WIN"
        else:
            final_status = "LOSS"
```
- **파일**: `phase2/phase2.py` -> `phase2_subAgent/Eval_assess_closing.py`
- **동작**: 사용자의 최후 변론을 평가한 후, `WINNING_THRESHOLD(70점)`를 기준으로 최종 승패를 결정함.

## 4. Phase 3: 최종 리포트 생성 (`phase3/phase3.py`)

모든 토론 데이터(기록, 점수 변화, 승패 등)를 바탕으로 결과 보고서를 생성함.

```python:9:10:phase3/phase3.py
def Execute_Debate_Mode_Phase3(final_status, evaluation_logs, summary_context, history):
    return EvaluationLogGenerator(final_status, evaluation_logs, summary_context, history)
```
- **파일**: `phase3/phase3.py` -> `phase3_subAgent/Eval_log_gen.py`
- **동작**: `EvaluationLogGenerator` 클래스를 통해 최종 결과를 정제된 텍스트 형태(JSON을 텍스트 형태로)로 반환하고, 메인 스크립트에서 이를 출력하며 종료됨.

---

# 비정상/예외 시나리오

## 1. 설정 단계 정체 (Phase 1 Stagnation)
- **발생 조건**: 사용자가 필수 정보를 제공하지 못하거나 모호한 답변을 3회 이상 반복할 때.
- **코드 근거**:
```python:49:51:phase1/phase1.py
            if stagnation_count >= MAX_STAGNATION:
                print("설정을 완료하지 못했습니다. 초기화하거나 종료합니다.")
                return None
```
- **결과**: `Debate_Agent_Main.py`에서 `session_profile`이 `None`이 되어 프로그램을 종료함.

## 2. 발언 부적절 반복 (Phase 2 Safety Abort)
- **발생 조건**: 사용자가 사회자의 경고에도 불구하고 부적절한 발언을 3회 반복할 때.
- **코드 근거**:
```python:66:69:phase2/phase2.py
            if retry_count >= MAX_RETRIES:
                print(f"\n[사회자]: 부적절한 입력이 {MAX_RETRIES}회 반복되어 세션을 강제 종료합니다.")
                final_status = "ABORT"
                break
```
- **결과**: 세션이 즉시 중단되며 `ABORT` 상태로 종료됨.

## 3. 콜드 게임 (Phase 2 Cold Game)
- **발생 조건**: 사용자의 발언 논리가 매우 부족하여 점수가 20점 이하로 떨어질 때.
- **코드 근거**:
```python:96:99:phase2/phase2.py
        # Step 4-3. 콜드 게임 체크
        if current_score <= 20:
            print("\n[사회자]: 점수가 너무 낮아 더 이상 토론 진행이 어렵습니다. (Cold Game)")
            final_status = "COLD_GAME"
            break
```
- **결과**: 더 이상의 토론이 무의미하다고 판단하여 즉시 패배 처리 및 종료됨.
