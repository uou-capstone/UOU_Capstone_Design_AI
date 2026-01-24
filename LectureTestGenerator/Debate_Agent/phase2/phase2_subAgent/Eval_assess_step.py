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

def llm_evaluator_assess_step(user_input, last_attack, lecture_material, dialogue_style, difficulty):
    # 환경 변수 불러오기
    api_key = os.environ.get('MY_API_KEY')
    # client 설정
    client = genai.Client(api_key=api_key)

    # 현재 파일의 위치를 기준으로 프로젝트 루트(LectureTestGenerator)를 찾음
    current_file_path = os.path.abspath(__file__)
    # Debate_Agent/phase2/phase2_subAgent/Eval_assess_step.py -> 3단계 위가 Debate_Agent 폴더
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(current_file_path)))

    evaluator_assess_step_object_schema_path = find_file("evaluator_assess_step_Object.json", base_path)
    evaluator_assess_step_system_prompt_path = find_file("evaluator_assess_step_SystemPrompt.md", base_path)

    if not evaluator_assess_step_object_schema_path or not evaluator_assess_step_system_prompt_path:
        raise FileNotFoundError("Evaluator Assess Step 프롬포트 파일을 찾을 수 없습니다")

    with open(evaluator_assess_step_object_schema_path, 'r', encoding='utf-8') as f:
        evaluator_assess_step_object_schema = json.load(f)

    with open(evaluator_assess_step_system_prompt_path, 'r', encoding='utf-8') as f:
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
        lecture_content,
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