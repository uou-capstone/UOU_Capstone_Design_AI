# Gemini 기반 에이전트 실연결 수정 결과

작성일: 2026-04-26

## 문제 요약

- 이전 구현은 Gemini PDF 업로드가 실패해도 로컬 PDF 텍스트 기반 응답으로 강의와 학습 세션을 계속 만들었다.
- 이 동작은 실제 Gemini 에이전트 연결 성공이 아니므로, 사용자가 보는 화면에서는 정상처럼 보여도 의도한 시스템 검증이 되지 않았다.
- 기존 실패 로그의 핵심 원인은 AI bridge가 프로젝트 `.env`의 Gemini 키보다, 터미널 환경에 남아 있던 오래된 `GOOGLE_API_KEY`를 우선 사용한 것이었다.

## 수정 원칙

- Gemini 업로드 실패는 실패로 드러낸다.
- `geminiFile` 없이 설명, 질의응답, 퀴즈 생성, 서술형 채점 같은 AI 에이전트 작업을 가짜로 실행하지 않는다.
- 교사가 업로드한 PDF는 Gemini Files API 업로드가 성공해야 강의로 생성된다.
- 학생은 Gemini 연결이 완료된 자료만 정상 학습할 수 있다.

## 구현 내용

- `apps/ai-bridge/main.py`
  - 프로젝트 `.env`의 `GOOGLE_API_KEY`를 AI bridge의 기본 Gemini 키로 사용하도록 조정했다.
  - 터미널 환경 키를 의도적으로 쓰려면 `MERGEEDU_USE_SHELL_GOOGLE_API_KEY=true`를 명시해야 한다.

- `apps/server/src/routes/lectures.ts`
  - PDF 텍스트 인덱싱 이후 Gemini 업로드가 실패하면 저장된 PDF와 페이지 인덱스를 정리하고 502를 반환한다.
  - 실패 상태에서는 강의를 생성하지 않는다.

- `apps/server/src/routes/session.ts`
  - `geminiFile`이 없는 강의를 학생이 열면 재업로드 요청 메시지를 반환한다.
  - 교사가 열 경우에는 한 번 Gemini 재연결을 시도하고, 실패 시 명시적으로 AI 연결 필요 오류를 반환한다.

- `apps/server/src/services/engine/ToolDispatcher.ts`
  - `geminiFile` 없이 EXPLAINER, QA, QUIZ, GRADER가 로컬 fallback 답변을 만들던 경로를 제거했다.
  - AI 작업에는 Gemini PDF 연결이 필요하다는 SYSTEM 메시지만 남기도록 바꿨다.

- `apps/web/src/routes/Session.tsx`
  - AI 연결 실패 배너를 “로컬 기본 학습 모드”가 아니라 실제 연결 실패로 표시하도록 바꿨다.

## Computer Use 실제 브라우저 검증

테스트 브라우저: Comet
웹 주소: `http://localhost:5190`
테스트 PDF: `/Users/jhkim/Downloads/6주차 학습자료.pdf`

- 교사 계정으로 로그인했다.
- `Fallback Upload Test Classroom`의 `1주차`에 새 강의 `6주차 Gemini 실연결 확인`을 추가했다.
- 브라우저 파일 선택창에서 실제 PDF를 선택하고 업로드했다.
- 서버 로그에서 `/bridge/upload_pdf` 200 OK를 확인했다.
- 학생 계정으로 로그인했다.
- 학생 화면에서 새 강의가 표시되는 것을 확인했다.
- 학생으로 `학습 시작`을 눌러 세션에 진입했다.
- 1페이지 설명 시작 요청 후 `/bridge/explain_page_stream` 200 OK를 확인했다.
- 에이전트가 실제 PDF 표지의 `4차 산업혁명과 메타버스`, `디지털 혁신과 메타버스`, 울산과학대학교 정보를 기반으로 설명했다.
- 다음 페이지 이동 요청 후 2페이지로 이동했고, 2페이지 목차 내용을 기반으로 설명했다.
- `시험 볼래요` 입력 후 객관식 퀴즈를 선택했다.
- `/bridge/generate_quiz_stream` 200 OK를 확인했다.
- 생성된 퀴즈가 PDF 1~2페이지 내용 기반으로 출제되었다.
- 답안을 선택하고 채점했으며 총점 `30/30`을 확인했다.

## 코드 검증

- `npm run test --workspace apps/server -- --run src/tests/lectureUploadFallback.test.ts src/tests/toolDispatcher.test.ts src/tests/orchestrationEngine.test.ts`
  - 3개 테스트 파일 통과
  - 25개 테스트 통과

- `npm run build --workspace apps/server`
  - 통과

- `npm run build --workspace apps/web`
  - 통과

- fallback 문구 검색
  - `로컬 PDF 텍스트 기반`, `로컬 기본 학습 모드`, `Gemini PDF 연결 없이`, `LOCAL_MODE_PREFIX`, `executeLocalFallbackTool` 검색 결과 없음

## 남은 주의점

- 이전 잘못된 fallback 구현으로 생성된 기존 세션 기록에는 “로컬 PDF 텍스트 기반” 메시지가 남아 있을 수 있다.
- 이 기록은 과거 실패 테스트의 산물이므로, 실제 성공 사례로 보면 안 된다.
- 새로 업로드한 `6주차 Gemini 실연결 확인` 강의가 이번 수정 후의 유효한 검증 대상이다.

## 결론

이번 수정 후에는 Gemini PDF 업로드가 실패한 상태를 성공처럼 꾸미지 않는다. 실제 Gemini 파일 연결이 성공해야 강의가 생성되고, 학생 학습 세션의 설명과 퀴즈 생성도 Gemini bridge를 통해 동작한다.
