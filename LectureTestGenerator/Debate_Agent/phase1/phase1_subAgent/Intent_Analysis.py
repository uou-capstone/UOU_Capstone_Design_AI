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

def intent_analysis(user_response):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 현재 파일의 위치를 기준으로 프로젝트 루트(LectureTestGenerator)를 찾음
    current_file_path = os.path.abspath(__file__)
    # Debate_Agent/phase1/phase1_subAgent/Intent_Analysis.py -> 3단계 위가 Debate_Agent 폴더
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(current_file_path)))

    intent_analysis_schema_path = find_file("Intent_Analysis_Object.json", base_path)
    intent_analysis_system_prompt_path = find_file("Intent_Analysis_SystemPrompt.md", base_path)

    if not intent_analysis_schema_path or not intent_analysis_system_prompt_path:
        raise FileNotFoundError("Intent Analysis 프롬포트 파일을 찾을 수 없습니다")

    with open(intent_analysis_schema_path, 'r', encoding='utf-8') as f:
        intent_analysis_schema = json.load(f)

    with open(intent_analysis_system_prompt_path, 'r', encoding='utf-8') as f:
        intent_analysis_system_prompt = f.read()

    # content 생성
    intent_analysis_agent_contents = user_response

    # response 생성
    response = client.models.generate_content(
        model = "gemini-3-flash-preview",
        contents = intent_analysis_agent_contents,
        config={
            "system_instruction": intent_analysis_system_prompt,
            "response_mime_type": "application/json",
            "response_schema": intent_analysis_schema
        })
    
    # response를 딕셔너리 형태로 반환
    return response.text
