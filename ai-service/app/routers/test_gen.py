# ai-service/app/routers/test_gen.py
"""
시험 문제 생성 라우터
LectureTestGenerator를 사용하여 다양한 유형의 시험 문제를 생성합니다.
"""
import hashlib
import json
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from redis.asyncio import Redis

from app.core.redis_client import get_redis
from ai_agent.LectureTestGenerator.main import LectureTestGenerator
from ai_agent.LectureTestGenerator.schemas import (
    ProblemRequest,
    TestGenerationResponse,
    TestProfile,
    ExamType
)
from ai_agent.LectureTestGenerator.profile import generate_profile_async


router = APIRouter(prefix="/api/test-gen", tags=["Test Generator"])

# 전역 Generator 인스턴스 (싱글톤)
generator: Optional[LectureTestGenerator] = None


def get_generator() -> LectureTestGenerator:
    """
    LectureTestGenerator 인스턴스를 반환합니다.
    싱글톤 패턴으로 한 번만 생성합니다.
    """
    global generator
    if generator is None:
        generator = LectureTestGenerator()
    return generator


@router.post("/generate", response_model=TestGenerationResponse)
async def generate_test_route(
    request: ProblemRequest,
    redis: Redis = Depends(get_redis)  # [NEW] Redis 주입
):
    """
    시험 문제를 생성합니다.
    
    Redis 캐싱:
    - 프로필이 자동 생성되는 경우, 강의 내용의 해시를 키로 사용하여 캐싱
    - TTL: 24시간 (86400초)
    """
    generator_instance = get_generator()
    
    if not generator_instance:
        raise HTTPException(status_code=503, detail="AI Service Not Initialized")
    
    try:
        # ---------------------------------------------------------
        # Redis Caching Logic for User Profile
        # ---------------------------------------------------------
        profile = request.user_profile
        
        # 프로필이 요청에 없다면 (자동 생성 모드)
        if not profile:
            # 1. 강의 내용 해시 생성 (Cache Key)
            content_hash = hashlib.md5(request.lecture_content.encode('utf-8')).hexdigest()
            cache_key = f"profile:{content_hash}"
            
            # 2. Redis 조회
            try:
                cached_data = await redis.get(cache_key)
                
                if cached_data:
                    # Cache Hit! 🎯
                    print(f"[Redis] Profile Cache Hit: {cache_key}")
                    profile = TestProfile.model_validate_json(cached_data)
                else:
                    # Cache Miss.. AI 생성 🐢
                    print(f"[Redis] Profile Cache Miss. Generating...")
                    profile = await generate_profile_async(
                        request.lecture_content,
                        generator_instance.client
                    )
                    
                    # 3. Redis 저장 (TTL 24시간)
                    await redis.setex(
                        cache_key,
                        86400,  # 24시간
                        profile.model_dump_json()
                    )
                    print(f"[Redis] Profile cached: {cache_key}")
            except Exception as redis_error:
                # Redis 오류 시에도 정상 동작 (Fallback)
                print(f"[Redis] Error: {redis_error}. Falling back to direct generation.")
                profile = await generate_profile_async(
                    request.lecture_content,
                    generator_instance.client
                )
        else:
            print(">> Using provided User Profile.")
        
        # ---------------------------------------------------------
        # 요청 객체에 프로필 주입 후 생성기 호출
        # ---------------------------------------------------------
        request.user_profile = profile
        response = await generator_instance.generate_test(request)
        return response

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[Error] Test generation failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"시험 문제 생성 실패: {str(e)}")


@router.get("/health")
async def health_check(redis: Redis = Depends(get_redis)):
    """
    Redis 연결 상태를 확인합니다.
    """
    try:
        await redis.ping()
        return {
            "status": "ok",
            "redis": "connected"
        }
    except Exception as e:
        return {
            "status": "error",
            "redis": f"disconnected: {str(e)}"
        }
