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

def llm_moderator_generate_intro(topic_keyword, rules, topic_description, dialogue_style):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 현재 파일의 위치를 기준으로 프로젝트 루트(LectureTestGenerator)를 찾음
    current_file_path = os.path.abspath(__file__)
    # Debate_Agent/phase2/phase2_subAgent/Gen_intro.py -> 3단계 위가 Debate_Agent 폴더
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(current_file_path)))

    moderator_gen_intro_object_schema_path = find_file("moderator_gen_intro_Object.json", base_path)
    moderator_gen_intro_system_prompt_path = find_file("moderator_gen_intro_Prompt.md", base_path)

    if not moderator_gen_intro_object_schema_path or not moderator_gen_intro_system_prompt_path:
        raise FileNotFoundError("Moderator Generate Intro 프롬포트 파일을 찾을 수 없습니다")

    with open(moderator_gen_intro_object_schema_path, 'r', encoding='utf-8') as f:
        moderator_gen_intro_object_schema = json.load(f)

    with open(moderator_gen_intro_system_prompt_path, 'r', encoding='utf-8') as f:
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