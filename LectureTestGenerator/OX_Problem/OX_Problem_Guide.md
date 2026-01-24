# OX 문제 생성 및 피드백 워크플로우 가이드

## OX_Problem 프로젝트 구조 개요

```
OX_Problem/
├── OX_Problem_main.py                  # 메인 엔트리 포인트 (워크플로우 조율)
├── OX_Problem_Guide.md                 # 현재 문서 (워크플로우 가이드)
├── OX_Problem_main_Example.text        # 실행 예시 로그
│
├── Generate_OX/                        # OX 문제 생성 모듈
│   ├── Generate_OX.py                  # 문제 생성 메인 로직 (Planner → Writer → Validator 루프)
│   ├── Generate_OX_Example.text        # 생성 예시 로그
│   └── Generate_OX_SubAgent/           # 문제 생성 하위 에이전트들
│       ├── OXPlanner.py                # 출제 계획 수립 에이전트
│       ├── OXWriter.py                 # 실제 OX 문제 작성 에이전트
│       ├── OXValidator.py              # 품질 검증 에이전트
│       └── Generate_OX_SubAgent_Prompt/  # 각 에이전트 프롬프트 및 스키마
│           ├── OXPlanner_Prompt/
│           │   ├── OXPlanner_Object.json
│           │   └── OXPlanner_SystemPrompt.md
│           ├── OXWriter_Prompt/
│           │   ├── OXWriter_Object.json
│           │   └── OXWriter_SystemPrompt.md
│           └── OXValidator_Prompt/
│               ├── OXValidator_Object.json
│               └── OXValidator_SystemPrompt.md
│
└── Gen_OX_feedBack/                    # OX 채점 및 피드백 모듈
    ├── Gen_OX_FeedBack.py              # 채점 및 기초 피드백 메인 로직
    ├── Gen_OX_FeedBack_Example.text    # 피드백 예시 로그
    └── Gen_OX_feedBack_SubAgent/
        └── OXGrader_Prompt/
            ├── OXGrader.py             # OX 채점 및 피드백 생성 에이전트
            ├── OXGrader_Object.json
            └── OXGrader_SystemPrompt.md
```

**주요 특징**:
- **문제 생성 파이프라인**: Planner(계획) → Writer(작성) → Validator(검증)의 3단계 품질 보증 시스템
- **피드백 파이프라인**: 단순 채점 + AI Grader의 심층 분석 결합
- **O/X 정답 비율 관리**: Planner가 O와 X의 균형을 고려하여 출제 계획 수립
- **Common 모듈 의존**: 사용자 프로필 생성(`Prior_Profile_Gen_Agent`) 및 통합 피드백(`generate_FeedBack`)은 공통 모듈 사용

---

- `OX_Problem_main.py`를 중심으로 OX 문제가 생성되고, 사용자 응답을 받아 채점 및 피드백이 이루어지는 전 과정을 설명

---

## 1. 메인 엔트리 포인트: `if __name__ == "__main__":`
프로그램 실행 시 가장 먼저 호출되며, 전체 워크플로우(`문제 생성 -> 응답 수집 -> 피드백 생성`)를 순차적으로 실행

*   **파일 위치**: `OX_Problem/OX_Problem_main.py`
*   **주요 코드**:
```python
if __name__ == "__main__":
    # 1. 문제 생성 Workflow
    gen_result = Workflow_OX_Problem_Generation(lecture_material, prev_userProfile)
    
    # 2. 사용자 응답 수집
    user_answers = Collect_User_Answers(generated_ox_problems)
    
    # 3. 피드백 생성 Workflow
    feedback_result = Workflow_OX_Problem_Feedback(generated_ox_problems, user_profile, user_answers, lecture_material)
```

---

## 2. [Phase 1] 문제 생성 프로세스: `Workflow_OX_Problem_Generation`
사용자 프로필을 정의하고, 강의 자료를 분석하여 목표 개수만큼의 OX 문제를 생성하는 단계

### [Step 1] 사용자 프로필 생성/수정
사용자의 학습 목표, 수준, 피드백 선호도 등을 정의하는 프로필을 생성

*   **호출 코드**:
```python
# OX_Problem_main.py (line 33)
user_profile = Execute_Generator_PriorProfile(prev_userProfile, exam_type)
```
*   **파일 위치**: `Common/Prior_Profile_Gen_Agent.py`

### [Step 2] 생성 개수 입력
사용자로부터 생성할 OX 문제의 수량을 입력받음 (1~15개 사이)

*   **주요 코드**:
```python
# OX_Problem_main.py (line 40~41)
target_problem_count_input = input("생성할 OX 문제 개수를 입력하세요 (최대 15개, 기본 10개): ").strip()
target_problem_count = int(target_problem_count_input or 10)
```

### [Step 3] OX 문제 생성 및 품질 검증 (핵심 로직)
AI 에이전트들(Planner, Writer, Validator)이 협업하여 고품질의 문제를 생성

*   **호출 코드**:
```python
# OX_Problem_main.py (line 51)
generated_ox_problems = Generate_OX(user_profile, lecture_material, target_problem_count)
```
*   **상세 흐름 (`OX_Problem/Generate_OX/Generate_OX.py`)**:
    1.  **OX Planner (`OXPlanner`)**: 강의 자료에서 핵심 개념을 추출하고 O/X 정답 비율을 포함한 출제 계획 수립
    2.  **Generation & Validation Loop (최대 3회 재시도)**:
        *   **OX Writer (`OXWriter`)**: 수립된 계획과 사용자 프로필, 이전 피드백을 반영하여 실제 OX 문제 생성
        *   **OX Validator (`OXValidator`)**: 생성된 문제가 강의 자료와 일치하는지(Fact Check), 개수가 맞는지, 스타일 가이드를 준수했는지 검증
        *   **Decision**: 검증 통과(`is_valid: True`) 시 즉시 반환하며, 실패 시 피드백을 Writer에게 전달하여 재생성

---

## 3. [Phase 2] 사용자 응답 수집: `Collect_User_Answers`
생성된 문제를 사용자에게 제시하고 'O' 또는 'X' 답변을 수집, 해당 부분은 실제 서비스시 별도의 UI로 사용자 응답을 받을 것 (응답 데이터 형태는 지금과 일치해야함)

*   **파일 위치**: `OX_Problem/OX_Problem_main.py`
*   **주요 코드**:
```python
def Collect_User_Answers(generated_ox_problems):
    for problem in generated_ox_problems.get('ox_problems', []):
        user_input = input("답변을 입력하세요 (O 또는 X): ").strip().upper()
        user_answers[p_id] = user_input
    return user_answers
```

---

## 4. [Phase 3] 피드백 생성 프로세스: `Workflow_OX_Problem_Feedback`
사용자의 답변을 채점하고, 문제별 심층 분석 및 최종 학습 결과 생성

### [Step 1] OX 채점 및 기초 피드백 생성
단순 정오답 판별과 에이전트 피드백을 결합하여 기초 데이터 생성

*   **호출 코드**:
```python
# OX_Problem_main.py (line 82)
grading_data = Gen_OX_feedBack(generated_ox_problems, user_answers)
```
*   **상세 흐름 (`OX_Problem/Gen_OX_feedBack/Gen_OX_FeedBack.py`)**:
    1.  **로직 채점**: 사용자 답변과 정답을 비교하여 `Correct`/`Incorrect` 판별
    2.  **OX Grader (`OXGrader`)**: 출제 의도를 바탕으로 맞춤형 피드백 메시지와 관련 주제 추출
    3.  **데이터 조립**: 문제 내용, 응답, 채점 결과, AI 피드백을 하나의 객체로 결합

### [Step 2] 통합 학습 결과 로그 생성
공통 형식의 최종 피드백 데이터를 생성하여 반환

*   **호출 코드**:
```python
# OX_Problem_main.py (line 88)
feedback_data = Generator_feedBack(test_log_data=grading_data, ...)
```
*   **파일 위치**: `Common/generate_FeedBack.py`

---

## 5. 비정상 시나리오 및 예외 처리

### 1) 입력 유효성 검사 실패
*   **상황**: 문제 개수나 OX 답변에 잘못된 형식의 값이 입력된 경우
*   **처리**: `while True` 루프와 조건문을 통해 올바른 값이 입력될 때까지 반복해서 입력을 요구

### 2) 품질 검증(Validator) 미통과
*   **상황**: 생성된 문제의 팩트가 틀리거나 가이드를 위반한 경우
*   **처리**: 최대 3회까지 재시도를 수행하며, Validator의 피드백을 반영하여 Writer가 재생성. 3회 초과 시 마지막 결과물을 반환하는 Fallback 로직 작동

### 3) 에이전트 리소스 파일 누락
*   **상황**: 에이전트 실행에 필요한 `.json` 스키마나 `.md` 프롬프트 파일을 찾지 못한 경우
*   **처리**: `find_file` 함수가 `None`을 반환하며, 각 에이전트 내에서 `FileNotFoundError`를 발생시켜 실행 중단
