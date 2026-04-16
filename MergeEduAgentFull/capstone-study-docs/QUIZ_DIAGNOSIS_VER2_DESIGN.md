# MergeEduAgent Ver2 Quiz Diagnosis Design

- 작성일: `2026-04-15`
- 최종 보강일: `2026-04-16`
- 상태: `구현 반영 + 후속 Ver3/Ver4 레이어 반영`
- 목표: `오답 -> 일반 복습` 흐름을 `오답 -> 원인 진단 -> 맞춤 교정 -> 짧은 재확인` 흐름으로 전환

## 0. 지금 이 문서를 어떻게 읽어야 하는가

이 문서는 원래 Ver2의 핵심 설계 의도를 정리한 문서다.
현재 코드베이스에서는 이 설계가 실제로 구현되었고,
그 위에 Ver3와 Ver4의 상위 레이어가 추가로 붙어 있다.

즉, 현재 구조는 아래처럼 읽는 것이 가장 정확하다.

- Ver2:
  - `QuizDiagnosisService`
  - `activeIntervention`
  - `MisconceptionRepairAgent`
- Ver3:
  - `pedagogyPolicy`
  - `ToolDispatcher` verifier
  - QA follow-up thread
- Ver4:
  - `quizAssessments`
  - `assessmentDigest`
  - 다음 턴 handoff / `CONSUMED` 처리

따라서 이 문서는 `진단/교정 레이어의 중심 설계`를 설명하는 문서로 보면 된다.

## 1. 왜 바꾸는가

현재 시스템은 퀴즈를 잘 만들고 채점도 안정적으로 수행한다.
하지만 낮은 점수가 나오면 주로 아래 흐름으로 간다.

1. 점수 미달 확인
2. 복습 여부 질문
3. 다시 설명 또는 재시험

이 구조는 `틀렸다`는 사실은 잘 잡지만,
`왜 틀렸는지`를 좁혀서 다루는 흐름은 약하다.

Ver2의 핵심은 다음 한 문장이다.

`학생이 틀렸을 때 전체를 다시 설명하기보다, 헷갈린 이유를 먼저 좁히고 그 부분만 교정한다.`

## 2. 구현 원칙

이번 구현은 미래 로드맵의 큰 방향을 따르되,
실시간 학습 시스템에 맞게 가볍게 적용한다.

채택한 원칙:

- 오케스트레이터 한 프롬프트에 모든 판단을 몰아넣지 않는다.
- 매 턴마다 무거운 서브 에이전트를 여러 개 연쇄 호출하지 않는다.
- 상태 추적은 서버에서 얇고 명확하게 한다.
- 교정 설명은 전용 에이전트가 맡는다.
- 기존 설명/QA/퀴즈/채점 구조는 최대한 유지한다.

## 3. 이번 Ver2에서 실제로 추가하는 것

### 3.1 새 상태 레이어

세션에 `activeIntervention` 상태를 추가한다.

이 상태는 지금 학생에게 어떤 교정 개입이 진행 중인지 저장한다.

포함 정보:

- 현재 개입 종류
- 어느 페이지에서 시작된 개입인지
- 어떤 퀴즈에서 시작되었는지
- 최근 점수 비율
- 시스템이 추정한 약점/오개념
- 학생에게 던진 진단 질문
- 지금 학생 응답을 기다리는지 여부

즉, Ver2는 단순히 메시지를 하나 더 보내는 것이 아니라,
`지금은 진단 대기 상태다`를 세션이 기억한다.

중요:

- `activeIntervention`은 `optional` 필드로 추가한다.
- 오래된 세션 JSON은 `JsonStore`에서 안전하게 기본값 보정한다.
- 별도 새 이벤트를 만들지 않고, 이 상태가 살아 있는 동안의 `USER_MESSAGE`를 진단 답변으로 해석한다.

### 3.2 새 서비스: `QuizDiagnosisService`

이 서비스는 퀴즈 오답 결과를 보고
`어떤 부분에서 무너졌는지`를 가볍게 추정한다.

역할:

- 틀린 문항 추출
- 점수 비율 분석
- 반복 오답 여부 확인
- 학생 메모리와 겹치는 약점 확인
- 사용자에게 던질 짧은 진단 질문 생성

이 서비스는 무거운 LLM 분석기가 아니라,
서버에서 빠르게 동작하는 얇은 진단 레이어로 둔다.

### 3.3 새 부분: `MisconceptionRepairAgent`

이 부분은 진단 뒤 실제 교정 설명을 담당한다.

이번 구현에서는 서버 쪽에 `MisconceptionRepairAgent` 래퍼를 추가하고,
교정 지향 입력을 사용해 짧은 repair 설명을 만든다.

입력:

- 현재 페이지 문맥
- 학생 메모리
- 퀴즈 오답 진단 결과
- 학생이 진단 질문에 답한 내용

출력 목표:

- 헷갈린 지점을 짧게 짚기
- 그 부분만 정확히 설명하기
- 전체 강의를 다시 풀지 않기
- 마지막에 빠른 재확인 문장을 붙이기

즉, 기존 `ExplainerAgent`가 전체 설명 담당이라면,
이 agent는 `오개념 교정 전용 설명기` 역할이다.

중요:

- 사용자에게는 새 visible agent 라벨을 노출하지 않는다.
- 교정 메시지는 기존 `EXPLAINER` 메시지 레이어로 전달한다.
- 따라서 웹 위젯/색상 맵을 바꾸지 않고도 검증 가능하다.

## 4. 바뀌는 호출 구조

### 4.1 기존

```text
퀴즈 제출
-> 채점
-> 점수 미달
-> 복습할까요?
-> 설명 또는 재시험
```

### 4.2 Ver2

```text
퀴즈 제출
-> 채점
-> QuizDiagnosisService
-> activeIntervention 저장
-> 학생에게 짧은 진단 질문
-> 학생 답변
-> MisconceptionRepairAgent
-> 맞춤 교정 설명
-> 짧은 재확인 또는 재시험
```

여기서 학생 답변은 새 이벤트가 아니라 일반 `USER_MESSAGE`로 들어온다.
단, `activeIntervention.stage == AWAITING_DIAGNOSIS_REPLY` 인 동안에는
이 메시지를 일반 자유 질문보다 우선적으로 진단 답변으로 해석한다.

## 5. 사용자 시나리오

### 시나리오 A: 학생이 개념 적용 이유를 헷갈린 경우

현재:

```text
학생 오답
-> "점수가 기준 미달입니다. 복습을 진행할까요?"
-> 전체 복습
```

Ver2:

```text
학생 오답
-> "공식은 기억나는데 왜 그렇게 적용하는지가 헷갈린 것 같아요."
-> "공식 자체가 낯선가요, 아니면 적용 이유가 헷갈린가요?"
-> 학생 답변
-> 해당 부분만 짧게 교정 설명
-> 같은 개념 재확인
```

### 시나리오 B: 학생이 같은 유형을 반복해서 틀리는 경우

현재:

```text
반복 오답
-> 다시 복습
-> 다시 퀴즈
```

Ver2:

```text
반복 오답
-> 이전 약점 메모와 현재 오답을 함께 봄
-> "이 개념을 계속 헷갈리고 있다"는 개입 상태 생성
-> 오개념 교정 중심 설명
-> 재시험 전에 핵심 개념만 다시 확인
```

### 시나리오 C: 이후 자유 질문과 설명에도 영향이 가는 경우

현재:

```text
오답 이후 약간 더 자세히 설명할 수는 있음
```

Ver2:

```text
오답 진단 후 memory 갱신
-> 이후 EXPLAIN_PAGE가 더 쉬운 예시/단계 분해 사용
-> 이후 QA가 같은 약점을 피드백에 반영
-> 이후 QUIZ가 약점 개념을 더 자주 점검
```

즉, Ver2는 퀴즈 한 번만 바꾸는 것이 아니라
그 결과를 이후 설명/질문/퀴즈에 다시 반영한다.

## 6. 기술적으로 어디가 바뀌는가

### 6.1 서버 타입/상태

변경 대상:

- `apps/server/src/types/domain.ts`
- `apps/server/src/services/storage/JsonStore.ts`
- `apps/web/src/types.ts`
- `apps/web/src/api/endpoints.ts`

변경 내용:

- 세션에 optional `activeIntervention` 추가
- 오래된 세션 JSON도 안전하게 로드되도록 기본값 보정
- 웹은 이 필드를 렌더링하지 않더라도 shared type만 동기화한다.

### 6.2 오답 진단 서비스 추가

추가 대상:

- `apps/server/src/services/engine/QuizDiagnosisService.ts`

변경 내용:

- 자동 채점 또는 서술형 채점 결과를 바탕으로
  진단 질문, 약점 후보, 오개념 후보를 생성

### 6.3 교정 에이전트 추가

추가 대상:

- `apps/server/src/services/agents/MisconceptionRepairAgent.ts`

변경 내용:

- 진단 상태와 학생 답변을 합쳐 교정 지향 입력 생성
- 교정 설명 뒤 재확인 위젯으로 연결

### 6.4 오케스트레이터 흐름 보강

변경 대상:

- `apps/server/src/services/agents/Orchestrator.ts`
- `apps/server/src/types/orchestrator.ts`
- `apps/server/src/types/guards.ts`

변경 내용:

- activeIntervention이 있으면 일반 QA보다 교정 플로우를 우선
- 새 tool `REPAIR_MISCONCEPTION` 추가
- 프롬프트에 현재 개입 상태를 반영

중요:

- 새 tool은 서버 내부 실행용이다.
- `ToolName`, `orchestratorPlanSchema`, dispatcher는 같은 변경에서 함께 갱신한다.
- UI 위젯이나 새 사용자 이벤트는 추가하지 않는다.

## 7. 후속 버전에서 실제로 덧붙은 상위 레이어

Ver2 구현 이후 현재 시스템에는 아래 상위 레이어가 추가되었다.

### 7.1 Ver3: pedagogy policy와 verifier

현재는 진단/교정 루프도 그냥 실행되지 않는다.

- 오케스트레이터가 먼저 `pedagogyPolicy`를 결정한다.
- `ToolDispatcher` verifier가 policy와 actions의 일관성을 다시 검사한다.
- `MISCONCEPTION_REPAIR` 모드일 때는 repair action을 보정 주입할 수도 있다.

즉, Ver2의 diagnosis/repair는 이제 더 큰 교수정책 프레임 안에서 실행된다.

### 7.2 Ver3: QA follow-up thread

현재 시스템은 같은 페이지 follow-up 질문을 `qaThread`로 압축 유지한다.

- 자유 질문과 진단 답변은 서로 다른 흐름으로 다뤄진다.
- activeIntervention이 열려 있으면 진단 답변이 일반 QA보다 우선한다.
- 일반 QA는 필요 시 `FOLLOW_UP` 모드로 같은 페이지 문맥만 이어받는다.

### 7.3 Ver4: assessment artifact와 next-turn handoff

현재 저득점 채점은 진단/교정으로만 끝나지 않는다.

- grading 직후 `quizAssessments`에 assessment artifact 저장
- 다음 orchestration turn에서 `assessmentDigest`로 handoff
- handoff가 끝난 assessment는 `CONSUMED` 처리

중요:

- assessment는 repair를 대체하지 않는다.
- repair는 `왜 틀렸는지`를 좁혀 즉시 교정하는 레이어다.
- assessment는 `다음 턴 personalization에 무엇을 남길지`를 위한 레이어다.

### 7.4 저장 보호

현재 `/session/:sessionId/save`는 클라이언트가 보낸 state를 세션에 merge하지 않는다.
즉, `activeIntervention`, `quizAssessments`, `qaThread` 같은 server-owned 상태는
브라우저 저장 요청으로 덮어써지지 않는다.

## 8. 결론

Ver2의 핵심은 여전히 아래 한 줄로 요약된다.

`오답을 맞춤 교정 흐름으로 전환한다.`

다만 현재 코드베이스에서 이 설계는 단독 기능이 아니라,

- `pedagogyPolicy`
- `verifier`
- `qaThread`
- `assessmentDigest`
- save-route 보호

위 레이어와 함께 통합된 상태로 동작한다.

즉, 지금의 MergeEduAgent에서 quiz diagnosis는
`저득점 직후의 얇은 오답 원인 좁히기 + 맞춤 교정의 중심 레이어`
로 이해하는 것이 가장 정확하다.
