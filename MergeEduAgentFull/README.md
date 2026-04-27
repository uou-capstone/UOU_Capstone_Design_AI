# MergeEduAgent

Gemini 기반 PDF 강의 튜터, 퀴즈, 오답 교정, 학생별 학습 메모리, 선생님용 역량 리포트를 한 흐름으로 연결한 학습 시스템입니다.

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

## 임시 테스트 계정

테스트 계정 목록은 `docs/temp-member-accounts.md`에 있다.

새 로컬 환경에서는 실제 사용자 JSON이 커밋되지 않으므로 아래 명령으로 계정을 시드한다.

```bash
npm run seed:temp-accounts -w apps/server
```

Windows:

```cmd
npm run seed:temp-accounts -w apps/server
```

공통 비밀번호는 문서에 적힌 로컬 테스트용 값이다. 배포/공유 환경에서는 이 계정을 삭제하거나 별도 테스트 데이터로 분리한다.

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
- `docs/temp-member-accounts.md`: 임시 선생님/학생 계정과 시드 명령
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
