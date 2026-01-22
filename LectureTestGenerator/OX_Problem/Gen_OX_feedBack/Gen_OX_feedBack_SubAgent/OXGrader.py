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

def OXGrader(problem_context, user_choice, result_status):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 현재 파일의 위치를 기준으로 프로젝트 루트(LectureTestGenerator)를 찾음
    current_file_path = os.path.abspath(__file__)
    # OX_Problem/Gen_OX_feedBack/Gen_OX_feedBack_SubAgent/OXGrader.py -> 4단계 위가 루트
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(current_file_path))))

    ox_grader_schema_path = find_file("OXGrader_Object.json", base_path)
    ox_grader_system_prompt_path = find_file("OXGrader_SystemPrompt.md", base_path)

    if not ox_grader_schema_path or not ox_grader_system_prompt_path:
        raise FileNotFoundError("OX Grader 프롬포트 파일을 찾을 수 없습니다")

    with open(ox_grader_schema_path, 'r', encoding='utf-8') as f:
        ox_grader_schema = json.load(f)

    with open(ox_grader_system_prompt_path, 'r', encoding='utf-8') as f:
        ox_grader_system_prompt = f.read()
    
    ox_grader_contents = [
        "Problem Context: " + json.dumps(problem_context),
        "User Choice: " + str(user_choice),
        "Result Status: " + str(result_status)
    ]

    # Response 생성
    response = client.models.generate_content(
        model = "gemini-3-flash-preview",
        contents = ox_grader_contents,
        config={
            "system_instruction": ox_grader_system_prompt,
            "response_mime_type": "application/json",
            "response_schema": ox_grader_schema
        })

    return response.text