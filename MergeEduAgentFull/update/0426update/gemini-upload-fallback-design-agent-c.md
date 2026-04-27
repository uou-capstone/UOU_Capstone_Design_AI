# Design Agent C Proposal

## Scenario-Centered Diagnosis

The user scenario fails because a cloud AI enhancement failure blocks the primary classroom artifact. The system already has a valid PDF and page index, so lecture availability should not depend on Gemini upload.

## Robust Recovery Model

- Local PDF ingest is authoritative.
- Gemini upload is an enhancement that can be missing, pending, or later reconnected.
- Students should never trigger Gemini upload side effects.
- Students should not see raw API-key or provider errors.
- Session should still allow PDF reading, page explanation, questions, and quizzes using local page text.

## Edge Cases

- Invalid PDF remains fatal.
- Page index extraction failure remains fatal because local fallback depends on it.
- Empty page text should not block PDF reading; local explanation should say the text layer is limited.
- Gemini reconnect should be teacher-only and idempotent enough not to spam raw errors.

## Implementation Priority

1. Fix lecture creation to persist local artifacts despite Gemini upload failure.
2. Add local fallback in session tools for missing `geminiFile`.
3. Soften user-facing AI status messages.
4. Add focused tests around the browser-failed scenario.

## Expected Scenario After Fix

- Teacher uploads PDF and sees the lecture in `세부 강의`.
- Invited students see the lecture.
- Student opens session and PDF viewer works.
- Student can request page explanation.
- Student can request a quiz and submit it.
- If Gemini is still unavailable, all generated content clearly indicates local basic mode.
