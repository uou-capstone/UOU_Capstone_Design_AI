# Pedagogy Policy Update (Ver3 Applied)

- 시간: `2026-04-15`
- 상태: `실제 적용 완료`
- 범위: `Orchestrator가 매 턴 "교수 목적(pedagogyPolicy)"을 먼저 정하고, 그 제약 안에서만 tool을 고르도록 바꿈`
- 기반 로드맵: [FUTURE_AGENT_FLOW_ROADMAP_2026-04.md](/Users/jhkim/Documents/MergeEduAgentFull/capstone-study-docs/FUTURE_AGENT_FLOW_ROADMAP_2026-04.md) Phase 1

## 한 줄 요약

이제 Orchestrator는 `무슨 tool을 부를지`를 고르기 전에
`지금 이 턴의 교수 목적은 무엇인가`를 먼저 확정합니다.
그리고 그 목적과 어긋나는 action은 dispatch 직전에 자동으로 막거나 교정합니다.

## 무엇이 달라졌는가 — 한 문장씩

- 매 턴, LLM 응답에 `pedagogyPolicy` 필드가 추가로 들어옵니다. (mode/reason/allowDirectAnswer/hintDepth/interventionBudget)
- 이 정책이 없으면 dispatch 경로에서 안전한 기본값으로 채웁니다 (이중 방어).
- dispatch 직전에 10개의 규칙(R1~R10)이 돌면서 policy와 action이 어긋나면 `추가`·`차단`·`격상` 중 하나로 교정합니다.
- 기존 30개 서버 테스트는 한 글자도 바꾸지 않았고, 모두 통과합니다.

## 왜 필요한가 (이전의 문제)

Ver2까지는 Orchestrator가 이런 순서로 움직였습니다.

```text
이벤트 수신
-> 프롬프트 읽고 actions[] 만들기
-> dispatch
```

여기엔 `이번 턴에 학생에게 어떤 교수 행위를 할 것인가`라는 **선언이 없었습니다.**
그래서 종종 아래 같은 일이 일어났습니다.

- 학생이 `그냥 답 알려줘` 라고 했는데 그대로 정답을 노출 (overhelping)
- 설명 직후 이해 확인 없이 바로 다음 페이지로 이동
- 진단 단계 직후인데 일반 QA로 흘러감
- 퀴즈 고득점 직후 자기성찰 없이 바로 퀴즈 재생성

교수적으로는 다른 turn인데, 실제 action 패턴은 같아 보였습니다.

## Ver3의 접근 — 정책을 먼저 확정

Ver3부터 Orchestrator는 반드시 아래 순서를 따릅니다.

```text
이벤트 수신
-> (1) 이번 턴의 pedagogyPolicy 확정
         · mode (8개 중 하나)
         · reason (왜 이 mode인가)
         · allowDirectAnswer (정답 노출 허용?)
         · hintDepth (LOW/MEDIUM/HIGH)
         · interventionBudget (개입성 tool 상한: 0/1/2/3)
-> (2) 그 정책의 허용/금지 목록 안에서만 actions[] 구성
-> (3) dispatch 직전에 Verifier가 R1~R10 점검 및 보정
-> (4) dispatch
```

`(1)→(2)` 순서는 프롬프트의 하드 제약으로 강제하고,
`(3)` 은 코드 레벨 안전망으로 중복 방어합니다.

## 8개 mode와 각자의 역할

| mode | 언제 | 기대 action |
|---|---|---|
| `EXPLAIN_FIRST` | 새 페이지 진입, 설명 이력 없음 | `EXPLAIN_PAGE` + 이해 확인 위젯 |
| `DIAGNOSE` | 퀴즈 저점 직후, 원인 좁히기 | 채점 + `어디가 헷갈렸는지` 한 줄 질문 |
| `MISCONCEPTION_REPAIR` | 진단 답변 수신 | `REPAIR_MISCONCEPTION` + 재시험 제안 |
| `MINIMAL_HINT` | `그냥 답 알려줘` 류 직접 정답 요구 | 힌트 1개 + 자기설명 유도 질문 |
| `CHECK_READINESS` | 설명 직후, 아직 이해 확인 없음 | 자기설명 유도 메시지 + 다음 페이지 위젯 |
| `HOLD_BACK` | `잠깐 스스로 해볼게` 류 자율 신호 | 짧은 격려 한 줄만 |
| `SRL_REFLECTION` | 퀴즈 고점 통과 | 자기성찰 질문 + 다음 페이지 위젯 |
| `ADVANCE` | 그 외 일반 진행 | 일반 QA/네비게이션 |

## 실제 시나리오

### 시나리오 A — 학생이 `그냥 답 알려줘` 라고 입력

**이전:**

```text
학생: "그냥 답 알려줘"
-> ANSWER_QUESTION 호출
-> QA가 그대로 정답을 노출 (overhelping)
```

**변경 후:**

```text
학생: "그냥 답 알려줘"
-> Orchestrator: pedagogyPolicy = MINIMAL_HINT
      reason: "직접 정답 요구 감지; overhelping 방지"
      allowDirectAnswer: false
      hintDepth: LOW
-> 프롬프트 하드 제약에 의해 questionText 앞에
   "[힌트만: 정답을 직접 말하지 말고 첫 단서 1개와
    자기설명 유도 질문으로 답하라] " 프리픽스 자동 삽입
-> Verifier R5: args.hintDirective="HINT_ONLY", hintDepth="LOW" 추가
-> QA는 힌트 1개 + "직접 다시 풀어볼래요?" 로 응답
```

학생이 `정답을 즉시 받는` 대신 `단서를 받고 자기 설명을 시도`하게 됩니다.

### 시나리오 B — 퀴즈 오답 직후, 진단 단계

**이전 (Ver2):**

```text
퀴즈 점수 < 0.6
-> AUTO_GRADE_MCQ_OX
-> createQuizRepairIntervention + stage = AWAITING_DIAGNOSIS_REPLY
-> 오답 진단 질문 송출
```

Ver2의 이 흐름 자체는 잘 동작했지만,
`왜 이 턴이 진단 턴인지`가 어디에도 기록되지 않았습니다.

**Ver3:**

```text
QUIZ_SUBMITTED 이벤트
-> Orchestrator: pedagogyPolicy = DIAGNOSE
      reason: "last score 0.40 < 0.85*pass; activeIntervention 없음;
               판단: 채점과 동시에 원인 좁히기"
      allowDirectAnswer: false
      interventionBudget: 2
-> actions = [AUTO_GRADE_MCQ_OX, APPEND_ORCHESTRATOR_MESSAGE("어디가 헷갈렸나요?")]
```

이 `reason` 한 줄이 세션 로그에 남습니다. 나중에 `이 턴에 왜 이렇게 행동했는가`를 재현할 수 있습니다.

### 시나리오 C — 진단 답변 수신 직후 (stage/mode 엇갈림 방어)

Ver2의 repair 테스트와 동일한 상황을 Ver3가 어떻게 다루는지 보여주는 시나리오입니다.

```text
state.activeIntervention.stage = AWAITING_DIAGNOSIS_REPLY
학생: "왜 적용하는지가 헷갈렸어요"
```

**LLM path (정상 동작):**

```text
-> Orchestrator: pedagogyPolicy = MISCONCEPTION_REPAIR
      reason: "stage=AWAITING_DIAGNOSIS_REPLY 이고 USER_MESSAGE 수신;
               판단: 원인 회신을 근거로 짧게 교정"
-> actions = [REPAIR_MISCONCEPTION, PROMPT_BINARY_DECISION(RETEST_DECISION)]
```

**LLM이 DIAGNOSE로 잘못 답한 경우 (R7이 보정):**

```text
-> Verifier R7: mode=DIAGNOSE && stage=AWAITING_DIAGNOSIS_REPLY
   → mode를 MISCONCEPTION_REPAIR로 강제 승격
-> 나머지 규칙 그대로 통과
```

**LLM이 아예 policy를 빼먹은 경우 (R1 safety net):**

```text
-> normalizePlan: policy 없음 → 기본값 ADVANCE 로 채움
-> Verifier R1: 이미 채워져 있어 skip
-> Verifier R8: stage=AWAITING + mode=ADVANCE → log "stage_mode_mismatch"
               → mode-wins: 기존 actions는 그대로, mutation 없음
-> 기존 REPAIR_MISCONCEPTION action 그대로 dispatch
```

**핵심**: R8은 **의도적으로 action을 건드리지 않습니다.** Ver2 `toolDispatcher.test.ts:242`의 "repairs misconception" 테스트가 이 경로를 그대로 통과해야 하기 때문입니다.

### 시나리오 D — 학생이 `잠깐만 스스로 해볼게` 입력

```text
학생: "잠깐만 스스로 해볼게요"
-> Orchestrator: pedagogyPolicy = HOLD_BACK
      reason: "자율 시도 신호; 개입 멈추고 공간 제공"
      interventionBudget: 1
-> actions = [APPEND_ORCHESTRATOR_MESSAGE("좋습니다. 잠시 스스로 생각해 볼 시간을 드릴게요...")]
-> Verifier R2: length=1 → 그대로 통과
```

만약 LLM이 HOLD_BACK이라고 해놓고 실수로 EXPLAIN_PAGE까지 붙였다면:

```text
-> Verifier R2: mode=HOLD_BACK && actions.length > 1
              → 첫 APPEND_ORCHESTRATOR_MESSAGE만 남기고 나머지 drop
              → log "hold_back_trimmed"
```

### 시나리오 E — 새 페이지 진입 + 설명 이력 없음

```text
PAGE_CHANGED → page 2
-> Orchestrator: pedagogyPolicy = EXPLAIN_FIRST
      reason: "2페이지 status=NEW, 설명 이력 없음; 판단: 먼저 설명"
      interventionBudget: 3
-> actions = [EXPLAIN_PAGE(2), PROMPT_BINARY_DECISION("여기까지 이해되셨나요?", NEXT_PAGE_DECISION)]
```

만약 LLM이 EXPLAIN_FIRST인데 실수로 GENERATE_QUIZ만 넣었다면:

```text
-> Verifier R9: EXPLAIN_FIRST + quiz 포함 + EXPLAIN_PAGE 없음
              → 맨 앞에 EXPLAIN_PAGE(현재 페이지) prepend
              → log "explain_prepended"
```

## Verifier 10개 규칙 (실행 순서 고정)

dispatch 직전에 `R1 → R7 → R8 → R6 → R9 → R5 → R4 → R2 → R3 → R10` 순서로 실행됩니다.

| 규칙 | 조건 | 행동 |
|---|---|---|
| R1 | `policy === undefined` | 기본 `ADVANCE` 로 채움 (normalizePlan이 먼저 잡지만 이중 방어) |
| R7 | `mode=DIAGNOSE` + `stage=AWAITING_DIAGNOSIS_REPLY` | `mode=MISCONCEPTION_REPAIR` 로 승격 |
| R8 | `stage=AWAITING_DIAGNOSIS_REPLY` + mode 불일치 | mode-wins. **action 불변** (Ver2 테스트 보호) |
| R6 | `mode=MISCONCEPTION_REPAIR` + REPAIR action 없음 | studentReply 있으면 앞에 `REPAIR_MISCONCEPTION` 주입 |
| R9 | `mode=EXPLAIN_FIRST` + quiz 있음 + EXPLAIN_PAGE 없음 | 앞에 `EXPLAIN_PAGE` prepend |
| R5 | `mode=MINIMAL_HINT` | 모든 `ANSWER_QUESTION.args`에 `hintDirective="HINT_ONLY"` 추가 (additive) |
| R4 | `allowDirectAnswer=false` | 모든 `ANSWER_QUESTION.args`에 `hintDirective` 추가 (questionText는 절대 건드리지 않음) |
| R2 | `mode=HOLD_BACK` + length > 1 | 첫 ORCHESTRATOR 메시지만 남기고 drop. 없으면 기본 격려 메시지 생성 |
| R3 | 개입성 tool 수 > `interventionBudget` | 뒤에서부터 trim |
| R10 | 전체 length > 8 | 앞 8개만 유지 |

### 왜 R9가 R3보다 먼저 실행되는가

`EXPLAIN_FIRST`에서 R9가 EXPLAIN_PAGE를 prepend 하면 개입성 tool 수가 1 늘어납니다.
만약 R3이 먼저 돌면 trim 대상이 될 수 있습니다.
R9를 먼저 실행해 필요한 설명을 주입한 뒤, R3이 전체 예산 제약을 적용하는 순서로 고정했습니다.

### 왜 Verifier는 `hintDirective` 필드를 쓰는가

R4/R5가 `questionText` 를 직접 수정하면 `toolDispatcher.test.ts:156`의
`qaThread?.turns[0]?.question === "첫 질문입니다."` 단언이 깨집니다.

그래서 Verifier는 **additive 필드**만 추가합니다.
`args.hintDirective: "HINT_ONLY"` 는 추가되지만 `questionText` 는 그대로 둡니다.

- **LLM path**: 프롬프트 하드 제약이 LLM이 직접 `questionText` 앞에 `[힌트만: ...]` 프리픽스를 넣게 유도 → QA 에이전트가 해당 프리픽스를 보고 힌트 중심 응답 생성
- **Fallback/test path**: Verifier가 `hintDirective` 필드만 추가 → 기존 QA 에이전트는 Phase 1 범위에서 이 필드를 읽지 않지만, Phase 2에서 단일화 경로 확보

## 관찰성 — `[verifier]` 로그

정책 교정이 실제로 발생하면 stdout에 stable prefix로 한 줄 로그가 남습니다.

```text
[verifier] {"sessionId":"ses_test","mode":"ADVANCE","reason":"R1 default","warnings":["policy_missing","stage_mode_mismatch"],"tools":["REPAIR_MISCONCEPTION"]}
```

`grep "[verifier]"` 한 번이면 세션에서 일어난 정책 불일치를 모두 뽑을 수 있습니다.
인시던트 분석 시 `어떤 규칙이 몇 번 발동했는가` 를 계측하는 출발점입니다.

## 어디를 고쳤는가 (파일별)

| 파일 | 변경 |
|---|---|
| [apps/server/src/types/orchestrator.ts](apps/server/src/types/orchestrator.ts) | `PolicyMode`, `HintDepth`, `PedagogyPolicy` 타입 추가. `OrchestratorPlan.pedagogyPolicy` 필드(optional) 추가 |
| [apps/server/src/types/guards.ts](apps/server/src/types/guards.ts) | `policyModeSchema`, `hintDepthSchema`, `pedagogyPolicySchema` 추가. Plan schema에 optional 필드 attach |
| [apps/server/src/services/agents/Orchestrator.ts](apps/server/src/services/agents/Orchestrator.ts) | `defaultPolicy()` 헬퍼 + `buildFallbackPlan()` 내 20개 물리 return 전부에 policy 스탬프 (REVIEW_DECISION/RETEST_DECISION은 accept/reject 조건부 스탬프). `buildPrompt()`에 정책 결정 트리 + 하드 제약 + 6개 few-shot 예시 블록 삽입 |
| [apps/server/src/services/engine/OrchestrationEngine.ts](apps/server/src/services/engine/OrchestrationEngine.ts) | `normalizePlan()` 단일 choke point — `planWithLlm()` 반환 직후 1회 호출. `DispatchContext`에 `pedagogyPolicy` 전달 |
| [apps/server/src/services/engine/ToolDispatcher.ts](apps/server/src/services/engine/ToolDispatcher.ts) | `DispatchContext`에 `pedagogyPolicy?` 필드(optional) 추가. `verifyAndPatchPlan()` private 메서드로 R1~R10 인라인 구현. `[verifier]` 로그 sink 추가 |

**테스트 파일은 0글자 수정.** 기존 `toolDispatcher.test.ts` / `orchestratorFlow.test.ts` / 나머지 30개 서버 테스트가 모두 그대로 통과합니다.

## 설계 원칙

1. **새 agent/service를 만들지 않았다.** Phase 1의 목표는 `프롬프트 + JSON 응답 스키마 확장`만으로 해결하는 것. PedagogyPolicyAgent 같은 별도 모듈은 생성하지 않았습니다.
2. **하위 호환성 100%.** `pedagogyPolicy` 는 Zod `.optional()`, 기존 테스트의 mock plan이 그대로 통과합니다.
3. **이중 방어**. `normalizePlan()` 단일 choke point + Verifier R1 safety net. 어느 한쪽이 빠져도 안전.
4. **Additive-only verifier**. `questionText` 등 기존 args key는 절대 덮어쓰지 않습니다. Drop은 R2/R3/R10에서만 발생.
5. **Mode-wins R8**. Ver2 repair 흐름을 깨지 않기 위해, stage/mode 불일치는 로그만 남기고 action은 건드리지 않습니다.
6. **Fixed rule ordering**. R9(EXPLAIN_PAGE prepend) → R3(budget trim) 순서가 뒤집히면 주입된 설명이 바로 trim되는 버그가 발생합니다. 실행 순서는 코드 주석으로 고정했습니다.

## 검증 결과

- 서버 테스트: **30 / 30 passed** (`npm run test -w apps/server`)
- 서버 TypeScript 빌드: **성공** (`tsc -p tsconfig.json`)
- 웹 빌드: **성공** (Vite)
- Verifier 로그 sink 실동작: 4개 dispatcher 테스트에서 `[verifier] {...}` JSON 라인이 stdout에 출력됨 확인

## Ver3 범위 밖 (의식적으로 남겨둔 것)

- **Ver2 P0#1 zombie state** (`ToolDispatcher.ts` 내 repair 실패 catch 경로가 `activeIntervention`을 정리하지 않는 기존 버그): Ver3 범위 밖. 별도 PR에서 처리 예정. Ver3의 R7 silent upgrade가 이 zombie를 masking할 위험이 있으므로, 해당 PR에서 R6 skip 경로의 intervention 정리 로직을 함께 검토.
- **Turn Evaluator (Phase 3)**: 매 턴 종료 후 `이번 개입이 학생 이해에 얼마나 기여했는가`를 별도 LLM이 평가하는 모듈. Ver3 범위 밖.
- **Concept-level mastery 스키마**: 개념 단위 숙달도 추적. Ver3 범위 밖.
- **Dispatcher 분기 전면 개편**: Ver3은 인라인 verifier 메서드 하나만 추가, 기존 분기 구조는 유지.

## 후속 확장 경로 (Phase 2 예고)

- Qa/Explainer 프롬프트가 `args.hintDirective` 를 **직접** 소비하도록 변경 (LLM path에서 `[힌트만:...]` 프리픽스 제거)
- `EventApiResponse` 에 optional `debug.verifierWarnings` 필드 추가 (현재는 stdout only)
- `neighborText` slice 크기 조정으로 Ver3가 추가한 프롬프트 토큰 상쇄 (~500 토큰 회수 가능)
