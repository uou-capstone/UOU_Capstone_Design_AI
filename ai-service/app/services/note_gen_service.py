# ai-service/app/services/note_gen_service.py
import os
import json
import asyncio
import traceback
from ai_agent.LectureContentGenerator.agents.phase1_planning import execute_phase1
from ai_agent.LectureContentGenerator.agents.phase2_briefing import execute_phase2
from ai_agent.LectureContentGenerator.agents.phase3_research import execute_phase3_async
from ai_agent.LectureContentGenerator.agents.phase4_review import execute_phase4_async
from ai_agent.LectureContentGenerator.agents.phase5_assembly import execute_phase5
from app.core.redis_client import redis_manager


async def generate_lecture_note(topic: str, audience: str = "University Students") -> str:
    """
    LectureContentGenerator의 전체 파이프라인을 실행합니다.
    API 요청에 맞춰 대화형 과정을 생략하고 자동 모드로 진행합니다.
    
    Args:
        topic: 생성할 강의 주제
        audience: 대상 독자 수준 (기본값: "University Students")
    
    Returns:
        str: 생성된 강의 자료 마크다운 텍스트
    """
    print(f"[NoteGen] Starting generation for topic: {topic}, audience: {audience}")

    try:
        # Phase 1: Planning (API 모드: 자동 진행)
        print("[NoteGen] Phase 1: Planning...")
        # topic과 audience를 결합하여 입력으로 사용
        user_input = f"주제: {topic}\n대상 독자: {audience}"
        draft_plan = execute_phase1(topic=user_input, auto_mode=True)
        
        if not draft_plan:
            raise RuntimeError("Phase 1 실패: 기획안을 생성할 수 없습니다.")
        
        print(f"[NoteGen] Phase 1 완료: {draft_plan.get('project_meta', {}).get('title', 'Untitled')}")
        
        # Phase 2: Briefing (API 모드: 자동 승인)
        print("[NoteGen] Phase 2: Briefing...")
        finalized_brief = execute_phase2(draft_plan, auto_mode=True)
        
        if not finalized_brief:
            raise RuntimeError("Phase 2 실패: 기획안 확정에 실패했습니다.")
        
        print("[NoteGen] Phase 2 완료: 기획안 확정")
        
        # Phase 3: Research & Writing (병렬 처리)
        print("[NoteGen] Phase 3: Research & Writing (병렬 처리)...")
        chapter_contents = await execute_phase3_async(finalized_brief)
        
        if not chapter_contents:
            raise RuntimeError("Phase 3 실패: 챕터 내용을 생성할 수 없습니다.")
        
        print(f"[NoteGen] Phase 3 완료: {len(chapter_contents)}개 챕터 생성")
        
        # Phase 4: Review (병렬 처리)
        print("[NoteGen] Phase 4: Review (병렬 처리)...")
        verified_contents = await execute_phase4_async(chapter_contents, finalized_brief)
        
        if not verified_contents:
            raise RuntimeError("Phase 4 실패: 검증에 실패했습니다.")
        
        print(f"[NoteGen] Phase 4 완료: {len(verified_contents)}개 챕터 검증")
        
        # Phase 5: Assembly
        print("[NoteGen] Phase 5: Assembly...")
        final_md = execute_phase5(verified_contents)
        
        if not final_md:
            raise RuntimeError("Phase 5 실패: 최종 문서 조립에 실패했습니다.")
        
        print("[NoteGen] 모든 단계 완료!")
        return final_md

    except Exception as e:
        print(f"[NoteGen] Error: {e}")
        traceback.print_exc()
        raise e


async def generate_lecture_note_task(task_id: str, topic: str, audience: str):
    """
    백그라운드에서 실행되며 Redis에 진행 상황을 보고하는 래퍼 함수
    
    Args:
        task_id: 작업 고유 ID
        topic: 강의 주제
        audience: 대상 독자 수준
    """
    redis = redis_manager.get_client()
    key = f"task:{task_id}"

    try:
        # Phase 1: 기획
        await redis.set(
            key,
            json.dumps({
                "status": "processing",
                "progress": 10,
                "message": "기획안 작성 중...",
                "topic": topic
            }, ensure_ascii=False)
        )
        user_input = f"주제: {topic}\n대상 독자: {audience}"
        draft_plan = execute_phase1(topic=user_input, auto_mode=True)
        
        if not draft_plan:
            raise RuntimeError("Phase 1 실패: 기획안을 생성할 수 없습니다.")

        # Phase 2: 브리핑
        await redis.set(
            key,
            json.dumps({
                "status": "processing",
                "progress": 30,
                "message": "기획 검토 중...",
                "topic": topic
            }, ensure_ascii=False)
        )
        finalized_brief = execute_phase2(draft_plan, auto_mode=True)
        
        if not finalized_brief:
            raise RuntimeError("Phase 2 실패: 기획안 확정에 실패했습니다.")

        # Phase 3: 집필 (가장 오래 걸림)
        await redis.set(
            key,
            json.dumps({
                "status": "processing",
                "progress": 50,
                "message": "본문 집필 중 (AI 병렬 처리)...",
                "topic": topic
            }, ensure_ascii=False)
        )
        chapter_contents = await execute_phase3_async(finalized_brief)
        
        if not chapter_contents:
            raise RuntimeError("Phase 3 실패: 챕터 내용을 생성할 수 없습니다.")

        # Phase 4: 검토
        await redis.set(
            key,
            json.dumps({
                "status": "processing",
                "progress": 80,
                "message": "내용 검증 및 수정 중...",
                "topic": topic
            }, ensure_ascii=False)
        )
        verified_contents = await execute_phase4_async(chapter_contents, finalized_brief)
        
        if not verified_contents:
            raise RuntimeError("Phase 4 실패: 검증에 실패했습니다.")

        # Phase 5: 조립
        await redis.set(
            key,
            json.dumps({
                "status": "processing",
                "progress": 90,
                "message": "최종 문서 생성 중...",
                "topic": topic
            }, ensure_ascii=False)
        )
        final_md = execute_phase5(verified_contents)
        
        if not final_md:
            raise RuntimeError("Phase 5 실패: 최종 문서 조립에 실패했습니다.")

        # 완료
        await redis.set(
            key,
            json.dumps({
                "status": "completed",
                "progress": 100,
                "result": final_md,
                "message": "완료됨",
                "topic": topic
            }, ensure_ascii=False),
            ex=86400  # 24시간 TTL
        )
        print(f"[NoteGen] Task {task_id} completed successfully")

    except Exception as e:
        print(f"[Task Error] {task_id}: {e}")
        traceback.print_exc()
        try:
            await redis.set(
                key,
                json.dumps({
                    "status": "failed",
                    "progress": 0,
                    "error": str(e),
                    "message": f"작업 실패: {str(e)}",
                    "topic": topic
                }, ensure_ascii=False),
                ex=86400  # 24시간 TTL
            )
        except Exception as redis_error:
            print(f"[Redis] Failed to save error status: {redis_error}")
