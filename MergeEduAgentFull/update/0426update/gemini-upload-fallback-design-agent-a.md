# Design Agent A Proposal

## Current Flow

1. Teacher upload starts in `LectureUploaderModal.tsx` and calls `createLecture()`.
2. `POST /weeks/:weekId/lectures` validates the PDF, saves the local file, builds the page text index, then calls Gemini upload.
3. Gemini failure currently deletes the local file and index, returns `502`, and prevents lecture creation.
4. Session entry already partly tolerates missing `pdf.geminiFile`, but `ToolDispatcher` refuses most AI tools when the Gemini file reference is absent.

## Proposed Server Changes

- Treat local PDF storage and page index creation as the authoritative success boundary for lecture creation.
- Make Gemini upload best-effort:
  - If it succeeds, store `pdf.geminiFile`.
  - If it fails, create the lecture without `geminiFile`, log a structured warning, and return `201`.
- Keep teacher-side reconnect on session entry, but soften the user-facing message.
- Add local fallback behavior in `ToolDispatcher` for:
  - page explanation
  - question answering
  - quiz generation
  - short/essay grading
  - misconception repair

## Proposed Web Changes

- Let upload modal close on successful `201` even if the response includes a warning.
- Optionally show `기본 모드` in lecture rows when `pdf.geminiFile` is absent.
- Reword the session alert from an error-like "AI 연결 비정상" to an informational local basic mode message.

## Data Model

- Minimal path: keep `pdf.geminiFile?: GeminiFileRef` as the compatibility flag.
- Optional future path: add `pdf.aiConnection.status`, `lastAttemptAt`, and a non-sensitive error code.

## Tests

- Upload route succeeds with Gemini failure and keeps local files.
- Student can enter a session for a lecture without `geminiFile`.
- Dispatcher local fallback handles explanation, QA, quiz generation, and subjective grading.
- Existing Gemini-backed tests keep passing.
