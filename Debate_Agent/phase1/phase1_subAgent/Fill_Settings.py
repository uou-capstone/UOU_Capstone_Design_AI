from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

def fill_settings(current_session_profile, user_response):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 미리 정의된 스키마, 시스템 프롬포트 불러오기 (서버 제작시 수정 필요)
    fill_settings_schema_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase1/phase1_subAgent/phase1_subAgent_Prompt/Fill_Settings_Prompt/fillSettingsResponse_Object.json"
    fill_settings_system_prompt_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase1/phase1_subAgent/phase1_subAgent_Prompt/Fill_Settings_Prompt/fill_Settings_SystemPrompt.md"


    with open(fill_settings_schema_pwd, 'r', encoding='utf-8') as f:
        fill_settings_schema = json.load(f)

    with open(fill_settings_system_prompt_pwd, 'r', encoding='utf-8') as f:
        fill_settings_system_prompt = f.read()
    
    # current_session_profile를 딕셔너리에서 -> 문자열로 바꾼다
    current_session_profile_str = json.dumps(current_session_profile, ensure_ascii=False)
    fill_setting_agent_contents = [current_session_profile_str, user_response]

    # response 생성
    response = client.models.generate_content(
        model = "gemini-3-flash-preview",
        contents = fill_setting_agent_contents,
        config={
            "system_instruction": fill_settings_system_prompt,
            "response_mime_type": "application/json",
            "response_schema": fill_settings_schema
        })
    
    # response를 딕셔너리 형태로 반환
    return response.text    