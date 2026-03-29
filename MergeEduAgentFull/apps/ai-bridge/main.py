from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from google import genai
from google.genai import types


class FileRef(BaseModel):
    fileName: str
    fileUri: str
    mimeType: str


class UploadPdfRequest(BaseModel):
    lectureId: str
    pdfPath: str
    displayName: str


class ExplainRequest(BaseModel):
    model: str
    fileRef: FileRef
    page: int
    pageText: str
    neighborText: dict[str, str]
    detailLevel: str | None = "NORMAL"
    learnerLevel: str | None = None
    learnerMemoryDigest: str | None = None


class QaRequest(BaseModel):
    model: str
    fileRef: FileRef
    page: int
    question: str
    learnerLevel: str
    pageText: str
    neighborText: dict[str, str]
    learnerMemoryDigest: str | None = None


class GenerateQuizRequest(BaseModel):
    model: str
    fileRef: FileRef
    page: int
    pageText: str
    quizType: str
    coverageStartPage: int = 1
    coverageEndPage: int | None = None
    questionCount: int = Field(default=3, ge=1, le=10)
    learnerLevel: str | None = None
    learnerMemoryDigest: str | None = None
    targetDifficulty: str | None = None


class GradeQuizRequest(BaseModel):
    model: str
    fileRef: FileRef
    page: int
    quiz: dict[str, Any]
    answers: dict[str, Any]
    learnerMemoryDigest: str | None = None


class OrchestratorThoughtStreamRequest(BaseModel):
    model: str
    fileRef: FileRef
    prompt: str


class OrchestrateSessionStreamRequest(BaseModel):
    model: str
    fileRef: FileRef
    prompt: str
    responseJsonSchema: dict[str, Any]


app = FastAPI(title="MergeEdu Gemini Bridge", version="1.0.0")

_CACHE_TTL_SECONDS = int(os.getenv("GEMINI_CACHE_TTL_SECONDS", "86400"))
_CACHE_REGISTRY: dict[tuple[str, str], dict[str, Any]] = {}


def _get_client() -> genai.Client:
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY is missing")
    return genai.Client(api_key=api_key)


def _as_dict(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        # FastAPI/Pydantic JSON serialization can fail on raw bytes.
        return f"<binary:{len(value)}bytes>"
    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_none=True)
    if isinstance(value, dict):
        return {k: _as_dict(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_as_dict(item) for item in value]
    if hasattr(value, "__dict__"):
        return {k: _as_dict(v) for k, v in value.__dict__.items() if not k.startswith("_")}
    return value


def _normalize_content_part(part: Any) -> dict[str, Any] | None:
    part_dict = _as_dict(part)
    if not isinstance(part_dict, dict):
        return None

    text = part_dict.get("text")
    if isinstance(text, str):
        normalized_text: dict[str, Any] = {"text": text}
        if isinstance(part_dict.get("thought"), bool):
            normalized_text["thought"] = part_dict["thought"]
        if isinstance(part_dict.get("thought_signature"), str):
            normalized_text["thought_signature"] = part_dict["thought_signature"]
        return normalized_text

    # Keep non-text parts as lightweight metadata to avoid binary payload serialization issues.
    inline_data = part_dict.get("inline_data")
    if isinstance(inline_data, dict):
        mime_type = inline_data.get("mime_type")
        data = inline_data.get("data")
        size = len(data) if isinstance(data, (str, bytes, bytearray)) else None
        normalized_inline: dict[str, Any] = {"type": "inline_data"}
        if isinstance(mime_type, str):
            normalized_inline["mime_type"] = mime_type
        if isinstance(size, int):
            normalized_inline["size"] = size
        return normalized_inline

    function_call = part_dict.get("function_call")
    if isinstance(function_call, dict):
        return {"type": "function_call", "value": function_call}

    return None


def _response_content_dict(response: Any) -> dict[str, Any] | None:
    content = getattr(response, "content", None)
    if content is None:
        candidates = getattr(response, "candidates", None)
        if candidates:
            candidate = candidates[0]
            content = getattr(candidate, "content", None)

    content_dict = _as_dict(content)
    if not isinstance(content_dict, dict):
        return None

    role = content_dict.get("role")
    raw_parts = content_dict.get("parts")
    parts: list[dict[str, Any]] = []
    if isinstance(raw_parts, list):
        for part in raw_parts:
            normalized = _normalize_content_part(part)
            if normalized:
                parts.append(normalized)

    safe_content: dict[str, Any] = {}
    if isinstance(role, str):
        safe_content["role"] = role
    safe_content["parts"] = parts
    return safe_content


def _content_text(content: dict[str, Any] | None) -> str:
    return _content_text_by_kind(content, thought=False)


def _thought_summary_text(content: dict[str, Any] | None) -> str:
    return _content_text_by_kind(content, thought=True)


def _content_text_by_kind(content: dict[str, Any] | None, *, thought: bool) -> str:
    if not content:
        return ""
    parts = content.get("parts") or []
    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if bool(part.get("thought", False)) != thought:
            continue
        text = part.get("text")
        if isinstance(text, str):
            chunks.append(text)
    return "\n".join(chunks).strip()


def _thinking_config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(include_thoughts=True)
    )


def _cache_key(file_ref: FileRef, model: str) -> tuple[str, str]:
    return (model, file_ref.fileUri)


def _cache_expired(entry: dict[str, Any]) -> bool:
    expires_at = entry.get("expires_at")
    if not isinstance(expires_at, str):
        return True
    try:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    return expiry <= datetime.now(timezone.utc)


def _ensure_cached_content_name(
    client: genai.Client, model: str, file_ref: FileRef
) -> str | None:
    key = _cache_key(file_ref, model)
    cached = _CACHE_REGISTRY.get(key)
    if cached and not _cache_expired(cached):
        return str(cached.get("name"))

    try:
        remote_file = client.files.get(name=file_ref.fileName)
        cache = client.caches.create(
            model=model,
            config=types.CreateCachedContentConfig(
                contents=[remote_file],
                ttl=f"{_CACHE_TTL_SECONDS}s",
            ),
        )
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=_CACHE_TTL_SECONDS)
        ).isoformat()
        _CACHE_REGISTRY[key] = {
            "name": cache.name,
            "expires_at": expires_at,
        }
        return str(cache.name)
    except Exception:
        return None


def _build_generation_config(
    *,
    client: genai.Client,
    model: str,
    file_ref: FileRef,
    response_json_schema: dict[str, Any] | None = None,
) -> tuple[types.GenerateContentConfig, list[Any]]:
    cached_content_name = _ensure_cached_content_name(client, model, file_ref)
    kwargs: dict[str, Any] = {
        "thinking_config": types.ThinkingConfig(include_thoughts=True),
    }
    if response_json_schema is not None:
        kwargs["response_mime_type"] = "application/json"
        kwargs["response_json_schema"] = response_json_schema
    if cached_content_name:
        kwargs["cached_content"] = cached_content_name
        return types.GenerateContentConfig(**kwargs), []
    return types.GenerateContentConfig(**kwargs), [_file_part(file_ref)]


def _ndjson_line(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _iter_stream_events(
    *,
    client: genai.Client,
    model: str,
    file_ref: FileRef,
    prompt: str,
    response_json_schema: dict[str, Any] | None = None,
) -> Iterator[bytes]:
    thought_chunks: list[str] = []
    answer_chunks: list[str] = []

    try:
        config, prefix_contents = _build_generation_config(
            client=client,
            model=model,
            file_ref=file_ref,
            response_json_schema=response_json_schema,
        )
        stream = client.models.generate_content_stream(
            model=model,
            contents=[*prefix_contents, prompt],
            config=config,
        )

        for chunk in stream:
            content = _response_content_dict(chunk)
            if not content:
                continue
            for part in content.get("parts", []):
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if not isinstance(text, str) or not text:
                    continue
                if bool(part.get("thought", False)):
                    thought_chunks.append(text)
                    yield _ndjson_line({"type": "thought_delta", "text": text})
                else:
                    answer_chunks.append(text)
                    yield _ndjson_line({"type": "answer_delta", "text": text})
    except Exception as exc:  # noqa: BLE001
        yield _ndjson_line({"type": "error", "error": f"Gemini streaming failed: {exc}"})
        return

    answer_text = "".join(answer_chunks).strip()
    thought_text = "".join(thought_chunks).strip()
    safe_content = {
        "role": "model",
        "parts": ([{"text": thought_text, "thought": True}] if thought_text else [])
        + ([{"text": answer_text}] if answer_text else []),
    }

    yield _ndjson_line(
        {
            "type": "done",
            "content": safe_content,
            "answerText": answer_text,
            "thoughtSummary": thought_text,
        }
    )


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise ValueError("empty response")

    if text.startswith("```"):
        text = text.strip("`")
        text = text.replace("json", "", 1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def _file_part(file_ref: FileRef) -> dict[str, Any]:
    return {
        "file_data": {
            "mime_type": file_ref.mimeType,
            "file_uri": file_ref.fileUri,
        }
    }


def _build_explain_prompt(request: ExplainRequest) -> str:
    detail_level = (request.detailLevel or "NORMAL").upper()
    detail_instruction = (
        "- 설명 깊이는 보통 수준으로 유지하고 핵심 개념을 짧고 명확하게 설명하라."
        if detail_level != "DETAILED"
        else "- 최근 퀴즈 성과가 낮을 수 있으니 설명을 더 자세히 제공하라.\n"
        "  정의/직관/예시/오개념 교정 포인트를 구조화해 설명하라."
    )
    return f"""
너는 설명 에이전트다.
현재 학생이 보고 있는 페이지는 {request.page}페이지다.
반드시 페이지 번호를 문장에 명시하고, Markdown으로 설명하라.
{detail_instruction}
학생 수준: {request.learnerLevel or "INTERMEDIATE"}
학생 통합 메모리:
{request.learnerMemoryDigest or "(개인화 메모리 없음)"}

개인화 규칙:
- 약점과 오개념이 보이면 쉬운 예시와 단계 분해를 더 써라.
- 강점 개념은 지나치게 장황하게 반복하지 말고 연결 개념으로 확장하라.
- 설명 선호가 있으면 해당 스타일을 우선 반영하라.

현재 페이지 텍스트:
{request.pageText}

이전 페이지 참고:
{request.neighborText.get('prev', '')}
다음 페이지 참고:
{request.neighborText.get('next', '')}
""".strip()


@app.get("/bridge/health")
def bridge_health() -> dict[str, Any]:
    return {"ok": True}


@app.post("/bridge/upload_pdf")
def upload_pdf(request: UploadPdfRequest) -> dict[str, Any]:
    client = _get_client()
    pdf_path = Path(request.pdfPath)
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF path not found")

    try:
        uploaded = client.files.upload(
            file=Path(request.pdfPath),
            config={"display_name": request.displayName},
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gemini upload failed: {exc}") from exc

    file_name = getattr(uploaded, "name", "")
    file_uri = getattr(uploaded, "uri", "")
    mime_type = getattr(uploaded, "mime_type", "application/pdf")

    return {
        "ok": True,
        "content": None,
        "data": {
            "file_name": file_name,
            "file_uri": file_uri,
            "mime_type": mime_type,
        },
    }


@app.post("/bridge/explain_page")
def explain_page(request: ExplainRequest) -> dict[str, Any]:
    client = _get_client()
    prompt = _build_explain_prompt(request)

    try:
        response = client.models.generate_content(
            model=request.model,
            contents=[_file_part(request.fileRef), prompt],
            config=_thinking_config(),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gemini explain failed: {exc}") from exc

    content = _response_content_dict(response)
    return {
        "ok": True,
        "content": content,
        "thoughtSummary": _thought_summary_text(content),
    }


@app.post("/bridge/answer_question")
def answer_question(request: QaRequest) -> dict[str, Any]:
    client = _get_client()
    prompt = f"""
너는 질문응답 에이전트다.
학생 수준: {request.learnerLevel}
학생 통합 메모리:
{request.learnerMemoryDigest or "(개인화 메모리 없음)"}
현재 페이지: {request.page}
질문: {request.question}

현재 페이지 텍스트:
{request.pageText}

답변은 Markdown 형식으로 작성하고, 필요하면 수식은 LaTeX를 사용하라.
""".strip()

    try:
        response = client.models.generate_content(
            model=request.model,
            contents=[_file_part(request.fileRef), prompt],
            config=_thinking_config(),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gemini QA failed: {exc}") from exc

    content = _response_content_dict(response)
    return {
        "ok": True,
        "content": content,
        "thoughtSummary": _thought_summary_text(content),
    }


@app.post("/bridge/generate_quiz")
def generate_quiz(request: GenerateQuizRequest) -> dict[str, Any]:
    client = _get_client()
    coverage_end = request.coverageEndPage or request.page
    prompt = f"""
아래 조건으로 반드시 JSON만 생성하라.
- schemaVersion: "1.0"
- quizId: "quiz_" 접두사 문자열
- quizType: "{request.quizType}"
- page: {request.page}
- 범위: {request.coverageStartPage}~{coverage_end}페이지
- questions 길이: {request.questionCount}
- 각 문항은 id, promptMarkdown, points를 포함
- 학생 수준: {request.learnerLevel or "INTERMEDIATE"}
- 목표 난이도: {request.targetDifficulty or "BALANCED"}
- 학생 통합 메모리:
{request.learnerMemoryDigest or "(개인화 메모리 없음)"}

타입별 필수 키:
- MCQ: choices[] (각 choice는 id, textMarkdown), answer.choiceId
- OX: answer.value(boolean)
- SHORT: referenceAnswer.text, rubricMarkdown
- ESSAY: modelAnswerMarkdown, rubricMarkdown

설명 텍스트 외 여분 출력 금지.
학생 약점과 오개념을 더 자주 점검하되, 이미 매우 잘하는 항목만 반복해서 내지 마라.
아래는 {request.coverageStartPage}~{coverage_end}페이지 범위 텍스트이며, 반드시 이를 참고해 문제를 만들 것:
{request.pageText}
""".strip()

    try:
        response = client.models.generate_content(
            model=request.model,
            contents=[_file_part(request.fileRef), prompt],
            config=_thinking_config(),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gemini quiz failed: {exc}") from exc

    content = _response_content_dict(response)
    text = _content_text(content)

    try:
        parsed = _extract_json(text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to parse quiz JSON: {exc}") from exc

    return {
        "ok": True,
        "content": content,
        "data": parsed,
        "thoughtSummary": _thought_summary_text(content),
    }


@app.post("/bridge/grade_quiz")
def grade_quiz(request: GradeQuizRequest) -> dict[str, Any]:
    client = _get_client()
    prompt = f"""
다음 문제와 답안으로 채점 결과 JSON만 출력하라.
점수는 엄격하게 채점하되, feedbackMarkdown과 summaryMarkdown은 학생 통합 메모리를 참고해 맞춤형 보충 포인트를 담아라.
학생 통합 메모리:
{request.learnerMemoryDigest or "(개인화 메모리 없음)"}
스키마:
{{
  "schemaVersion": "1.0",
  "quizId": "...",
  "type": "GRADING_RESULT",
  "totalScore": number,
  "maxScore": number,
  "items": [
    {{"questionId": "...", "score": number, "maxScore": number, "verdict": "CORRECT|WRONG|PARTIAL", "feedbackMarkdown": "..."}}
  ],
  "summaryMarkdown": "..."
}}

문제 JSON:
{json.dumps(request.quiz, ensure_ascii=False)}

사용자 답안:
{json.dumps(request.answers, ensure_ascii=False)}
""".strip()

    try:
        response = client.models.generate_content(
            model=request.model,
            contents=[_file_part(request.fileRef), prompt],
            config=_thinking_config(),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gemini grading failed: {exc}") from exc

    content = _response_content_dict(response)
    text = _content_text(content)
    try:
        parsed = _extract_json(text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to parse grading JSON: {exc}") from exc

    return {
        "ok": True,
        "content": content,
        "data": parsed,
        "thoughtSummary": _thought_summary_text(content),
    }


@app.post("/bridge/explain_page_stream")
def explain_page_stream(request: ExplainRequest) -> StreamingResponse:
    client = _get_client()
    prompt = _build_explain_prompt(request)

    return StreamingResponse(
        _iter_stream_events(
            client=client,
            model=request.model,
            file_ref=request.fileRef,
            prompt=prompt,
        ),
        media_type="application/x-ndjson",
    )


@app.post("/bridge/answer_question_stream")
def answer_question_stream(request: QaRequest) -> StreamingResponse:
    client = _get_client()
    prompt = f"""
너는 질문응답 에이전트다.
학생 수준: {request.learnerLevel}
학생 통합 메모리:
{request.learnerMemoryDigest or "(개인화 메모리 없음)"}
현재 페이지: {request.page}
질문: {request.question}

현재 페이지 텍스트:
{request.pageText}

답변은 Markdown 형식으로 작성하고, 필요하면 수식은 LaTeX를 사용하라.
""".strip()

    return StreamingResponse(
        _iter_stream_events(
            client=client,
            model=request.model,
            file_ref=request.fileRef,
            prompt=prompt,
        ),
        media_type="application/x-ndjson",
    )


@app.post("/bridge/generate_quiz_stream")
def generate_quiz_stream(request: GenerateQuizRequest) -> StreamingResponse:
    client = _get_client()
    coverage_end = request.coverageEndPage or request.page
    prompt = f"""
아래 조건으로 반드시 JSON만 생성하라.
- schemaVersion: "1.0"
- quizId: "quiz_" 접두사 문자열
- quizType: "{request.quizType}"
- page: {request.page}
- 범위: {request.coverageStartPage}~{coverage_end}페이지
- questions 길이: {request.questionCount}
- 각 문항은 id, promptMarkdown, points를 포함
- 학생 수준: {request.learnerLevel or "INTERMEDIATE"}
- 목표 난이도: {request.targetDifficulty or "BALANCED"}
- 학생 통합 메모리:
{request.learnerMemoryDigest or "(개인화 메모리 없음)"}

타입별 필수 키:
- MCQ: choices[] (각 choice는 id, textMarkdown), answer.choiceId
- OX: answer.value(boolean)
- SHORT: referenceAnswer.text, rubricMarkdown
- ESSAY: modelAnswerMarkdown, rubricMarkdown

설명 텍스트 외 여분 출력 금지.
학생 약점과 오개념을 더 자주 점검하되, 이미 매우 잘하는 항목만 반복해서 내지 마라.
아래는 {request.coverageStartPage}~{coverage_end}페이지 범위 텍스트이며, 반드시 이를 참고해 문제를 만들 것:
{request.pageText}
""".strip()

    def generator() -> Iterator[bytes]:
        answer_buffer: list[str] = []
        thought_buffer: list[str] = []
        for line in _iter_stream_events(
            client=client,
            model=request.model,
            file_ref=request.fileRef,
            prompt=prompt,
        ):
            payload = json.loads(line.decode("utf-8"))
            event_type = payload.get("type")
            if event_type == "answer_delta":
                answer_buffer.append(str(payload.get("text", "")))
            elif event_type == "thought_delta":
                thought_buffer.append(str(payload.get("text", "")))
            elif event_type == "done":
                answer_text = "".join(answer_buffer).strip() or str(payload.get("answerText", "")).strip()
                thought_text = "".join(thought_buffer).strip() or str(payload.get("thoughtSummary", "")).strip()
                try:
                    parsed = _extract_json(answer_text)
                except Exception as exc:  # noqa: BLE001
                    yield _ndjson_line({"type": "error", "error": f"Failed to parse quiz JSON: {exc}"})
                    return
                yield _ndjson_line(
                    {
                        "type": "done",
                        "content": {
                            "role": "model",
                            "parts": ([{"text": thought_text, "thought": True}] if thought_text else [])
                            + ([{"text": answer_text}] if answer_text else []),
                        },
                        "answerText": answer_text,
                        "thoughtSummary": thought_text,
                        "data": parsed,
                    }
                )
                return
            yield line

    return StreamingResponse(generator(), media_type="application/x-ndjson")


@app.post("/bridge/grade_quiz_stream")
def grade_quiz_stream(request: GradeQuizRequest) -> StreamingResponse:
    client = _get_client()
    prompt = f"""
다음 문제와 답안으로 채점 결과 JSON만 출력하라.
점수는 엄격하게 채점하되, feedbackMarkdown과 summaryMarkdown은 학생 통합 메모리를 참고해 맞춤형 보충 포인트를 담아라.
학생 통합 메모리:
{request.learnerMemoryDigest or "(개인화 메모리 없음)"}
스키마:
{{
  "schemaVersion": "1.0",
  "quizId": "...",
  "type": "GRADING_RESULT",
  "totalScore": number,
  "maxScore": number,
  "items": [
    {{"questionId": "...", "score": number, "maxScore": number, "verdict": "CORRECT|WRONG|PARTIAL", "feedbackMarkdown": "..."}}
  ],
  "summaryMarkdown": "..."
}}

문제 JSON:
{json.dumps(request.quiz, ensure_ascii=False)}

사용자 답안:
{json.dumps(request.answers, ensure_ascii=False)}
""".strip()

    def generator() -> Iterator[bytes]:
        answer_buffer: list[str] = []
        thought_buffer: list[str] = []
        for line in _iter_stream_events(
            client=client,
            model=request.model,
            file_ref=request.fileRef,
            prompt=prompt,
        ):
            payload = json.loads(line.decode("utf-8"))
            event_type = payload.get("type")
            if event_type == "answer_delta":
                answer_buffer.append(str(payload.get("text", "")))
            elif event_type == "thought_delta":
                thought_buffer.append(str(payload.get("text", "")))
            elif event_type == "done":
                answer_text = "".join(answer_buffer).strip() or str(payload.get("answerText", "")).strip()
                thought_text = "".join(thought_buffer).strip() or str(payload.get("thoughtSummary", "")).strip()
                try:
                    parsed = _extract_json(answer_text)
                except Exception as exc:  # noqa: BLE001
                    yield _ndjson_line({"type": "error", "error": f"Failed to parse grading JSON: {exc}"})
                    return
                yield _ndjson_line(
                    {
                        "type": "done",
                        "content": {
                            "role": "model",
                            "parts": ([{"text": thought_text, "thought": True}] if thought_text else [])
                            + ([{"text": answer_text}] if answer_text else []),
                        },
                        "answerText": answer_text,
                        "thoughtSummary": thought_text,
                        "data": parsed,
                    }
                )
                return
            yield line

    return StreamingResponse(generator(), media_type="application/x-ndjson")


@app.post("/bridge/orchestrate_session_stream")
def orchestrate_session_stream(
    request: OrchestrateSessionStreamRequest,
) -> StreamingResponse:
    client = _get_client()

    def generator() -> Iterator[bytes]:
        answer_buffer: list[str] = []
        thought_buffer: list[str] = []
        for line in _iter_stream_events(
            client=client,
            model=request.model,
            file_ref=request.fileRef,
            prompt=request.prompt,
            response_json_schema=request.responseJsonSchema,
        ):
            payload = json.loads(line.decode("utf-8"))
            event_type = payload.get("type")
            if event_type == "answer_delta":
                answer_buffer.append(str(payload.get("text", "")))
            elif event_type == "thought_delta":
                thought_buffer.append(str(payload.get("text", "")))
            elif event_type == "done":
                answer_text = "".join(answer_buffer).strip() or str(
                    payload.get("answerText", "")
                ).strip()
                thought_text = "".join(thought_buffer).strip() or str(
                    payload.get("thoughtSummary", "")
                ).strip()
                try:
                    parsed = _extract_json(answer_text)
                except Exception as exc:  # noqa: BLE001
                    yield _ndjson_line(
                        {
                            "type": "error",
                            "error": f"Failed to parse orchestrator JSON: {exc}",
                        }
                    )
                    return
                yield _ndjson_line(
                    {
                        "type": "done",
                        "content": {
                            "role": "model",
                            "parts": (
                                [{"text": thought_text, "thought": True}]
                                if thought_text
                                else []
                            )
                            + ([{"text": answer_text}] if answer_text else []),
                        },
                        "answerText": answer_text,
                        "thoughtSummary": thought_text,
                        "data": parsed,
                    }
                )
                return
            yield line

    return StreamingResponse(generator(), media_type="application/x-ndjson")


@app.post("/bridge/orchestrator_thought_stream")
def orchestrator_thought_stream(request: OrchestratorThoughtStreamRequest) -> StreamingResponse:
    client = _get_client()
    return StreamingResponse(
        _iter_stream_events(
            client=client,
            model=request.model,
            file_ref=request.fileRef,
            prompt=request.prompt,
        ),
        media_type="application/x-ndjson",
    )
