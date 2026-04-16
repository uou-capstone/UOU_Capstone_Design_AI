# MergeEduAgent

멀티 에이전트 기반 강의 설명, 질의응답, 퀴즈, 오답 교정, 누적 리포트를 한 흐름으로 연결한 학습 시스템 데모입니다.

## 구성
- `apps/web`: React + Vite + TypeScript UI
- `apps/server`: Node.js + Express + TypeScript API, 세션 오케스트레이션, 로컬 저장
- `apps/ai-bridge`: FastAPI + Gemini 브리지

## 빠른 실행
사전 요구사항:
- Node.js 20+
- Python 3.11 ~ 3.13

1. `.env` 생성
```bash
cp .env.example .env
```
2. `.env`에 `GOOGLE_API_KEY` 설정
3. 실행
```bash
./run.sh
```

실행 후:
- Web: `http://localhost:5173`
- Server: `http://localhost:4000`

## 현재 시스템 한눈에 보기
- 세션 엔진은 `이벤트 수신 -> StateReducer 선반영 -> assessment handoff 준비 -> LLM planner -> verifier 제약 적용 -> tool 실행 -> 저장` 순서로 동작합니다.
- 오케스트레이터는 단순 라우터가 아니라 `pedagogyPolicy`를 먼저 확정하고, 그 제약 안에서만 tool call을 고릅니다.
- 하위 실행기는 `ExplainerAgent`, `QaAgent`, `QuizAgents`, `GraderAgent`, `MisconceptionRepairAgent`로 분리되어 있습니다.
- 퀴즈 흐름은 `채점 -> QuizDiagnosisService -> activeIntervention -> 맞춤 교정 -> 다음 턴 assessmentDigest handoff`까지 이어집니다.
- 세션 상태는 `integratedMemory`, `qaThread`, `activeIntervention`, `quizAssessments`를 함께 보존하고, `JsonStore`가 구버전 세션을 안전하게 backfill 합니다.
- `POST /api/session/:sessionId/save`는 클라이언트 state를 merge하지 않고 서버 상태만 다시 저장해 server-owned session state를 보호합니다.
- 스트리밍은 `orchestrator_thought_delta`, `agent_delta`, `final`, `error` NDJSON 계약을 사용합니다.

## 핵심 특징
- 이벤트 기반 세션 엔진: `POST /api/session/:sessionId/event`
- 오케스트레이터 + 설명/QA/퀴즈/채점/교정 에이전트 분리
- `pedagogyPolicy` + verifier 기반 안전한 tool 실행
- 퀴즈 4종(MCQ/OX/SHORT/ESSAY) + 자동 채점/LLM 채점
- 오답 진단(`activeIntervention`)과 교정(`REPAIR_MISCONCEPTION`) 루프
- deterministic `QuizAssessmentService`와 다음 턴 `assessmentDigest` handoff
- QA follow-up thread memory
- 로컬 JSON 저장/복구 + atomic write
- Markdown + LaTeX 렌더링

## 브리지 규칙
- PDF 업로드: `pathlib.Path(pdf_path)`
- 오케스트레이터는 thought 스트리밍 + JSON schema plan을 함께 사용
- Gemini 생성 응답은 표준 필드 `content`로 정규화됩니다.

## Python 호환성 / 트러블슈팅
- `run.sh`는 Python 3.13/3.12/3.11을 우선 선택합니다.
- 기존 `.venv`가 Python 3.14로 만들어져 있으면 자동 백업 후 재생성합니다.
- 특정 Python을 강제하려면:
```bash
PYTHON_BIN=python3.13 ./run.sh
```

## 참고 문서
- `AGENT_ORCHESTRATION_DESIGN.md`
- `LLM_MULTI_AGENT_ARCHITECTURE.md`
- `STUDENT_COMPETENCY_AGENT.md`
- `capstone-study-docs/`

## 테스트
```bash
npm run test -w apps/server
```

## 빌드
```bash
npm run build
```
