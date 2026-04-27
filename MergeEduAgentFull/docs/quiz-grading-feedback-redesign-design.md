# 퀴즈 채점 결과 UI 디자인 문서

작성일: 2026-04-27

## 디자인 원칙

UI 변경 컨셉의 핵심은 “채점 결과를 문장보다 먼저 시각적으로 읽히게 만드는 것”이다. 기존의 노란 피드백 박스와 영문 verdict는 제거하고, 문항 카드 자체가 결과 상태를 갖도록 만든다.

## 정보 구조

### 문항 카드

문항 카드는 다음 구조를 가진다.

- 질문 본문
- 답변 UI
- 채점 상태 배지
- 피드백 박스

채점 전에는 상태 배지와 피드백 박스가 보이지 않는다.

채점 후에는 문항 카드 우측 상단에 상태 배지를 표시한다.

- `CORRECT`: 초록색, `O`, `정답`
- `WRONG`: 빨간색, `X`, `오답`
- `PARTIAL`: 주황색, `△`, `부분 정답`

### 피드백 박스

피드백 박스에는 `feedbackMarkdown`만 표시한다.

표시하지 않는 정보:

- `CORRECT`, `WRONG`, `PARTIAL` 원문
- 문항별 `score/maxScore`

렌더링 방식:

- `feedbackMarkdown`은 Markdown으로 렌더링한다.
- 수식/목록/강조 표현이 깨지지 않도록 기존 렌더러와 동일한 `ReactMarkdown`, `remarkMath`, `rehypeKatex` 조합을 쓴다.

### 최종 점수 카드

모달 하단에 전체 점수만 표시한다.

- 제목: `최종 점수`
- 큰 점수: 예: `80점`
- 보조 점수: 예: `총점 4/5`
- 판정 배지: `통과` 또는 `보완 필요`
- 요약문: `summaryMarkdown`
- `summaryMarkdown`도 Markdown으로 렌더링한다.
- 채점 완료 후 최종 점수 영역에는 `aria-live="polite"`를 둔다.

전체 점수 계산:

- 먼저 `effectiveScoreRatio`를 하나만 계산한다.
- `record.grading.scoreRatio`가 `Number.isFinite(value) && value >= 0 && value <= 1`이면 우선 사용한다.
- `scoreRatio`가 없거나 유효하지 않고 `score`, `maxScore`가 finite number이며 `maxScore > 0`이면 `score / maxScore`를 계산한다.
- fallback 계산 결과도 `[0, 1]` 범위로 clamp하거나 범위 검증 후 사용한다.
- 그 외 예외 상황은 `0`으로 방어한다.
- 화면 점수는 `Math.round(effectiveScoreRatio * 100)`으로 표시한다.

통과 판정:

- 서버는 세션 이벤트 응답 `ui.passScoreRatio`에 현재 `PASS_SCORE_RATIO`를 내려준다.
- 웹은 `effectiveScoreRatio >= passScoreRatio`이면 `통과`, 미만이면 `보완 필요`로 표시한다.
- 기준값이 누락되었거나 `[0, 1]` 범위를 벗어난 예외 상황에서는 현재 기본 정책과 같은 `0.7`을 fallback으로 사용한다.
- `통과` 배지는 초록색, `보완 필요` 배지는 주황색으로 표시한다.

레이아웃:

- 최종 점수 카드는 기존 `.quiz-modal-footer` 내부에 둔다.
- 새 sticky/fixed footer 동작을 만들지 않는다.
- `.quiz-modal-actions`는 점수 카드와 별도 블록으로 유지한다.
- 모바일에서는 점수, 배지, 버튼이 자연스럽게 줄바꿈되어야 한다.
- `.card` 배경색에 상태색을 의존하지 않는다.

## API 계약

서버는 모든 세션 이벤트 응답의 `ui.passScoreRatio`에 현재 `appConfig.passScoreRatio`를 내려준다.

수정 대상:

- `apps/server/src/types/domain.ts`의 `EventApiResponse.ui`
- `apps/server/src/services/engine/ToolDispatcher.ts`의 dispatch 반환 타입과 초기 `ui`
- `apps/server/src/services/engine/OrchestrationEngine.ts`의 일반 응답, noop 응답, 스트리밍 최종 응답 경로
- 서버 테스트/mock 응답에서 `ui.passScoreRatio` 누락 방지
- `apps/web/src/api/endpoints.ts`의 일반 이벤트 응답 타입과 스트리밍 최종 응답 타입

서버는 `appConfig.passScoreRatio`가 `Number.isFinite(value) && value >= 0 && value <= 1`이면 그대로 내리고, 비정상 값이면 `0.7`을 내려준다. 웹도 마지막 방어선으로 같은 bounded guard를 유지하고, 누락/비정상 값이면 `0.7`을 사용한다.

## 웹 상태 흐름

`Session.tsx`는 `passScoreRatio`를 세션 영속 상태가 아닌 UI/config 상태로 보관한다.

- 기본값은 `0.7`
- 이벤트 응답 `response.ui.passScoreRatio`가 finite number이면 갱신
- `QuizModal`에는 `passScoreRatio` prop으로 전달
- `QuizModal`은 최종 점수 카드에서만 이 값을 사용한다.

## 답안 표시 기준

채점 전에는 현재 입력 중인 로컬 `answers` 상태가 표시 기준이다.

채점 후에는 반드시 채점 대상이었던 제출 답안을 표시 기준으로 고정한다.

우선순위:

1. `record.userAnswers`
2. 채점 직후 같은 모달에서만 `submittedAnswersSnapshot`

재오픈된 채점 완료 퀴즈에서는 로컬 `answers`가 비어 있거나 오래된 값일 수 있으므로, `record.userAnswers`가 없으면 답안을 임의로 현재 로컬 상태로 대체하지 않는다. 대신 “제출 답안을 불러올 수 없습니다.” 같은 명시적 unavailable 상태를 표시한다.

구현 방식:

- 제출 직전 `submittedAnswersSnapshot`을 만든다.
- snapshot은 `{ ...answers }`처럼 복사된 객체여야 하고, 현재 `quizId`/submission/localRecord와 연결된다.
- API에는 이 snapshot을 제출한다.
- `loading` 중에는 답안 컨트롤을 잠그거나 변경을 무시해서, 채점 중 수정된 현재 `answers`와 제출 snapshot이 갈라지지 않게 한다.
- `record.grading.status === "GRADED"`이면 `displayAnswers`는 `record.userAnswers`를 기준으로 만든다.
- `record.userAnswers` 객체 자체가 누락된 경우에만, 같은 제출 직후의 `localRecord` 상황에서 `submittedAnswersSnapshot` fallback을 허용한다.
- 채점 후에는 live/current `answers`를 표시 기준으로 사용하지 않는다.
- snapshot은 quiz 변경, close, 새 submit 때 clear한다.
- snapshot은 재오픈된 채점 기록이나 다른 퀴즈에는 사용하지 않는다.
- 특정 문항 값이 타입 가드에 실패하면 그 문항은 미답/불러오기 실패 상태로 보여주고, 다른 로컬 답안으로 섞지 않는다.

타입 가드:

- 객관식, 단답형, 서술형: `typeof value === "string"`
- OX: `typeof value === "boolean"`

채점 후 잠금:

- 객관식/OX 라디오는 `disabled`
- 단답형/서술형은 `readOnly`

이렇게 해야 사용자가 채점 후 답안을 바꾸더라도, 결과 색상과 실제 채점된 답안이 어긋나지 않는다.

## CSS 설계

### 카드 상태 클래스

- `.quiz-question-card-graded`
- `.quiz-question-card-correct`
- `.quiz-question-card-wrong`
- `.quiz-question-card-partial`

상태별 색상:

- 정답: green `#14865d`
- 오답: red `#dc2626`
- 부분 정답: amber `#b7791f`

전역 CSS 주의:

- 프로젝트 하단 white surface 규칙이 `.card`에 `background-color`, `background-image`, `color`, `-webkit-text-fill-color`를 강하게 적용한다. 특히 `global.css` 하단의 강제 흰색 표면 규칙과 충돌할 수 있다.
- 따라서 카드 전체 배경을 상태색으로 칠하는 방식은 피한다.
- 카드에는 `border-left`, `box-shadow`, CSS 변수만 적용하고, 실제 색상 배경은 배지/피드백/선택 답안에 적용한다.
- 상태 selector는 `.quiz-modal-panel` 아래의 compound selector로 scope를 묶는다.
- 컬러가 들어가는 채점 배지, 피드백 박스, 선택 답안, 통과/보완 배지는 모두 `color`와 `-webkit-text-fill-color: currentColor`를 함께 둔다.

허용 selector 예:

- `.quiz-modal-panel .quiz-question-card.quiz-question-card-graded.quiz-question-card-wrong`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-choice.quiz-choice-selected.quiz-choice-wrong`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-answer-graded.quiz-answer-wrong`

금지 selector 예:

- bare `.quiz-choice-wrong`
- bare `.quiz-answer-wrong`
- bare `.active` verdict rule

### 선택지 상태 클래스

객관식/OX 선택지에 다음 클래스를 사용한다.

- `.quiz-choice-selected`
- `.quiz-choice-correct`
- `.quiz-choice-wrong`
- `.quiz-choice-partial`

채점 후 학생이 선택한 선택지만 상태색을 갖는다.

상태 스타일은 반드시 `selected`와 `graded` gate를 함께 요구한다.

예:

- `.quiz-modal-panel .quiz-question-card-graded .quiz-choice.quiz-choice-selected.quiz-choice-wrong`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-ox-choice.quiz-choice-selected.quiz-choice-wrong`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-choice.quiz-choice-selected.quiz-choice-correct`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-ox-choice.quiz-choice-selected.quiz-choice-correct`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-choice.quiz-choice-selected.quiz-choice-partial`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-ox-choice.quiz-choice-selected.quiz-choice-partial`

이렇게 해야 미선택 선택지가 정답처럼 칠해지는 오해를 막을 수 있다.

OX 라벨은 반드시 base class `.quiz-ox-choice`를 가진다. 기존 `.quiz-ox-options label.active` 파란 `border-color`와 `box-shadow`와 충돌하지 않도록, 채점 후 verdict selector가 명시적으로 덮는다.

OX active override 예:

- `.quiz-modal-panel .quiz-question-card-graded .quiz-ox-options label.quiz-ox-choice.active.quiz-choice-selected.quiz-choice-wrong`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-ox-options label.quiz-ox-choice.active.quiz-choice-selected.quiz-choice-correct`
- `.quiz-modal-panel .quiz-question-card-graded .quiz-ox-options label.quiz-ox-choice.active.quiz-choice-selected.quiz-choice-partial`

### 입력 답변 상태 클래스

단답형/서술형 입력에는 다음 클래스를 사용한다.

- `.quiz-answer-graded`
- `.quiz-answer-correct`
- `.quiz-answer-wrong`
- `.quiz-answer-partial`

채점된 입력의 focus 상태는 verdict 색상을 유지한다.

focus-visible:

- 전역 blue focus rule보다 더 구체적인 selector를 쓴다.
- 단답형/서술형은 `.quiz-modal-panel .quiz-question-card-graded .quiz-answer-graded.quiz-answer-wrong:focus-visible`처럼 상태별 focus selector를 둔다.
- 객관식/OX 선택지는 선택된 라벨 내부 input focus-visible에서도 상태색 ring이 보이게 한다.
- OX는 `.quiz-modal-panel .quiz-question-card-graded .quiz-ox-options label.quiz-ox-choice.active.quiz-choice-selected.quiz-choice-wrong input:focus-visible + span`처럼 `.quiz-ox-options input:focus-visible + span`을 덮는 selector를 둔다.
- OX focus-visible은 `wrong`, `correct`, `partial` 세 변형을 모두 둔다.
- focus ring은 제거하지 않고 상태색 계열로 유지한다.

## 컴포넌트 설계

### `QuizFeedback.tsx`

새 컴포넌트를 만든다.

입력:

- `grading: GradingItem`

출력:

- 상태 배지
- 피드백 박스

보조 함수:

- `getGradingPresentation(verdict)`
  - label
  - symbol
  - tone
  - cardClass
  - answerClass
  - selectedClass
  - ariaLabel

이 보조 함수는 렌더러에서도 재사용할 수 있도록 export한다.

상태 배지:

- 기호 `O`, `X`, `△`는 시각적 보조다.
- 기호 span은 `aria-hidden="true"`로 둔다.
- 배지에는 `aria-label="채점 결과: 정답"`처럼 명확한 접근 가능한 이름을 둔다.
- 텍스트 `정답`, `오답`, `부분 정답`은 화면에도 표시한다.

## 렌더러 변경

### 객관식

- 문항 카드에 상태 클래스 적용
- 학생이 고른 선택지에 상태 클래스 적용
- 문항별 점수 제거
- 공통 `QuizFeedback` 표시
- `fieldset` 또는 `role="radiogroup"`으로 문항 본문과 선택지 그룹을 연결한다.
- 객관식 라디오 그룹은 피드백이 렌더링된 뒤에만 `aria-describedby={feedbackId}`로 피드백과 연결한다.
- 피드백 컨테이너에는 항상 안정적인 matching `id`를 둔다.
- 채점 후 라디오는 `disabled` 처리한다.
- disabled 라디오는 키보드 focus가 되지 않을 수 있으므로, 선택된 답안의 시각 상태와 피드백 텍스트가 문서 순서상 바로 이어져 읽히게 한다.

### OX

- O/X 라벨 중 학생이 고른 것에 상태 클래스 적용
- 문항별 점수 제거
- 공통 `QuizFeedback` 표시
- OX 라벨에는 base class `.quiz-ox-choice`를 둔다.
- OX 라디오 그룹은 문항 본문과 접근 가능한 이름으로 연결하고, 피드백이 렌더링된 뒤에만 `aria-describedby={feedbackId}`로 피드백과 연결한다.
- 기존 `.active` 파란 선택 상태가 오답/정답 색상과 충돌하지 않도록 `.quiz-ox-choice`와 verdict selector를 강하게 둔다.
- 채점 후 라디오는 `disabled` 처리한다.
- disabled 라디오는 키보드 focus가 되지 않을 수 있으므로, 선택된 O/X와 피드백 텍스트가 문서 순서상 바로 이어져 읽히게 한다.

### 단답형

- input에 상태 클래스 적용
- 문항별 점수 제거
- 공통 `QuizFeedback` 표시
- 채점 후 input은 `readOnly` 처리한다.
- 피드백이 렌더링된 뒤에만 피드백 id를 `aria-describedby`에 연결한다.

### 서술형

- textarea에 상태 클래스 적용
- 문항별 점수 제거
- 공통 `QuizFeedback` 표시
- 채점 후 textarea는 `readOnly` 처리한다.
- 피드백이 렌더링된 뒤에만 피드백 id를 `aria-describedby`에 연결한다.

## 접근성

- 상태 배지는 텍스트 `정답`, `오답`, `부분 정답`을 포함한다.
- 상태 기호 `O`, `X`, `△`는 `aria-hidden="true"`로 처리한다.
- 색상만으로 의미를 전달하지 않고 O/X/△ 기호와 텍스트를 함께 표시한다.
- 문항별 피드백 박스에는 과도한 live region을 두지 않는다.
- 최종 점수 카드에는 `aria-live="polite"`를 둔다.
- 답안 컨트롤은 피드백이 렌더링된 경우에만 채점 피드백 id를 `aria-describedby`로 참조한다.
- 객관식/OX 라디오 그룹도 피드백이 렌더링된 경우에만 채점 피드백 id를 `aria-describedby`로 참조한다.
- 라디오 그룹 name은 기존 수정대로 유지한다.

## 리스크

- 정답 선택지 데이터는 존재할 수 있으나, 이번 범위에서는 정답 선택지를 UI에서 별도 강조하지 않는다. 서버 피드백이 정답을 설명하는 것은 그대로 허용하고, 오답 학습 지원은 `feedbackMarkdown`에 맡긴다.
- 단답형/서술형은 학생 답안이 문자열로 보존되므로 상태 표시만 가능하고 정답 비교 강조는 불가하다.

## 비목표

이번 변경에서는 다음을 수정하지 않는다.

- 채점 로직
- Gemini 프롬프트
- 퀴즈 생성 스키마
- 저장된 세션 JSON/data migration
- 인증/권한/세션 소유권
- PDF 업로드/추출 흐름
- 강의실 리포트
- 퀴즈 모달 밖의 전역 스타일

## 완료 기준

- 네 렌더러가 모두 `QuizFeedback`을 사용한다.
- 문항별 `score/maxScore` 문자열이 렌더러 코드에서 제거된다.
- 전체 점수 카드에서만 점수 숫자를 보여준다.
- 전체 점수 카드가 `통과`/`보완 필요` 판정을 보여준다.
- 채점 후 렌더러는 `record.userAnswers`를 우선 표시한다.
- 채점 후 답안 입력은 잠긴다.
- Markdown 피드백과 Markdown 요약문이 깨지지 않는다.
- 서버와 웹 타입 모두 `ui.passScoreRatio`를 포함한다.
- 일반 이벤트, noop 이벤트, 스트리밍 최종 응답에서 `ui.passScoreRatio`가 누락되지 않는다.
- `Session.tsx`가 `passScoreRatio`를 UI 상태로 보관하고 `QuizModal`로 전달한다.
- `npm run build -w apps/server`가 통과한다.
- `npm run build -w apps/web`가 통과한다.
- `npm run test -w apps/server`가 통과한다.
- 디자인 정적 검토와 코드 구현 검토가 모두 통과한다.
