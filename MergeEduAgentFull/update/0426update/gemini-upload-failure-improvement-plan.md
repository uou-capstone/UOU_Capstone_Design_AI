# Gemini PDF 업로드 실패 개선 계획서

## 문제 정의

- 현재 교사가 PDF 자료를 업로드하면 서버는 로컬 PDF 저장, 페이지 인덱스 생성, Gemini 파일 업로드를 하나의 원자적 흐름처럼 처리한다.
- Gemini API 키가 없거나 유효하지 않으면 `/bridge/upload_pdf`가 실패하고, 서버는 이미 저장한 PDF와 페이지 인덱스를 삭제한 뒤 강의 생성 자체를 실패시킨다.
- 그 결과 학생은 자료 목록을 볼 수 없고, PDF 뷰어, 페이지 설명, 퀴즈 흐름까지 모두 막힌다.

## 목표

- Gemini 연결 실패가 강의 자료 등록 자체를 막지 않도록 한다.
- PDF 원본과 페이지 텍스트 인덱스가 만들어졌다면 강의 목록과 학생 접근은 정상 동작하게 한다.
- Gemini 연결이 없는 상태에서도 최소한의 페이지 설명, 질문 응답, 객관식/OX/단답/서술형 퀴즈 생성 및 채점 흐름이 동작하게 한다.
- AI 연결 상태는 UI에서 명확하게 안내하되, 사용자가 학습 세션을 시작하지 못하게 막지는 않는다.
- 나중에 Gemini 키가 정상화되면 기존처럼 teacher session 진입 시 PDF 연결 복구를 시도할 수 있게 한다.

## 비목표

- Gemini API 키 자체를 새로 발급하거나 외부 계정 설정을 자동으로 변경하지 않는다.
- 전체 AI 품질을 Gemini 응답 수준으로 대체하지 않는다.
- 인증/초대/권한 모델은 이번 변경 범위에 포함하지 않는다.

## 변경 후보 모듈

- `apps/server/src/routes/lectures.ts`
  - 업로드 실패 시 PDF 파일을 삭제하고 502를 반환하는 로직을 변경한다.
  - Gemini 업로드 실패는 경고 상태로 남기고 강의 생성을 계속한다.
- `apps/server/src/services/engine/ToolDispatcher.ts`
  - `lecture.pdf.geminiFile`이 없을 때 현재는 모든 AI 도구를 거절한다.
  - 로컬 페이지 텍스트 인덱스를 기반으로 설명/QA/퀴즈/서술형 채점 fallback을 제공한다.
- `apps/server/src/routes/session.ts`
  - Gemini 연결 복구 실패 메시지를 "학습 불가"처럼 보이지 않게 정리한다.
- `apps/server/src/types/domain.ts`, `apps/web/src/types.ts`
  - 필요하면 PDF 연결 상태 메타데이터를 추가한다.
- `apps/web/src/routes/Classroom.tsx`, `apps/web/src/routes/Session.tsx`
  - 필요하면 자료 목록과 세션 경고 문구를 개선한다.
- `apps/server/src/tests/*`
  - Gemini 업로드 실패에도 강의가 생성되는지, 로컬 fallback 학습 도구가 동작하는지 테스트한다.

## 구현 순서

1. 현재 코드와 실패 보고서를 기준으로 상세 설계안을 만든다.
2. 설계안 3개를 통합해 최종 design 문서를 작성한다.
3. 통합 design을 5개 관점으로 정적 검토한다.
4. 지적사항을 반영해 design 문서를 수정한다.
5. `lectures.ts`에서 Gemini 업로드 실패를 비치명 경고로 처리한다.
6. `ToolDispatcher.ts`에 로컬 텍스트 기반 fallback 설명/QA/퀴즈/채점 흐름을 추가한다.
7. 서버 타입과 웹 타입/UI 문구를 필요한 만큼 갱신한다.
8. 서버 테스트를 추가하고 전체 테스트와 빌드를 실행한다.
9. Comet 브라우저에서 교사 PDF 업로드, 학생 자료 노출, 학생 학습 세션, 설명, 시험 보기까지 다시 확인한다.

## 리스크

- 로컬 fallback이 Gemini 품질보다 낮으므로 사용자에게 "로컬 기본 모드"임을 숨기면 안 된다.
- `geminiFile`이 없을 때도 세션 이벤트가 정상 처리되어야 하므로 ToolDispatcher의 fallback 범위를 명확히 제한해야 한다.
- PDF 텍스트 추출 결과가 비어 있는 페이지에서는 설명/문제가 빈약해질 수 있으므로 빈 텍스트용 안내가 필요하다.
- 기존 Gemini 정상 환경에서는 기존 경로가 그대로 우선되어야 한다.

## 검증 전략

- 단위/통합 테스트:
  - Gemini 업로드가 예외를 던져도 `/weeks/:weekId/lectures` 생성이 `201`로 완료되는지 확인한다.
  - 생성된 lecture의 `pdf.geminiFile`이 없어도 세션 진입이 `200`인지 확인한다.
  - `START_EXPLANATION_DECISION`, `USER_MESSAGE` 질문, `QUIZ_TYPE_SELECTED`, `QUIZ_SUBMITTED`가 로컬 fallback으로 응답하는지 확인한다.
- 수동 테스트:
  - Comet에서 교사 업로드가 완료되는지 확인한다.
  - 초대 학생 계정에서 강의 자료가 보이는지 확인한다.
  - 학생 세션에서 PDF가 렌더링되고, 페이지 설명과 시험 보기 흐름이 실제 클릭으로 완료되는지 확인한다.
