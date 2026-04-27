# Design Agent B Proposal

## Current Failure Shape

`lectures.ts` treats Gemini upload as required. The route creates local artifacts first, but deletes them if `deps.bridge.uploadPdf()` fails. This is the exact reason the browser test could not continue after invalid Gemini API key failure.

## Minimal Safe Design

1. Keep Gemini bridge behavior unchanged. `GeminiBridgeClient.uploadPdf()` should still throw when Gemini fails.
2. Change only the route-level interpretation of that error:
   - invalid PDF, storage, and page-index errors remain fatal;
   - Gemini upload errors become warnings;
   - lecture creation continues with `geminiFile` omitted.
3. Preserve current teacher reconnect behavior in `session.ts`.
4. Replace the blanket `!fileRef` stop in `ToolDispatcher` with per-tool fallback.

## ToolDispatcher Fallback

- `AUTO_GRADE_MCQ_OX` already works without Gemini and should remain unchanged.
- `EXPLAIN_PAGE`: build a deterministic Korean explanation from extracted text.
- `ANSWER_QUESTION`: answer only from page/neighbor text and preserve QA thread memory.
- `GENERATE_QUIZ_*`: return schema-valid local quizzes from extracted page or cumulative text.
- `GRADE_SHORT_OR_ESSAY`: use non-empty and keyword-overlap heuristics to return a valid grading result.
- `REPAIR_MISCONCEPTION`: provide a short local repair message and preserve active intervention state transition.

## Frontend Impact

- No breaking API change is required because `createLecture()` already reads `res.data.data`.
- Optional `warning` in the upload response is backward-compatible.
- Session warning copy should state that local PDF text mode is active.

## Verification

- Add server tests for upload fallback.
- Add dispatcher tests for missing `geminiFile`.
- Add an orchestration-level test for `START_EXPLANATION_DECISION` on a lecture without `geminiFile`.
- Run server tests and both builds.
