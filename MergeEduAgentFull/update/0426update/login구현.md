# 로그인/회원가입/역할 분리 구현 보고서

작성일: 2026-04-26

## 1. 최종 결과

- [x] 이메일/비밀번호 기반 회원가입을 구현했다.
- [x] 회원가입 시 `선생님` / `학생` 계정을 명시적으로 선택하도록 구현했다.
- [x] 이메일 인증 흐름을 구현했다.
- [x] 로그인/로그아웃/현재 사용자 조회 세션을 쿠키 기반으로 구현했다.
- [x] Google OAuth 진입점과 콜백 흐름을 구현했다.
- [x] 선생님은 강의실 생성, 주차 생성, 자료 추가, 학생 초대가 가능하도록 제한했다.
- [x] 학생은 초대받은 강의실만 볼 수 있고, 강의실 생성/자료 추가/학생 초대가 불가능하도록 제한했다.
- [x] 선생님은 학생 이름과 학생 코드 `#0000`의 4자리 코드를 함께 입력해야 강의실에 초대할 수 있다.
- [x] 기존 강의실을 새 로그인 체계로 이전할 수 있는 bootstrap claim 엔드포인트를 추가했다.
- [x] 서버 테스트, 빌드, Playwright E2E, Comet 브라우저 수동 테스트를 통과했다.

## 2. 산출 문서

- `update/0426update/auth-role-classroom-plan.md`: 전체 체크리스트 및 기능 계획
- `update/0426update/login-implementation-temp-plan.md`: 구현 전 임시 계획
- `update/0426update/login-implementation-design-temp.md`: 설계 및 정적 검증 반영 design 문서
- `update/0426update/login-browser-test-cases.md`: 실제 브라우저 검증용 테스트 케이스
- `update/0426update/login구현.md`: 최종 구현 보고서

## 3. 설계/검토 프로세스

- [x] 3개 planning sub-agent가 현재 코드 구조를 읽고 로그인/회원가입/역할 분리 설계안을 냈다.
- [x] 5개 static review sub-agent가 design 문서를 요구사항, 보안, 데이터 정합성, 테스트 가능성 관점에서 검토했다.
- [x] BLOCK 이슈를 design 문서에 반영한 뒤 구현 기준 문서로 확정했다.
- [x] 구현 후 5개 code review sub-agent가 실제 코드와 design 문서를 대조했다.
- [x] review에서 나온 이메일 인증 세션 탈취, 역할 기본값, 초대 검증 우회, 학생 세션 권한 유지, 학생 side effect, Google OAuth 미구현 등 주요 이슈를 수정했다.
- [x] 3개 test sub-agent가 서버 테스트, E2E 테스트, 수동 브라우저 체크리스트를 보강했다.

## 4. 구현 내용

### 서버

- `AuthService`를 추가해 비밀번호 해시, 이메일 인증 코드, 세션 발급/검증/폐기, Google OAuth 프로필 연동을 담당하게 했다.
- `auth` middleware를 추가해 인증 필요, 이메일 인증 필요, 선생님 권한 필요, 강의실/주차/강의 접근 가능 여부를 서버에서 검사한다.
- `/api/auth/signup`, `/api/auth/verify-email`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`를 추가했다.
- `/api/auth/google/status`, `/api/auth/google`, `/api/auth/google/callback`을 추가했다.
- 선생님 전용 강의실 생성/삭제, 주차 생성/삭제, 자료 추가 API를 서버에서 차단한다.
- 학생은 초대된 강의실, 그 안의 주차/강의, 해당 강의의 세션만 접근할 수 있게 했다.
- 학생 초대 API는 선생님 소유 강의실 안에서만 동작하며, 학생 이름과 4자리 코드가 동시에 맞아야 초대된다.
- 업로드 파일은 `/api/uploads/:fileName`을 통해 권한 검사 후 제공하도록 바꿨다.
- 기존 무소유 강의실을 로그인 선생님 계정에 귀속시키는 bootstrap claim 엔드포인트를 추가했다.

### 프론트엔드

- `AuthProvider`, `ProtectedRoute`, `RequireRole`을 추가해 화면 단에서 인증 상태를 일관되게 처리한다.
- `/login`, `/signup`, `/verify-email` 라우트를 추가했다.
- 회원가입 화면에서 선생님/학생 역할을 선택할 수 있게 했다.
- 미인증 사용자는 인증 화면으로 이동하고, 인증 완료 후 대시보드로 이동한다.
- 상단 바에 사용자 이름, 역할 배지, 학생 초대 코드, 로그아웃을 표시한다.
- 선생님 대시보드는 강의실 생성/삭제를 제공한다.
- 학생 대시보드는 초대받은 강의실만 표시한다.
- 학생에게는 자료 추가, 주차 추가/삭제, 학생 초대, 리포트 버튼이 보이지 않도록 했다.

## 5. 보안/권한 원칙

- 역할은 클라이언트 표시만 믿지 않고 서버 라우트에서 다시 검사한다.
- 회원가입 role은 `teacher` 또는 `student`만 허용하며, 잘못된 값은 거부한다.
- 이메일 인증 전 로그인 세션 발급을 차단한다.
- 이미 인증된 사용자의 인증 코드 재사용으로 세션이 새로 발급되지 않도록 막았다.
- 학생 초대는 이름과 4자리 코드가 모두 맞아야 하며, 초대 검색과 초대 실행 모두 선생님 소유 강의실로 제한한다.
- 학생이 초대 해제된 뒤 기존 세션 이벤트를 계속 쓰는 경우도 서버에서 다시 차단한다.
- 업로드 파일은 파일명만으로 직접 공개하지 않고, 강의 접근 권한을 확인한 뒤 내려준다.
- Same-origin CSRF 가드를 추가하고 localhost/127.0.0.1 개발 환경 alias를 허용했다.

## 6. 자동 검증 결과

- [x] `npm run test -w apps/server`
  - 결과: 13개 파일, 65개 테스트 통과
- [x] `npm run build`
  - 결과: 통과
- [x] `npm run test:e2e`
  - 결과: Chromium E2E 1개 통과

## 7. Comet 브라우저 수동 검증 결과

테스트 환경: `http://127.0.0.1:5180`

- [x] 선생님 계정 `manual-teacher-426@example.com` 회원가입
- [x] 개발용 인증 코드로 이메일 인증
- [x] 선생님 대시보드 진입
- [x] `Manual Test Classroom` 강의실 생성
- [x] 학생 계정 `manual-student-426@example.com` 회원가입
- [x] 학생 인증 후 학생 코드 `#8634` 표시 확인
- [x] 학생 대시보드에서 초대 전 강의실이 보이지 않는 것 확인
- [x] 선생님 계정으로 다시 로그인
- [x] 강의실 안에서 `Manual Student` + `8634` 입력 후 학생 초대 성공 확인
- [x] 학생 계정으로 접속했을 때 초대받은 `Manual Test Classroom`만 표시되는 것 확인
- [x] 학생 강의실 화면에서 `학생 초대`, `+ 주차 추가`, `선택 주차 삭제`, 자료 추가, 리포트 버튼이 보이지 않는 것 확인

## 8. 남은 운영 메모

- 실제 Google OAuth를 운영하려면 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` 설정이 필요하다.
- 실제 메일 발송은 현재 개발 모드 인증 코드 노출을 기준으로 검증했다. 운영에서는 메일 provider를 붙이고 개발 코드 노출을 꺼야 한다.
- 제공 PDF를 이용한 강의 에이전트 본 테스트는 AI bridge와 외부 모델 설정이 연결된 실행 환경에서 별도 수행하는 것이 좋다. 이번 작업에서는 로그인/권한 경계와 학생/선생 계정 분리를 중심으로 검증했다.

## 9. 주요 변경 파일

- `apps/server/src/services/auth/AuthService.ts`
- `apps/server/src/middleware/auth.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/routes/students.ts`
- `apps/server/src/routes/classrooms.ts`
- `apps/server/src/routes/weeks.ts`
- `apps/server/src/routes/lectures.ts`
- `apps/server/src/routes/session.ts`
- `apps/server/src/routes/uploads.ts`
- `apps/server/src/services/storage/JsonStore.ts`
- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/auth/ProtectedRoute.tsx`
- `apps/web/src/auth/RequireRole.tsx`
- `apps/web/src/routes/Login.tsx`
- `apps/web/src/routes/Signup.tsx`
- `apps/web/src/routes/VerifyEmail.tsx`
- `apps/web/src/routes/Dashboard.tsx`
- `apps/web/src/routes/Classroom.tsx`
- `apps/web/src/components/classrooms/InviteStudentPanel.tsx`
- `e2e/auth-role.spec.ts`
- `apps/server/src/tests/authFlow.test.ts`
- `apps/server/src/tests/jsonStore.test.ts`
