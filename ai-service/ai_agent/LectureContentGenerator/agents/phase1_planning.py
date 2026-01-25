import json
import sys
import time
import google.generativeai as genai
from . import MODEL_FAST
from ..prompts import PLANNING_SYSTEM_PROMPT
from ..schemas import PLANNING_SCHEMA


class PlanningAgent:
    def __init__(self, model_name=MODEL_FAST):
        self.model = genai.GenerativeModel(
            model_name=model_name,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": PLANNING_SCHEMA
            },
            system_instruction=PLANNING_SYSTEM_PROMPT
        )
        self.current_draft = None

    def generate_plan(self, user_input, force_completion=False):
        """
        user_input: 사용자의 최신 입력
        force_completion: 강제 완성 모드 활성화 여부
        """
        if self.current_draft is None:
            context_str = "Current Draft Plan: None (Start fresh)"
        else:
            context_str = f"Current Draft Plan: {json.dumps(self.current_draft, ensure_ascii=False)}"

        prompt = f"""
        [Context Info]
        {context_str}
        
        [Current User Input]
        {user_input}
        
        [Mode]
        Force Completion Mode: {force_completion}
        """

        print(f"\n[Agent] Gemini에게 요청을 보냅니다... (Force Mode: {force_completion})")
        try:
            response = self.model.generate_content(prompt)
            response_json = json.loads(response.text)
            
            if "draft_plan" in response_json:
                self.current_draft = response_json["draft_plan"]
            
            return AgentResponse(
                has_missing_info=response_json.get("has_missing_info", False),
                missing_info_list=response_json.get("missing_info_list", []),
                draft_plan=response_json.get("draft_plan", {})
            )
        except Exception as e:
            print(f"\n[Error] API 호출 중 오류 발생: {e}")
            return None


class AgentResponse:
    def __init__(self, has_missing_info, missing_info_list, draft_plan):
        self.has_missing_info = has_missing_info
        self.missing_info_list = missing_info_list
        self.draft_plan = draft_plan


def execute_phase1(model_name=MODEL_FAST):
    """Phase 1 실행 로직"""
    agent = PlanningAgent(model_name=model_name)
    MAX_RETRY_LIMIT = 3
    current_retry = 0
    
    print("\n[Step 1] 만들고 싶은 강의의 주제나 요구사항을 입력해주세요:")
    user_input = input(">>> ")

    while True:
        is_force_mode = (current_retry >= MAX_RETRY_LIMIT)
        agent_response = agent.generate_plan(user_input, force_completion=is_force_mode)
        
        if not agent_response:
            print("Agent 응답 실패. 다시 시도해주세요.")
            continue

        if agent_response.has_missing_info and not is_force_mode:
            print("\n[System] 더 정확한 기획을 위해 추가 정보가 필요합니다.")
            for i, q in enumerate(agent_response.missing_info_list, 1):
                print(f"System: {q}")
            
            sys.stdout.flush()
            time.sleep(0.5)
            
            user_answer = input("\n위 질문에 대한 답변을 입력해주세요: ")
            user_input = f"이전 질문에 대한 사용자의 답변: {user_answer}"
            current_retry += 1
        else:
            return agent_response.draft_plan
