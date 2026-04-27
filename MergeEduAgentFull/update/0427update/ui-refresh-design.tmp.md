# 0427 UI Refresh Design

## 목표

- 전역 배경의 격자/패턴을 제거하고 모든 앱 화면을 기본 흰 배경으로 전환한다.
- 로그인 외 화면도 이미지 생성 레퍼런스를 기준으로 명확히 다르게 보이도록 개선한다.
- 기능/권한/데이터 흐름은 변경하지 않고, React 구조와 CSS 클래스 중심으로 시각적 품질을 높인다.
- 교사용 대시보드, 강의실, 강의 생성/업로드 모달, 학습 세션, 학생 리포트 화면을 모두 대상으로 한다.

## 이미지 레퍼런스

- Dashboard: `/Users/jhkim/Documents/MergeEduAgentFull/update/0427update/design_refs/dashboard-concept.png`
- Classroom + Upload: `/Users/jhkim/Documents/MergeEduAgentFull/update/0427update/design_refs/classroom-upload-concept.png`
- Learning Session: `/Users/jhkim/Documents/MergeEduAgentFull/update/0427update/design_refs/session-concept.png`
- Report: `/Users/jhkim/Documents/MergeEduAgentFull/update/0427update/design_refs/report-concept.png`
- Auth: `/Users/jhkim/Documents/MergeEduAgentFull/update/0427update/design_refs/auth-concept.png`

## 공통 디자인 시스템

- `body` 배경은 `#ffffff` 단색으로 한다. 격자, 반복 패턴, 배경 그라디언트, 장식 오브젝트는 사용하지 않는다.
- 앱 표면은 흰 배경 위에 아주 옅은 `#f6f9fc`, `#eef6fb` 패널을 제한적으로 사용한다.
- 기존 파란색/청록색 정체성은 유지하되, CTA와 상태 강조에만 사용한다. 페이지 배경/큰 섹션 배경에는 그라디언트를 쓰지 않는다.
- 카드 반경은 8-12px를 기본으로 유지하고, 중첩 카드처럼 보이는 과도한 그림자/블러를 줄인다.
- `.page-shell`, `.app-topbar`, `.card`, `.btn`, `.input`, `.modal-panel`을 공통 토큰으로 정리한다.
- 모바일에서는 모든 주요 grid가 1열로 접히고, 버튼은 최소 40px 높이를 유지한다.
- 이미지 레퍼런스는 구조/분위기 참조용이다. `apps/web/src`에서 concept png를 import하거나 `background-image`, `url(...)`로 참조하지 않는다.

## Dashboard

- 현재 단순 카드 grid를 유지하되, 상단에 `dashboard-hero` 요약 영역을 추가한다.
- `dashboard-hero`는 작은 상태 pill, 제목/설명, 계정 역할별 보조 설명, 우측 미니 운영 패널로 구성한다. 미니 운영 패널은 기존 데이터(`classrooms.length`, 역할, 학생 초대 코드 등)만 사용하고 가짜 통계는 추가하지 않는다.
- 강의실 카드는 기존 `CLS` 배지만 두는 형태에서 벗어나 상단 accent bar, 강의실 첫 글자 badge, 역할별 microcopy, action footer를 가진다.
- `ClassroomCard`의 `canDelete` 기본값은 `false`로 바꾸어 학생 화면이나 미래 재사용에서 삭제 버튼이 노출되지 않게 한다.
- `add-classroom-card`는 dashed placeholder가 아니라 새 강의실 생성용 upload-style action tile로 보이게 한다.
- 학생의 empty state는 넓은 안내 패널로 정리하되 학생에게 강의실 생성/삭제 affordance는 보이지 않는다.

## Classroom

- 상단은 `classroom-hero`로 바꾸어 주차/학생/자료 관리의 목적을 한눈에 보이게 한다.
- teacher action buttons는 우측 toolbar에 유지하되, 버튼 군이 흩어지지 않게 한다.
- `InviteStudentPanel`은 이름/코드 입력과 참여 학생 목록이 좌우로 나뉜 `invite-grid` 레이아웃으로 바꾼다. 부모의 `canRenderClassroomTools && classroomId && isTeacher` gate를 유지하고, 컴포넌트에도 `isTeacher` prop을 전달해 false면 `null`을 반환한다.
- 주차 목록은 단순 카드가 아니라 `week-timeline` 느낌을 준다. 각 week card에는 왼쪽 marker, 주차 제목, 펼침 버튼, 메뉴 버튼이 있다.
- 펼친 week는 lecture rows를 작은 file table 느낌으로 보여준다.
- 접근 오류/로딩 상태에서는 기존처럼 데이터 표면을 숨기고 명확한 상태 카드만 표시한다.
- selection UI는 `teacherSelectionMode = isTeacher && selectionMode`로만 렌더링한다. 체크박스, 배너, 삭제 실행 UI가 학생에게 나타날 수 없어야 한다.
- 주차 펼침 버튼에는 `aria-expanded`, `aria-controls`를 부여한다. 주차 선택 체크박스는 40px 이상 label hit area와 접근 가능한 이름을 가진다.
- 주차 메뉴 popover는 완전한 menu keyboard behavior를 만들지 않는 한 `role="menu"`를 제거하고 일반 popover로 둔다. 메뉴 버튼은 최소 40px 정사각형이다.
- 레퍼런스에 보이는 설정, 초대 링크 복사, 전체 메일, 최상위 학습 시작 등 현재 기능에 없는 버튼은 구현하지 않는다.

## Lecture Upload Modal

- 모달은 흰 배경의 `upload-modal-panel`로 바꾸고, 설명 헤더와 form 영역을 구분한다.
- PDF input은 기본 파일 input을 유지하되, `upload-dropzone` 스타일 컨테이너 안에 표시한다.
- 파일을 선택하면 파일명 chip을 표시한다.
- 업로드/취소 버튼은 하단 우측에 고정된 액션 그룹으로 유지한다.
- 기존 portal, focus trap, `role="dialog"`, `aria-modal`, Escape/backdrop close, loading close guard, PDF validation은 그대로 유지한다.

## Learning Session

- `session-layout`은 문서 workspace와 AI tutor panel의 두 영역으로 분명히 나눈다.
- PDF 영역은 `document-stage` 느낌을 준다: toolbar header, document canvas background, 페이지 indicator.
- 채팅 영역은 `session-chat-shell`에 header를 추가하지 않고 CSS만으로 내부 spacing, sticky composer, agent label, bubble hierarchy를 개선한다.
- 사용자 bubble은 과한 gradient 대신 단색 primary surface로 유지하고, agent bubble은 흰 카드와 left accent를 사용한다.
- quiz type / binary widgets는 chip-grid 느낌으로 바꾸되 실제 button 동작은 유지한다.
- `session-heading`은 조밀한 product toolbar처럼 정리하고, 진행 상태 pill을 강조한다.
- 세션 높이는 viewport 상수 빼기 계산에 의존하지 않는다. `.session-page`를 grid/flex height container로 만들고 `.session-layout`은 `minmax(0, 1fr)`로 채운다.
- `.session-chat-shell`은 `overflow: hidden`, `.chat-panel`은 내부 스크롤, `.session-composer`는 sticky bottom으로 유지한다.
- PDF wheel zoom은 일반 wheel scroll을 가로채지 않는다. `Ctrl`/`Meta` + wheel일 때만 `preventDefault()` 후 zoom하거나, toolbar zoom만 사용한다.
- `.pdf-single-view`는 zoom 확대 시 상단/좌측이 접근 불가능해지지 않도록 `align-items: start; justify-items: center;`를 사용한다.
- 채팅 전송 icon-only 버튼은 `aria-label="전송"`을 가진다.
- quiz modal은 기존 submit/close 동작을 유지하되, 긴 퀴즈에서 header/action이 사라지지 않도록 sticky header/footer를 허용한다.

## Report

- report page는 단순 card stack에서 벗어나 `report-layout` 느낌을 준다.
- 학생 selector는 상단 넓은 selector panel로 유지하되, active 상태와 metrics가 더 명확한 analytics tile이 되게 한다.
- selected student meta는 pill strip로 정리한다.
- report hero는 score summary와 headline이 함께 보이는 analytics summary로 구성한다.
- competency list는 각 항목이 더 낮은 card density와 progress bar를 갖게 하며, evidence pill wrap이 깨지지 않게 한다.
- insight grid와 lecture flow는 흰 배경 위의 section panel로 구분한다.
- 학생 selector는 실제 교실에서 학생 수가 많아도 리포트를 아래로 무한히 밀지 않도록 `max-height: min(42dvh, 420px)`와 내부 스크롤 또는 compact grid를 둔다.
- report markdown 출력은 `markdown-content report-markdown` wrapper를 사용하거나 동등한 wrapping guard를 적용한다.
- 긴 한국어/영문/코드/수식이 score column이나 card 밖으로 밀리지 않게 `min-width: 0`, `overflow-wrap: anywhere`, `word-break: keep-all`을 적용한다.
- selector active/disabled CSS는 실제 DOM에 맞춰 `.active`, `:has(input:checked)`, `:has(input:disabled)`를 사용한다. 동작하지 않는 `[aria-checked]`/`:disabled label` selector에 의존하지 않는다.
- strengths, growthAreas, coachingInsights, recommendedActions, lectureInsights가 비어 있을 때 빈 패널만 보이지 않도록 간단한 empty row를 표시한다.

## Auth

- 기존 auth 기능은 유지한다.
- 격자 배경 제거에 맞춰 auth panel도 더 흰 화면에 자연스럽게 놓이도록 한다.
- auth rail은 solid soft panel을 사용한다. rail 배경에도 큰 그라디언트/패턴을 쓰지 않는다.

## 접근성/반응형 수용 기준

- `button`, `input`, `textarea`, `select`뿐 아니라 `a:focus-visible`, `.btn:focus-visible`, `summary:focus-visible`도 명확한 focus ring을 가진다.
- 모든 icon-only button은 접근 가능한 이름을 가진다.
- 주요 touch target은 최소 40px 높이/너비를 가진다.
- `dashboard-hero`, `classroom-hero`, `invite-grid`, `session-layout`, `report-summary-grid`, `report-insight-grid`는 `<=980px`에서 1열로 접힌다.
- `<=640px`에서 action group은 full-width wrapping을 하며 긴 버튼 텍스트가 overflow되지 않는다.
- 새 wrapper는 `minmax(0, 1fr)`, `min-width: 0`, `overflow-wrap: anywhere`를 사용해 긴 콘텐츠가 레이아웃을 밀지 않게 한다.
- `prefers-reduced-motion` 환경에서는 hover/entry animation이 과하게 동작하지 않게 한다.

## 권한/기능 보존 매트릭스

- 선생님: 강의실 생성/삭제, 학생 초대/제거, 주차 추가/삭제, 자료 업로드/삭제, 리포트 보기 가능.
- 학생: 초대된 강의실 보기, 주차 펼침, 세부 강의 보기, 학습 세션 시작만 가능.
- 학생에게 생성/삭제/초대/업로드/리포트 affordance가 보여서는 안 된다.
- 레이아웃 변경은 API 호출, 세션 이벤트, Gemini 연결, 리포트 분석 호출 방식을 변경하지 않는다.

## 구현 범위

- CSS: `apps/web/src/styles/global.css`
- Dashboard markup: `apps/web/src/routes/Dashboard.tsx`
- Classroom markup: `apps/web/src/routes/Classroom.tsx`
- Classroom card: `apps/web/src/components/cards/ClassroomCard.tsx`
- Invite panel: `apps/web/src/components/classrooms/InviteStudentPanel.tsx`
- Lecture upload modal: `apps/web/src/components/lectures/LectureUploaderModal.tsx`
- Session route markup/CSS hooks: `apps/web/src/routes/Session.tsx`
- PDF viewer behavior/style hooks: `apps/web/src/components/pdf/PdfViewer.tsx`
- Chat input accessibility/style hooks: `apps/web/src/components/chat/ChatInput.tsx`
- Report markup wrapper/classes: `apps/web/src/routes/ClassroomReport.tsx`

## 비목표

- 인증/권한/AI orchestration/세션 저장 로직은 변경하지 않는다.
- Gemini 프롬프트나 서버 데이터 구조는 변경하지 않는다.
- 이미지 레퍼런스의 가짜 텍스트를 그대로 코드에 넣지 않는다.
- 새 UI 라이브러리나 아이콘 패키지를 추가하지 않는다.

## 검증 기준

- `npm run build -w apps/web`가 통과한다.
- 배경 격자 CSS가 남아 있지 않다.
- `rg "design_refs|\\.png|\\.jpg|url\\(" apps/web/src`로 concept image import/reference가 없는지 확인한다.
- Comet에서 dashboard, classroom, upload modal, session, report 화면을 직접 열어 흰 배경과 새로운 구조를 확인한다.
- 기본 클릭 동작: 강의실 입장, 강의실 주차 펼침, 업로드 모달 열기/닫기, 학습 세션 페이지 이동/채팅 입력, 리포트 학생 선택이 깨지지 않는다.
