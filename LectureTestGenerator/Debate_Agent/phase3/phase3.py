from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json
from phase3_subAgent.Eval_log_gen import EvaluationLogGenerator

def Execute_Debate_Mode_Phase3(final_status, evaluation_logs, summary_context, history):
    """
    토론 세션의 최종 평가 로그를 생성하는 Phase 3 함수
    
    Args:
        final_status: 토론 최종 상태 (WIN, LOSS, ABORT, COLD_GAME 등)
        evaluation_logs: 각 턴별 평가 로그 리스트
        summary_context: 토론 전체 요약 컨텍스트
        history: 토론 대화 이력
        
    Returns:
        str: 최종 평가 보고서 (JSON 형식)
    """
    return EvaluationLogGenerator(final_status, evaluation_logs, summary_context, history)