import os
import pathlib
from typing import TypedDict
from dotenv import load_dotenv
from google import genai
from google.genai import types

# 환경 변수 로드
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


class LectureState(TypedDict):
    chapter_title: str
    pdf_path: str
    explanation: str


# 시스템 프롬프트: 페르소나 정의
SYSTEM_PROMPT = """### 롤 (Role)
당신은 **세계적인 석학이자 친절한 교수님**입니다. 
당신의 임무는 주어진 강의 자료를 바탕으로 학생들에게 **구어체로 강의**를 진행하는 것입니다.

### 강의 스타일 가이드
1. **톤앤매너**: 격식 있지만 친근하게 (예: "자, 여기를 볼까요?", "이 부분은 정말 중요해요.")
2. **설명 방식**:
   - 단순히 자료를 요약하지 말고, **이야기하듯이 풀어서** 설명하세요.
   - 추상적인 개념은 **구체적인 예시**를 들어 설명하세요.
   - 중간중간 학생들의 이해를 돕기 위해 **[질문]**을 던지세요.

### 필수 출력 형식
- 강의 내용은 줄글로 자연스럽게 이어가세요.
- 질문을 던질 때는 반드시 아래 형식을 지키세요:
  [질문]
  질문 내용
  [/질문]
"""


def generate_explanation(state: LectureState) -> LectureState:
    """
    강의 자료(PDF/MD)를 읽어 교수님 페르소나로 강의 텍스트를 생성하는 함수
    """
    client = genai.Client(api_key=GEMINI_API_KEY)
    file_path = pathlib.Path(state["pdf_path"])

    # 1. 파일 형식에 따른 분기 처리 (Markdown 호환성 확보)
    file_extension = file_path.suffix.lower()

    if file_extension == ".pdf":
        # PDF: 바이너리로 읽어서 MIME 타입 지정
        content_part = types.Part.from_bytes(
            data=file_path.read_bytes(),
            mime_type="application/pdf",
        )
    elif file_extension == ".md":
        # Markdown: 텍스트로 읽어서 프롬프트에 직접 삽입
        try:
            text_content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # 인코딩 이슈 대비
            text_content = file_path.read_text(encoding="cp949")

        content_part = f"""
[강의 자료 내용 ({file_extension})]
{text_content}
"""
    else:
        raise ValueError(f"지원하지 않는 파일 형식입니다: {file_extension}")

    # 2. 사용자 프롬프트 구성
    user_prompt = f"""[현재 챕터]: {state['chapter_title']}

위 챕터 주제를 중심으로 강의를 진행해주세요. 
전체 자료 중 해당 챕터와 관련된 부분을 중점적으로 설명하고, 학생들의 사고를 확장시키는 질문을 1~2개 포함해주세요.
"""

    # 3. API 호출
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            SYSTEM_PROMPT,
            content_part,
            user_prompt,
        ],
    )

    return {**state, "explanation": response.text}


def main(chapter_title: str, pdf_path: str) -> dict:
    """외부에서 호출하는 진입점"""
    initial_state: LectureState = {
        "chapter_title": chapter_title,
        "pdf_path": pdf_path,
        "explanation": "",
    }
    result_state = generate_explanation(initial_state)

    # 딕셔너리 형태로 반환 {챕터명: 설명}
    return {chapter_title: result_state["explanation"]}