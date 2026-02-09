# ai-service/app/routers/note_gen.py
import uuid
import json
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from app.core.redis_client import get_redis
from app.services.note_gen_service import generate_lecture_note, generate_lecture_note_task


class NoteGenerationRequest(BaseModel):
    topic: str = Field(..., description="생성할 강의 주제")
    audience_level: str = Field(default="University Students", description="대상 독자 수준")


router = APIRouter(prefix="/note-gen", tags=["Lecture Note Generator"])


@router.post("/generate")
async def generate_note_endpoint(req: NoteGenerationRequest):
    """
    주제를 입력받아 전체 강의 자료(Lecture Note)를 생성합니다.
    
    주의: 이 작업은 시간이 오래 걸릴 수 있습니다 (수 분 ~ 수십 분).
    실제 운영 환경에서는 /generate-async 엔드포인트를 사용하여 비동기 처리하는 것을 권장합니다.
    """
    try:
        # 비동기 실행으로 블로킹 방지
        final_md = await generate_lecture_note(req.topic, req.audience_level)
        return {
            "status": "success",
            "topic": req.topic,
            "content": final_md,
            "message": "강의 자료 생성이 완료되었습니다."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"강의 자료 생성 실패: {str(e)}")


@router.post("/generate-async")
async def generate_note_async_endpoint(
    req: NoteGenerationRequest,
    background_tasks: BackgroundTasks,
    redis: Redis = Depends(get_redis)  # [NEW] Redis 주입
):
    """
    비동기 강의 노트 생성 요청. Task ID를 반환합니다.
    
    이 엔드포인트는 즉시 응답을 반환하고, 실제 생성 작업은 백그라운드에서 진행됩니다.
    진행 상태는 /status/{task_id} 엔드포인트로 조회할 수 있습니다.
    """
    task_id = str(uuid.uuid4())
    
    try:
        # 1. 초기 상태 설정 (Redis에 저장)
        initial_status = {
            "status": "queued",
            "progress": 0,
            "message": "작업 대기 중...",
            "topic": req.topic
        }
        await redis.set(
            f"task:{task_id}",
            json.dumps(initial_status, ensure_ascii=False),
            ex=86400  # 24시간 TTL
        )
        
        # 2. 백그라운드 작업 시작
        background_tasks.add_task(
            generate_lecture_note_task,
            task_id,
            req.topic,
            req.audience_level
        )
        
        return {
            "task_id": task_id,
            "status": "accepted",
            "message": "강의 노트 생성이 시작되었습니다.",
            "status_url": f"/note-gen/status/{task_id}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"작업 등록 실패: {str(e)}")


@router.get("/status/{task_id}")
async def get_task_status(
    task_id: str,
    redis: Redis = Depends(get_redis)  # [NEW] Redis 주입
):
    """
    Task 진행 상태 조회
    
    Returns:
        - status: queued | processing | completed | failed
        - progress: 0-100 (진행률)
        - message: 상태 메시지
        - result: 완료 시 생성된 마크다운 텍스트 (status가 completed일 때만)
        - error: 실패 시 에러 메시지 (status가 failed일 때만)
    """
    try:
        data = await redis.get(f"task:{task_id}")
        if not data:
            raise HTTPException(status_code=404, detail="Task not found")
        
        status_data = json.loads(data)
        return status_data
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"상태 데이터 파싱 실패: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"상태 조회 실패: {str(e)}")
