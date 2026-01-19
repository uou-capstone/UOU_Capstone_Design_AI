from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json

def llm_evaluator_assess_step(user_input, last_attack, lecture_material, dialogue_style, difficulty):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)
    # 미리 정의된 스키마, 시스템 프롬포트 불러오기 (서버 제작시 수정 필요)
    evaluator_assess_step_object_schema_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase2/phase2_subAgent/phase2_subAgent_Prompt/evaluator_assess_step_Prompt/evaluator_assess_step_Object.json"
    evaluator_assess_step_system_prompt_pwd = "/Users/jhkim/Desktop/Debate_Agent/phase2/phase2_subAgent/phase2_subAgent_Prompt/evaluator_assess_step_Prompt/evaluator_assess_step_SystemPrompt.md"

    with open(evaluator_assess_step_object_schema_pwd, 'r', encoding='utf-8') as f:
        evaluator_assess_step_object_schema = json.load(f)

    with open(evaluator_assess_step_system_prompt_pwd, 'r', encoding='utf-8') as f:
        evaluator_assess_step_system_prompt = f.read()

    path = pathlib.Path(lecture_material)

    # 파일 타입별 처리
    if path.is_file(): # 실제 존재하는 파일인지 먼저 검사
        # 파일 경로 소문자로 전환 (일관성 높이기 위해)
        suffix = path.suffix.lower()

        # PDF인 경우 처리
        if suffix == '.pdf':
            lecture_content = client.files.upload(file=path)
        # 텍스트 파일인 경우 처리
        elif suffix in ['.txt', '.md']:
            lecture_content = path.read_text(encoding='utf-8')
        
        # 지원되지 않는 파일은 경우
        else:
            lecture_content = "강의 자료 없음"
    else:
        # 파일이 없다면, 파일 경로가 아닌, 강의 텍스트가 입력되었다고 처리
        lecture_content = lecture_material

    # contents 생성
    eval_assess_step_contents = [
        "user_input: " + user_input,
        "last_attack: " + last_attack,
        "lecture_material: " + lecture_content,
        "dialogue_style: " + dialogue_style,
        "difficulty: " + difficulty
    ]

    # response 생성
    response = client.models.generate_content(
        model = "gemini-3-flash-preview",
        contents = eval_assess_step_contents,
        config={
            "system_instruction": evaluator_assess_step_system_prompt, 
            "response_mime_type": "application/json",
            "response_schema": evaluator_assess_step_object_schema
        })

    return response.text