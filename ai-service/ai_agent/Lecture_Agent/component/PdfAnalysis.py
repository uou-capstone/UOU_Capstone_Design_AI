import os
import pathlib
from typing import List, Tuple
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


SYSTEM_PROMPT = """당신은 **문서 구조 분석 전문가**입니다.
주어진 파일의 목차나 내용을 분석하여, 강의를 진행하기 적합한 **챕터(소주제) 리스트**를 추출해주세요.

### 출력 형식 (Strict JSON List)
["챕터1 제목", "챕터2 제목", "챕터3 제목"]

### 주의사항
- 번호(1., 2.)는 제거하고 제목 텍스트만 추출하세요.
- 너무 자잘한 소제목은 합치고, 강의하기 좋은 굵직한 주제 위주로 3~10개 사이로 추출하세요.
"""


def analyze_pdf_structure(file_path: str) -> List[str]:
    """Gemini를 사용하여 문서의 챕터 구조를 추출 (PDF 또는 Markdown)"""
    client = genai.Client(api_key=GEMINI_API_KEY)
    path = pathlib.Path(file_path)
    suffix = path.suffix.lower()

    # 1. 파일 로드 분기
    if suffix == ".pdf":
        content_part = types.Part.from_bytes(
            data=path.read_bytes(),
            mime_type="application/pdf",
        )
    elif suffix == ".md":
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="cp949")
        # 토큰 절약을 위해 앞부분만 분석 (목차는 보통 앞에 있으므로)
        content_part = f"[문서 내용 앞부분]\n{text[:20000]}"
    else:
        raise ValueError(f"지원하지 않는 파일 형식입니다: {suffix}")

    # 2. 구조 분석 요청
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[SYSTEM_PROMPT, content_part],
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )

    # 3. 파싱 (JSON Array -> Python List)
    import json

    try:
        chapters = json.loads(response.text)
        if isinstance(chapters, list):
            return [str(c) for c in chapters]
        return ["전체 내용"]
    except Exception:
        return ["전체 내용"]


def main(pdf_path: str) -> List[Tuple[str, str]]:
    """
    메인 분석 함수
    Returns: [(챕터제목, 파일경로), (챕터제목, 파일경로), ...]
    """
    path = pathlib.Path(pdf_path)

    print(f"[INFO] 문서 구조를 분석 중입니다... ({path.name})")

    try:
        chapter_titles = analyze_pdf_structure(pdf_path)
    except Exception as e:
        print(f"[WARN] 구조 분석 실패 (기본 모드로 진행): {e}")
        chapter_titles = [path.stem]

    # 현재는 파일을 쪼개지 않고 통째로 넘기므로, 모든 챕터가 동일한 파일 경로를 가짐
    result = [(title, pdf_path) for title in chapter_titles]

    return result
