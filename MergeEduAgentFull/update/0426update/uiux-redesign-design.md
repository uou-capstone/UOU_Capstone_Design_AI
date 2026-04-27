# 0426 UI/UX Redesign Design

## 기준 컨셉

- 이미지 생성 컨셉: `/Users/jhkim/.codex/generated_images/019dc825-979d-7293-915e-59a6a244d069/ig_031b4d59ce8be2090169edf271e3748191a01814d0d1225749.png`
- 방향: 밝은 교육용 SaaS, 낮은 채도의 mist-blue 배경, 흰색 작업면, 선명한 ink 텍스트, blue/teal/amber/coral 포인트.
- 원칙: 현재 기능 정보 구조를 유지하고, 생성 이미지에 보이는 허구 메뉴나 장식 요소는 구현하지 않는다.
- 카드 반경은 기존 18px 계열에서 더 정돈된 8-12px 계열로 낮추고, 중첩 카드 느낌을 줄인다.
- 배경 장식은 그라디언트 오브/보케가 아니라 얇은 grid, subtle wash, panel shadow 정도로 제한한다.

## 화면 인벤토리

1. 인증 화면
   - `/login`, `/signup`, `/verify-email`
   - 목적: 사용자가 역할과 계정 상태를 빠르게 이해하고 로그인/회원가입을 완료한다.
   - 개선: 좌측 brand/benefit panel, 우측 compact form panel, role segmented control, Google/email 인증 버튼 위계 정리.

2. 메인 대시보드
   - `/`
   - 목적: 교사는 강의실 생성/입장, 학생은 초대받은 강의실 입장.
   - 개선: 상단 compact topbar, 역할별 subtitle, classroom cards의 상태/액션 구분, 추가 카드의 CTA 명확화.

3. 강의실 내부
   - `/classrooms/:classroomId`
   - 목적: 주차/세부 강의/학생 초대/리포트 진입을 한 화면에서 관리.
   - 개선: toolbar actions 정돈, 학생 초대 영역을 utility panel로 변경, week row를 table-like list로 정돈, lecture row를 명확한 학습 시작 surface로 변경.

4. 학습 세션
   - `/session/:lectureId`
   - 목적: PDF를 보며 AI 에이전트와 대화하고 퀴즈/채점을 수행.
   - 개선: PDF viewer와 chat panel을 작업 도구처럼 분리, 상단 progress strip, chat bubble contrast 개선, input composer 고정감, quiz modal의 문항/채점 결과 시각 위계 개선.

5. 학생별 리포트
   - `/classrooms/:classroomId/report`
   - 목적: 교사가 학생별 학습 기록을 바탕으로 Gemini 역량 리포트를 조회/생성.
   - 개선: 학생 selector card grid, report hero score, metric chips, competency bars, lecture flow의 분석 화면 톤을 전체 디자인 시스템과 통일.

## 공통 디자인 시스템

- 색상 토큰
  - `--bg-main`: `#f7f9fc`
  - `--surface`: `#ffffff`
  - `--surface-soft`: `#f1f6fb`
  - `--text`: `#172033`
  - `--muted`: `#637089`
  - `--line`: `rgba(23, 32, 51, 0.10)`
  - `--accent`: `#2f72d6`
  - `--teal`: `#21a6a1`
  - `--amber`: `#f1a531`
  - `--coral`: `#ec6f5f`
  - `--success`: `#14865d`
  - `--danger`: `#d64a4a`

- 형태
  - 주요 shell: max-width 1180-1240px.
  - card radius 10-12px, button/input radius 8-10px.
  - shadow는 `0 16px 40px rgba(23,32,51,.08)` 이하로 가볍게.
  - button은 primary/secondary/danger/icon 형태로 구분.

- 타이포그래피
  - 기존 Manrope/Noto Sans KR 유지.
  - H1 30-34px, panel title 17-20px, body 14-15px, meta 12-13px.
  - letter spacing은 0 유지.

- 컴포넌트 방향
  - `AppTopBar`: pill형 topbar가 아니라 얇은 sticky product bar.
  - `AuthLayout`: two-column auth shell. 단, 로그인 화면에는 role segmented control을 추가하지 않고 기존 Google login `role=student` 정책을 유지한다.
  - `ClassroomCard`: badge + title + role-aware CTA.
  - `Week/Lecture rows`: card grid가 아니라 scan-friendly list.
  - `ChatBubble`: 에이전트별 과한 어두운 gradient 제거, 밝은 bubble + agent badge.
  - `QuizModal`: question card, result panel, answer option active/graded 상태 강화.
  - `Report`: 현재 기능 유지, 공통 tokens로 더 얇고 고급스럽게.

## 역할/권한 보존 매트릭스

| 영역 | 선생님 | 학생 | 불변 조건 |
| --- | --- | --- | --- |
| Topbar | 이름, `선생님`, 로그아웃 | 이름, `학생`, `#inviteCode`, 로그아웃 | 학생 초대 코드 노출은 강의실 초대 흐름과 연결되므로 유지 |
| 대시보드 | 강의실 목록, 강의실 추가, 강의실 삭제, 입장 | 초대받은 강의실 목록, 입장 | 학생은 강의실 생성/삭제 불가 |
| 강의실 내부 | 주차 추가/삭제, 선택 삭제, 강의 업로드/삭제, 학생 초대/제거, 학생 리포트 진입, 학습 시작 | 주차/강의 목록 조회, 학습 시작 | 학생에게 교사 전용 CTA가 보이면 실패 |
| 학습 세션 | 접근 가능 시 PDF/채팅/퀴즈 동일 | 접근 가능 시 PDF/채팅/퀴즈 동일 | 페이지 이동, 채팅, 퀴즈, 저장 종료 이벤트는 동일하게 유지 |
| 학생 리포트 | 접근 가능, 학생별 분석/재분석/조회 | 접근 불가 | `RequireRole allow={["teacher"]}` 유지 |

## 화면별 상태 IA

- 인증
  - 로그인: authenticated redirect, unverified redirect, next redirect, Google OAuth enabled/disabled, email/password error.
  - 회원가입: teacher/student role 선택, Google signup role query, dev verification code handoff.
  - 이메일 인증: pending email, dev verification code 표시, success/error 상태.
  - 코드 재전송은 현재 기능에 없으므로 이번 UI/UX 개편에서 추가하지 않는다.
  - 폼은 placeholder만 의존하지 않고 visible label, `autocomplete`, `aria-invalid`, `aria-describedby`, `aria-live` 오류 영역을 가진다.

- 대시보드
  - loading, empty classroom, teacher add modal, delete confirm, delete error.
  - 긴 강의실명은 줄바꿈되며 카드/버튼 밖으로 새지 않는다.

- 강의실 내부
  - teacher toolbar, student read-only toolbar, selection delete mode, week menu open/closed, no lecture empty state, upload modal loading/error, invite candidate found/not found, enrolled student list/remove.
  - PDF 업로드의 파일 선택, MIME 검증, `onSubmit({ title, file })` 전달은 불변이다.

- 학습 세션
  - boot loading/error, AI disconnected alert, session entered retry, page changed, streaming draft, thought summary toggle, binary decision, quiz type picker, quiz modal, grading insight stream, save and exit.
  - desktop session shell은 `100dvh` 기반으로 계산한다. CSS 변수 `--topbar-height`, `--session-header-height`, `--session-gap`을 두고 PDF panel과 chat panel은 `min-height: 0`을 가진 독립 스크롤 영역이 된다.
  - mobile session shell은 stacked layout을 사용한다. PDF panel은 최소 `55dvh`, chat panel은 최소 `62dvh`로 보여주되 전체 페이지 스크롤을 허용한다. composer는 chat panel 하단에 sticky로 두고 모바일 키보드가 올라와도 입력창과 전송 버튼이 보이도록 `env(safe-area-inset-bottom)` 여백을 둔다.

- 학생 리포트
  - student list loading/empty, selected student loading, no saved report empty state, analyze/reanalyze streaming, 6단계 progress, Gemini thought stream, fallback note, sparse data badge, saved report metadata.
  - 분석 중에는 학생 선택/재분석 버튼 disabled 정책을 유지한다.

## 이벤트/로직 불변 계약

- 수정 금지 파일
  - `apps/server/src/**`
  - `apps/web/src/api/**`
  - `apps/web/src/auth/AuthProvider.tsx`
  - `apps/web/src/auth/ProtectedRoute.tsx`
  - `apps/web/src/auth/RequireRole.tsx`

- 수정 가능 범위
  - CSS token/class 추가 및 화면 className 변경.
  - 순수 presentational markup 추가.
  - visible label, aria 속성, focus/keyboard 접근성 보강.
  - inline style의 class 치환.

- `Session.tsx` 불변 심볼
  - `loadSession`, `runEvent`, `sendSessionEventStream` 호출 흐름, optimistic page update, `handleQuizSubmit`, `handleQuizTypeSelect`, `handleBinaryDecision`, `handleChatSend`, `handleSaveAndExit`.
  - 보존 이벤트: `SESSION_ENTERED`, `START_EXPLANATION_DECISION`, `USER_MESSAGE`, `PAGE_CHANGED`, `QUIZ_TYPE_SELECTED`, `QUIZ_DECISION`, `QUIZ_SUBMITTED`, `NEXT_PAGE_DECISION`, `REVIEW_DECISION`, `RETEST_DECISION`, `SAVE_AND_EXIT`.

- `ClassroomReport.tsx` 불변 심볼
  - `visibleReport`의 `reportScope + classroomId + studentUserId` guard.
  - `refreshStudents`, `refreshSelectedReport`, `runAnalysis`의 request sequence/stale response 방어.
  - `analyzeStudentCompetencyReportStream` 호출과 final payload 검증.

- 인증 불변 조건
  - Login의 authenticated/unverified redirect와 next redirect 유지.
  - Signup의 role segmented control은 회원가입 전용.
  - Google login URL의 현재 정책은 변경하지 않는다.
  - VerifyEmail의 pending email/dev code/state handoff 유지.

- 기존 CSS token alias 유지
  - 새 토큰을 추가하되 `--card`, `--card-border`, `--accent-2`는 제거하지 않고 새 토큰의 alias로 유지한다.

## 접근성/반응형/오버플로 수용 기준

- 공통
  - 360px, 768px, 1024px, desktop 폭에서 텍스트/버튼/카드가 겹치지 않는다.
  - flex/grid 자식에는 필요한 곳에 `min-width: 0`, 텍스트에는 `overflow-wrap: anywhere`를 적용한다.
  - 긴 이메일, 긴 강의실명, 긴 학생명, 긴 마크다운, 긴 수식/코드가 부모 밖으로 새지 않는다.
  - 색상만으로 선택/상태를 전달하지 않고 텍스트, 아이콘, aria 상태를 함께 둔다.

- 모달
  - Dashboard add modal, lecture upload modal, quiz modal은 `role="dialog"`, `aria-modal`, 제목 연결을 가진다.
  - ESC/backdrop close 정책을 유지하고, 닫기 불가 상태인 quiz modal은 닫기 버튼 disabled가 명확해야 한다.
  - 최초 포커스와 닫기 후 포커스 복귀를 구현한다.
  - 모달이 열려 있는 동안 `Tab`/`Shift+Tab` 포커스는 모달 내부에서 순환한다.
  - 배경은 `aria-hidden` 또는 동등한 inert 처리로 보조기술/키보드 포커스 대상에서 제외한다.

- 폼
  - 로그인/회원가입/인증/학생 초대 필드는 visible label을 가진다.
  - error/success는 `aria-live`로 노출한다.
  - email/code 입력은 적절한 `autocomplete`, `inputMode`를 가진다.

- 리포트 학생 selector
  - `radiogroup`/`radio` 또는 동등한 선택 semantics를 사용한다.
  - 선택 상태는 `aria-checked` 또는 `aria-selected`로 노출한다.
  - keyboard focus ring이 보이고, active 상태가 색상 외 텍스트 또는 check 표시로 구분된다.

- 퀴즈
  - MCQ/OX/SHORT/ESSAY renderer는 기존 answer shape를 유지한다.
  - 모든 문항 답변 전 채점 불가, 채점 완료 후 재채점 disabled, 문항별 피드백과 총점 summary 유지.
  - `disableClose`, 채점 에이전트 스트리밍 패널 유지.
  - markdown, `pre`, `.katex-display`는 horizontal scroll 또는 wrapping 규칙을 가진다.

## CSS/컴포넌트 이관 전략

1. 새 token을 추가하고 기존 token alias를 유지한다.
2. `.card`, `.btn`, `.grid`를 한 번에 급격히 변경하지 않고, 다음 primitive를 추가해 화면별 점진 적용한다.
   - `.surface`, `.panel`, `.toolbar`, `.list-row`, `.option-card`, `.modal-panel`, `.alert`, `.form-field`, `.form-actions`, `.text-muted`, `.eyebrow`.
3. 하드코딩 색상/gradient와 레이아웃 inline style은 class로 이동하되, 동적 width/progress/conic-gradient처럼 런타임 값은 inline으로 남긴다.
4. 큰 route는 필요한 범위에서 presentational subcomponent로만 분리한다.
   - `ClassroomToolbar`, `WeekRow`, `LectureRow`.
   - `SessionHeader`, `SessionChatShell`.
   - `ReportStudentSelector`, `ReportProgressCard`, `ReportHero`, `CompetencyPanel`.
5. 구현 순서는 인증 → 대시보드/강의실 → 세션/퀴즈 → 리포트로 진행한다.

## 구현 계획

1. CSS token과 primitive class 추가
   - `global.css`에 새 token, 기존 token alias, primitive class를 추가한다.
   - `.card`, `.btn`, `.grid`는 호환성을 유지하며 점진적으로만 조정한다.
   - inline style은 레이아웃/간격/색상부터 class로 치환한다.

2. 인증 화면 개편
   - `AuthLayout.tsx`, `Login.tsx`, `Signup.tsx`, `VerifyEmail.tsx`, `RoleSegmentedControl.tsx`.
   - 로그인/회원가입/이메일 인증에서 공통 visual rail과 form panel을 사용한다.
   - Login Google role 정책, redirect, pending verification 흐름은 변경하지 않는다.

3. 대시보드/강의실 개편
   - `Dashboard.tsx`, `ClassroomCard.tsx`, `Classroom.tsx`, `InviteStudentPanel.tsx`, `LectureUploaderModal.tsx`.
   - 역할별 helper copy는 유지하되 카드 밀도와 액션 위치를 재정렬한다.
   - 업로드/초대/삭제 handler와 validation은 변경하지 않는다.

4. 학습 세션/퀴즈 개편
   - `Session.tsx`, `PdfViewer.tsx`, `ChatPanel.tsx`, `ChatBubble.tsx`, `ChatInput.tsx`, quiz renderer/modal.
   - 현재 스트리밍/퀴즈/페이지 이동 로직은 건드리지 않고 시각 구조만 개선한다.
   - 세션 이벤트 함수와 quiz answer shape는 변경하지 않는다.

5. 리포트 화면 개편
   - `ClassroomReport.tsx`와 관련 CSS.
   - 학생별 데이터 분리 로직은 유지하고 selector/report hierarchy만 조정한다.
   - request sequence/stale response 방어와 `visibleReport` guard는 변경하지 않는다.

6. 검증
   - 정적 검증: 서브 에이전트 4개가 디자인 문서 검토.
   - 코드 구현 후: `npm run build -w apps/web`, `npm run build -w apps/server`, `npm run test -w apps/server`.
   - 코드 리뷰: 서브 에이전트 4개가 UI 코드/회귀 위험 검토.
   - 실제 검증: Comet에서 로그인, 대시보드, 강의실, 세션, 퀴즈, 리포트 화면을 마우스/키보드/스크롤로 확인.
   - 가능하면 `npm run test:e2e`도 실행하되, 환경상 실패하면 실패 원인을 기록한다.

## 화면별 수동 수용 기준

- 로그인/회원가입
  - 로그인 성공 시 next 또는 `/`로 이동한다.
  - 미인증 계정은 `/verify-email`로 이동한다.
  - Google 버튼 disabled/enabled 상태가 보인다.
  - 회원가입 role 선택이 teacher/student를 명확히 보여준다.

- 대시보드
  - 교사는 강의실 추가/삭제/입장 가능.
  - 학생은 초대받은 강의실 입장만 가능하고 추가/삭제 CTA가 없다.
  - 빈 상태가 역할별로 다르게 보인다.

- 강의실
  - 교사는 학생 초대, 주차 추가/삭제, 강의 업로드/삭제, 학생 리포트 진입 가능.
  - 학생은 학습 시작 외 교사 액션이 보이지 않는다.
  - 선택 삭제 모드에서 선택 수와 삭제 실행 disabled 상태가 맞다.

- 세션/퀴즈
  - PDF 이전/다음/zoom이 보이고 페이지 변경 시 현재 페이지가 갱신된다.
  - 사용자 질문 입력 후 optimistic message와 AI stream draft가 보인다.
  - 다음 페이지/퀴즈 선택 widget이 기존처럼 동작한다.
  - 퀴즈 모달에서 모든 답 입력 전 채점 불가, 채점 후 총점/문항 피드백 표시.
  - 저장 및 종료가 대시보드로 이동한다.

- 리포트
  - 학생 selector에서 우등생/부진 학생을 전환하면 서로 다른 점수/퀴즈 평균/질문 수가 보인다.
  - 분석 중 6단계 progress와 Gemini thought stream이 보인다.
  - fallback note와 sparse data badge가 필요한 경우 보인다.
  - 학생 계정은 리포트 URL 접근이 차단된다.

## 비목표

- Gemini 프롬프트, PDF 업로드, 학생 리포트 생성 로직은 수정하지 않는다.
- 인증/권한 정책은 수정하지 않는다.
- API client, AuthProvider, ProtectedRoute, RequireRole, 서버 코드는 수정하지 않는다.
- 생성 이미지의 임의 메뉴, 가짜 통계, 마케팅용 hero section은 도입하지 않는다.
- 기능을 막는 skeleton-only 화면이나 장식용 mock data를 만들지 않는다.
