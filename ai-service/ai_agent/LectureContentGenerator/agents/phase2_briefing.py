import json
import sys
import time
import google.generativeai as genai
from . import MODEL_FAST
from ..prompts import CONFIRM_SYSTEM_PROMPT, UPDATE_SYSTEM_PROMPT
from ..schemas import CONFIRM_SCHEMA, UPDATE_SCHEMA


class ConfirmAgent:
    def __init__(self, model_name=MODEL_FAST):
        self.model = genai.GenerativeModel(
            model_name=model_name,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": CONFIRM_SCHEMA
            },
            system_instruction=CONFIRM_SYSTEM_PROMPT
        )

    def analyze(self, user_feedback, current_plan):
        prompt = f"""
        [Current Draft Plan]
        {json.dumps(current_plan, ensure_ascii=False)}

        [User Prompt]
        {user_feedback}
        """
        
        print("\n[Confirm Agent] Analyzing user feedback...")
        response = self.model.generate_content(prompt)
        return json.loads(response.text)


class UpdateAgent:
    def __init__(self, model_name=MODEL_FAST):
        self.model = genai.GenerativeModel(
            model_name=model_name,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": UPDATE_SCHEMA
            },
            system_instruction=UPDATE_SYSTEM_PROMPT
        )

    def modify_plan(self, current_plan, feedback_analysis):
        prompt = f"""
        [Current Draft Plan]
        {json.dumps(current_plan, ensure_ascii=False)}

        [Feedback Analysis]
        {json.dumps(feedback_analysis, ensure_ascii=False)}
        """
        
        print("\n[Update Agent] Modifying the plan based on feedback...")
        response = self.model.generate_content(prompt)
        return json.loads(response.text)["draft_plan"]


def execute_phase2(draft_plan):
    """Phase 2 실행 로직"""
    confirm_agent = ConfirmAgent()
    update_agent = UpdateAgent()
    current_plan = draft_plan
    is_confirmed = False

    print("\n================ [Phase 2: Interactive Briefing] ================")

    while not is_confirmed:
        print("\n[Current Plan Summary]")
        print(f"Title: {current_plan.get('project_meta', {}).get('title', 'Untitled')}")
        print(f"Chapters: {len(current_plan.get('chapters', []))} predefined chapters")
        print("-"*30)
        print("기획안이 마음에 들면 '승인' 또는 '좋아'라고 입력하고, 수정을 원하면 구체적인 요청사항을 입력하세요.")
        
        sys.stdout.flush()
        time.sleep(0.5)

        user_feedback_prompt = input("\n피드백 입력 >>> ")

        try:
            analysis_result = confirm_agent.analyze(user_feedback_prompt, current_plan)
            
            if analysis_result.get("is_approval") is True:
                print("\n[System] 기획안이 확정되었습니다!")
                is_confirmed = True
                return current_plan
            else:
                feedback_payload = analysis_result.get("feedback_analysis", {})
                print(f"\n[System] 수정 요청을 반영합니다: {feedback_payload.get('summary')}")
                current_plan = update_agent.modify_plan(current_plan, feedback_payload)
                print("\n[System] 기획안이 업데이트되었습니다.")
        except Exception as e:
            print(f"\n[Error] 처리 중 오류가 발생했습니다: {e}")
            continue
