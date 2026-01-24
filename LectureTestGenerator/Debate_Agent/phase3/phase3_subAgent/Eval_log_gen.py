from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

# 미리 정의된 스키마, 시스템 프롬포트 불러오기 (파일 이름으로 자동 탐색)
def find_file(filename, search_path='.'):
    # 주어진 파일명을 search_path부터 재귀적으로 탐색하여 경로 반환
    for root, dirs, files in os.walk(search_path):
        if filename in files:
            return os.path.join(root, filename)
    return None

def EvaluationLogGenerator(final_status, evaluation_logs, summary_context, history):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 현재 파일의 위치를 기준으로 프로젝트 루트(LectureTestGenerator)를 찾음
    current_file_path = os.path.abspath(__file__)
    # Debate_Agent/phase3/phase3_subAgent/Eval_log_gen.py -> 3단계 위가 Debate_Agent 폴더
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(current_file_path)))

    eval_log_gen_object_schema_path = find_file("eval_log_gen_Object.json", base_path)
    eval_log_gen_system_prompt_path = find_file("eval_log_gen_SystemPrompt.md", base_path)

    if not eval_log_gen_object_schema_path or not eval_log_gen_system_prompt_path:
        raise FileNotFoundError("Eval Log Generator 프롬포트 파일을 찾을 수 없습니다")

    with open(eval_log_gen_object_schema_path, 'r', encoding='utf-8') as f:
        eval_log_gen_object_schema = json.load(f)

    with open(eval_log_gen_system_prompt_path, 'r', encoding='utf-8') as f:
        eval_log_gen_system_prompt = f.read()

    eval_log_gen_contents = [
        "final_status: " + final_status,
        "evaluation_logs: " + json.dumps(evaluation_logs),
        "summary_context: " + json.dumps(summary_context),
        "history: " + json.dumps(history)
    ]

    # response 생성
    response = client.models.generate_content(
        model = "gemini-3-flash-preview",
        contents = eval_log_gen_contents,
        config={
            "system_instruction": eval_log_gen_system_prompt, 
            "response_mime_type": "application/json",
            "response_schema": eval_log_gen_object_schema
        })

    return response.text