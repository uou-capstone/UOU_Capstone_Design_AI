# 0427 FAIL 시나리오 수정 디자인

## 목표

0427 안전성 시나리오 중 실제 `FAIL`인 3개 항목과, `PARTIAL` 중 실제 표시 불일치가 확인된 E-03을 사용자 기준으로 통과시키는 것이 목표다.

- 중복 이메일 가입은 내부 오류가 아니라 명확한 409 응답으로 처리한다.
- `다음 페이지`라는 단어가 포함되어도 실제 명령이 아니면 페이지가 이동하지 않는다.
- 단답형/서술형 퀴즈는 학생이 답안을 입력하고 채점하기 전까지 채점 완료 상태가 되지 않는다.
- 학생 리포트 카드의 진도 지표는 세션 실제 진도와 일치하되, 분석용 페이지 커버리지 의미는 유지한다.

## 비목표

- `BLOCKED` 삭제 시나리오의 파괴적 동작을 자동 수행하지 않는다.
- AI 프롬프트 품질 자체나 Gemini 내부 채점 기준은 바꾸지 않는다.
- 학생 역량 리포트 Gemini 분석 프롬프트/평가 알고리즘 자체는 수정하지 않는다.

## 현재 구조 요약

### 가입

`AuthService.register`는 이메일 정규화와 입력값 검증 후 `store.createUser`를 호출한다. `JsonStore.createUser`는 중복 이메일이면 일반 `Error("Email already exists")`를 던진다. 라우터의 `handleAuthError`는 `AuthError`만 4xx/409로 변환한다.

### 페이지 이동 의도

`StateReducer`와 `Orchestrator`에 각각 `isNextPageCommand` 정규식이 있다. 현재 정규식은 `다음 페이지` 포함 여부만 보므로 문맥 구분이 없다. 웹 `SessionRoute`도 optimistic page 이동에 별도 정규식을 사용한다.

### 퀴즈 채점 표시

서버 `ToolDispatcher`는 LLM이 반환한 `quiz.quizId`를 그대로 `QuizRecord.id`로 쓴다. 프론트 `SessionRoute.currentQuizRecord`는 `session.quizzes.find(q => q.id === activeQuiz.quizId)`로 첫 번째 기록을 고른다. 같은 id의 기존 graded record가 있으면 새 단답형 모달에 이전 grading이 붙는다.

### 리포트 완료 페이지 표시

`StudentCompetencyReportService.aggregateClassroomSource`는 `completedPageCount`를 `session.pageStates.filter(status !== "NEW").length`로 계산한다. 이 값은 분석용 페이지 커버리지로는 의미가 있지만, 카드의 `완료 페이지` 문구는 사용자가 현재 진도처럼 읽기 쉽다. 세션 화면의 진도는 `session.currentPage` 기반이며, 리포트 본문도 `진도 currentPage/numPages페이지`를 쓴다. 따라서 pageStates가 덜 채워진 학생은 카드에서만 낮은 진도로 보일 수 있다.

## 제안 구조

### 1. 사용자 친화적 중복 이메일 오류

`AuthService.register`에서 `emailNormalized` 검증 직후 기존 유저를 조회한다.

```ts
const existing = await this.store.getUserByEmail(emailNormalized);
if (existing) {
  throw new AuthError("이미 가입된 이메일입니다. 로그인하거나 이메일 인증을 진행해 주세요.", 409, "EMAIL_ALREADY_EXISTS");
}
```

저장소의 중복 방어는 경쟁 상태 대비용으로 유지한다. `createUser`에서 발생한 `Error("Email already exists")`도 반드시 `AuthService.register`에서 `AuthError(409, "EMAIL_ALREADY_EXISTS")`로 변환한다. 선조회는 사용자 경험을 빠르게 개선하고, 저장소 오류 wrapping은 동시 가입 race에서도 500이 새지 않게 하는 최종 방어선이다.

### 2. 페이지 이동 명령 분류 안정화

서버에 `PageCommandIntent` 유틸을 추가한다.

- `isNextPageCommand(text)`
- `isPreviousPageCommand(text)`

인정할 패턴:

- `다음 페이지`, `다음 페이지로`, `다음으로`, `넘어가 주세요`, `next page`처럼 짧고 명령형인 발화
- `다음 페이지로 넘어가 주세요`, `다음 페이지 보여줘`, `next page please`

차단할 패턴:

- `누를 수도`, `누르면`, `클릭하면`, `이동하면`, `넘어가면`
- `어떻게`, `뭐가`, `설명`, `답변 중`, `수도`
- 물음표 또는 조건/가정 문장

이 유틸을 `StateReducer`와 `Orchestrator`에서 같이 사용한다. 웹 optimistic 이동도 같은 의미의 로컬 함수로 맞춘다. 서버 유틸을 웹에서 직접 공유하지 않고 동일 규칙을 작게 복제한다. 현재 workspace는 server/web 분리라 cross package import를 늘리지 않는 편이 안전하다.

LLM 오케스트레이션 성공 경로도 별도로 잠근다. 실제 운영에서는 fallback보다 `planWithLlm`이 먼저 쓰이므로, `OrchestrationEngine`에서 `normalizePlan(rawPlan)` 직후 다음 하드 가드를 적용한다.

- 이벤트가 `USER_MESSAGE`이고 텍스트가 명령형 next/previous intent가 아니면 `SET_CURRENT_PAGE` action을 제거한다.
- 같은 조건에서 `EXPLAIN_PAGE`, `ANSWER_QUESTION`, `GENERATE_QUIZ_*`의 `page` 인자가 현재 페이지가 아니면 현재 페이지로 보정한다.
- 명령형 next intent는 reducer가 이미 현재 페이지를 한 칸 올린 상태를 기준으로 허용한다.
- previous intent는 fallback/LLM의 `SET_CURRENT_PAGE`를 허용하되, 웹 optimistic 이동 규칙도 동일하게 둔다.

이 가드는 LLM 프롬프트 품질과 별개로 잘못된 이동 도구 실행을 막는 마지막 방어선이다.

### 3. 퀴즈 id 충돌 방지와 최신 기록 선택

서버 `ToolDispatcher`의 `GENERATE_QUIZ_*` 처리에서 `state.quizzes` 안에 같은 id가 이미 있거나, LLM이 빈 id를 반환하면 새 id를 만든다. 새 id도 기존 id와 충돌하지 않도록 loop로 확인한다.

```ts
const uniqueQuiz =
  state.quizzes.some(q => q.id === generated.quiz.quizId)
    ? { ...generated.quiz, quizId: makeId("quiz") }
    : generated.quiz;
```

그 다음 `QuizRecord.id`, `quizJson.quizId`, `ui.quiz.quizId`, `pageState.quiz.lastQuizId`를 모두 동일한 unique id로 저장한다.

프론트 `currentQuizRecord`는 다음 조건으로 최신 기록을 고른다.

- 뒤에서부터 탐색한다.
- `id === activeQuiz.quizId`
- `quizType === activeQuiz.quizType`

기존 중복 데이터가 있어도 새로 열린 퀴즈와 다른 타입/오래된 기록이 연결되지 않는다.

기존 중복 데이터 호환성을 위해 제출/패치 조회도 최신 기록 기준으로 맞춘다.

- 웹 `SessionRoute`에서 `quizSubmitPage` 조회는 뒤에서부터 탐색한다.
- 서버 `ToolDispatcher`의 `GRADE_SHORT_OR_ESSAY` 조회는 뒤에서부터 탐색한다.
- 서버 `OrchestrationEngine`의 `QUIZ_SUBMITTED` patch record 조회도 뒤에서부터 탐색한다.

### 4. 리포트 카드 진도 지표 정합성

분석용 `completedPageCount/pageCoverageRatio`는 기존처럼 `touchedPageCount` 기준으로 유지한다. 대신 표시용 통계를 새로 추가한다.

```ts
const touchedPageCount = session.pageStates.filter(pageState => pageState.status !== "NEW").length;
const currentPageProgress = Math.max(0, Math.min(lecture.pdf.numPages, session.currentPage));
const progressPageCountForLecture = Math.max(touchedPageCount, currentPageProgress);
```

세션이 없으면 0으로 유지한다. 페이지 상태가 실제 currentPage보다 더 많이 존재하는 기존 데이터는 표시용 진도에서도 `touchedPageCount`가 유지된다.

`StudentReportSourceStats`에 optional 호환 필드를 추가한다.

- `progressPageCount?: number`
- `progressCoverageRatio?: number`

새로 생성되는 리포트에는 두 필드를 항상 채운다. 기존 저장 리포트에는 필드가 없을 수 있으므로 guard와 웹 포맷터는 optional을 허용하고, 없으면 기존 `completedPageCount/pageCoverageRatio`로 fallback한다.

기존 저장 리포트도 재분석 없이 카드가 보정되도록, 학생 목록 API는 저장된 `sourceStats`를 응답하기 전에 현재 세션에서 표시용 `progressPageCount/progressCoverageRatio`를 계산해 덧붙인다. 이 read-time enrichment는 저장된 분석용 `completedPageCount/pageCoverageRatio`를 바꾸지 않는다.

프론트 `ClassroomReport.tsx`에서는 카드 라벨을 `완료 페이지`에서 `진도`로 바꾸고, `formatPageProgress`는 `progressPageCount/progressCoverageRatio`를 우선 사용한다. 리포트 상세의 `페이지 커버리지`와 분석 점수는 기존 `pageCoverageRatio`를 유지한다.

## 실패 시나리오별 Before / After

### A-04

- Before: 중복 이메일 가입 → 500 `Email already exists`
- After: 중복 이메일 가입 → 409 `EMAIL_ALREADY_EXISTS`, 사용자 친화 문구

### D-03

- Before: `답변 중 내가 다음 페이지를 누를 수도 있어` → 5페이지로 이동
- After: 같은 문장 → 현재 페이지 설명/QA로 처리, 페이지 유지

### D-08

- Before: 단답형 모달이 빈 답안 상태에서 `총점 100/100`, `채점 완료`
- After: 단답형 모달은 빈 입력 상태로 열리고 `채점하기`는 비활성, 채점 결과는 답안 제출 후에만 표시

### E-03

- Before: 카드 `완료 페이지`가 `1/71p`인데 본문/세션 데이터는 `2/71페이지`
- After: 카드 `진도`가 표시용 `progressPageCount`를 사용해 현재 세션 진행 지점과 같은 기준으로 표시된다. 기존 저장 리포트도 학생 목록 새로고침 시 read-time 보강으로 `5/71p`처럼 최신 진행 지점을 보여주며, 분석용 `pageCoverageRatio`는 기존 의미를 유지한다.

## 테스트 전략

- `authFlow.test.ts`: 같은 이메일 대소문자/공백 변형 가입 시 409와 `EMAIL_ALREADY_EXISTS`.
- `stateReducer.test.ts`: 실제 명령형 문장은 이동, 조건/메타 문장은 이동하지 않음.
- `orchestratorFlow.test.ts`: 조건/메타 문장은 `ANSWER_QUESTION`으로 라우팅, 명령형은 기존대로 이동.
- `orchestrationEngine.test.ts` 또는 engine 단위 테스트: LLM plan이 `SET_CURRENT_PAGE`를 내도 비명령 USER_MESSAGE에서는 제거되고 page-scoped action이 현재 페이지로 보정됨.
- `toolDispatcher.test.ts`: LLM이 기존 quiz id를 반환해도 `record.id`, `record.quizJson.quizId`, `ui.quiz.quizId`, `pageState.quiz.lastQuizId`가 모두 새 unique id와 일치함.
- 웹 테스트 또는 순수 helper 테스트: 기존 graded record와 최신 ungraded record가 같은 id로 공존해도 최신+타입 일치 record를 선택함.
- `studentCompetencyReport.test.ts`: `currentPage`가 pageStates 개수보다 큰 세션에서도 `completedPageCount/pageCoverageRatio`는 기존 touched 기준이고, `progressPageCount/progressCoverageRatio`만 진도 기준으로 계산됨.
- 같은 테스트 파일에서 `touchedPageCount > currentPage` 보존, `currentPage > numPages` clamp, 세션 없음 0 fallback을 확인함.
- `npm run build -w apps/web`, `npm run test -w apps/server`.

## 수동 검증

Comet에서 아래를 확인한다.

1. `/signup`에서 기존 이메일을 공백/대소문자 변형으로 가입 시도한다.
2. 학생 세션에서 `현재 페이지를 아주 자세히 설명해줘. 답변 중 내가 다음 페이지를 누를 수도 있어.`를 전송한다.
3. 같은 세션에서 단답형 퀴즈를 생성하고 모달 초기 상태가 미채점인지 확인한다.
4. 교사 리포트 화면에서 학생 카드의 `완료 페이지`가 세션 진도와 같은 기준으로 표시되는지 확인한다.

검증 후 `update/0427update/safety-scenarios-50.md`의 A-04, D-03, D-08, E-03을 PASS 또는 남은 실패 내용으로 갱신한다.

## 최종 수동 검증 결과

- A-04: 중복 이메일 가입은 사용자 친화적인 중복 가입 안내로 처리되었다.
- D-03: 조건/메타 문장 속 `다음 페이지` 표현은 페이지 이동으로 처리되지 않았고, Gemini가 현재 5페이지를 설명했다.
- D-08: 중복 quiz id가 있는 기존 세션에서도 단답형 모달은 빈 입력/미채점 상태로 열렸고, 답안 제출 후 채점 결과가 표시되었다.
- E-03: 교사 리포트 화면에서 `학생 목록 새로고침` 후 학생 A 카드가 `진도 5/71p`를 표시했다. 상세 분석 본문은 기존 저장본의 `페이지 커버리지 1%`를 유지했다.
