# ai-service/ai_agent/common/streaming_schemas.py
"""
에이전트 추론 과정 스트리밍을 위한 공통 스키마 정의
"""
from pydantic import BaseModel
from typing import Literal, Optional, Dict, Any
import time


class ThoughtNode(BaseModel):
    """각 추론 단계의 단위"""
    step_id: str  # 단계별 고유 식별자
    content: str  # 실시간 스트리밍되는 텍스트 내용
    status: Literal["processing", "completed", "failed"] = "processing"  # 상태
    visual_type: Optional[Literal["flowchart", "math_block", "graph"]] = None  # 시각화 타입 (하위 호환성)
    timestamp: float = time.time()  # 타임스탬프
    
    # 시각화를 위한 필드 추가 (Mermaid.js / React Flow 연동)
    viz_type: Optional[Literal["flowchart", "graph", "tree", "sequence"]] = None  # Mermaid.js 시각화 타입
    viz_data: Optional[str] = None  # Mermaid 문법 또는 JSON 좌표 데이터
    
    @classmethod
    def create(
        cls, 
        step_id: str, 
        content: str, 
        status: str = "processing", 
        visual_type: str = None,
        viz_type: str = None,
        viz_data: str = None
    ):
        """ThoughtNode 생성 헬퍼"""
        return cls(
            step_id=step_id,
            content=content,
            status=status,
            visual_type=visual_type,
            viz_type=viz_type,
            viz_data=viz_data,
            timestamp=time.time()
        )


class StreamingEvent(BaseModel):
    """스트리밍 이벤트"""
    type: Literal["thought", "answer", "error"]  # 이벤트 타입
    delta: Optional[str] = None  # 증분 텍스트 (스트리밍용)
    content: Optional[ThoughtNode] = None  # 완전한 Thought Node
    metadata: Optional[Dict[str, Any]] = None  # 추가 메타데이터
