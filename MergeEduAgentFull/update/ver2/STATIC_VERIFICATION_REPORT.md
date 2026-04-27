# Ver2 정적 검증 최종 보고서

- 작성일: `2026-04-15`
- 대상: `Quiz Diagnosis Ver2`
- 방식: `코드 수정 없이, 5개 서브 에이전트가 독립적으로 문서와 소스를 읽고 PASS/FAIL 판정`
- 관련 문서:
  - [UPDATE_NOTE.md](UPDATE_NOTE.md)
  - [IMPROVEMENT_NOTE.md](IMPROVEMENT_NOTE.md)
  - [QUIZ_DIAGNOSIS_VER2_DESIGN.md](../../capstone-study-docs/QUIZ_DIAGNOSIS_VER2_DESIGN.md)

---

## 0. 한 장 요약

| 항목 | 결과 |
|---|---|
| 전체 판정 | **조건부 PASS** (`4 PASS / 1 FAIL`) |
| 기능 흐름(오답 → 진단 → 교정 → 재확인) 실제 구현 | **동작함** |
| UPDATE_NOTE가 약속한 것과 코드의 일치 | **일치함** |
| 새 프런트 위젯 / 새 Python 엔드포인트 없음 약속 | **지켜짐** |
| 발견된 리스크 | **activeIntervention이 일부 경로에서 "좀비 상태"로 남을 수 있음** |
| 테스트 방어막 | **최소 수준 — 확장 필요** (IMPROVEMENT_NOTE 9와 일치) |

한 줄로:

> **"Ver2는 의도대로 동작한다. 다만 오류 경로에서 진단 상태가 정리되지 않는 가장자리 케이스 2개와, 그것을 잡아줄 통합 테스트가 부족하다."**

---

## 1. 검증 방법

동시에 5개의 서브 에이전트를 띄워, 각자 서로 다른 영역만 읽고 독립적으로 판정했다. 코드는 아무도 수정하지 않았다.

| # | 서브 에이전트 스코프 | 주요 검토 파일 |
|---|---|---|
| 1 | 상태 계약 & 도메인 타입 | `domain.ts`, `guards.ts`, `StateReducer.ts`, `JsonStore.ts` |
| 2 | 진단 생성 로직 | `QuizDiagnosisService.ts`, 호출부 (`ToolDispatcher`, `OrchestrationEngine`) |
| 3 | Dispatcher + Orchestrator 흐름 | `ToolDispatcher.ts`, `Orchestrator.ts`, `OrchestrationEngine.ts` |
| 4 | 교정 에이전트 & 브리지 재사용 | `MisconceptionRepairAgent.ts`, `QaAgent.ts`, `apps/ai-bridge/`, `apps/web/` |
| 5 | 문서↔코드 일치 & 테스트 커버리지 | `*.test.ts`, 프런트 / 브리지 전수 점검, UPDATE_NOTE 주장 검증 |

---

## 2. 각 에이전트의 판정 요약

### 에이전트 #1 — State 계약 & 도메인 타입 → `FAIL`

**좋은 점**

- `ActiveIntervention` 타입이 UPDATE_NOTE가 말한 모든 필드를 포함해 깔끔하게 정의됨 ([domain.ts:212-224](../../apps/server/src/types/domain.ts)).
- `StateReducer`가 페이지 전환 / 재시험 결정 / 다음 페이지 / 복습 결정 / 설명 재시작 등에서 `clearActiveIntervention()`을 호출해 정리함 ([StateReducer.ts:9-11, 39, 61, 76, 108, 130, 138](../../apps/server/src/services/engine/StateReducer.ts)).
- API patch 계약(`EventApiResponse.patch.activeIntervention`)이 프런트와 일관되게 `ActiveIntervention | null` 형태로 노출됨.
- 레거시 세션 JSON 로딩 시 `activeIntervention` 필드가 없으면 `null`로 보정 ([JsonStore.ts:289-291](../../apps/server/src/services/storage/JsonStore.ts)).

**문제 (FAIL 사유)**

1. **교정 실패 경로에서 상태가 안 지워짐.**
   `REPAIR_MISCONCEPTION` 실행 중 검증에 실패하면 에러 메시지만 붙고 `activeIntervention`은 그대로 남는다 ([ToolDispatcher.ts:387-392](../../apps/server/src/services/engine/ToolDispatcher.ts)).
   → 결과적으로 학생은 영원히 `AWAITING_DIAGNOSIS_REPLY` 같은 상태에 묶일 수 있다.

2. **`REPAIR_DELIVERED` 상태의 수명이 모호.**
   교정이 끝난 뒤(`stage = REPAIR_DELIVERED`) 학생이 아무 질문이나 던져도, 그 일반 `USER_MESSAGE`는 intervention을 치우지 않는다. 치워지는 조건은 명시적 `REVIEW_DECISION` / `RETEST_DECISION` / 페이지 변경뿐이다.
   → "이미 교정 끝난 intervention"이 한참 뒤 대화에까지 끌려갈 수 있다.

**권고**

- `ToolDispatcher.ts:387-392`에서 에러 처리 직전에 `state.activeIntervention = null;` 추가.
- `StateReducer`에서 `REPAIR_DELIVERED` 상태인 intervention은 다음 일반 `USER_MESSAGE`에 한해 정리하거나, 유지할 거면 근거를 주석으로 남기기.
- 두 경로 모두에 대해 통합 테스트 추가.

---

### 에이전트 #2 — `QuizDiagnosisService` 진단 로직 → `PASS`

- UPDATE_NOTE가 주장한 4개 신호를 **모두 실제로** 수집한다:
  - 틀린 문항 추출 → `wrongItemsOf()` ([QuizDiagnosisService.ts:179-185](../../apps/server/src/services/engine/QuizDiagnosisService.ts))
  - 점수 비율 → `grading.scoreRatio`
  - 같은 페이지 최근 저득점 이력 → `recentRepeatCount()` (`createdFromPage` + `scoreRatio < 0.6`)
  - 기존 메모리 약점 오버랩 → `focusConceptsFromPrompts()`가 prompt 토큰과 `memory.weaknesses` 매칭
- 진단 질문은 **하드코딩이 아님**: `buildDiagnosticPrompt()`가 "반복 오답인지 / 점수가 매우 낮은지 / 그 외"에 따라 문구가 갈라짐.
- 엣지 케이스 처리됨: 채점 전 / 100% 정답 / 틀린 문항 0개 → 전부 `null`을 반환해 intervention 생성 안 함.
- 임계값: `appConfig.passScoreRatio` (환경변수 `PASS_SCORE_RATIO`)로 외부화되어 있어 타당.
- **출력 shape**가 `domain.ts`의 `ActiveIntervention` 필드와 1:1로 매칭되어 ToolDispatcher가 그대로 소비.
- **남은 숙제**: 아직 concept-tag 기반이 아니라 "페이지 + prompt 토큰" 기반 — 이는 IMPROVEMENT_NOTE 1, 2항목과 일치한다.

---

### 에이전트 #3 — ToolDispatcher + Orchestrator 흐름 → `PASS`

- 저득점 시 구(舊) `복습할까요?` 분기로 **곧장 가지 않는다.** `createQuizRepairIntervention()`이 `null`이 아니면 진단 질문을 먼저 보낸다 ([ToolDispatcher.ts:552-577](../../apps/server/src/services/engine/ToolDispatcher.ts)).
- 서술형 경로(`GRADE_SHORT_OR_ESSAY`) 역시 객관식과 동일한 로직으로 처리됨 ([ToolDispatcher.ts:636-661](../../apps/server/src/services/engine/ToolDispatcher.ts)).
- `Orchestrator`의 `USER_MESSAGE` 라우팅이 **일반 QA보다 먼저** `activeIntervention.stage === "AWAITING_DIAGNOSIS_REPLY"`를 체크하고, 맞으면 `REPAIR_MISCONCEPTION`을 실행한 뒤 조기 return한다 ([Orchestrator.ts:452-461](../../apps/server/src/services/agents/Orchestrator.ts)).
- 교정 직후에는 `BINARY_CHOICE` 형태의 재시험 권유 위젯이 붙는다 ([ToolDispatcher.ts:443-450](../../apps/server/src/services/engine/ToolDispatcher.ts)).
- 저득점 통과(스코어가 통과 임계 이상)면 intervention을 `null`로 직접 비움 ([ToolDispatcher.ts:576, 660](../../apps/server/src/services/engine/ToolDispatcher.ts)).

UPDATE_NOTE가 설명한 흐름과 **코드의 실제 분기**가 정확히 일치한다.

---

### 에이전트 #4 — `MisconceptionRepairAgent` & 브리지 재사용 → `PASS`

- `MisconceptionRepairAgent`가 실제로 `bridge.answerQuestionStream()`을 감싸는 얇은 래퍼임 ([MisconceptionRepairAgent.ts:20-37](../../apps/server/src/services/agents/MisconceptionRepairAgent.ts)). 즉 **기존 QA 브리지 재사용이 사실**.
- `apps/ai-bridge/main.py`를 전수 점검한 결과 `/repair`, `/diagnosis`, `/misconception` 같은 **새 엔드포인트는 없다**. 엔드포인트는 전부 기존 것.
- 교정용 질문은 `buildRepairQuestion()`에서 "짧게, 전체 재설명 금지, 4~6문장 제한" 규율이 명시됨 ([QuizDiagnosisService.ts:258-273](../../apps/server/src/services/engine/QuizDiagnosisService.ts)).
- 교정이 끝나면 `buildRepairMemoryWrite` → `applyLearnerMemoryWrite()`로 약점이 `state.integratedMemory`와 `learnerModel.weakConcepts`에 병합됨 ([LearnerMemoryService.ts:46-89](../../apps/server/src/services/engine/LearnerMemoryService.ts)).
- `apps/web/src/components/`에 `intervention`, `diagnosis`, `repair`라는 이름을 쓴 **새 UI 컴포넌트는 없다.** 기존 `BinaryChoice` 위젯이 재시험 권유를 그대로 재활용한다. → "새 위젯 없음" 약속 지켜짐.
- 브리지 응답이 비면 `"헷갈린 부분을 다시 짧게 정리했습니다."` 폴백 문자열을 내보내 UI가 빈 말풍선이 되지 않게 함.

---

### 에이전트 #5 — 문서↔코드 일치 & 테스트 커버리지 → `PASS` (경고 포함)

- UPDATE_NOTE가 지목한 **핵심 파일 6개 전부 실존**(`QuizDiagnosisService.ts`, `MisconceptionRepairAgent.ts`, `ToolDispatcher.ts`, `Orchestrator.ts`, `StateReducer.ts`, `domain.ts`).
- `apps/server`의 테스트 파일 7개, 케이스 합계 약 32개 — UPDATE_NOTE의 "30 passed" 주장과 정합.
- Ver2 관련 전용 테스트는 소수 존재:
  - `quizDiagnosisService.test.ts` — 진단 생성 자체
  - `toolDispatcher.test.ts` — "저점수 시 진단-우선 흐름" / "학습자 답변 후 교정 + 집중 메모리 저장"
  - `orchestratorFlow.test.ts` — intervention이 포함된 세션 mock
- 프런트: `apps/web` 어디에도 교정용 신규 컴포넌트가 없고, `activeIntervention`은 타입/엔드포인트/세션 merge 정도에만 등장 → 순수 상태 병합이지 UI 전용 로직 아님.
- 브리지: `apps/ai-bridge/main.py`의 POST 엔드포인트는 전부 기존 것 (`upload_pdf`, `explain_page`, `answer_question`, `generate_quiz`, `grade_quiz`, `analyze_student_report`, `analyze_student_report_stream`) — 새 엔드포인트 0개.
- **경고**: 전체 end-to-end handoff(저점수 → intervention 생성 → patch 반영 → 다음 `USER_MESSAGE` → repair 실행 → 메모리 저장)를 한 줄로 관통하는 통합 테스트는 **부재**. IMPROVEMENT_NOTE 9항의 지적이 정당함.

---

## 3. 종합 판정

| 영역 | 판정 | 핵심 이유 |
|---|---|---|
| 상태 계약 & 타입 | **FAIL** | 교정 실패 경로, `REPAIR_DELIVERED` 수명 모호 |
| 진단 로직 | PASS | 4개 신호 수집 + 엣지 케이스 안전 |
| 오케스트레이션 흐름 | PASS | 구 `복습할까요?` 분기 차단 + 진단 우선 라우팅 |
| 교정 에이전트 / 브리지 재사용 | PASS | 기존 QA 브리지 래핑, 새 엔드포인트/위젯 없음 |
| 문서↔코드 / 테스트 | PASS (경고) | 주장 일치, 통합 테스트 부족 |

**최종 판정: 조건부 PASS**

Ver2의 **행위(behavior) 계약은 의도대로 구현되어 있다.**
다만 상태(state) 계약의 **"예외/오류 경로"** 두 곳에서 `activeIntervention`이 정리되지 않는 리스크가 있고, 이 리스크를 회귀에서 막아줄 **통합 테스트가 비어 있다.**

---

## 4. 실제 서비스 투입 전 권장 조치 (우선순위)

### P0 — 가드레일 (바로 반영 권장)

1. **교정 실패 시 intervention 정리.**
   `ToolDispatcher.ts:387-392` 에러 경로에서 `state.activeIntervention = null` (또는 StateReducer 경유의 clear 이벤트) 처리.

2. **`REPAIR_DELIVERED` 수명 정책 명시.**
   "다음 일반 `USER_MESSAGE`에 자동 해제" 또는 "유지하되 만료 timestamp 기반 정리" 중 하나 선택 후 주석으로 문서화.

### P1 — 테스트 방어막 확장 (IMPROVEMENT_NOTE 9와 동일)

3. 오케스트레이션 엔진 레벨 **통합 테스트** 1개 이상:
   `저득점 → intervention 생성 → patch 반영 → 다음 USER_MESSAGE → repair 실행 → 메모리 저장`까지 한 번에 관통.
4. 서술형 채점(`GRADE_SHORT_OR_ESSAY`) 저득점 → 진단 진입 테스트.
5. `PAGE_CHANGED`, `NEXT_PAGE_DECISION`, `REVIEW_DECISION`, `RETEST_DECISION`에서 **intervention cleanup** 테스트 확장.
6. 레거시 세션 JSON (필드 부재) 로드 테스트.

### P2 — 품질 개선 (IMPROVEMENT_NOTE 1~6과 동일)

7. concept-tag 기반 진단 보강.
8. 반복 오답 추적을 page → concept 단위로 확장.
9. 메모리 `confidence` / `provenance` / `decay` 도입.
10. 진단 상태 UI 가시성 (배지, 안내 문구) 보강.
11. 운영 지표(diagnosis 진입률, 교정 후 재시험 성공률 등) 계측.

---

## 5. 결론 (누구나 이해하기 쉽게)

Ver2는 **"학생이 퀴즈를 틀리면 바로 전체 복습을 강요하지 않고, 어디가 헷갈렸는지부터 짧게 짚고 그 부분만 고쳐준다"** 라는 의도를 문서대로 구현했다.

- 설계가 말한 **진단 → 교정 → 재확인** 흐름은 코드에서 실제로 작동한다.
- 약속한 **"새 위젯/새 Python 엔드포인트 없음"** 도 지켜졌다.
- 다만 **오류가 났거나 교정이 끝난 뒤의 뒷정리**가 한두 군데 느슨해서, 드물지만 학생이 엉뚱하게 "진단 응답 대기 중" 상태에 갇힐 수 있다.
- 그리고 지금 테스트는 **"각 부품이 혼자서는 잘 돈다"** 까지만 보장한다. **"다섯 부품이 합쳐졌을 때도 잘 돈다"** 를 막아주는 통합 테스트는 아직 부족하다.

즉, **"지금 배포해도 대부분 시나리오는 문제가 없다. 다만 위의 P0 2건은 고치고, P1 통합 테스트는 바로 이어서 추가하자."** 가 이번 정적 검증의 결론이다.
