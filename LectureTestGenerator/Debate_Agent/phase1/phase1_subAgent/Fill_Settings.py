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

def fill_settings(current_session_profile, user_response):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 현재 파일의 위치를 기준으로 프로젝트 루트(LectureTestGenerator)를 찾음
    current_file_path = os.path.abspath(__file__)
    # Debate_Agent/phase1/phase1_subAgent/Fill_Settings.py -> 3단계 위가 Debate_Agent 폴더
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(current_file_path)))

    fill_settings_schema_path = find_file("fillSettingsResponse_Object.json", base_path)
    fill_settings_system_prompt_path = find_file("fill_Settings_SystemPrompt.md", base_path)

    if not fill_settings_schema_path or not fill_settings_system_prompt_path:
        raise FileNotFoundError("Fill Settings 프롬포트 파일을 찾을 수 없습니다")

    with open(fill_settings_schema_path, 'r', encoding='utf-8') as f:
        fill_settings_schema = json.load(f)

    with open(fill_settings_system_prompt_path, 'r', encoding='utf-8') as f:
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