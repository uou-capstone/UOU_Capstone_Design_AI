# Ver5 구현 및 재검증 리포트

작성일: 2026-04-26

## 구현 범위

이번 구현은 실제 Comet 브라우저 테스트에서 교육 에이전트 흐름을 막던 문제와, 테스트 중 추가로 발견된 퀴즈 UX 문제를 고쳤다.

1. 스트리밍 이벤트 라우트의 정상 POST 요청 abort 오인 수정
2. 객관식 오답 피드백의 내부 choice id 노출 수정
3. 퀴즈 생성 중 raw JSON 채팅 노출 방지
4. 위 동작을 고정하는 서버 테스트 추가

## 변경 파일

- `apps/server/src/routes/session.ts`
  - `attachSessionStreamAbortHandlers` 추가
  - `req.close` 대신 `req.aborted`와 `res.close` 기반 abort 처리
  - `res.writableEnded`, `res.destroyed`, `signal.aborted` guard 추가
  - 스트림 종료/오류 경로에서 닫힌 response write 방지
- `apps/server/src/tests/sessionRoute.test.ts`
  - request close가 abort를 일으키지 않는지 검증
  - request aborted, response early close, response normal close, cleanup 동작 검증
  - `/event/stream`이 정상 요청에서 `final` NDJSON chunk를 반환하는지 검증
- `apps/server/src/services/engine/ToolDispatcher.ts`
  - MCQ 오답 피드백에서 choice id 대신 실제 선택지 문장 표시
  - 퀴즈 생성 스트림에서 `answer` channel JSON delta를 UI에 전달하지 않음
- `apps/server/src/tests/toolDispatcher.test.ts`
  - MCQ 오답 피드백에 내부 id가 노출되지 않는지 검증
  - 퀴즈 JSON answer delta가 chat stream event로 전달되지 않는지 검증

## 검증 결과

- `npm run test -w apps/server`
  - 통과: 12 files, 58 tests
- `npm run build`
  - 통과
  - Vite large chunk warning만 발생
- Comet 브라우저 실제 재검증
  - 세션 진입 후 스트리밍 이벤트 정상 완료
  - 다음/이전 페이지 자연어 이동 정상
  - 수동 PDF 페이지 이동 후 현재 페이지 질문 정상
  - 존재하지 않는 999페이지 요청 환각 없이 거절
  - 객관식 퀴즈 생성/채점/오답 교정 정상
  - MCQ 오답 피드백이 실제 정답 선택지 문장으로 표시
  - 새 퀴즈 생성 중 raw JSON 객체가 채팅 본문에 노출되지 않음
  - 저장/종료/재입장 후 세션 상태 유지

## 남은 이슈

- Comet 파일 선택 UI에서 PDF 업로드가 60초 timeout으로 실패한 사례가 있다. 같은 API를 직접 호출하면 성공하므로 업로드 UX/timeout/재시도 안내를 별도 개선해야 한다.
- 사용자가 이미 객관식 퀴즈를 요청해도 유형 선택 버튼이 다시 뜬다. 기능은 정상이나 흐름이 한 번 더 필요하다.
- 최신 연구나 PDF 밖 지식 질문에서 자료 안/밖 경계를 더 엄격히 해야 한다.
- 오답 복구 흐름 중 새 퀴즈 요청이 복구 흐름에 흡수될 수 있어, 명시적 새 퀴즈 요청 분기가 더 또렷하면 좋다.

## 결론

초기 BLOCKED 상태였던 교육 에이전트 핵심 흐름은 스트리밍 라우트 수정 후 실제 브라우저에서 동작했다. 페이지 동기화, 질문응답, 퀴즈, 채점, 오답 교정, 저장/재입장은 현재 의도한 방향으로 진행된다. 남은 항목은 핵심 장애보다는 업로드 UX와 오케스트레이션 정책의 사용성 개선에 가깝다.
