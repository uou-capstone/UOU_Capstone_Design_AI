from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

def EvaluationLogGenerator(final_status, evaluation_logs, summary_context, history):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 미리 정의된 스키마, 시스템 프롬포트 불러오기 (서버 제작시 수정 필요)
    eval_log_gen_object_schema_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase3/phase3_subAgent/phase3_subAget_Prompt/eval_log_generator_Prompt/eval_log_gen_Object.json"
    eval_log_gen_system_prompt_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase3/phase3_subAgent/phase3_subAget_Prompt/eval_log_generator_Prompt/eval_log_gen_SystemPrompt.md"

    with open(eval_log_gen_object_schema_pwd, 'r', encoding='utf-8') as f:
        eval_log_gen_object_schema = json.load(f)

    with open(eval_log_gen_system_prompt_pwd, 'r', encoding='utf-8') as f:
        eval_log_gen_system_prompt = f.read()

    eval_log_gen_contents = [
        "final_status: " + final_status,
        "evaluation_logs: " + json.dumps(evaluation_logs),
        "summary_context: " + json.dumps(summary_context),
        "history: " + json.dumps(history)
    ]

    # response 생성
    response = client.models.generate_content(
        model = "gemini-3-pro-preview",
        contents = eval_log_gen_contents,
        config={
            "system_instruction": eval_log_gen_system_prompt, 
            "response_mime_type": "application/json",
            "response_schema": eval_log_gen_object_schema
        })

    return response.text