# MergeEduAgent 학습 멀티 에이전트 다이어그램

이 산출물은 현재 코드 기준으로 학습 멀티 에이전트가 어떻게 동작하는지 한눈에 보기 위한 다이어그램 모음이다.

## 핵심 이해

현재 구조는 에이전트들이 서로 자유롭게 대화하는 형태가 아니다.
`OrchestrationEngine`이 이벤트를 받고, `Orchestrator`가 제한된 `tool call` 계획을 만들며, `ToolDispatcher`가 `pedagogyPolicy`와 verifier 규칙으로 검증한 뒤 전문 에이전트를 순차 실행한다.

즉, LLM은 "무엇을 호출할지"를 고르고, 서버는 "실제로 실행하고 저장하는 일"을 맡는다.

## 생성한 보드

| 파일 | 내용 |
|---|---|
| `01-context.png` | 전체 컨텍스트 인포그래픽 |
| `02-session-explain.png` | 세션 진입과 페이지 설명 |
| `03-qa.png` | 자유 질문과 QA follow-up |
| `04-quiz.png` | 퀴즈 생성 |
| `05-grading.png` | 채점, assessment, 다음 턴 handoff |
| `06-repair.png` | 저득점 후 오답 교정 루프 |
| `07-safety.png` | 안전장치와 fallback |
| `learning-multi-agent-diagrams.html` | 모든 보드를 담은 원본 HTML |

## 코드 기준점

- `apps/server/src/services/engine/OrchestrationEngine.ts`
- `apps/server/src/services/agents/Orchestrator.ts`
- `apps/server/src/services/engine/ToolDispatcher.ts`
- `apps/server/src/services/engine/QuizAssessmentService.ts`
- `apps/server/src/services/engine/QuizDiagnosisService.ts`
- `apps/server/src/services/engine/QaThreadService.ts`
- `apps/server/src/services/agents/ExplainerAgent.ts`
- `apps/server/src/services/agents/QaAgent.ts`
- `apps/server/src/services/agents/QuizAgents.ts`
- `apps/server/src/services/agents/GraderAgent.ts`
- `apps/server/src/services/agents/MisconceptionRepairAgent.ts`
- `apps/server/src/services/llm/GeminiBridgeClient.ts`
- `apps/ai-bridge/main.py`

## 시나리오 요약

1. **세션 진입/설명**: `SESSION_ENTERED` 이후 설명 시작 여부를 묻고, 동의하면 `EXPLAIN_PAGE`가 `ExplainerAgent`를 호출한다.
2. **질문응답**: `USER_MESSAGE`는 `ANSWER_QUESTION`으로 라우팅된다. 같은 페이지 후속 질문이면 `qaThreadDigest`만 이어 붙인다.
3. **퀴즈 생성**: 퀴즈 선택 위젯에서 유형을 고르면 `GENERATE_QUIZ_*`가 `QuizAgents`를 호출하고, `QuizRecord`와 quiz modal patch를 만든다.
4. **채점/assessment**: MCQ/OX는 조건이 맞으면 deterministic fast path로 채점한다. SHORT/ESSAY는 `GraderAgent`가 채점한다. 결과는 `quizAssessments`에 `PENDING`으로 저장되어 다음 턴 prompt에 handoff된다.
5. **오답 교정**: 저득점이면 `activeIntervention`이 열리고, 다음 학생 답변은 `REPAIR_MISCONCEPTION`으로 우선 처리된다. 이후 `integratedMemory`, `feedback`, `pageState`가 갱신된다.
6. **fallback/안전장치**: `geminiFile` 없음, 모델 실패, JSON parsing 실패, `SAVE_AND_EXIT`, MCQ/OX fast path 등에서는 deterministic fallback을 사용한다. 최종 실행 전에는 `verifyAndPatchPlan`이 policy와 action을 다시 맞춘다.
