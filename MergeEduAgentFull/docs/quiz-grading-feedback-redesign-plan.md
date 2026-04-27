# 퀴즈 채점 결과 UI 개선 계획

작성일: 2026-04-27

## 배경

현재 퀴즈 채점 후 문항별 피드백은 `CORRECT (33/33) - 정답입니다.`처럼 영문 verdict, 문항별 점수, 설명이 한 줄에 섞여 표시된다. 사용자는 맞았는지 틀렸는지 즉시 파악하기 어렵고, `(33/33)` 같은 문항 점수는 의미가 직관적이지 않다.

## 목표

- 문항별로 `정답`, `오답`, `부분 정답`을 색과 O/X/부분 표시로 명확히 구분한다.
- 문항별 점수 `(33/33)` 표시는 제거한다.
- 최종 점수는 모달 하단의 총점 카드에서만 보여준다.
- 객관식, OX, 단답형, 서술형 모두 같은 채점 피드백 컴포넌트를 사용한다.
- 기존 채점 데이터 구조와 서버 API는 변경하지 않는다.

## 이미지 컨셉

- 이미지 생성 모델로 퀴즈 채점 결과 모달 컨셉을 생성했다.
- 컨셉 경로: `/Users/jhkim/.codex/generated_images/019dc825-979d-7293-915e-59a6a244d069/ig_02082607d016eb9d0169ef3f097de081919d9ec351c335483e.png`
- 구현은 이미지를 그대로 박는 것이 아니라, 컨셉의 시각 규칙을 HTML/CSS 컴포넌트로 반영한다.

## 구현 계획

1. 공통 `QuizFeedback` 컴포넌트 추가
   - `GradingItem`을 받아 verdict별 라벨, 아이콘, 색상 클래스를 결정한다.
   - `CORRECT` → `O 정답`
   - `WRONG` → `X 오답`
   - `PARTIAL` → `△ 부분 정답`
   - feedbackMarkdown만 표시하고 문항별 `score/maxScore`는 표시하지 않는다.

2. 각 렌더러에 verdict 상태 클래스 적용
   - `quiz-question-card`에 `quiz-question-card-graded`, `quiz-question-card-correct`, `quiz-question-card-wrong`, `quiz-question-card-partial` 추가.
   - 문항 카드 상단 우측에 상태 배지가 보이게 한다.

3. 객관식/OX 선택지 상태 개선
   - 채점 후 학생이 선택한 답변에는 verdict에 따라 green/red/amber 계열 배경과 border를 준다.
   - 오답인 경우 선택한 답변이 붉게 표시되어 “내가 고른 답이 틀렸다”가 즉시 보이도록 한다.
   - 정답 선택지 식별 정보는 `QuizQuestion.answer` 계열 데이터에 존재할 수 있으나, 이번 범위에서는 학생이 제출한 답의 판정과 피드백을 명확히 표시하는 데 집중한다. 정답 선택지 공개 UI는 별도 교수 전략 결정으로 남긴다.

4. 단답형/서술형 상태 개선
   - 답안 입력 영역 주변에 verdict별 색상 ring 또는 border를 적용한다.
   - 채점 후에도 기존 답변 내용은 유지된다.
   - 채점 후 단답형/서술형 답안은 `readOnly`로 잠근다.

5. 최종 점수 카드 개선
   - 하단 총점 카드는 `최종 점수`, 점수 숫자, 퍼센트, 요약문을 명확하게 보여준다.
   - 문항별 점수를 제거한 대신 전체 점수에서만 `score/maxScore`를 제공한다.
   - 서버의 `PASS_SCORE_RATIO`를 세션 이벤트 응답 `ui.passScoreRatio`로 내려주고, 웹은 이 기준으로 `통과`/`보완 필요` 배지를 표시한다.

6. 채점된 답안 기준 고정
   - 채점 전에는 로컬 `answers` 상태를 표시 기준으로 사용한다.
   - 채점 후에는 `record.userAnswers`를 우선 표시 기준으로 사용한다.
   - `record.userAnswers`가 없는 예외 상황에서만 로컬 `answers`를 fallback으로 사용한다.
   - 채점 후 라디오 계열은 `disabled`, 텍스트 계열은 `readOnly` 처리해 결과와 답안 상태가 어긋나지 않게 한다.

7. Markdown 렌더링 유지
   - `feedbackMarkdown`과 `summaryMarkdown`은 이름 그대로 Markdown으로 렌더링한다.
   - 기존 렌더러와 동일하게 `ReactMarkdown + remarkMath + rehypeKatex`를 사용한다.

## 비목표

- 서버 채점 로직 변경 없음
- 정답 선택지 강조/노출 로직 추가 없음
- Gemini 프롬프트 수정 없음
- 퀴즈 생성 형식 변경 없음

## 검증 기준

- 객관식, OX, 단답형, 서술형 문항에서 문항별 피드백이 한국어 상태 배지로 표시된다.
- 문항별 `(score/maxScore)`가 화면에 나오지 않는다.
- 최종 점수 카드에서는 전체 점수가 표시된다.
- 최종 점수 카드에서는 `scoreRatio >= passScoreRatio`이면 `통과`, 미만이면 `보완 필요`가 표시된다.
- `scoreRatio === passScoreRatio` 경계값은 통과로 표시한다.
- 기존 채점 기록을 다시 열어도 제출한 답안이 유지되고 채점 상태색이 실제 제출 답안에 붙는다.
- 채점 후 답안 컨트롤은 수정되지 않는다.
- 오답/정답/부분 정답 색상이 명확히 다르다.
- 상태 배지는 `aria-label`, 답안 컨트롤은 `aria-describedby`, 라디오 그룹은 접근 가능한 이름과 피드백 연결, 최종 점수 카드는 `aria-live="polite"`를 갖는다.
- `npm run build -w apps/web`가 통과한다.
