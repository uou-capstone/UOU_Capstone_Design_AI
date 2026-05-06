# MergeEduAgent

Gemini 기반 PDF 강의 튜터, 퀴즈, 오답 교정, 학생별 학습 메모리, 선생님용 역량 리포트를 한 흐름으로 연결한 학습 시스템입니다.

# 0502 업데이트 사항

## 개발자 로그인/인증 모드 기본 활성화

로컬 실행과 테스트 계정 검증을 빠르게 하기 위해 `.env.example`의 로그인 관련 개발자 모드를 기본으로 항상 켜두는 설정으로 정리했다. 기본값은 `AUTH_EMAIL_DELIVERY_MODE=dev`, `AUTH_DEV_EXPOSE_VERIFICATION_CODE=true`이며, 회원가입/이메일 변경/재전송 과정에서 개발용 인증 코드가 웹 화면과 API 응답에 표시될 수 있다.

실제 메일 인증이 필요한 운영 또는 SMTP 테스트 환경에서는 `AUTH_EMAIL_DELIVERY_MODE=smtp`로 바꾸고 `AUTH_VERIFICATION_CODE_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`을 모두 채워야 한다.

## AI 모델 및 시험 스튜디오 안정화

기본 LLM 모델을 `gemini-3-flash-preview`로 정리하고, 시험 스튜디오 AI 설계 도우미는 Gemini 3 Flash의 `thinking_level=minimal` 설정을 사용하도록 바꿨다. 빈 JSON schema를 Gemini에 그대로 넘기지 않도록 정리해 응답 지연을 줄였고, 스트리밍 UI는 유지하되 브릿지 내부에서는 빠른 일반 JSON 응답을 사용해 `사고 요약 스트리밍` 단계에서 멈춰 보이는 현상을 줄였다. AI 응답이 비정상적으로 오래 걸릴 경우 `EXAM_STUDIO_AI_TIMEOUT_MS`로 제한할 수 있다.

시험 스튜디오 채팅은 이제 사용자 문장을 서버가 직접 파싱해서 수정하지 않고, 현재 시험 draft와 현재 KST 시간을 Gemini에 넘긴 뒤 `answerMarkdown`과 `operations[{ method, params }]` JSON 응답만 검증해 왼쪽 스튜디오에 반영한다. 예를 들어 "내일 오후 3시로 바꿔줘" 같은 요청은 Gemini가 `patchExamSettings`의 `availableFrom`, `availableUntil`, `timeLimitMinutes`를 직접 내려줘야 반영되며, operation이 없거나 날짜 params가 비어 있으면 UI를 바꾸지 않는다. 불가능한 ISO 날짜나 timezone 없는 날짜도 서버에서 버린다.

## PDF 뷰어 확대/이동 UX 개선

학습 세션 PDF 뷰어의 `-`, `+` 버튼 중심 확대 UI를 슬라이더 기반 확대 컨트롤로 바꾸고, 확대된 PDF를 뷰어 내부에서 드래그해 이동할 수 있도록 개선했다. PDF 확대는 PDF 캔버스 내부에만 적용되며, 세션 레이아웃이나 오른쪽 AI 튜터 채팅 패널이 함께 커지지 않도록 데스크톱/모바일 높이와 overflow를 고정했다.

구현 위치:

- `apps/web/src/components/pdf/PdfViewer.tsx`
  - PDF worker를 번들 파일로 로드하고, 확대 슬라이더, 확대율 표시, 맞춤 버튼, 드래그 pan, 확대 중심 유지 로직을 추가했다.
- `apps/web/src/styles/global.css`
  - `.session-layout`, `.pdf-viewer-shell`, `.session-chat-shell`, `.pdf-single-view`의 크기와 overflow를 안정화했다.
- `e2e/pdf-viewer-pan-zoom.spec.ts`
  - 확대/드래그 이동, 내부 스크롤 fallback, 채팅 패널 크기 고정, 모바일/소형 데스크톱 레이아웃을 검증한다.

## 퀴즈 문항 수 개인화 정책 추가

퀴즈 생성 시 항상 고정 문항 수를 요청하지 않고, 학습자 수준/자신감/누적 메모리/오개념/질문 이력/페이지 복잡도/출제 범위를 바탕으로 5~10문항 사이에서 동적으로 결정하도록 바꿨다. 생성 결과가 요청 문항 수보다 부족하면 재시도하고, 너무 많은 문항은 정책값에 맞게 잘라 안정적인 퀴즈 흐름을 유지한다.

구현 위치:

- `apps/server/src/services/agents/QuizQuestionCountPolicy.ts`
  - 문항 수 결정을 위한 신호 계산과 5~10문항 clamp 정책을 담당한다.
- `apps/server/src/services/agents/QuizAgents.ts`
  - Gemini 퀴즈 생성 요청에 `questionCount`와 결정 근거를 전달하고, 부족 생성 시 재시도/검증 로그를 남긴다.
- `apps/server/src/tests/quizQuestionCountPolicy.test.ts`, `apps/server/src/tests/quizAgentsQuestionCount.test.ts`
  - 문항 수 정책과 생성 재시도/trim 동작을 검증한다.

## 회원 정보 수정 전용 화면 정리

대시보드 안에 바로 노출되던 회원 정보 수정 패널을 `/account` 전용 화면으로 분리했다. 상단 프로필 메뉴에서 계정 관리로 이동해 이메일과 비밀번호를 변경할 수 있고, 이메일 변경 후에는 같은 계정 화면으로 돌아오도록 인증 흐름을 연결했다.

구현 위치:

- `apps/web/src/routes/AccountSettings.tsx`
  - 회원 정보 수정 전용 페이지와 대시보드 복귀 흐름을 담당한다.
- `apps/web/src/App.tsx`, `apps/web/src/components/layout/AppTopBar.tsx`
  - `/account` 라우트와 프로필 메뉴 진입점을 연결했다.
- `apps/web/src/components/account/AccountProfilePanel.tsx`
  - 전용 화면에서도 취소/인증 후 복귀 흐름을 처리하도록 정리했다.

## 강의실 화면 내비게이션과 리포트 기준 확장

강의실 상세 화면을 `학생 초대`, `강의실 주차`, `학생 리포트` 섹션으로 나눠 교사용 작업 흐름을 더 명확하게 만들었다. 학생 계정은 초대/리포트 관리 섹션을 보지 않고 주차 학습 흐름에 집중하도록 유지했다. 학생 역량 리포트는 기본 기준 외에 강의실별 커스텀 평가 기준을 저장하고 사용할 수 있도록 타입과 저장소 로직을 확장했다.

구현 위치:

- `apps/web/src/routes/Classroom.tsx`
  - 역할별 강의실 섹션 내비게이션, 업로드 모달 정리, 모바일 폭 대응을 담당한다.
- `apps/server/src/routes/classrooms.ts`, `apps/server/src/types/domain.ts`
  - 리포트 기준 조회/저장과 커스텀 기준 타입을 추가했다.
- `e2e/classroom-navigation.spec.ts`
  - 교사/학생 역할별 섹션 표시, 학생 목록 실패 재시도, 모바일 폭 맞춤을 검증한다.

## 회원 정보 수정 기능 추가

로그인 후 대시보드와 계정 화면에서 본인의 회원 정보를 확인하고 수정할 수 있는 영역을 추가했다. 사용자는 현재 아이디 이메일과 비밀번호 표시 상태를 확인할 수 있고, `회원 정보 수정`을 통해 이메일과 비밀번호를 변경할 수 있다.

구현 위치:

- `apps/web/src/components/account/AccountProfilePanel.tsx`
  - 회원 정보 표시, 수정 모드 전환, 이메일/비밀번호 입력, 현재 비밀번호 확인, 저장 결과와 개발자 인증 코드 표시 UI를 담당한다.
- `apps/web/src/routes/Dashboard.tsx`
  - 로그인 후 대시보드 진입 흐름을 담당한다.
- `apps/web/src/auth/AuthProvider.tsx`
  - 회원 정보 수정 후 사용자 상태를 갱신하고, 이메일이 바뀌어 재인증이 필요하면 인증 화면 흐름으로 연결한다.
- `apps/web/src/api/endpoints.ts`
  - `updateAccount` API 클라이언트 함수를 추가했다.
- `apps/server/src/routes/auth.ts`
  - `PATCH /api/auth/me` 엔드포인트를 추가해 이메일과 비밀번호 수정을 처리한다.
- `apps/server/src/services/auth/AuthService.ts`
  - 현재 비밀번호 검증, 이메일 중복 검사, 비밀번호 해시 갱신, 이메일 변경 시 재인증 코드 발급 로직을 담당한다.
- `apps/server/src/services/storage/JsonStore.ts`
  - 사용자 정보 업데이트 저장 로직을 추가했다.
- `apps/server/src/services/security/RequestEncryptionService.ts`
  - `/api/auth/me` 경로도 요청 암호화 필수 경로에 포함되도록 보완했다.
- `.env.example`
  - 개발자 모드 이메일 인증 코드 노출 설정과 `/api/auth/me` 암호화 경로 예시를 추가했다.
- `apps/server/src/tests/authFlow.test.ts`, `e2e/account-profile.spec.ts`
  - 회원 정보 수정, 이메일 재인증, 기존/신규 비밀번호 로그인 흐름을 검증한다.

## 학생 리포트 기반 챗봇 기능 추가

학생별 역량 리포트 화면에서 우하단 원형 챗봇 버튼을 눌러 선택된 학생에 대해 추가 질문을 할 수 있는 기능을 추가했다. 챗봇은 현재 화면에서 선택된 학생 한 명의 정보, 해당 학생의 강의실 로그 데이터, 저장된 학생 분석 리포트를 Gemini 입력으로 사용한다. 멀티모달 입력은 막고 텍스트 `textarea` 입력만 제공한다.

구현 위치:

- `apps/web/src/routes/ClassroomReport.tsx`
  - 우하단 고정 챗봇 버튼, 채팅 drawer, 텍스트 입력창, 메시지 스트리밍 표시, 학생 변경 시 채팅 초기화와 stale stream 무시 로직을 담당한다.
- `apps/web/src/styles/global.css`
  - `report-chat-*` 전용 스타일을 추가해 기존 세션 채팅 UI와 충돌하지 않도록 분리했다. 모바일에서도 drawer가 화면을 벗어나지 않도록 높이와 위치를 조정했다.
- `apps/web/src/api/endpoints.ts`
  - `streamStudentReportChat` 클라이언트 함수를 추가해 NDJSON 스트림을 읽고 `answer_delta`, `thought_delta`, `done`, `error` 이벤트를 처리한다.
- `apps/server/src/routes/classrooms.ts`
  - `POST /api/classrooms/:classroomId/report/students/:studentUserId/chat/stream` 엔드포인트를 추가했다. 선생님 권한, 강의실 소유자, 등록 학생, 저장 리포트 존재 여부를 검증한다.
- `apps/server/src/services/report/StudentCompetencyReportService.ts`
  - 선택된 학생 한 명만 `ownerIds: [student.id]`로 집계해 챗봇 prompt를 만든다. 대화 history는 참고 문맥으로만 쓰고, 저장 리포트와 선택 학생 로그를 근거 데이터로 사용한다.
- `apps/server/src/services/llm/GeminiBridgeClient.ts`
  - 학생 리포트 챗봇용 Markdown 스트리밍 bridge 호출을 추가했다.
- `apps/ai-bridge/main.py`
  - `/bridge/student_report_chat_stream` 엔드포인트를 추가해 Gemini schema-less Markdown 스트림을 반환한다.
- `apps/server/src/tests/studentCompetencyReport.test.ts`
  - 챗봇 prompt가 선택 학생의 저장 리포트와 로그만 포함하고 다른 학생 데이터를 섞지 않는지 검증한다.
- `e2e/student-report-chatbot.spec.ts`
  - fake NDJSON 기반으로 챗봇 drawer 열림, 텍스트 전용 입력, 리포트 미생성 409 안내, 학생 전환 중 늦은 스트림 무시를 검증한다.

## 구성

| 경로 | 역할 |
|---|---|
| `apps/web` | React + Vite + TypeScript 웹 UI |
| `apps/server` | Express + TypeScript API, 인증/권한, 세션 오케스트레이션, JSON 저장소 |
| `apps/ai-bridge` | FastAPI + Google Gemini 브리지 |
| `docs` | 현재 사용 문서와 테스트 계정 문서 |
| `update` | 버전별 설계/검증/수동 테스트 기록 |
| `capstone-study-docs` | 멀티 에이전트 설계 참고 문서 |

## 빠른 실행

사전 요구사항:

- Node.js 20+
- Python 3.11 ~ 3.13
- Google Gemini API key

1. 환경 파일을 만든다.

```bash
cp .env.example .env
```

2. `.env`에서 `GOOGLE_API_KEY`를 실제 키로 바꾼다.

3. macOS/Linux에서는 아래 명령을 실행한다.

```bash
./run.sh
```

4. Windows에서는 프로젝트 루트에서 아래 명령을 실행한다.

```cmd
run.cmd
```

실행 후 기본 주소:

- Web: `http://localhost:5173`
- Server: `http://localhost:4000`
- AI Bridge: `http://localhost:8001`

`run.sh`와 `run.cmd`는 `.env`가 없으면 `.env.example`에서 생성하고, Python 가상환경과 Node 의존성을 준비한 뒤 web/server/bridge를 함께 실행한다.

## 환경 변수

`.env`는 커밋하지 않는다. 저장소에는 샘플인 `.env.example`만 포함한다.

필수 값:

- `PORT`, `WEB_PORT`, `AI_BRIDGE_PORT`
- `MODEL_NAME`
- `GOOGLE_API_KEY`
- `PASS_SCORE_RATIO`
- `CONTEXT_MAX_CHARS`, `RECENT_MESSAGES_N`
- `DATA_DIR`, `UPLOAD_DIR`
- `AI_BRIDGE_URL`

`DATA_DIR`와 `UPLOAD_DIR`가 상대 경로이면 `.env`가 있는 프로젝트 루트 기준으로 해석된다. 따라서 기본값 `./apps/server/data`, `./apps/server/uploads`는 macOS/Linux, Windows, npm workspace 실행에서 같은 위치를 가리킨다.

인증/메일:

- 기본 개발 모드는 `AUTH_EMAIL_DELIVERY_MODE=dev`이며, 인증 코드가 화면/API 응답에 노출될 수 있다.
- 실제 이메일 인증은 `AUTH_EMAIL_DELIVERY_MODE=smtp`와 `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `AUTH_VERIFICATION_CODE_SECRET`을 모두 설정해야 한다.
- Google OAuth는 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`가 모두 있을 때 활성화된다.

요청 암호화:

- 기본값은 `REQUEST_ENCRYPTION_MODE=required`다.
- 개발 편의를 위해 `optional`을 사용할 수 있지만, 운영 모드에서는 `required`만 허용된다.
- 웹 클라이언트는 `/api/crypto/request-key`에서 RSA-OAEP 공개키를 받고, 인증 요청 본문을 AES-256-GCM으로 암호화해 전송한다.
- 운영 모드에서는 `REQUEST_ENCRYPTION_MODE=off`와 `optional`이 차단된다.

## 핵심 기능

- 이메일/비밀번호 회원가입, 가입 시 이메일 인증, 아이디/비밀번호 로그인
- 선생님/학생 역할 분리
- Google OAuth 가입/로그인 옵션
- 선생님 강의실/주차/PDF 자료 관리
- 학생 이름 + 4자리 코드 기반 강의실 초대
- 학생은 초대받은 강의실과 선생님 자료만 조회
- Gemini PDF 파일 업로드 기반 페이지 설명, 질문응답, 퀴즈 생성
- 객관식/OX 자동 채점, 단답형/서술형 Gemini 채점
- 오답 진단, 교정, 재확인 흐름
- 학생별 세션 메모리와 선생님용 학생별 역량 리포트
- 요청 암호화, Same-Origin unsafe method 보호, role/owner 기반 API 권한 검사

## 주요 문서

- `AGENT_ORCHESTRATION_DESIGN.md`: 세션 오케스트레이션 구현 기준 문서
- `LLM_MULTI_AGENT_ARCHITECTURE.md`: LLM planner와 tool dispatcher 아키텍처
- `STUDENT_COMPETENCY_AGENT.md`: 학생별/강의실별 역량 리포트 구조
- `docs/README.md`: docs 디렉토리 문서 색인
- `apps/ai-bridge/README.md`: Gemini bridge 역할과 엔드포인트
- `docs/multi-agent-diagrams/README.md`: 멀티 에이전트 다이어그램 안내
- `update/0427update/safety-scenarios-50.md`: 0427 수동 안전성/권한/UI 테스트 로그

## 테스트와 빌드

서버 단위 테스트:

```bash
npm run test -w apps/server
```

전체 빌드:

```bash
npm run build
```

격리된 e2e 서버:

```bash
npm run e2e:serve
```

Playwright 테스트:

```bash
npm run test:e2e
```

## 저장소에 포함하지 않는 파일

- `.env`, `.env.*`
- `node_modules/`, `.venv*/`, `dist/`
- `apps/server/data/*.json`, `apps/server/data-*`, `apps/server/uploads-*`
- `apps/server/apps/` 아래에 잘못 생성된 로컬 테스트 데이터
- `test-results/`, `playwright-report/`

`.env.example`, 소스 코드, 문서, 테스트 코드는 커밋 대상이다.
