from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

def intent_analysis(user_response):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 미리 정의된 스키마, 시스템 프롬포트 불러오기
    intent_analysis_schema_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase1/phase1_subAgent/phase1_subAgent_Prompt/Intent_Analyzer_Prompt/Intent_Analysis_Object.json"
    intent_analysis_system_prompt_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase1/phase1_subAgent/phase1_subAgent_Prompt/Intent_Analyzer_Prompt/Intent_Analysis_SystemPrompt.md"

    with open(intent_analysis_schema_pwd, 'r', encoding='utf-8') as f:
        intent_analysis_schema = json.load(f)

    with open(intent_analysis_system_prompt_pwd, 'r', encoding='utf-8') as f:
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
