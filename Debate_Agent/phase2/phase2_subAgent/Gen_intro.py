from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

def llm_moderator_generate_intro(topic_keyword, rules, topic_description, dialogue_style):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 미리 정의된 스키마, 시스템 프롬포트 불러오기 (서버 제작시 수정 필요)
    moderator_gen_intro_object_schema_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase2/phase2_subAgent/phase2_subAgent_Prompt/moderator_gen_intro_Prompt/moderator_gen_intro_Object.json"
    moderator_gen_intro_system_prompt_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase2/phase2_subAgent/phase2_subAgent_Prompt/moderator_gen_intro_Prompt/moderator_gen_intro_Prompt.md"

    with open(moderator_gen_intro_object_schema_pwd, 'r', encoding='utf-8') as f:
        moderator_gen_intro_object_schema = json.load(f)

    with open(moderator_gen_intro_system_prompt_pwd, 'r', encoding='utf-8') as f:
        moderator_gen_intro_system_prompt = f.read()

    gen_intro_contents = [topic_keyword, json.dumps(rules, ensure_ascii=False), topic_description, dialogue_style]

    # response 생성
    response = client.models.generate_content(
        model = "gemini-3-flash-preview",
        contents = gen_intro_contents,
        config={
            "system_instruction": moderator_gen_intro_system_prompt, 
            "response_mime_type": "application/json",
            "response_schema": moderator_gen_intro_object_schema
        })

    return response.text