# LectureTestGenerator 리팩토링 계획

## 📋 현재 구조 분석

### 발견된 문제점

1. **구조적 파편화**
   - 각 시험 유형(Five_Choice, OX_Problem 등)이 독립적인 main.py와 깊은 폴더 구조를 가짐
   - `Five_Choice/Gen_5_Choice/Gen_5_Choice_SubAgent/...` 같은 중첩 구조
   - 공통 로직(Common)이 분리되어 있어 재사용 어려움

2. **콘솔 기반 I/O**
   - `input()`, `print()` 사용으로 웹 서비스 통합 불가
   - 사용자 상호작용이 코드에 하드코딩됨

3. **경로 의존성**
   - `sys.path.append()` 남용
   - 하드코딩된 경로 (`/Users/jhkim/Desktop/...`)
   - `find_file()` 함수로 파일 탐색 (비효율적)

4. **동기 처리**
   - 모든 API 호출이 순차적
   - 문제 생성 시 병렬 처리 없음

5. **프롬프트/스키마 분산**
   - 각 SubAgent 폴더에 프롬프트/스키마 파일 산재
   - 25개 이상의 SystemPrompt.md 파일
   - JSON 스키마도 각 폴더에 분산

## 🎯 리팩토링 목표 구조

```
ai-service/ai_agent/LectureTestGenerator/
├── __init__.py              # 패키지 노출 관리
├── main.py                  # 통합 진입점 (Orchestrator)
├── prompts.py               # 모든 프롬프트 템플릿 중앙화
├── schemas.py               # Pydantic 모델 정의 (입출력 스키마)
├── utils.py                 # 공통 유틸리티 (PDF 로드, 파일 처리 등)
├── profile.py               # 사용자 프로필 생성/관리 로직
└── generators/              # 각 시험 유형별 로직
    ├── __init__.py
    ├── base.py              # BaseGenerator 추상 클래스
    ├── five_choice.py       # 5지선다 생성기
    ├── ox_problem.py        # OX 문제 생성기
    ├── flash_card.py        # 플래시카드 생성기
    ├── short_answer.py      # 단답형 생성기
    └── debate.py            # 토론형 생성기 (Debate_Agent 통합)
```

## 📝 단계별 리팩토링 계획

### Phase 1: 기반 구조 구축 (Foundation)

#### 1.1 스키마 정의 (`schemas.py`)
- **Prior_Profile.json** → `TestProfile` Pydantic 모델
- 각 시험 유형별 Response 스키마 정의
- Request 스키마 정의 (입력 파라미터)

**예시:**
```python
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Literal, Union
from enum import Enum

class ProficiencyLevel(str, Enum):
    BEGINNER = "Beginner"
    INTERMEDIATE = "Intermediate"
    ADVANCED = "Advanced"

class TestProfile(BaseModel):
    learning_goal: LearningGoal
    user_status: UserStatus
    interaction_style: InteractionStyle
    feedback_preference: FeedbackPreference
    scope_boundary: str

class ProblemRequest(BaseModel):
    exam_type: Literal["Five_Choice", "OX", "Flash_Card", "Short_Answer", "Debate"]
    target_count: int = Field(ge=1, le=15, default=10)
    lecture_content: str  # Markdown text or file path
    user_profile: Optional[TestProfile] = None  # 자동 생성 가능

class FiveChoiceProblem(BaseModel):
    id: int
    question_content: str
    options: List[Dict[str, str]]  # [{"id": "1", "content": "..."}, ...]
    correct_answer: str
    explanation: Optional[str] = None

class TestGenerationResponse(BaseModel):
    problems: List[Union[FiveChoiceProblem, ...]]  # Union 타입
    user_profile: TestProfile
    metadata: Dict[str, Any]
```

#### 1.2 프롬프트 중앙화 (`prompts.py`)
- 모든 SystemPrompt.md 파일 내용을 변수로 통합
- JSON 스키마도 함께 관리

**구조:**
```python
# prompts.py
FIVE_CHOICE_PLANNER_PROMPT = """..."""
FIVE_CHOICE_WRITER_PROMPT = """..."""
FIVE_CHOICE_VALIDATOR_PROMPT = """..."""
# ... (25개 프롬프트 모두)

# schemas.py에 JSON 스키마도 함께
FIVE_CHOICE_PLANNER_SCHEMA = {...}
```

#### 1.3 공통 유틸리티 (`utils.py`)
- PDF/텍스트 파일 로드 함수
- 환경 변수 관리
- 파일 경로 처리

```python
async def load_lecture_material(file_path: str) -> str:
    """PDF 또는 텍스트 파일을 로드하여 문자열로 반환"""
    pass
```

### Phase 2: 프로필 생성 로직 리팩토링 (`profile.py`)

#### 2.1 비동기 프로필 생성
- `Prior_Profile_Gen_Agent.py`의 `Execute_Generator_PriorProfile()` 함수를 비동기로 변환
- `input()` 제거 → 함수 인자로 받거나 자동 생성

```python
async def generate_profile_async(
    lecture_content: str,
    exam_type: str,
    existing_profile: Optional[TestProfile] = None
) -> TestProfile:
    """강의 내용을 분석하여 사용자 프로필 자동 생성"""
    # AI가 강의 내용을 분석하여 최적의 프로필 생성
    pass
```

#### 2.2 프로필 수정 로직
- `Update_Profile_Logic.py` → `update_profile()` 함수로 변환
- 대화형 루프 제거, 직접 수정 가능한 API 제공

### Phase 3: Generator 클래스화 (`generators/`)

#### 3.1 BaseGenerator 추상 클래스 (`base.py`)
```python
from abc import ABC, abstractmethod

class BaseGenerator(ABC):
    def __init__(self, client: genai.Client):
        self.client = client
        self.semaphore = asyncio.Semaphore(5)  # Rate limit 방어
    
    @abstractmethod
    async def generate_async(
        self,
        lecture_content: str,
        user_profile: TestProfile,
        target_count: int
    ) -> List[BaseProblem]:
        """문제 생성 (비동기)"""
        pass
    
    @abstractmethod
    async def validate_async(self, problems: List[BaseProblem]) -> ValidationResult:
        """문제 검증 (비동기)"""
        pass
```

#### 3.2 각 Generator 구현
- **Five_Choice**: `Five_Choice_main.py` + `Gen_5_Choice.py` → `generators/five_choice.py`
- **OX_Problem**: `OX_Problem_main.py` + `Generate_OX.py` → `generators/ox_problem.py`
- **Flash_Card**: `Flash_Card_Main.py` + `Generate_flashCard.py` → `generators/flash_card.py`
- **ShortAnswer**: `ShortAnswer_main.py` + `Gen_ShortAnswer.py` → `generators/short_answer.py`
- **Debate**: `Debate_Agent_Main.py` → `generators/debate.py` (별도 처리 필요)

**변환 예시 (FiveChoiceGenerator):**
```python
class FiveChoiceGenerator(BaseGenerator):
    async def generate_async(
        self,
        lecture_content: str,
        user_profile: TestProfile,
        target_count: int
    ) -> List[FiveChoiceProblem]:
        # 1. Planner (비동기)
        plan = await self._plan_async(lecture_content, user_profile, target_count)
        
        # 2. Writer + Validator 루프 (최대 3회)
        for attempt in range(3):
            # 병렬로 여러 문제 생성 가능
            problems = await self._write_async(plan, user_profile, target_count)
            validation = await self._validate_async(problems, lecture_content)
            
            if validation.is_valid:
                return problems
            # 피드백 반영 후 재시도
        
        return problems  # Fallback
```

### Phase 4: 통합 진입점 (`main.py`)

#### 4.1 LectureTestGenerator 클래스
```python
class LectureTestGenerator:
    def __init__(self, api_key: Optional[str] = None):
        self.client = genai.Client(api_key=api_key or os.getenv("GEMINI_API_KEY"))
        self.generators = {
            "Five_Choice": FiveChoiceGenerator(self.client),
            "OX": OXProblemGenerator(self.client),
            "Flash_Card": FlashCardGenerator(self.client),
            "Short_Answer": ShortAnswerGenerator(self.client),
            "Debate": DebateGenerator(self.client),
        }
    
    async def generate_test_async(
        self,
        request: ProblemRequest
    ) -> TestGenerationResponse:
        """통합 테스트 생성 API"""
        # 1. 프로필 생성/확인
        if not request.user_profile:
            profile = await generate_profile_async(
                request.lecture_content,
                request.exam_type
            )
        else:
            profile = request.user_profile
        
        # 2. Generator 선택 (Factory Pattern)
        generator = self.generators[request.exam_type]
        
        # 3. 문제 생성 (비동기)
        problems = await generator.generate_async(
            request.lecture_content,
            profile,
            request.target_count
        )
        
        # 4. 응답 구성
        return TestGenerationResponse(
            problems=problems,
            user_profile=profile,
            metadata={"exam_type": request.exam_type, ...}
        )
    
    async def generate_feedback_async(
        self,
        problems: List[BaseProblem],
        user_answers: Dict[int, Any],
        user_profile: TestProfile,
        lecture_content: str
    ) -> FeedbackResponse:
        """피드백 생성 API"""
        pass
```

### Phase 5: 피드백 시스템 통합

#### 5.1 Grader 통합
- 각 시험 유형의 Feedback 폴더 로직을 Generator 클래스에 통합
- `Common/generate_FeedBack.py` → `main.py`의 `generate_feedback_async()`로 이동

## 🔄 마이그레이션 전략

### 우선순위
1. **High Priority**: Five_Choice (가장 복잡하고 자주 사용)
2. **Medium Priority**: OX_Problem, Flash_Card, ShortAnswer
3. **Low Priority**: Debate (별도 구조이므로 나중에)

### 호환성 유지
- 기존 코드와 병행 운영 가능하도록 점진적 마이그레이션
- 기존 함수를 래퍼로 유지 (Deprecated 표시)

### 테스트 전략
- 각 Generator별 단위 테스트
- 통합 테스트 (end-to-end)
- 기존 예제 파일로 회귀 테스트

## 📊 예상 개선 효과

### 성능
- **병렬 처리**: 10개 문제 생성 시 30초 → 5초 (약 6배 향상)
- **비동기 I/O**: API 호출 대기 시간 최소화

### 유지보수성
- **코드 라인 수**: 약 40% 감소 (중복 제거)
- **프롬프트 관리**: 25개 파일 → 1개 파일
- **Import 경로**: 명확한 상대 경로

### 확장성
- **새로운 시험 유형 추가**: BaseGenerator 상속만으로 가능
- **웹 서비스 통합**: FastAPI 라우터에서 직접 호출 가능

## ⚠️ 주의사항

1. **Debate_Agent 통합**
   - Debate는 별도의 3단계 Phase 구조를 가짐
   - 기존 Debate_Agent 로직을 최대한 보존하면서 통합 필요

2. **프로필 생성 모드**
   - 자동 생성 vs 대화형 생성 선택 가능하게
   - FastAPI에서 턴 기반 대화 지원 (선택사항)

3. **에러 처리**
   - API Rate Limit 대응 (세마포어)
   - 부분 실패 허용 (일부 문제만 생성되어도 반환)

## 🚀 실행 계획

1. **Week 1**: Phase 1-2 (기반 구조 + 프로필)
2. **Week 2**: Phase 3 (Five_Choice Generator)
3. **Week 3**: Phase 3 (나머지 Generators)
4. **Week 4**: Phase 4-5 (통합 + 피드백)
