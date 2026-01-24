# 5지선다 문제 생성 및 피드백 워크플로우 가이드

## Five_Choice 프로젝트 구조 개요

```
Five_Choice/
├── Five_Choice_main.py                 # 메인 엔트리 포인트 (워크플로우 조율)
├── Five_Choice_Guide.md                # 현재 문서 (워크플로우 가이드)
├── Five_Choice_Example.text            # 실행 예시 로그
│
├── Gen_5_Choice/                       # 5지선다 문제 생성 모듈
│   ├── Gen_5_Choice.py                 # 문제 생성 메인 로직 (Planner → Writer → Validator 루프)
│   ├── Gen_5_Choice_Example.text       # 생성 예시 로그
│   └── Gen_5_Choice_SubAgent/          # 문제 생성 하위 에이전트들
│       ├── FiveChoicePlanner.py        # 출제 계획 수립 에이전트
│       ├── FiveChoiceWriter.py         # 실제 문제 작성 에이전트
│       ├── FiveChoiceValidator.py      # 품질 검증 에이전트
│       └── Gen_5_Choice_SubAgent_Prompt/  # 각 에이전트 프롬프트 및 스키마
│           ├── 5ChoicePlanner_Prompt/
│           │   ├── 5ChoicePlanner_Object.json
│           │   └── 5ChoicePlanner_SystemPrompt.md
│           ├── 5ChocieWriter_Prompt/
│           │   ├── 5ChoiceWriter_Object.json
│           │   └── 5ChoiceWriter_SystemPrompt.md
│           └── 5ChoiceValidator_Prompt/
│               ├── 5ChoiceValidator_Object.json
│               └── 5ChoiceValidator_SystemPrompt.md
│
└── Five_Choice_Feedback/               # 5지선다 채점 및 피드백 모듈
    ├── Five_Choice_Feedback.py         # 채점 및 기초 피드백 메인 로직
    ├── Five_Choice_Feedback_Example.text  # 피드백 예시 로그
    └── 5_Choice_Feedback_SubAgent/
        └── 5_Choice_Grader/
            ├── FiveChoiceGrader.py     # 5지선다 채점 및 피드백 생성 에이전트
            └── 5_Choice_Grader_Prompt/
                ├── 5ChoiceGrader_object.json
                └── 5ChoiceGrader_SystemPrompt.md
```

**주요 특징**:
- **문제 생성 파이프라인**: Planner(계획) → Writer(작성) → Validator(검증)의 3단계 품질 보증 시스템
- **피드백 파이프라인**: 단순 채점 + AI Grader의 심층 분석 결합
- **Common 모듈 의존**: 사용자 프로필 생성(`Prior_Profile_Gen_Agent`) 및 통합 피드백(`generate_FeedBack`)은 공통 모듈 사용

---

- `Five_Choice_main.py`를 중심으로 5지선다 문제가 생성되고, 사용자 응답을 받아 채점 및 피드백이 이루어지는 전 과정을 설명

---

## 1. 메인 엔트리 포인트: `if __name__ == "__main__":`
프로그램 실행 시 가장 먼저 호출되며, 전체 워크플로우(`문제 생성 -> 응답 수집 -> 피드백 생성`)를 순차적으로 실행

*   **파일 위치**: `Five_Choice/Five_Choice_main.py`
*   **주요 코드**:
```python
if __name__ == "__main__":
    # 1. 문제 생성 Workflow
    gen_result = Workflow_Five_Choice_Generation(lecture_material, prev_userProfile)
    
    # 2. 사용자 응답 수집
    user_answers = Collect_User_Answers(generated_mcq_problems)
    
    # 3. 피드백 생성 Workflow
    feedback_result = Workflow_Five_Choice_Feedback(generated_mcq_problems, user_profile, user_answers, lecture_material)
```

---

## 2. [Phase 1] 문제 생성 프로세스: `Workflow_Five_Choice_Generation`
사용자 프로필을 정의하고, 강의 자료를 분석하여 목표 개수만큼의 5지선다 문제를 생성하는 단계

### [Step 1] 사용자 프로필 생성/수정
사용자의 학습 목표, 수준, 피드백 선호도 등을 정의하는 프로필을 생성

*   **호출 코드**:
```python
# Five_Choice_main.py (line 31)
user_profile = Execute_Generator_PriorProfile(prev_userProfile, exam_type)
```
*   **파일 위치**: `Common/Prior_Profile_Gen_Agent.py`

### [Step 2] 생성 개수 입력
사용자로부터 생성할 5지선다 문제의 수량을 입력받음 (1~15개 사이)

*   **주요 코드**:
```python
# Five_Choice_main.py (line 37~39)
target_problem_count_input = input("생성할 5지선다 문제 개수를 입력하세요 (최대 15개, 기본 10개): ").strip()
target_problem_count = int(target_problem_count_input or 10)
if 1 <= target_problem_count <= 15:
```

### [Step 3] 5지선다 문제 생성 및 품질 검증 (핵심 로직)
AI 에이전트들(Planner, Writer, Validator)이 협업하여 고품질의 문제를 생성

*   **호출 코드**:
```python
# Five_Choice_main.py (line 47)
generated_mcq_problems = Generate_5_Choice(user_profile, lecture_material, target_problem_count)
```
*   **상세 흐름 (`Five_Choice/Gen_5_Choice/Gen_5_Choice.py`)**:
    1.  **Five Choice Planner (`FiveChoicePlanner`)**: 강의 자료에서 핵심 개념을 추출하고 각 문제의 난이도, 주제, 출제 포인트를 포함한 출제 계획 수립
    2.  **Generation & Validation Loop (최대 3회 재시도)**:
        *   **Five Choice Writer (`FiveChoiceWriter`)**: 수립된 계획과 사용자 프로필, 이전 피드백을 반영하여 실제 5지선다 문제 생성 (질문 + 5개 선택지 + 정답 + 해설)
        *   **Five Choice Validator (`FiveChoiceValidator`)**: 생성된 문제가 강의 자료와 일치하는지(Fact Check), 개수가 맞는지, 선택지가 5개인지, 스타일 가이드를 준수했는지 검증
        *   **Decision**: 검증 통과(`is_valid: True`) 시 즉시 반환하며, 실패 시 피드백을 Writer에게 전달하여 재생성

---

## 3. [Phase 2] 사용자 응답 수집: `Collect_User_Answers`
생성된 문제를 사용자에게 제시하고 1~5 사이의 답변을 수집, 해당 부분은 실제 서비스시 별도의 UI로 사용자 응답을 받을 것 (응답 데이터 형태는 지금과 일치해야함)

*   **파일 위치**: `Five_Choice/Five_Choice_main.py`
*   **주요 코드**:
```python
def Collect_User_Answers(generated_mcq_problems):
    for problem in generated_mcq_problems.get('mcq_problems', []):
        p_id = problem['id']
        question = problem['question_content']
        options = problem['options']
        
        print(f"\n[문제 {p_id}] {question}")
        for opt in options:
            print(f"  {opt['id']}. {opt['content']}")
        
        user_input = input("답변을 입력하세요 (1~5): ").strip()
        user_choice = int(user_input)
        user_answers[p_id] = user_choice
    return user_answers
```

---

## 4. [Phase 3] 피드백 생성 프로세스: `Workflow_Five_Choice_Feedback`
사용자의 답변을 채점하고, 문제별 심층 분석 및 최종 학습 결과 생성

### [Step 1] 5지선다 채점 및 기초 피드백 생성
단순 정오답 판별과 에이전트 피드백을 결합하여 기초 데이터 생성

*   **호출 코드**:
```python
# Five_Choice_main.py (line 90)
grading_data = Gen_5_Choice_feedBack(generated_mcq_problems, user_answers)
```
*   **상세 흐름 (`Five_Choice/Five_Choice_Feedback/Five_Choice_Feedback.py`)**:
    1.  **로직 채점**: 사용자 답변과 정답(`correct_answer`)을 비교하여 `Correct`/`Incorrect` 판별
    2.  **Five Choice Grader (`FiveChoiceGrader`)**: 출제 의도, 오답 선택지 분석을 바탕으로 맞춤형 피드백 메시지와 관련 주제 추출
    3.  **데이터 조립**: 문제 내용, 5개 선택지, 사용자 응답, 채점 결과, AI 피드백을 하나의 객체로 결합

### [Step 2] 통합 학습 결과 로그 생성
공통 형식의 최종 피드백 데이터를 생성하여 반환

*   **호출 코드**:
```python
# Five_Choice_main.py (line 95)
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
*   **상황**: 문제 개수나 5지선다 답변에 잘못된 형식의 값이 입력된 경우
*   **처리**: `while True` 루프와 조건문을 통해 올바른 값이 입력될 때까지 반복해서 입력을 요구

### 2) 품질 검증(Validator) 미통과
*   **상황**: 생성된 문제의 팩트가 틀리거나 선택지가 5개가 아니거나 가이드를 위반한 경우
*   **처리**: 최대 3회까지 재시도를 수행하며, Validator의 피드백을 반영하여 Writer가 재생성. 3회 초과 시 마지막 결과물을 반환하는 Fallback 로직 작동

### 3) 에이전트 리소스 파일 누락
*   **상황**: 에이전트 실행에 필요한 `.json` 스키마나 `.md` 프롬프트 파일을 찾지 못한 경우
*   **처리**: `find_file` 함수가 `None`을 반환하며, 각 에이전트 내에서 `FileNotFoundError`를 발생시켜 실행 중단
