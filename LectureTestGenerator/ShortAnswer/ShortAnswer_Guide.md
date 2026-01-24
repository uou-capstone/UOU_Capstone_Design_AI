# 단답형/서술형 문제 생성 및 피드백 워크플로우 가이드

## ShortAnswer 프로젝트 구조 개요

```
ShortAnswer/
├── ShortAnswer_main.py                 # 메인 엔트리 포인트 (워크플로우 조율)
├── ShortAnswer_Guide.md                # 현재 문서 (워크플로우 가이드)
├── YouMustFollow.md                    # 워크플로우 상세 지침 및 JSON 스키마 정의서
│
├── Gen_ShortAnswer/                    # 단답형/서술형 문제 생성 모듈
│   ├── Gen_ShortAnswer.py              # 문제 생성 메인 로직 (Planner → Writer → Validator 루프)
│   └── Gen_ShortAnswer_SubAgent/       # 문제 생성 하위 에이전트들
│       ├── ShortAnswerPlanner.py       # 출제 계획 수립 에이전트
│       ├── ShortAnswerWriter.py        # 실제 문제 작성 에이전트
│       ├── ShortAnswerValidator.py     # 품질 검증 에이전트
│       └── Gen_ShortAnswer_SubAgent_Prompt/  # 각 에이전트 프롬프트 및 스키마
│           ├── ShortAnswerPlanner_Prompt/
│           │   ├── ShortAnswerPlanner_Object.json
│           │   └── ShortAnswerPlanner_SystemPrompt.md
│           ├── ShortAnswerWriter_Prompt/
│           │   ├── ShortAnswerWriter_Object.json
│           │   └── ShortAnswerWriter_SystemPrompt.md
│           └── ShortAnswerValidator_Prompt/
│               ├── ShortAnswerValidator_Object.json
│               └── ShortAnswerValidator_SystemPrompt.md
│
└── ShortAnswer_Feedback/               # 단답형/서술형 채점 및 피드백 모듈
    ├── ShortAnswer_Feedback.py         # 채점 및 기초 피드백 메인 로직
    └── ShortAnswer_Feedback_SubAgent/
        └── ShortAnswer_Grader/
            ├── ShortAnswerGrader.py    # 단답형/서술형 채점 및 피드백 생성 에이전트
            └── ShortAnswer_Grader_Prompt/
                ├── ShortAnswerGrader_Object.json
                └── ShortAnswerGrader_SystemPrompt.md
```

**주요 특징**:
- **문제 생성 파이프라인**: Planner(계획) → Writer(작성) → Validator(검증)의 3단계 품질 보증 시스템
- **피드백 파이프라인**: 객관식과 달리 텍스트 답안을 AI Grader가 심층 분석 (키워드 포함 여부 + 논리 일치도 검증)
- **Common 모듈 의존**: 사용자 프로필 생성(`Prior_Profile_Gen_Agent`) 및 통합 피드백(`generate_FeedBack`)은 공통 모듈 사용

---

- `ShortAnswer_main.py`를 중심으로 단답형/서술형 문제가 생성되고, 사용자 응답을 받아 채점 및 피드백이 이루어지는 전 과정을 설명

---

## 1. 메인 엔트리 포인트: `if __name__ == "__main__":`
프로그램 실행 시 가장 먼저 호출되며, 전체 워크플로우(`문제 생성 -> 응답 수집 -> 피드백 생성`)를 순차적으로 실행

*   **파일 위치**: `ShortAnswer/ShortAnswer_main.py`
*   **주요 코드**:

```python
if __name__ == "__main__":
    # 1. 문제 생성 Workflow
    gen_result = Workflow_ShortAnswer_Generation(lecture_material, prev_userProfile)
    
    # 2. 사용자 응답 수집
    user_answers = Collect_User_Answers(generated_short_answer_problems)
    
    # 3. 피드백 생성 Workflow
    feedback_result = Workflow_ShortAnswer_Feedback(generated_short_answer_problems, user_profile, user_answers, lecture_material)
```

---

## 2. [Phase 1] 문제 생성 프로세스: `Workflow_ShortAnswer_Generation`
사용자 프로필을 정의하고, 강의 자료를 분석하여 목표 개수만큼의 단답형/서술형 문제를 생성하는 단계

### [Step 1] 사용자 프로필 생성/수정
사용자의 학습 목표, 수준, 피드백 선호도 등을 정의하는 프로필을 생성

*   **호출 코드**:

```python
# ShortAnswer_main.py (line 26)
user_profile = Execute_Generator_PriorProfile(prev_userProfile, exam_type)
```

*   **파일 위치**: `Common/Prior_Profile_Gen_Agent.py`

### [Step 2] 생성 개수 입력
사용자로부터 생성할 단답형/서술형 문제의 수량을 입력받음 (1~20개 사이)

*   **주요 코드**:

```python
# ShortAnswer_main.py (line 32~39)
target_problem_count_input = input("생성할 단답형/서술형 문제 개수를 입력하세요 (최대 20개, 기본 5개): ").strip()
target_problem_count = int(target_problem_count_input or 5)
if 1 <= target_problem_count <= 20:
```

### [Step 3] 단답형/서술형 문제 생성 및 품질 검증 (핵심 로직)
AI 에이전트들(Planner, Writer, Validator)이 협업하여 고품질의 문제를 생성

*   **호출 코드**:

```python
# ShortAnswer_main.py (line 43)
generated_short_answer_problems = Generate_ShortAnswer(user_profile, lecture_material, target_problem_count)
```

*   **상세 흐름 (`ShortAnswer/Gen_ShortAnswer/Gen_ShortAnswer.py`)**:
    1.  **ShortAnswer Planner (`ShortAnswerPlanner`)**: 강의 자료에서 핵심 개념을 추출하고 각 문제의 유형(단답형/서술형), 난이도, 주제, 출제 포인트를 포함한 출제 계획 수립
    2.  **Generation & Validation Loop (최대 3회 재시도)**:
        *   **ShortAnswer Writer (`ShortAnswerWriter`)**: 수립된 계획과 사용자 프로필, 이전 피드백을 반영하여 실제 단답형/서술형 문제 생성 (질문 + 모범 답안 + 핵심 키워드 + 출제 의도)
        *   **ShortAnswer Validator (`ShortAnswerValidator`)**: 생성된 문제가 강의 자료와 일치하는지(Fact Check), 모범 답안의 정확성, 키워드가 채점 기준으로 적절한지 검증
        *   **Decision**: 검증 통과(`is_valid: True`) 시 즉시 반환하며, 실패 시 피드백을 Writer에게 전달하여 재생성

---

## 3. [Phase 2] 사용자 응답 수집: `Collect_User_Answers`
생성된 문제를 사용자에게 제시하고 텍스트 답변을 수집, 해당 부분은 실제 서비스시 별도의 UI로 사용자 응답을 받을 것 (응답 데이터 형태는 지금과 일치해야함)

*   **파일 위치**: `ShortAnswer/ShortAnswer_main.py`
*   **주요 코드**:

```python
def Collect_User_Answers(generated_short_answer_problems):
    for problem in generated_short_answer_problems.get('short_answer_problems', []):
        p_id = problem['id']
        question = problem['question_content']
        problem_type = problem['type']
        
        print(f"\n[문제 {p_id}] ({problem_type}) {question}")
        
        user_input = input("답변을 입력하세요: ").strip()
        user_answers[str(p_id)] = user_input
    return user_answers
```

---

## 4. [Phase 3] 피드백 생성 프로세스: `Workflow_ShortAnswer_Feedback`
사용자의 텍스트 답변을 채점하고, 문제별 심층 분석 및 최종 학습 결과 생성

### [Step 1] 단답형/서술형 채점 및 기초 피드백 생성
주관식 답안을 AI 에이전트로 채점하고 피드백을 생성

*   **호출 코드**:

```python
# ShortAnswer_main.py (line 86)
grading_data = Gen_ShortAnswer_feedBack(generated_short_answer_problems, user_answers)
```

*   **상세 흐름 (`ShortAnswer/ShortAnswer_Feedback/ShortAnswer_Feedback.py`)**:
    1.  **텍스트 답안 분석**: 객관식과 달리 사용자의 자유 입력 텍스트를 분석
    2.  **ShortAnswer Grader (`ShortAnswerGrader`)**: 
        - **키워드 체크**: 사용자 답안에 필수 키워드(`key_keywords`)가 포함되어 있는지 확인
        - **논리 체크**: 사용자 답안의 논리가 모범 답안(`model_answer`)과 일치하는지 분석
        - **3단계 채점**: `Correct` (완전 정답) / `Partial_Correct` (부분 정답) / `Incorrect` (오답) 판별
        - **맞춤형 피드백 생성**: 채점 결과에 따라 칭찬, 누락된 키워드 지적, 모범 답안과의 비교 교정 메시지 생성
    3.  **데이터 조립**: 문제 내용, 사용자 응답, 채점 결과(3단계), AI 피드백을 하나의 객체로 결합

### [Step 2] 통합 학습 결과 로그 생성
공통 형식의 최종 피드백 데이터를 생성하여 반환

*   **호출 코드**:

```python
# ShortAnswer_main.py (line 91)
feedback_data = Generator_feedBack(
    test_log_data=grading_data, 
    exam_type=exam_type,
    source_material=lecture_material,
    timestamp=current_timestamp
)
```

*   **파일 위치**: `Common/generate_FeedBack.py`

---

## 5. 비정상 시나리오 및 예외 처리

### 1) 입력 유효성 검사 실패
*   **상황**: 문제 개수에 잘못된 형식의 값이 입력된 경우
*   **처리**: `while True` 루프와 조건문을 통해 올바른 값이 입력될 때까지 반복해서 입력을 요구

### 2) 품질 검증(Validator) 미통과
*   **상황**: 생성된 문제의 팩트가 틀리거나 모범 답안이 부정확하거나 키워드가 부족한 경우
*   **처리**: 최대 3회까지 재시도를 수행하며, Validator의 피드백을 반영하여 Writer가 재생성. 3회 초과 시 마지막 결과물을 반환하는 Fallback 로직 작동

### 3) 에이전트 리소스 파일 누락
*   **상황**: 에이전트 실행에 필요한 `.json` 스키마나 `.md` 프롬프트 파일을 찾지 못한 경우
*   **처리**: `find_file` 함수가 `None`을 반환하며, 각 에이전트 내에서 `FileNotFoundError`를 발생시켜 실행 중단

