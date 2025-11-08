import sys
import asyncio
import time
import re
from typing import List, Tuple, Dict
from ai_agent import PdfAnalysis, MainLectureAgent, MainQandAAgent

pdf_analysis_main = PdfAnalysis.main
lecture_agent_main = MainLectureAgent.main
qa_agent_main = MainQandAAgent.main


def print_streaming(text: str, delay: float = 0.1):
    """텍스트를 문장 단위로 스트리밍하듯이 출력"""
    # 문장 단위로 분리 (마침표, 느낌표, 물음표 기준)
    sentences = re.split(r'([.!?]\s+|[.!?]$|\n)', text)
    
    for i in range(0, len(sentences), 2):
        if i < len(sentences):
            sentence = sentences[i]
            if i + 1 < len(sentences):
                sentence += sentences[i + 1]
            
            print(sentence, end='', flush=True)
            time.sleep(delay)
    
    print()  # 마지막 줄바꿈


def extract_questions(text: str) -> List[Tuple[int, int, str]]:
    """텍스트에서 [질문] [/질문] 토큰을 찾아 위치와 질문 내용을 반환"""
    pattern = r'\[질문\](.*?)\[/질문\]'
    questions = []
    
    for match in re.finditer(pattern, text, re.DOTALL):
        start_pos = match.start()
        end_pos = match.end()
        question_content = match.group(1).strip()
        questions.append((start_pos, end_pos, question_content))
    
    return questions


def process_explanation_with_qa(explanation: str, chapter_title: str, pdf_path: str):
    """설명문을 처리하면서 질문이 나오면 Q&A 에이전트를 호출"""
    questions = extract_questions(explanation)
    
    if not questions:
        # 질문이 없으면 그냥 전체 출력
        print_streaming(explanation)
        return
    
    # 질문이 있는 경우 구간별로 처리
    current_pos = 0
    
    for start_pos, end_pos, question_content in questions:
        # 질문 이전 부분 출력
        before_question = explanation[current_pos:start_pos]
        if before_question.strip():
            print_streaming(before_question)
        
        # 질문 출력
        print("\n" + "="*60)
        print(f"[질문]")
        print(question_content)
        print("="*60)
        
        # 사용자 답변 받기
        user_answer = input("\n답변을 입력하세요: ")
        print("\n")
        
        # Q&A 에이전트 호출
        print("답변을 분석하고 보충 설명을 생성하고 있습니다...\n")
        supplementary_explanation = qa_agent_main([
            (question_content, user_answer),
            pdf_path
        ])
        
        # 보충 설명 출력
        print("\n" + "="*60)
        print("[보충 설명]")
        print("="*60 + "\n")
        print_streaming(supplementary_explanation)
        print("\n" + "="*60 + "\n")
        
        current_pos = end_pos
    
    # 마지막 질문 이후 남은 부분 출력
    remaining = explanation[current_pos:]
    if remaining.strip():
        print_streaming(remaining)


async def run_lecture_agent(chapter_title: str, pdf_path: str) -> Dict[str, str]:
    """비동기로 강의 에이전트를 실행"""
    return await asyncio.to_thread(lecture_agent_main, chapter_title, pdf_path)


async def run_all_lecture_agents(chapters_info: List[Tuple[str, str]]) -> List[Dict[str, str]]:
    """모든 챕터에 대해 강의 에이전트를 동시에 실행"""
    tasks = []
    for chapter_title, pdf_path in chapters_info:
        task = run_lecture_agent(chapter_title, pdf_path)
        tasks.append(task)
    
    # 순서를 유지하면서 동시 실행
    results = await asyncio.gather(*tasks)
    return results


def main(pdf_path: str):
    """
    통합 에이전트 시스템의 메인 함수
    
    Args:
        pdf_path (str): 분석할 PDF 파일의 경로
    """
    print("="*60)
    print("교육 에이전트 시스템을 시작합니다")
    print("="*60 + "\n")
    
    # 1. PDF 분석 및 챕터별 분할
    print("📄 PDF 파일을 분석하고 챕터별로 분할하고 있습니다...\n")
    chapters_info = pdf_analysis_main(pdf_path)
    
    print(f"총 {len(chapters_info)}개의 챕터를 발견했습니다.\n")
    for i, (title, path) in enumerate(chapters_info, 1):
        print(f"  {i}. {title}")
    print("\n")
    
    # 2. 모든 챕터에 대해 동시에 강의 에이전트 호출
    print("🎓 각 챕터에 대한 강의 설명을 생성하고 있습니다...\n")
    lecture_results = asyncio.run(run_all_lecture_agents(chapters_info))
    
    print("모든 강의 설명 생성이 완료되었습니다.\n")
    print("="*60 + "\n")
    
    # 3. 순서대로 강의 진행
    for i, ((chapter_title, pdf_path), lecture_dict) in enumerate(zip(chapters_info, lecture_results), 1):
        print("\n" + "="*60)
        print(f"📚 Chapter {i}: {chapter_title}")
        print("="*60 + "\n")
        
        explanation = lecture_dict[chapter_title]
        
        # 설명문을 처리하면서 질문이 나오면 Q&A 진행
        process_explanation_with_qa(explanation, chapter_title, pdf_path)
        
        # 다음 챕터로 넘어가기 전 구분선
        if i < len(chapters_info):
            print("\n" + "="*60)
            print("다음 챕터로 이동합니다...")
            print("="*60 + "\n")
            time.sleep(1)
    
    # 4. 모든 강의 완료
    print("\n" + "="*60)
    print("모든 강의가 완료되었습니다!")
    print("="*60)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python integration.py <PDF 파일 경로>")
        print("예시: python integration.py /Users/jhkim/Desktop/Edu_Agent/02-SW-Process.pdf")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        main(pdf_path)
    except FileNotFoundError as e:
        print(f"❌ 오류: 파일을 찾을 수 없습니다 - {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 오류가 발생했습니다: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

