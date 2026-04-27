# AI Bridge

FastAPI bridge for Google Gemini calls. The Express server calls this bridge through `AI_BRIDGE_URL`.

## Runtime

- Python 3.11 ~ 3.13
- Dependencies: `requirements.txt`
- Required environment: `GOOGLE_API_KEY`
- Default local URL: `http://127.0.0.1:8001`

Run from the project root through `./run.sh` or `run.cmd`. For manual execution:

```bash
source .venv/bin/activate
uvicorn --app-dir apps/ai-bridge main:app --host 127.0.0.1 --port 8001 --reload
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/bridge/health` | bridge health check |
| `POST` | `/bridge/upload_pdf` | upload a local PDF to Gemini Files API |
| `POST` | `/bridge/explain_page` | non-streaming page explanation |
| `POST` | `/bridge/explain_page_stream` | streaming page explanation |
| `POST` | `/bridge/answer_question` | non-streaming QA |
| `POST` | `/bridge/answer_question_stream` | streaming QA |
| `POST` | `/bridge/generate_quiz` | non-streaming quiz JSON generation |
| `POST` | `/bridge/generate_quiz_stream` | streaming quiz JSON generation |
| `POST` | `/bridge/grade_quiz` | non-streaming short/essay grading |
| `POST` | `/bridge/grade_quiz_stream` | streaming short/essay grading |
| `POST` | `/bridge/orchestrate_session_stream` | streaming orchestrator JSON plan |
| `POST` | `/bridge/analyze_student_report` | non-streaming competency report analysis |
| `POST` | `/bridge/analyze_student_report_stream` | streaming competency report analysis |

## Implementation Notes

- PDF upload uses `pathlib.Path(pdf_path)` so Gemini receives a real local file path.
- Gemini responses are normalized into a stable `content` shape with `parts[]`.
- Streaming endpoints emit NDJSON events: `thought_delta`, `answer_delta`, `done`, or `error`.
- When possible, uploaded PDFs are reused through Gemini cached content for token/context efficiency.
