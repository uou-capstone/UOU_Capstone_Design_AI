# Ver5 스트리밍 이벤트 안정화 설계

작성일: 2026-04-26

## 문제 정의

Comet 브라우저에서 학습 세션에 진입하면 PDF 뷰어는 렌더링되지만, 교육 에이전트의 초기 `SESSION_ENTERED` 이벤트가 실패한다. 화면에는 `강의 시작 이벤트가 실패했습니다. 다시 시도해 주세요.`가 표시되고, 이후 교육 에이전트 테스트 시나리오가 대부분 BLOCKED 된다.

직접 확인 결과:

- `POST /api/session/:sessionId/event`는 정상 응답한다.
- `POST /api/session/:sessionId/event/stream`는 `final` chunk 없이 빈 응답으로 끝난다.
- 브라우저 세션 이벤트는 스트리밍 경로를 사용하므로 사용자 환경에서는 에이전트가 시작되지 않는다.

## 원인 가설

`apps/server/src/routes/session.ts`의 스트리밍 라우트는 다음 패턴을 사용한다.

```ts
req.on("close", () => {
  if (!res.writableEnded) {
    controller.abort();
  }
});
```

Node/Express에서 request의 `close`는 "클라이언트가 응답 스트림을 끊었다"는 의미로만 볼 수 없다. POST 요청 본문이 모두 처리된 뒤 request 객체가 닫히는 정상 흐름에서도 발생할 수 있다. 이 경우 응답 스트림은 아직 살아있는데도 `AbortController`가 abort되고, `handleEventStream`은 `final`을 emit하지 않은 채 종료한다.

## 목표

- 클라이언트가 연결을 유지한 비-abort 스트리밍 이벤트 요청은 반드시 `final` 또는 `error` chunk로 끝난다.
- 클라이언트가 실제로 스트림 응답을 끊은 경우에는 서버 작업을 abort한다.
- POST 요청 본문 완료를 응답 스트림 중단으로 오인하지 않는다.
- 브라우저의 세션 진입, 사용자 메시지, 퀴즈/채점 이벤트가 다시 동작한다.

## 비목표

- 에이전트 답변 품질 자체를 이번 변경에서 튜닝하지 않는다.
- Gemini 프롬프트나 오케스트레이션 정책은 변경하지 않는다.
- PDF 업로드 타임아웃 UX는 별도 개선 후보로 기록하되, 이번 1차 구현의 핵심 범위는 스트림 이벤트 복구다.

## 제안 구조

### 1. 스트림 abort 기준 변경

`req.on("close")`를 사용하지 않는다.

대신 다음 이벤트만 abort 신호로 사용한다.

- `req.on("aborted")`: 요청 본문 수신 도중 클라이언트가 끊은 경우
- `res.on("close")`: 응답 스트림이 끝나기 전에 연결이 닫힌 경우

`res.on("close")`에서는 `res.writableEnded`가 `false`일 때만 abort한다. 정상적으로 `res.end()`가 호출된 뒤 발생하는 close는 abort로 보지 않는다.

### 2. 정리 함수 추가

라우트 내부에서 이벤트 리스너를 등록한 뒤, 정상/오류 종료 시 제거한다.

예상 형태:

```ts
export function attachSessionStreamAbortHandlers(
  req: Request,
  res: Response,
  controller: AbortController
): () => void {
  const abortIfResponseOpen = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };

  req.on("aborted", abortIfResponseOpen);
  res.on("close", abortIfResponseOpen);

  return () => {
    req.off("aborted", abortIfResponseOpen);
    res.off("close", abortIfResponseOpen);
  };
}
```

구현에서는 `await handleEventStream(...)` 주변에 `try/finally`를 두고, 성공, throw, abort return 모두에서 cleanup을 호출한다. 정상 완료 시에는 `final` chunk를 쓴 뒤 `res.end()`를 호출하고, 이후 cleanup한다.

### 3. writer-level guard 추가

스트림 writer는 닫힌 응답에는 아무 chunk도 쓰지 않는다.

예상 조건:

```ts
if (controller.signal.aborted || res.destroyed || res.writableEnded) {
  return;
}
```

이 guard는 progress, final, error chunk 모두에 동일하게 적용한다. 클라이언트가 페이지를 떠났거나 프론트 `AbortController`가 이전 스트림을 취소한 뒤, 엔진 내부에서 늦게 emit되는 chunk가 닫힌 response에 쓰이는 것을 막는다.

### 4. 라우트 오류 처리 보강

스트림 처리 중 이미 연결이 abort된 경우에는 닫힌 응답에 `error` chunk를 쓰지 않는다.

예상 처리:

```ts
if (controller.signal.aborted || res.destroyed) {
  return;
}
```

### 5. 회귀 테스트

`apps/server/src/tests/sessionRoute.test.ts`에 유닛 테스트를 추가한다.

검증 항목:

- request의 `close` 이벤트는 abort를 발생시키지 않는다.
- request의 `aborted` 이벤트는 abort를 발생시킨다.
- response가 정상 종료된 뒤 발생한 `close`는 abort를 발생시키지 않는다.
- response가 끝나기 전 발생한 `close`는 abort를 발생시킨다.
- cleanup 이후에는 이벤트가 abort를 발생시키지 않는다.
- 라우트 레벨에서 `/session/:sessionId/event/stream` 정상 요청은 `final` NDJSON chunk를 반환한다.
- 라우트 레벨에서 fake engine이 지연되어도 정상 request close를 abort로 오인하지 않는다.
- 닫힌 응답/abort 이후에는 error chunk write를 시도하지 않는다.

## 이벤트 수용 기준

| 이벤트 | 경로 | 기대 결과 |
| --- | --- | --- |
| `SESSION_ENTERED` | `/event/stream` | 초기 안내 메시지를 포함한 `final` chunk 수신 |
| `USER_MESSAGE` | `/event/stream` | 스트리밍 delta 이후 `final` chunk 수신 |
| `PAGE_CHANGED` | `/event/stream` | 페이지 상태 patch가 포함된 `final` chunk 수신 |
| `START_EXPLANATION_DECISION` | `/event/stream` | 설명/후속 선택 메시지가 포함된 `final` chunk 수신 |
| `QUIZ_TYPE_SELECTED` | `/event/stream` | 퀴즈 modal payload 또는 관련 메시지가 포함된 `final` chunk 수신 |
| `QUIZ_SUBMITTED` | `/event/stream` | 채점 patch와 피드백 메시지가 포함된 `final` chunk 수신 |
| `NEXT_PAGE_DECISION` | `/event/stream` | 페이지 이동 patch가 포함된 `final` chunk 수신 |
| `REVIEW_DECISION` | `/event/stream` | 복습/진행 분기에 맞는 `final` chunk 수신 |
| `RETEST_DECISION` | `/event/stream` | 재시험 분기에 맞는 `final` chunk 수신 |
| `SAVE_AND_EXIT` | `/event` | 기존 비스트림 저장 경로 유지 |

## 실패 시나리오와 복구

- 스트림 중 클라이언트가 페이지를 떠남: `res.close`가 발생하고 서버 작업 abort.
- 요청 본문 수신 중 브라우저가 취소됨: `req.aborted`가 발생하고 서버 작업 abort.
- AI bridge 오류: 기존처럼 `error` chunk 또는 route error path로 전달.
- 정상 완료: `final` chunk 작성 후 `res.end()`.

## 테스트 전략

1. `npm run test -w apps/server`
2. `npm run build`
3. 직접 API 검증:
   - `/api/session/:sessionId/event/stream`에 `SESSION_ENTERED` 전송
   - `final` chunk가 내려오는지 확인
4. Comet 브라우저 검증:
   - 학습 세션 새로고침
   - 초기 안내 메시지가 생성되는지 확인
   - S02~S24 핵심 시나리오 재실행

## 사용자 시나리오 Before / After

Before:

- 학습 시작 클릭
- PDF는 보임
- 우측 에이전트 패널에 시작 이벤트 실패 표시
- 모든 에이전트 질의응답/퀴즈 흐름 BLOCKED

After:

- 학습 시작 클릭
- PDF 1페이지 렌더링
- 에이전트가 초기 안내 메시지를 표시
- 사용자 메시지/페이지 이동/퀴즈 이벤트가 스트리밍 응답으로 이어짐

## 구현 중 추가 발견된 UX 보정

스트림 안정화 이후 실제 Comet 테스트를 계속하면서 퀴즈 흐름에서 두 가지 사용자 가시 문제가 추가로 확인됐다.

### 객관식 오답 피드백의 내부 id 노출

기존 MCQ 자동 채점은 오답일 때 `정답은 c3 입니다.`처럼 내부 choice id를 그대로 표시했다. 사용자는 `c3`가 어떤 선택지인지 즉시 알 수 없고, 학습 피드백으로도 부자연스럽다.

개선 설계:

- MCQ 채점 시 `answer.choiceId`로 `question.choices`에서 실제 선택지를 찾는다.
- `textMarkdown`이 있으면 이를 정답 라벨로 사용한다.
- 선택지를 찾지 못하는 비정상 데이터에서만 기존 id를 fallback으로 사용한다.
- 회귀 테스트는 오답 feedback에 선택지 문장이 포함되고 내부 id가 포함되지 않는지 검증한다.

### 퀴즈 생성 중 raw JSON 노출

퀴즈 생성 모델은 최종적으로 JSON을 만들어야 하므로 스트리밍 중 `answer` channel에 JSON 조각을 emit할 수 있다. 기존 UI는 이를 그대로 채팅 메시지로 보여줘, 퀴즈 모달이 뜨기 전에 `{ "schemaVersion": ... }` 같은 raw JSON이 잠시 노출됐다.

개선 설계:

- `GENERATE_QUIZ_*` tool의 stream callback은 `thought` channel만 UI progress event로 전달한다.
- `answer` channel은 내부 JSON 생성물로 간주해 채팅 본문에 전달하지 않는다.
- 최종 사용자 메시지는 파싱된 quiz record가 생성된 뒤 `N페이지 퀴즈가 생성되었습니다...`만 표시한다.
- 회귀 테스트는 fake quiz stream이 `answer` JSON delta를 emit해도 UI stream event에 포함되지 않는지 검증한다.

## 최종 검증 항목

- `npm run test -w apps/server`
- `npm run build`
- Comet 세션 재진입 후 초기 이벤트 정상 완료
- 자연어 다음/이전 페이지 이동과 PDF 뷰어 상태 동기화
- MCQ 오답 후 정답 선택지 문장 표시
- 퀴즈 생성 중 raw JSON 미노출 및 최종 퀴즈 모달 표시
