# 토론 에이전트(Debate Agent) 워크플로우 가이드

## Debate Agent 프로젝트 구조 개요

```
Debate_Agent/
├── Debate_Agent_Main.py                # 메인 엔트리 포인트 (전체 워크플로우 조율)
├── Debate_Agent_Guide.md               # 현재 문서 (워크플로우 가이드)
│
├── phase1/                             # Phase 1: 토론 세션 설정 및 준비
│   ├── phase1.py                       # Phase 1 메인 로직 (대화형 세션 설정)
│   └── phase1_subAgent/                # Phase 1 하위 에이전트들
│       ├── Check_Status.py             # 세션 프로파일 완성도 검사
│       ├── Generate_Question.py        # 누락 필드 입력 질문 생성
│       ├── Fill_Settings.py            # 사용자 응답 파싱 및 프로파일 업데이트
│       ├── Intent_Analysis.py          # 승인/수정 의도 분석
│       ├── Generate_Summary.py         # 세션 설정 요약문 생성
│       └── phase1_subAgent_Prompt/     # 각 에이전트 프롬프트 및 스키마
│           ├── Fill_Settings_Prompt/
│           │   ├── fill_Settings_SystemPrompt.md
│           │   └── fillSettingsResponse_Object.json
│           ├── Generate_Question_Prompt/
│           │   ├── Generate_Question_System_Prompt.md
│           │   └── question_Object_Schema.json
│           └── Intent_Analyzer_Prompt/
│               ├── Intent_Analysis_Object.json
│               └── Intent_Analysis_SystemPrompt.md
│
├── phase2/                             # Phase 2: 토론 세션 진행
│   ├── phase2.py                       # Phase 2 메인 로직 (토론 턴제 진행)
│   └── phase2_subAgent/                # Phase 2 하위 에이전트들
│       ├── Gen_intro.py                # 토론 오프닝 메시지 생성 (사회자)
│       ├── Check_safety.py             # 발언 안전성 검사 (사회자)
│       ├── Eval_assess_step.py         # 턴별 논리 평가 (평가자)
│       ├── Debater_Generate_Attack.py  # AI 토론자 반박 생성
│       ├── Eval_assess_closing.py      # 최종 변론 평가 (평가자)
│       ├── Generate_Summary.py         # 토론 전체 요약 생성 (사회자)
│       └── phase2_subAgent_Prompt/     # 각 에이전트 프롬프트 및 스키마
│           ├── moderator_gen_intro_Prompt/
│           │   ├── moderator_gen_intro_Object.json
│           │   └── moderator_gen_intro_Prompt.md
│           ├── moderator_check_safety_Prompt/
│           │   ├── check_safety_object.json
│           │   └── check_safety_SystemPrompt.md
│           ├── evaluator_assess_step_Prompt/
│           │   ├── evaluator_assess_step_Object.json
│           │   └── evaluator_assess_step_SystemPrompt.md
│           ├── debater_gen_attack/
│           │   ├── debater_Attack_Object.json
│           │   └── debater_gen_attack_SystemPrompt.md
│           ├── eval_assess_closing/
│           │   ├── eval_assess_closing_Object.json
│           │   └── eval_assess_closing_SystemPrompt.md
│           └── moderator_gen_summary_Prompt/
│               ├── moderator_gen_summary_object.json
│               └── moderator_gen_summary_SystemPrompt.md
│
└── phase3/                             # Phase 3: 최종 평가 로그 생성
    ├── phase3.py                       # Phase 3 메인 로직 (최종 보고서 생성)
    └── phase3_subAgent/                # Phase 3 하위 에이전트
        ├── Eval_log_gen.py             # 최종 평가 보고서 생성기
        └── phase3_subAget_Prompt/
            └── eval_log_generator_Prompt/
                ├── eval_log_gen_Object.json
                └── eval_log_gen_SystemPrompt.md
```

**주요 특징**:
- **3단계 파이프라인**: Phase 1(세션 설정) → Phase 2(토론 진행) → Phase 3(평가 보고서)
- **멀티 에이전트 시스템**: 사회자(Moderator), 평가자(Evaluator), 토론자(Debater) 역할 분리
- **적응형 대화 시스템**: 사용자 입력을 실시간으로 파싱하여 세션 프로파일을 동적으로 구성
- **실시간 점수 시스템**: 각 턴마다 논리성을 평가하여 점수 조정, 승패 판정

---

이 가이드는 `Debate_Agent_Main.py`를 중심으로 토론 세션이 설정되고, 실시간으로 진행되며, 최종 평가 보고서가 생성되는 전 과정을 설명합니다.

---

## 1. 메인 엔트리 포인트: `if __name__ == "__main__":`
프로그램 실행 시 가장 먼저 호출되며, 전체 워크플로우(`세션 설정 -> 토론 진행 -> 평가 보고서 생성`)를 순차적으로 실행

*   **파일 위치**: `Debate_Agent/Debate_Agent_Main.py`
*   **주요 코드**:

```python
if __name__ == "__main__":
    # 1. CLI 인자 파싱
    parser = argparse.ArgumentParser(description="Debate Agent Main Script")
    parser.add_argument("lecture_mat", type=str, help="강의 자료 내용 또는 강의 자료 파일 경로")
    args = parser.parse_args()
    lecture_material = args.lecture_mat
    
    # 2. Phase 1: 세션 설정
    session_profile = Execute_Debate_Mode_Setup(lecture_material)
    
    # 3. Phase 2: 토론 진행
    final_status, evaluation_logs, summary_context, history = run_debate_session_logic(session_profile, lecture_material)
    
    # 4. Phase 3: 최종 평가 보고서 생성
    final_output = Execute_Debate_Mode_Phase3(final_status, evaluation_logs, summary_context, history)
```

---

## 2. [Phase 1] 토론 세션 설정 프로세스: `Execute_Debate_Mode_Setup`
사용자와 대화하며 토론 주제, 목표, 난이도, 최대 턴 수 등을 포함한 세션 프로파일을 완성하는 단계

### 세션 프로파일 구조
Phase 1에서 완성해야 하는 세션 프로파일 객체는 다음과 같은 구조를 가짐:

```python
{
    "mode_configuration": {
        "dialogue_style": "Debate_Mode",
        "interaction_goal": None,        # 토론 목표 (예: "비판적 사고 훈련")
        "goal_description": None         # 목표 상세 설명
    },
    "content_context": {
        "target_topic": {
            "keyword": None,             # 토론 주제 키워드 (예: "인공지능의 윤리")
            "description": None          # 주제 상세 설명
        },
        "knowledge_boundary": "Lecture_Only"
    },
    "session_rules": {
        "max_turns": None,               # 최대 토론 턴 수 (예: 5)
        "difficulty_parameter": {
            "level": None,               # 난이도 (예: "중급")
            "custom_constraints": []
        }
    }
}
```

### [Step 1] 필수 필드 체크 및 질문 생성 루프
세션 프로파일의 모든 필수 필드가 채워질 때까지 반복

*   **파일 위치**: `Debate_Agent/phase1/phase1.py`
*   **호출 흐름**:

```python
# phase1.py 54-63행
while True:
    status_result = Check_Status(current_session_profile)

    if status_result.get("status") == "COMPLETE":
        stagnation_count = 0 
        break 
    
    if stagnation_count >= MAX_STAGNATION:
        print("설정을 완료하지 못했습니다. 초기화하거나 종료합니다.")
        return None
```

#### Sub-Step 1-1: 세션 프로파일 완성도 검사

*   **호출 함수**: `Check_Status(current_session_profile)`
*   **파일 위치**: `Debate_Agent/phase1/phase1_subAgent/Check_Status.py`
*   **기능**: 
    - 세션 프로파일의 필수 필드(`interaction_goal`, `goal_description`, `target_topic.keyword`, `max_turns`, `difficulty_parameter.level`)가 모두 채워졌는지 검사
    - 누락된 필드가 있으면 `{"status": "INCOMPLETE", "missing_fields": [...]}`를 반환
    - 모든 필드가 채워졌으면 `{"status": "COMPLETE", "missing_fields": []}`를 반환

*   **주요 로직**:

```python
# Check_Status.py 19-50행
# 1. Mode Configuration 점검
mode_config = profile.get("mode_configuration", {})
interaction_goal = mode_config.get("interaction_goal")
if not interaction_goal or _is_null_text(interaction_goal):
    missing_fields.append("토론 목표 (interaction_goal)")
goal_description = mode_config.get("goal_description")
if not goal_description or _is_null_text(goal_description):
    missing_fields.append("목표 상세 (goal_description)")

# 2. Content Context 점검
content_context = profile.get("content_context", {})
target_topic = content_context.get("target_topic", {})
keyword = target_topic.get("keyword") if isinstance(target_topic, dict) else None
if not target_topic or not keyword or _is_null_text(keyword):
    missing_fields.append("토론 주제 (target_topic)")

# 3. Session Rules 점검
session_rules = profile.get("session_rules", {})
max_turns = session_rules.get("max_turns")
if not max_turns or _is_null_text(max_turns):
    missing_fields.append("최대 턴 수 (max_turns)")

difficulty = session_rules.get("difficulty_parameter", {})
level = difficulty.get("level") if isinstance(difficulty, dict) else None
if not level or _is_null_text(level):
    missing_fields.append("난이도 (level)")

# 4. 최종 상태 반환
if not missing_fields:
    return {"status": "COMPLETE", "missing_fields": []}
else:
    return {"status": "INCOMPLETE", "missing_fields": missing_fields}
```

#### Sub-Step 1-2: 누락 필드에 대한 질문 생성

*   **호출 함수**: `generate_question(missing_fields, lecture_material)`
*   **파일 위치**: `Debate_Agent/phase1/phase1_subAgent/Generate_Question.py`
*   **기능**:
    - Gemini LLM을 사용하여 누락된 필드에 대해 사용자에게 물어볼 질문을 생성
    - 강의 자료를 분석하여 적절한 추천 옵션 제공 (예: 주제 추천)
    - JSON 스키마를 사용하여 `{"question_text": "...", "recommendations": "..."}` 형식으로 반환

*   **주요 코드**:

```python
# Generate_Question.py 47-75행
# 파일 타입별 처리
if path.is_file():
    suffix = path.suffix.lower()
    if suffix == '.pdf':
        lecture_content = client.files.upload(file=path)
    elif suffix in ['.txt', '.md']:
        lecture_content = path.read_text(encoding='utf-8')
    else:
        lecture_content = "강의 자료 없음"
else:
    lecture_content = lecture_material

# missing_fields를 JSON 문자열로 변환
missing_fields_str = json.dumps(missing_fields, ensure_ascii=False)
question_Agent_contents = [missing_fields_str, lecture_content]

# Gemini API 호출
response = client.models.generate_content(
    model = "gemini-3-flash-preview",
    contents = question_Agent_contents,
    config={
        "system_instruction": question_system_prompt, 
        "response_mime_type": "application/json",
        "response_schema": question_object_schema
    })
```

#### Sub-Step 1-3: 사용자 응답 파싱 및 프로파일 업데이트

*   **호출 함수**: `fill_settings(current_session_profile, user_response)`
*   **파일 위치**: `Debate_Agent/phase1/phase1_subAgent/Fill_Settings.py`
*   **기능**:
    - Gemini LLM을 사용하여 사용자의 자연어 입력을 파싱
    - 세션 프로파일의 적절한 필드에 값을 자동으로 채움
    - 유효한 입력인 경우 `{"is_valid": True, "new_profile": {...}}` 반환
    - 이해할 수 없는 입력인 경우 `{"is_valid": False}` 반환

*   **주요 코드**:

```python
# Fill_Settings.py 38-51행
# 프로파일과 사용자 응답을 JSON 문자열로 변환
current_session_profile_str = json.dumps(current_session_profile, ensure_ascii=False)
fill_setting_agent_contents = [current_session_profile_str, user_response]

# Gemini API 호출
response = client.models.generate_content(
    model = "gemini-3-flash-preview",
    contents = fill_setting_agent_contents,
    config={
        "system_instruction": fill_settings_system_prompt,
        "response_mime_type": "application/json",
        "response_schema": fill_settings_schema
    })

return response.text
```

#### Sub-Step 1-4: 업데이트 유효성 검증 및 정체 감지

*   **파일 위치**: `Debate_Agent/phase1/phase1.py`
*   **기능**:
    - `is_valid`가 `False`인 경우 정체 카운터 증가 후 재시도
    - 프로파일이 업데이트되지 않은 경우 정체 카운터 증가
    - 정체 카운터가 3회 도달 시 세션 설정 실패로 종료

*   **주요 로직**:

```python
# phase1.py 84-101행
# is_valid가 False인 경우
if not update_result.get("is_valid"):
    stagnation_count += 1
    print("이해하지 못했습니다. 다시 말씀해 주세요.")
    continue

# 업데이트된 프로파일 가져오기
new_profile = update_result.get("new_profile")

# 프로파일이 변경되지 않은 경우
if str(new_profile) == prev_profile_str:
    stagnation_count += 1
    print("설정이 변경되지 않았습니다. 구체적으로 말씀해 주세요.")
    continue

# 정상적으로 업데이트된 경우
stagnation_count = 0
current_session_profile = new_profile
```

### [Step 2] 승인/수정 확인 루프
완성된 세션 프로파일을 사용자에게 보여주고 승인 또는 수정 요청을 받는 단계

#### Sub-Step 2-1: 세션 설정 요약문 생성

*   **호출 함수**: `format_session_summary(current_session_profile)`
*   **파일 위치**: `Debate_Agent/phase1/phase1_subAgent/Generate_Summary.py`
*   **기능**: 세션 프로파일을 읽기 쉬운 형식의 요약문으로 포맷팅

*   **출력 예시**:

```python
# Generate_Summary.py 3-24행
return f'''
[Session Configuration Summary]

1. Mode Configuration
   - Dialogue Style: {mode.get("dialogue_style")}
   - Interaction Goal: {mode.get("interaction_goal")}
   - Description: {mode.get("goal_description")}

2. Content Context
   - Target Topic: {topic.get("keyword")}
   - Topic Description: {topic.get("description")}
   - Knowledge Boundary: {context.get("knowledge_boundary")}

3. Session Rules
   - Max Turns: {rules.get("max_turns")}
   - Difficulty Level: {diff.get("level")}
   - Constraints: {", ".join(diff.get("custom_constraints", []))}
'''
```

#### Sub-Step 2-2: 사용자 의도 분석

*   **호출 함수**: `intent_analysis(user_response)`
*   **파일 위치**: `Debate_Agent/phase1/phase1_subAgent/Intent_Analysis.py`
*   **기능**:
    - Gemini LLM을 사용하여 사용자가 승인(`APPROVE`)을 원하는지 수정(`MODIFY`)을 원하는지 분석
    - 수정 의도인 경우 수정 내용(`Modifications`)도 함께 추출
    - `{"intent": "APPROVE"}` 또는 `{"intent": "MODIFY", "Modifications": "..."}` 형식으로 반환

*   **주요 코드**:

```python
# Intent_Analysis.py 37-48행
# 사용자 응답을 content로 전달
intent_analysis_agent_contents = user_response

# Gemini API 호출
response = client.models.generate_content(
    model = "gemini-3-flash-preview",
    contents = intent_analysis_agent_contents,
    config={
        "system_instruction": intent_analysis_system_prompt,
        "response_mime_type": "application/json",
        "response_schema": intent_analysis_schema
    })
```

#### Sub-Step 2-3: 승인 또는 수정 처리

*   **파일 위치**: `Debate_Agent/phase1/phase1.py`
*   **주요 로직**:

```python
# phase1.py 112-134행
intent = intent_analysis_result.get("intent")

if intent == "APPROVE":
    final_check = Check_Status(current_session_profile)
    
    if final_check.get("status") == "INCOMPLETE":
        print("수정 과정에서 필수 정보가 누락되었습니다. 다시 입력 단계로 돌아갑니다.")
        break  # 최초 루프로 되돌아감
    
    return current_session_profile

elif intent == "MODIFY":
    update_result = fill_settings(current_session_profile, intent_analysis_result.get("Modifications"))
    update_result = json.loads(update_result)

    if update_result.get("is_valid"):
        current_session_profile = update_result.get("new_profile")
        print("설정이 수정되었습니다.")
    else:
        print("수정 사항을 명확히 인식하지 못했습니다.")
    continue
```

---

## 3. [Phase 2] 토론 세션 진행 프로세스: `run_debate_session_logic`
Phase 1에서 설정된 세션 프로파일을 기반으로 실제 토론을 진행하는 단계

### [Step 1] 초기화 및 오프닝
토론 진행에 필요한 변수들을 초기화하고 사회자 AI가 오프닝 멘트를 생성

*   **파일 위치**: `Debate_Agent/phase2/phase2.py`
*   **주요 코드**:

```python
# phase2.py 12-44행
# 1. 설정값 파싱
dialogue_style = session_profile.get('mode_configuration', {}).get('dialogue_style')
topic_info = session_profile.get('content_context', {}).get('target_topic', {})
topic_keyword = topic_info.get('keyword')
topic_description = topic_info.get('description')
rules = session_profile.get('session_rules', {})
max_turns = rules.get('max_turns')
difficulty = rules.get('difficulty_parameter', {}).get('level')

# 2. 상태 변수 초기화
history = []
evaluation_logs = []
current_score = 50
turn_count = 0
WINNING_THRESHOLD = 70
retry_count = 0
MAX_RETRIES = 3

# 3. 오프닝 (사회자 LLM)
intro_response_str = llm_moderator_generate_intro(topic_keyword, rules, topic_description, dialogue_style)
intro_response = json.loads(intro_response_str)
intro_message = intro_response.get("message")

print(f"\n[사회자]: {intro_message}")
history.append({"role": "system", "content": intro_message, "turn": "Opening"})
```

*   **호출 함수**: `llm_moderator_generate_intro(topic_keyword, rules, topic_description, dialogue_style)`
*   **파일 위치**: `Debate_Agent/phase2/phase2_subAgent/Gen_intro.py`
*   **기능**: 토론 주제와 규칙을 소개하는 사회자의 오프닝 멘트를 생성

### [Step 2] 메인 토론 루프
최대 턴 수까지 반복하며 사용자 발언 → 안전성 검사 → 논리 평가 → AI 반박 순서로 진행

*   **파일 위치**: `Debate_Agent/phase2/phase2.py`

#### Sub-Step 2-1: 사용자 발언 안전성 검사

*   **호출 함수**: `llm_moderator_check_safety(user_input, topic_keyword, topic_description)`
*   **파일 위치**: `Debate_Agent/phase2/phase2_subAgent/Check_safety.py`
*   **기능**:
    - 사용자 발언이 토론 주제와 관련 있는지 확인
    - 욕설, 비방 등 부적절한 내용 포함 여부 검사
    - 위반 시 `{"is_valid": False, "reason": "..."}` 반환 및 점수 감점(-5점)
    - 3회 연속 위반 시 세션 강제 종료(`ABORT`)

*   **주요 로직**:

```python
# phase2.py 48-66행
# 안전성 검사
print("\n(시스템: 발언 안전성 검사 중...)")
safety_check_str = llm_moderator_check_safety(user_input, topic_keyword, topic_description)
safety_check = json.loads(safety_check_str)

if safety_check.get('is_valid') == False:
    retry_count += 1
    warning_msg = safety_check.get('reason')
    print(f"[사회자]: 경고! {warning_msg} (감점 -5점)")

    if retry_count >= MAX_RETRIES:
        print(f"\n[사회자]: 부적절한 입력이 {MAX_RETRIES}회 반복되어 세션을 강제 종료합니다.")
        final_status = "ABORT"
        break

    current_score = max(0, current_score - 5)
    user_input = input(f"[나 (다시 입력) - {retry_count}/{MAX_RETRIES}]: ")
    continue
```

#### Sub-Step 2-2: 논리 및 내용 평가

*   **호출 함수**: `llm_evaluator_assess_step(user_input, last_attack, lecture_material, dialogue_style, difficulty)`
*   **파일 위치**: `Debate_Agent/phase2/phase2_subAgent/Eval_assess_step.py`
*   **기능**:
    - 사용자 발언의 논리성, 강의 자료와의 일치성, 상대방 논증에 대한 대응력 평가
    - 평가 결과에 따라 `score_delta` (점수 변화량) 계산
    - 평가 근거(`rationale`)와 함께 JSON 형식으로 반환

*   **주요 코드**:

```python
# phase2.py 71-83행
# 논리 평가
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
```

#### Sub-Step 2-3: Cold Game 체크

*   **기능**: 점수가 20점 이하로 떨어지면 토론 진행이 불가능하다고 판단하고 종료

*   **주요 코드**:

```python
# phase2.py 85-89행
# Cold Game 체크
if current_score <= 20:
    print("\n[사회자]: 점수가 너무 낮아 더 이상 토론 진행이 어렵습니다. (Cold Game)")
    final_status = "COLD_GAME"
    break
```

#### Sub-Step 2-4: AI 토론자 반박 생성

*   **호출 함수**: `llm_debater_generate_attack(user_input, history, lecture_material, difficulty, dialogue_style)`
*   **파일 위치**: `Debate_Agent/phase2/phase2_subAgent/Debater_Generate_Attack.py`
*   **기능**:
    - 사용자 발언과 전체 토론 맥락을 분석하여 적절한 반박 논증 생성
    - 강의 자료를 기반으로 사실에 근거한 논리적 공격 수행
    - 난이도에 따라 반박의 복잡도와 공격성 조절

*   **주요 코드**:

```python
# phase2.py 91-99행
# AI 반박 생성
print("(시스템: Debater 반박 생성 중...)")
debater_response_str = llm_debater_generate_attack(user_input, history, lecture_material, difficulty, dialogue_style)
debater_response = json.loads(debater_response_str)
debater_msg = debater_response.get('argument', '')

print(f"\n[Debater]: {debater_msg}")
history.append({"role": "assistant", "content": debater_msg, "turn": current_turn_display})
```

### [Step 3] 최종 변론 및 마무리
정해진 턴이 모두 소진되면 최종 변론 기회를 제공하고 승패를 판정

#### Sub-Step 3-1: 최종 변론 평가

*   **호출 함수**: `llm_evaluator_assess_closing(final_user_speech, history, lecture_material, difficulty, dialogue_style)`
*   **파일 위치**: `Debate_Agent/phase2/phase2_subAgent/Eval_assess_closing.py`
*   **기능**:
    - 사용자의 최종 변론을 전체 토론 맥락과 함께 종합 평가
    - 토론 전체에서 보여준 일관성, 설득력, 논리 전개 능력 평가
    - 최종 점수 조정을 위한 `score_delta` 계산

*   **주요 코드**:

```python
# phase2.py 116-126행
# 최종 평가
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
```

#### Sub-Step 3-2: 승패 판정

*   **기능**: 최종 점수가 70점 이상이면 승리(`WIN`), 미만이면 패배(`LOSS`)

*   **주요 코드**:

```python
# phase2.py 128-132행
# 승패 판정
if current_score >= WINNING_THRESHOLD:
    final_status = "WIN"
else:
    final_status = "LOSS"
```

#### Sub-Step 3-3: 토론 전체 요약 생성

*   **호출 함수**: `llm_moderator_generate_summary(history, evaluation_logs, final_status)`
*   **파일 위치**: `Debate_Agent/phase2/phase2_subAgent/Generate_Summary.py`
*   **기능**:
    - 전체 토론 내역과 평가 로그를 종합하여 사회자의 총평 생성
    - 사용자의 강점과 약점, 개선 방향 제시
    - `{"summary_text": "..."}` 형식으로 반환

*   **주요 코드**:

```python
# phase2.py 134-142행
# 토론 전체 요약
print("(시스템: 토론 전체 요약 생성 중...)")
summary_context_str = llm_moderator_generate_summary(history, evaluation_logs, final_status)
summary_context = json.loads(summary_context_str)

print(f"\n{'='*30}")
print(f"    결과: {final_status} (최종 점수: {current_score}점)")
print(f"{'='*30}")
print(f"[총평]: {summary_context.get('summary_text', '')}")
```

### [Step 4] 최종 결과 반환

*   **반환값**: `(final_status, evaluation_logs, summary_context, history)`
    - `final_status`: 토론 결과 상태 (`WIN`, `LOSS`, `ABORT`, `COLD_GAME`)
    - `evaluation_logs`: 각 턴별 점수 및 평가 이유 리스트
    - `summary_context`: 사회자의 총평 컨텍스트
    - `history`: 전체 대화 이력

---

## 4. [Phase 3] 최종 평가 보고서 생성: `Execute_Debate_Mode_Phase3`
Phase 2의 결과를 종합하여 구조화된 최종 평가 보고서를 생성하는 단계

*   **파일 위치**: `Debate_Agent/phase3/phase3.py`
*   **호출 코드**:

```python
# phase3.py 10-20행
def Execute_Debate_Mode_Phase3(final_status, evaluation_logs, summary_context, history):
    """
    토론 세션의 최종 평가 로그를 생성하는 Phase 3 함수
    
    Args:
        final_status: 토론 최종 상태 (WIN, LOSS, ABORT, COLD_GAME 등)
        evaluation_logs: 각 턴별 평가 로그 리스트
        summary_context: 토론 전체 요약 컨텍스트
        history: 토론 대화 이력
        
    Returns:
        str: 최종 평가 보고서 (JSON 형식)
    """
    return EvaluationLogGenerator(final_status, evaluation_logs, summary_context, history)
```

### 최종 평가 보고서 생성기

*   **호출 함수**: `EvaluationLogGenerator(final_status, evaluation_logs, summary_context, history)`
*   **파일 위치**: `Debate_Agent/phase3/phase3_subAgent/Eval_log_gen.py`
*   **기능**:
    - Gemini LLM을 사용하여 모든 토론 데이터를 종합 분석
    - 턴별 상세 피드백, 전체 학습 성과, 개선 포인트 등을 포함한 구조화된 보고서 생성
    - JSON 스키마에 따라 표준화된 형식으로 반환

*   **주요 코드**:

```python
# Eval_log_gen.py 29-47행
eval_log_gen_contents = [
    "final_status: " + final_status,
    "evaluation_logs: " + json.dumps(evaluation_logs),
    "summary_context: " + json.dumps(summary_context),
    "history: " + json.dumps(history)
]

# Gemini API 호출
response = client.models.generate_content(
    model = "gemini-3-flash-preview",
    contents = eval_log_gen_contents,
    config={
        "system_instruction": eval_log_gen_system_prompt, 
        "response_mime_type": "application/json",
        "response_schema": eval_log_gen_object_schema
    })

return response.text
```

---

## 5. 비정상 시나리오 및 예외 처리

### 1) Phase 1: 세션 설정 정체 상태
*   **상황**: 사용자 입력을 3회 연속으로 이해하지 못하거나 프로파일 업데이트가 발생하지 않은 경우
*   **처리**: `MAX_STAGNATION` (3회) 도달 시 세션 설정 실패로 종료하고 `None` 반환

```python
# phase1.py 58-61행
if stagnation_count >= MAX_STAGNATION:
    print("설정을 완료하지 못했습니다. 초기화하거나 종료합니다.")
    return None
```

### 2) Phase 2: 안전성 검사 실패 (부적절한 발언)
*   **상황**: 사용자가 주제와 무관하거나 부적절한 발언을 3회 연속으로 한 경우
*   **처리**: 
    - 각 위반마다 5점 감점
    - 3회 도달 시 세션 강제 종료 (`ABORT` 상태)

```python
# phase2.py 56-61행
if retry_count >= MAX_RETRIES:
    print(f"\n[사회자]: 부적절한 입력이 {MAX_RETRIES}회 반복되어 세션을 강제 종료합니다.")
    final_status = "ABORT"
    break
```

### 3) Phase 2: Cold Game (점수 급락)
*   **상황**: 논리 평가 결과 점수가 20점 이하로 떨어진 경우
*   **처리**: 더 이상 토론 진행이 의미 없다고 판단하고 `COLD_GAME` 상태로 종료

```python
# phase2.py 85-89행
if current_score <= 20:
    print("\n[사회자]: 점수가 너무 낮아 더 이상 토론 진행이 어렵습니다. (Cold Game)")
    final_status = "COLD_GAME"
    break
```

### 4) Phase 2: 비정상 종료 시 요약 컨텍스트 부재
*   **상황**: `ABORT` 또는 `COLD_GAME`으로 정상적인 마무리 단계를 거치지 않아 `summary_context`가 생성되지 않은 경우
*   **처리**: Phase 2 반환값에서 `summary_context`를 `None`으로 반환하여 Phase 3에서 처리 가능하도록 함

```python
# phase2.py 145-149행
# 최종 결과 반환
if 'summary_context' in locals(): 
    return final_status, evaluation_logs, summary_context, history
else: 
    # 강제 종료된 경우 summary_context가 없음
    return final_status, evaluation_logs, None, history
```

### 5) 에이전트 리소스 파일 누락
*   **상황**: 에이전트 실행에 필요한 JSON 스키마 파일(`.json`) 또는 시스템 프롬프트 파일(`.md`)을 찾지 못한 경우
*   **처리**: 각 에이전트 함수에서 `find_file()` 함수가 `None`을 반환하면 `FileNotFoundError` 발생시켜 즉시 실행 중단

```python
# Intent_Analysis.py 25-28행
if not intent_analysis_schema_path or not intent_analysis_system_prompt_path:
    raise FileNotFoundError("Intent Analysis 프롬포트 파일을 찾을 수 없습니다")
```

### 6) Phase 1: 승인 후 필수 필드 누락 발견
*   **상황**: 사용자가 수정 과정에서 기존에 채워진 필드를 삭제하여 승인 시점에 다시 불완전해진 경우
*   **처리**: 최종 검증(`Check_Status`)을 한 번 더 수행하여 불완전하면 필드 채우기 루프로 되돌아감

```python
# phase1.py 114-119행
if intent == "APPROVE":
    final_check = Check_Status(current_session_profile)
    
    if final_check.get("status") == "INCOMPLETE":
        print("수정 과정에서 필수 정보가 누락되었습니다. 다시 입력 단계로 돌아갑니다.")
        break  # 최초 루프로 되돌아감
```

---

## 6. 전체 워크플로우 요약

```
[시작]
   ↓
[Phase 1: 세션 설정]
   ├─ Check_Status: 프로파일 완성도 검사
   ├─ Generate_Question: 누락 필드 질문 생성
   ├─ Fill_Settings: 사용자 응답 파싱 및 업데이트
   ├─ (반복) 모든 필드가 채워질 때까지
   ├─ Generate_Summary: 설정 요약문 생성
   ├─ Intent_Analysis: 승인/수정 의도 분석
   └─ 승인 시 session_profile 반환
   ↓
[Phase 2: 토론 진행]
   ├─ Gen_intro: 오프닝 메시지 생성 (사회자)
   ├─ [토론 루프 시작] (최대 턴 수까지 반복)
   │   ├─ Check_safety: 발언 안전성 검사 (사회자)
   │   ├─ Eval_assess_step: 논리 평가 (평가자)
   │   ├─ 점수 업데이트 및 Cold Game 체크
   │   ├─ Debater_Generate_Attack: AI 반박 생성 (토론자)
   │   └─ 다음 턴으로
   ├─ 최종 변론 입력
   ├─ Eval_assess_closing: 최종 변론 평가 (평가자)
   ├─ 승패 판정 (점수 >= 70 → WIN, < 70 → LOSS)
   ├─ Generate_Summary: 토론 전체 요약 생성 (사회자)
   └─ (final_status, evaluation_logs, summary_context, history) 반환
   ↓
[Phase 3: 최종 평가 보고서]
   ├─ Eval_log_gen: 최종 평가 보고서 생성
   └─ 구조화된 JSON 형식의 평가 보고서 반환
   ↓
[종료]
```

---

## 7. 주요 데이터 흐름

### Phase 1 → Phase 2
```python
session_profile = {
    "mode_configuration": {...},
    "content_context": {...},
    "session_rules": {...}
}
```

### Phase 2 → Phase 3
```python
final_status = "WIN" | "LOSS" | "ABORT" | "COLD_GAME"
evaluation_logs = [
    {"turn": 1, "score_now": 55, "reason": "..."},
    {"turn": 2, "score_now": 60, "reason": "..."},
    ...
]
summary_context = {"summary_text": "..."}
history = [
    {"role": "system", "content": "...", "turn": "Opening"},
    {"role": "user", "content": "...", "turn": 1},
    {"role": "assistant", "content": "...", "turn": 1},
    ...
]
```

### Phase 3 출력
```json
{
  "final_status": "WIN",
  "final_score": 75,
  "session_summary": "...",
  "turn_by_turn_feedback": [...],
  "strengths": [...],
  "areas_for_improvement": [...],
  "learning_outcomes": [...]
}
```
