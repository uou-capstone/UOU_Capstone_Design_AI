# 퀴즈 모달 채점 버튼 배치 수정 디자인

작성일: 2026-04-27

## 문제

퀴즈 모달에서 스크롤 중 `모든 문항에 답변하면 채점 버튼이 활성화됩니다.` 안내와 `채점하기` 버튼이 문항 사이에 떠 있는 것처럼 보인다.

현재 구조상 전역 모달 규칙 `.modal-panel .form-actions`가 `position: sticky; bottom: 0`을 적용하고 있다. 퀴즈 모달은 문항 목록이 길어질 수 있는데, 이 sticky footer가 본문 위에 겹쳐 보이며 사용자는 “아직 문항이 남았는데 채점 버튼이 중간에 나온다”고 느낀다.

## 목표

- 채점 안내와 채점 버튼은 모든 문항이 끝난 뒤에만 보인다.
- 스크롤 중 문항 위에 버튼이나 안내문이 겹치지 않는다.
- 모달 헤더와 닫기 버튼은 유지하되, 퀴즈 본문 영역만 자연스럽게 스크롤된다.
- 기존 채점 로직, 답변 상태 계산, 채점 결과 표시 로직은 변경하지 않는다.

## 수정 방향

### 1. DOM 구조

`QuizModal.tsx`에서 퀴즈 전용 스크롤 컨테이너를 만든다.

현재:

- `.modal-panel`
  - `.modal-head`
  - `.modal-body`
  - `.quiz-modal-footer`
    - `.form-actions.quiz-modal-actions`

변경:

- `.modal-panel.quiz-modal-panel`
  - `.modal-head.quiz-modal-head`
  - `.quiz-modal-scroll`
    - `.modal-body.quiz-modal-body`
    - `.quiz-modal-footer`
      - 안내문
      - 에러
      - `.quiz-modal-actions`

핵심은 footer를 `.quiz-modal-scroll` 내부의 문항 목록 뒤에 두는 것이다. 따라서 footer는 스크롤 콘텐츠의 끝에 있으며, 문항 위로 떠다니지 않는다.

### 2. CSS 구조

퀴즈 모달만 전용 레이아웃을 갖도록 한다.

- `.quiz-modal-panel`
  - `overflow: hidden`
  - `display: flex`
  - `flex-direction: column`
  - 모달 전체 높이는 viewport 안에 제한
- `.quiz-modal-head`
  - `flex: 0 0 auto`
- `.quiz-modal-scroll`
  - `flex: 1 1 auto`
  - `overflow-y: auto`
  - `min-height: 0`
  - `overscroll-behavior: contain`
- `.quiz-modal-actions`
  - `position: static`
  - `display: flex`
  - `justify-content: flex-end`

또한 퀴즈 버튼 영역에서는 `.form-actions` 클래스를 제거한다. 전역 sticky 규칙을 덮어쓰는 방식보다 전역 규칙의 대상에서 벗어나는 방식이 더 확실하다.

구현 시 반드시 다음을 지킨다.

- `.quiz-modal-footer`는 `.quiz-modal-scroll` 내부에서 `.quiz-modal-body` 뒤에 위치한다.
- `.quiz-modal-actions`에는 `.form-actions` 클래스를 함께 붙이지 않는다.
- CSS selector는 `.modal-panel.quiz-modal-panel ...` 형태로 작성해 전역 모달 후반 override보다 강하게 만든다.
- 작은 화면에서는 `.quiz-modal-actions .btn`에 모바일 폭 보정을 별도로 둔다.

## 검토 반영 사항

서브 에이전트 정적 검토에서 다음 지적이 있었다.

- 기존 구현은 `.quiz-modal-scroll`이 없어 설계와 불일치했다.
- 기존 구현은 `.form-actions quiz-modal-actions`를 함께 사용해 전역 sticky 규칙 영향권에 남아 있었다.
- `.modal-panel { overflow: auto }` 전역 규칙을 퀴즈 전용으로 확실히 무력화해야 한다.
- 작은 화면에서 `96vw` + backdrop padding이 가로 overflow를 만들 수 있으므로 퀴즈 모달 폭을 `calc(100vw - 36px)` 기준으로 제한한다.
- 닫기 버튼에 접근 가능한 이름이 필요하다.
- 객관식 라디오는 같은 문항 내에서 같은 `name`을 가져야 키보드 탐색이 자연스럽다.

위 지적을 모두 구현 범위에 포함한다.

## 비목표

- 퀴즈 생성/채점 API 변경 없음
- 객관식/OX/단답형/서술형 렌더러의 답변 로직 변경 없음
- 모달 디자인 전체 리디자인 없음

## 검증 기준

- 긴 객관식 퀴즈에서 중간 스크롤 위치에 채점 안내/버튼이 보이지 않는다.
- 마지막 문항 아래까지 스크롤해야 안내/버튼이 보인다.
- 모든 문항에 답변하기 전 버튼은 disabled 상태다.
- 모든 문항에 답변하면 맨 아래 버튼이 enabled 상태가 된다.
- `npm run build -w apps/web`가 통과한다.
