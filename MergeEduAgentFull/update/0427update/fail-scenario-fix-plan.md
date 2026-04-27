# 0427 FAIL 시나리오 수정 계획

## 대상 범위

명확히 `FAIL`로 기록된 3개 시나리오를 1차 수정 대상으로 한다. 추가로 `PARTIAL` 중 실제 표시 불일치가 기록된 E-03을 near-fail 보정 대상으로 포함한다.

- A-04 이메일 중복 및 대소문자 정규화
- D-03 설명 요청 중 `다음 페이지` 문맥 오분류
- D-08 단답형/서술형 퀴즈 공백 답안 채점 상태 오류
- E-03 학생 리포트 카드 완료 페이지 지표 불일치

`BLOCKED`는 파괴적 삭제 확인이 필요한 테스트라 이번 구현 대상에서 제외한다. `PARTIAL`과 `PENDING` 대부분은 미검증/장기 검증 항목이므로, 실제 코드/표시 불일치가 확인된 E-03만 함께 수정한다.

## 문제 재정의

### A-04

이미 존재하는 이메일을 공백/대소문자만 바꿔 가입하면 저장소에서 중복을 감지하지만 일반 `Error`가 라우터까지 올라가 `500 Email already exists`로 보인다. 사용자는 중복 가입 안내를 받아야 하고 내부 오류 표현은 노출되면 안 된다.

### D-03

`USER_MESSAGE` 처리에서 `다음 페이지` 문자열만 있으면 즉시 페이지 이동으로 판단한다. `답변 중 내가 다음 페이지를 누를 수도 있어`처럼 설명 요청 문맥에 포함된 표현도 이동 명령으로 오인한다.

### D-08

새 단답형 퀴즈 모달이 열릴 때 기존 채점 기록이 연결되어 빈 입력 상태인데도 `총점 100/100`, `채점 완료`가 표시된다. 서버가 LLM이 준 `quizId`를 그대로 사용해 중복 id가 생길 수 있고, 프론트는 중복 id가 있을 때 첫 번째 기록을 선택한다.

### E-03

학생 리포트 카드의 `완료 페이지`가 세션 본문/데이터의 실제 진도보다 낮게 표시된다. 리포트 집계의 `completedPageCount`는 분석용으로 `pageStates.status !== "NEW"` 개수를 의미하지만, 카드에서는 사용자가 기대하는 현재 진도처럼 보인다. 분석용 완료 페이지와 표시용 진도 페이지가 같은 필드에 섞인 것이 문제다.

## 변경 대상

- `apps/server/src/services/auth/AuthService.ts`
- `apps/server/src/services/engine/StateReducer.ts`
- `apps/server/src/services/agents/Orchestrator.ts`
- `apps/server/src/services/engine/OrchestrationEngine.ts`
- `apps/server/src/services/engine/ToolDispatcher.ts`
- `apps/web/src/routes/Session.tsx`
- 서버 테스트: `authFlow.test.ts`, `stateReducer.test.ts`, `orchestratorFlow.test.ts`, `toolDispatcher.test.ts`

## 구현 순서

1. 가입 전 `AuthService.register`에서 `getUserByEmail(emailNormalized)` 선조회 후 `409 EMAIL_ALREADY_EXISTS`를 던진다.
2. `createUser` 중복 일반 오류도 `AuthService.register`에서 `409 EMAIL_ALREADY_EXISTS`로 감싸 동시 가입 race를 막는다.
3. 페이지 이동 의도 판별을 서버 공통 유틸로 분리하고, 명령형/짧은 발화만 이동으로 인정한다.
4. `StateReducer`, `Orchestrator` fallback, 웹 optimistic page 이동 판별이 같은 fixture 기준을 따르도록 맞춘다.
5. LLM plan 성공 경로도 `OrchestrationEngine`에서 하드 가드한다. 비명령 USER_MESSAGE에서는 `SET_CURRENT_PAGE`를 제거하고 page-scoped action을 현재 페이지로 보정한다.
6. 퀴즈 생성 시 기존 session 내 `quizId`와 충돌하거나 빈 id면 서버에서 loop로 새 unique id를 부여한다.
7. 프론트의 `currentQuizRecord`와 제출/patch 조회는 최신 매칭 기록을 고르고, active quiz와 타입이 다른 기록은 연결하지 않는다.
8. 리포트 집계에는 분석용 `completedPageCount/pageCoverageRatio`를 그대로 유지하고, 표시용 `progressPageCount/progressCoverageRatio`를 별도로 추가한다. 표시용 값은 `max(touchedPageCount, currentPage)`를 강의 페이지 범위 안에서 사용한다.
9. 관련 단위 테스트를 추가/갱신한다.
10. Comet에서 A-04, D-03, D-08, E-03 시나리오를 직접 재현해 PASS 여부를 문서에 기록한다.

## 리스크와 대응

- 페이지 이동 명령을 너무 좁게 보면 실제 `다음 페이지로 넘어가 주세요`가 동작하지 않을 수 있다. 대표 명령형 문장은 테스트로 고정한다.
- LLM이 동일 `quizId`를 계속 반환해도 서버에서 session-scoped unique id를 보장한다.
- 기존 중복 quiz id 데이터가 있어도 프론트에서 최신 기록을 우선 선택해 새 모달 표시 오류를 줄인다.
- 리포트 분석용 완료 페이지는 기존 의미를 유지한다. 카드 UI는 새 표시용 진도 필드를 사용해 현재 UI 문구(`~N페이지까지 진행`)와 맞춘다. 페이지별 상세 상태가 더 많이 쌓인 경우는 표시용 진도도 그 값을 보존한다.

## 검증 전략

- 서버 단위 테스트로 중복 이메일 409, createUser race fallback 409, 페이지 의도 분류, LLM plan navigation guard, 퀴즈 id 충돌 방지를 확인한다.
- 웹 helper/route 테스트로 최신+타입 일치 quiz record 선택을 확인한다.
- 학생 리포트 테스트로 `completedPageCount`는 기존 touched pages 기준을 유지하고, `progressPageCount/progressCoverageRatio`만 실제 진도 기준으로 계산되는지 확인한다. `touchedPageCount > currentPage`, `currentPage > numPages`, no-session 케이스도 경계로 고정한다.
- 웹 빌드로 타입 오류를 확인한다.
- Comet에서 실제 사용자 흐름으로 가입 중복, 설명 요청, 단답형 퀴즈 모달, 리포트 카드 지표를 확인한다.
