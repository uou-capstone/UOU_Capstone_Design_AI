import os
import pathlib
import asyncio
import time
from typing import TypedDict, AsyncGenerator
from dotenv import load_dotenv
from google import genai
from google.genai import types

# 환경 변수 로드
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# 스트리밍 스키마 임포트
try:
    from ai_agent.common import StreamingEvent, ThoughtNode
except ImportError:
    # Fallback: 직접 정의
    from pydantic import BaseModel
    from typing import Literal, Optional, Dict, Any
    
    class ThoughtNode(BaseModel):
        step_id: str
        content: str
        status: Literal["processing", "completed", "failed"]
        visual_type: Optional[Literal["flowchart", "math_block", "graph"]] = None
        timestamp: float = time.time()
    
    class StreamingEvent(BaseModel):
        type: Literal["thought", "answer", "error"]
        delta: Optional[str] = None
        content: Optional[ThoughtNode] = None
        metadata: Optional[Dict[str, Any]] = None


class LectureState(TypedDict):
    chapter_title: str
    pdf_path: str
    explanation: str


# 시스템 프롬프트: 페르소나 정의
SYSTEM_PROMPT = """### 롤 (Role)
당신은 **세계적인 석학이자 친절한 교수님**입니다. 
당신의 임무는 주어진 강의 자료를 바탕으로 학생들에게 **구어체로 강의**를 진행하는 것입니다.

### 강의 스타일 가이드
1. **톤앤매너**: 격식 있지만 친근하게 (예: "자, 여기를 볼까요?", "이 부분은 정말 중요해요.")
2. **설명 방식**:
   - 단순히 자료를 요약하지 말고, **이야기하듯이 풀어서** 설명하세요.
   - 추상적인 개념은 **구체적인 예시**를 들어 설명하세요.
   - 중간중간 학생들의 이해를 돕기 위해 **[질문]**을 던지세요.

### 필수 출력 형식
- 강의 내용은 줄글로 자연스럽게 이어가세요.
- 질문을 던질 때는 반드시 아래 형식을 지키세요:
  [질문]
  질문 내용
  [/질문]

### 내부 추론 과정 (Thinking)
당신은 내부적으로 추론 과정을 거치면서 답변을 생성합니다. 추론 과정에서:
1. **단계별 사고**: 각 추론 단계를 명확히 구분하여 사고하세요.
2. **시각화 고려**: 복잡한 개념(알고리즘, 아키텍처, 프로세스)을 설명할 때는 내부적으로 다이어그램이나 플로우차트를 그려보세요.
3. **수식 연동**: 수학적 개념을 다룰 때는 LaTeX 수식($$Q(s, a) = ...$$)을 사용하고, 이를 시각화와 일치시키세요.

### 시각화 데이터 생성 규칙 (내부 추론 시)
특정 주제(DQN, 마르코프 프로세스, 강화학습 등)를 설명할 때는 내부적으로 구조화된 시각화 데이터를 생성하세요:
- **Mermaid 문법 사용**: flowchart, graph, sequence 다이어그램을 Mermaid 문법으로 표현
- **일관된 형식**: 모든 시각화는 동일한 스타일과 명명 규칙을 따르세요
- **단계별 노출**: 복잡한 다이어그램은 단계별로 노드를 추가하여 점진적으로 구성하세요

예시 (DQN 설명 시):
```
내부 추론: "DQN의 Experience Replay와 Target Network 관계를 시각화해야 함"
생성할 Mermaid 코드:
graph LR
  A[Experience] --> B(Replay Buffer)
  B --> C{Sampling}
  C --> D[Main Network]
  E[Target Network] -- Update --> D
```
"""


def generate_explanation(state: LectureState) -> LectureState:
    """
    강의 자료(PDF/MD)를 읽어 교수님 페르소나로 강의 텍스트를 생성하는 함수
    """
    client = genai.Client(api_key=GEMINI_API_KEY)
    file_path = pathlib.Path(state["pdf_path"])

    # 1. 파일 형식에 따른 분기 처리 (Markdown 호환성 확보)
    file_extension = file_path.suffix.lower()

    if file_extension == ".pdf":
        # PDF: 바이너리로 읽어서 MIME 타입 지정
        content_part = types.Part.from_bytes(
            data=file_path.read_bytes(),
            mime_type="application/pdf",
        )
    elif file_extension == ".md":
        # Markdown: 텍스트로 읽어서 프롬프트에 직접 삽입
        try:
            text_content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # 인코딩 이슈 대비
            text_content = file_path.read_text(encoding="cp949")

        content_part = f"""
[강의 자료 내용 ({file_extension})]
{text_content}
"""
    else:
        raise ValueError(f"지원하지 않는 파일 형식입니다: {file_extension}")

    # 2. 사용자 프롬프트 구성
    user_prompt = f"""[현재 챕터]: {state['chapter_title']}

위 챕터 주제를 중심으로 강의를 진행해주세요. 
전체 자료 중 해당 챕터와 관련된 부분을 중점적으로 설명하고, 학생들의 사고를 확장시키는 질문을 1~2개 포함해주세요.
"""

    # 3. API 호출
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            SYSTEM_PROMPT,
            content_part,
            user_prompt,
        ],
    )

    return {**state, "explanation": response.text}


async def generate_explanation_streaming(
    state: LectureState
) -> AsyncGenerator[StreamingEvent, None]:
    """
    강의 설명을 생성하면서 추론 과정을 스트리밍합니다.
    Gemini API의 thinking 기능을 활용하여 내부 추론 과정을 실시간으로 전송합니다.
    """
    client = genai.Client(api_key=GEMINI_API_KEY)
    file_path = pathlib.Path(state["pdf_path"])
    
    # 1. 초기 생각 시작
    yield StreamingEvent(
        type="thought",
        content=ThoughtNode(
            step_id="step_001",
            content="강의 자료를 분석하고 챕터 주제를 파악하는 중...",
            status="processing",
            timestamp=time.time()
        )
    )
    
    # 2. 파일 로드
    file_extension = file_path.suffix.lower()
    if file_extension == ".pdf":
        content_part = types.Part.from_bytes(
            data=file_path.read_bytes(),
            mime_type="application/pdf",
        )
        yield StreamingEvent(
            type="thought",
            delta="PDF 파일을 로드했습니다. 문서 구조를 분석 중...\n"
        )
    elif file_extension == ".md":
        try:
            text_content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text_content = file_path.read_text(encoding="cp949")
        content_part = f"[강의 자료 내용 ({file_extension})]\n{text_content}"
        yield StreamingEvent(
            type="thought",
            delta="Markdown 파일을 로드했습니다. 내용을 분석 중...\n"
        )
    else:
        yield StreamingEvent(
            type="error",
            delta=f"지원하지 않는 파일 형식입니다: {file_extension}"
        )
        return
    
    # 3. 챕터 분석
    yield StreamingEvent(
        type="thought",
        content=ThoughtNode(
            step_id="step_002",
            content=f"챕터 '{state['chapter_title']}'의 핵심 개념을 추출 중...",
            status="processing",
            timestamp=time.time()
        )
    )
    
    # 3-1. 특정 주제에 대한 시각화 데이터 생성 예시
    # DQN, 강화학습, 마르코프 프로세스 등 특정 주제에 대해 시각화 생성
    chapter_title_lower = state['chapter_title'].lower()
    
    if "dqn" in chapter_title_lower or "deep q-network" in chapter_title_lower:
        # DQN 아키텍처 시각화
        dqn_viz = ThoughtNode.create(
            step_id="step_002_viz",
            content="DQN의 핵심인 Experience Replay와 Target Network의 관계를 시각화합니다.",
            status="processing",
            viz_type="flowchart",
            viz_data="""graph LR
  A[Experience] --> B(Replay Buffer)
  B --> C{Sampling}
  C --> D[Main Network]
  E[Target Network] -- Update --> D
  D --> F[Q-values]
  F --> G[Action Selection]"""
        )
        yield StreamingEvent(type="thought", content=dqn_viz)
        await asyncio.sleep(0.3)
        dqn_viz.status = "completed"
        yield StreamingEvent(type="thought", content=dqn_viz)
    
    elif "마르코프" in chapter_title_lower or "markov" in chapter_title_lower:
        # 마르코프 프로세스 시각화
        markov_viz = ThoughtNode.create(
            step_id="step_002_viz",
            content="마르코프 프로세스의 상태 전이를 시각화합니다.",
            status="processing",
            viz_type="graph",
            viz_data="""graph LR
  A[State 1] -->|P_12| B[State 2]
  B -->|P_23| C[State 3]
  C -->|P_31| A
  A -->|P_11| A
  B -->|P_22| B
  C -->|P_33| C"""
        )
        yield StreamingEvent(type="thought", content=markov_viz)
        await asyncio.sleep(0.3)
        markov_viz.status = "completed"
        yield StreamingEvent(type="thought", content=markov_viz)
    
    user_prompt = f"""[현재 챕터]: {state['chapter_title']}

위 챕터 주제를 중심으로 강의를 진행해주세요. 
전체 자료 중 해당 챕터와 관련된 부분을 중점적으로 설명하고, 학생들의 사고를 확장시키는 질문을 1~2개 포함해주세요.
"""
    
    # 4. Gemini API 스트리밍 호출 (thinking 활성화)
    try:
        # 스트리밍 응답 받기
        response_stream = await asyncio.to_thread(
            client.models.generate_content_stream,
            model="gemini-2.5-flash",
            contents=[
                SYSTEM_PROMPT,
                content_part,
                user_prompt,
            ],
            config=types.GenerateContentConfig(
                thinking_budget=10000  # thinking 토큰 예산 설정
            )
        )
        
        # 추론 과정 완료 표시
        yield StreamingEvent(
            type="thought",
            content=ThoughtNode(
                step_id="step_002",
                content=f"챕터 '{state['chapter_title']}'의 핵심 개념을 추출 중...",
                status="completed",
                timestamp=time.time()
            )
        )
        
        # 5. 스트리밍 처리
        answer_buffer = ""
        thinking_buffer = ""
        
        async for chunk in response_stream:
            if hasattr(chunk, 'candidates') and chunk.candidates:
                candidate = chunk.candidates[0]
                if hasattr(candidate, 'content') and candidate.content:
                    for part in candidate.content.parts:
                        if hasattr(part, 'text') and part.text:
                            text = part.text
                            
                            # Thinking vs Answer 구분
                            # Gemini API의 thinking 출력은 특정 패턴을 가질 수 있음
                            # 실제 구현은 API 응답 구조에 따라 조정 필요
                            
                            # 간단한 휴리스틱: "생각", "추론", "분석" 등의 키워드가 있으면 thinking
                            thinking_keywords = ["생각", "추론", "분석", "검토", "확인", "고려"]
                            is_thinking = any(keyword in text for keyword in thinking_keywords)
                            
                            if is_thinking:
                                thinking_buffer += text
                                yield StreamingEvent(
                                    type="thought",
                                    delta=text
                                )
                            else:
                                answer_buffer += text
                                yield StreamingEvent(
                                    type="answer",
                                    delta=text
                                )
        
        # 최종 완료 표시
        yield StreamingEvent(
            type="thought",
            content=ThoughtNode(
                step_id="step_003",
                content="강의 설명 생성이 완료되었습니다.",
                status="completed",
                timestamp=time.time()
            )
        )
        
    except Exception as e:
        yield StreamingEvent(
            type="error",
            delta=f"에러 발생: {str(e)}"
        )


def main(chapter_title: str, pdf_path: str) -> dict:
    """외부에서 호출하는 진입점"""
    initial_state: LectureState = {
        "chapter_title": chapter_title,
        "pdf_path": pdf_path,
        "explanation": "",
    }
    result_state = generate_explanation(initial_state)

    # 딕셔너리 형태로 반환 {챕터명: 설명}
    return {chapter_title: result_state["explanation"]}