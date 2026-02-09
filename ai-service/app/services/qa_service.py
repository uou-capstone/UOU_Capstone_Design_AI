from ai_agent.Lecture_Agent.component.MainQandAAgent import main as run_qa_agent


def evaluate_answer(original_q: str, user_answer: str, pdf_path: str) -> str:
    """
    MainQandAAgent를 호출하여 답변을 평가하고 보충 설명을 생성합니다.
    
    Args:
        original_q: 원래 질문
        user_answer: 사용자 답변
        pdf_path: PDF 파일 경로
    
    Returns:
        str: 보충 설명 텍스트
    """
    # MainQandAAgent.main()은 리스트 [("질문", "답변"), "파일경로"]를 인자로 받음
    qa_input = [(original_q, user_answer), pdf_path]
    
    result = run_qa_agent(qa_input)
    return result


