# Flash Card 생성 워크플로우 가이드

- `Flash_Card_Main.py`를 중심으로 플래시 카드가 생성되는 과정을 설명

---

## 1. 메인 엔트리 포인트: `main()`
프로그램 실행 시 가장 먼저 호출되며, 사용자로부터 강의 자료 경로를 입력받아 전체 워크플로우를 실행

*   **파일 위치**: `Flash_Card/Flash_Card_Main.py`
*   **주요 코드**:
```python
def main():
    # 1. 실행 인자(강의 자료 경로) 확인
    lecture_material = sys.argv[1]
    
    # 2. 워크플로우 실행
    result = Workflow_FlashCard_Generation(lecture_material)
```

---

## 2. 전체 프로세스 제어: `Workflow_FlashCard_Generation`
- 전체 생성 단계를 순차적으로 관리하는 컨트롤러 역할

### [Step 1] 사용자 프로필 생성/수정
사용자의 학습 목표와 수준을 정의하는 프로필을 생성

*   **호출 코드**:
```python
# Flash_Card_Main.py (line 36)
user_profile = Execute_Generator_PriorProfile(prev_userProfile, exam_type)
```
*   **상세 흐름 (`Common/Prior_Profile_Gen_Agent.py`)**:
    1.  `ProfileAgent_analyze` 호출: 현재 프로필 상태를 분석하고 부족한 정보가 있다면 질문을 생성
    2.  `UpdateProfileLogic` 호출: 사용자의 답변을 바탕으로 프로필 JSON을 업데이트
    3.  `COMPLETE` 상태가 될 때까지 위 과정을 반복(최대 5회).

### [Step 2] 생성 개수 입력
사용자로부터 생성할 플래시 카드의 수량을 입력받음 (숫자만 입력되어야 함)

*   **주요 코드**:
```python
# Flash_Card_Main.py (line 43~45)
target_card_count_input = input("생성할 플래시 카드 개수를 입력하세요 (최대 30개, 기본 15개): ").strip()
target_card_count = int(target_card_count_input or 15)
```

### [Step 3] 플래시 카드 생성 및 품질 검증 (핵심 로직)
실제 AI 에이전트들이 협업하여 카드를 생성하는 단계

*   **호출 코드**:
```python
# Flash_Card_Main.py (line 54)
generated_cards = Generate_flashCard(user_profile, lecture_material, target_card_count)
```
*   **상세 흐름 (`Flash_Card/Generate_flashCard/Generate_flashCard.py`)**:
    1.  **Concept Planner (`Agent_ConceptPlanner`)**: 강의 자료에서 핵심 개념을 추출하여 출제 계획을 세운다
    2.  **Generation & Validation Loop (최대 3회 재시도)**:
        *   **Card Writer (`Agent_CardWriter`)**: 계획된 개념과 사용자 프로필에 맞춰 실제 카드(앞면/뒷면)를 생성.
        *   **Quality Validator (`Agent_QualityValidator`)**: 생성된 카드가 강의 자료와 일치하는지, 프로필 가이드를 준수했는지 검증
        *   **Decision**: 검증 통과(`is_valid: True`) 시 즉시 반환하며, 실패 시 피드백을 반영하여 재생성

### [Step 5] 피드백 데이터 생성
생성된 결과와 메타 데이터를 조합하여 최종 피드백 객체를 생성 (공통 프로파일 형태)

*   **호출 코드**:
```python
# Flash_Card_Main.py (line 72)
feedback_data = Generator_feedBack(
    test_log_data=generated_cards,
    exam_type=exam_type,
    source_material=lecture_material,
    timestamp=current_timestamp
)
```
*   **파일 위치**: `Common/generate_FeedBack.py`

---

## 3. 비정상 시나리오 및 예외 처리

### 1) 실행 인자 및 파일 경로 오류
*   **상황**: 프로그램 실행 시 인자를 누락하거나 존재하지 않는 파일 경로를 입력한 경우.
*   **처리**: `main()` 함수에서 `sys.exit(1)`을 통해 에러 메시지를 출력하고 즉시 종료

### 2) 사용자 입력 값 유효성 실패
*   **상황**: 카드 개수 입력 시 숫자가 아니거나 범위를 벗어난 값(1~30 이외)을 입력한 경우.
*   **처리**: `while True` 루프와 `try-except` 문을 통해 올바른 값이 입력될 때까지 반복해서 입력을 요구

### 3) 품질 검증(Validator) 미통과
*   **상황**: 생성된 카드의 내용이 부정확하거나 가이드를 위반한 경우.
*   **처리**: `Generate_flashCard` 내의 루프에서 `MAX_RETRIES(3회)`까지 재시도를 수행, 각 시도마다 Validator의 피드백 메시지가 Writer에게 전달됨. 만약 3회 초과 시에는 마지막 생성물을 반환하는 Fallback 로직이 작동.

### 4) 에이전트 프롬프트 파일 누락
*   **상황**: 각 에이전트 실행 시 필요한 `.json` 스키마나 `.md` 시스템 프롬프트 파일을 찾지 못한 경우.
*   **처리**: `find_file` 함수가 `None`을 반환하며, 각 에이전트 함수 내에서 `FileNotFoundError`를 발생시켜 실행을 중단
