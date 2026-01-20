from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

def llm_moderator_check_safety(user_input, topic_keyword, topic_description):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 미리 정의된 스키마, 시스템 프롬포트 불러오기 (서버 제작시 수정 필요)
    check_safety_object_schema_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase2/phase2_subAgent/phase2_subAgent_Prompt/moderator_check_safety_Prompt/check_safety_object.json"
    check_safety_system_prompt_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase2/phase2_subAgent/phase2_subAgent_Prompt/moderator_check_safety_Prompt/check_safety_SystemPrompt.md"

    with open(check_safety_object_schema_pwd, 'r', encoding='utf-8') as f:
        check_safety_object_schema = json.load(f)

    with open(check_safety_system_prompt_pwd, 'r', encoding='utf-8') as f:
        check_safety_system_prompt = f.read()

    check_safety_contents = ["UserInput: " + user_input, "TopicKeyword: " + topic_keyword, "TopicDescription: " + topic_description]

    # response 생성
    response = client.models.generate_content(
        model = "gemini-3-flash-preview",
        contents = check_safety_contents,
        config={
            "system_instruction": check_safety_system_prompt, 
            "response_mime_type": "application/json",
            "response_schema": check_safety_object_schema
        })

    return response.text
