# 로그인/회원가입/역할 권한 구현 설계 임시 문서

## 1. 목표

현재 앱을 계정 기반 서비스로 확장한다. 사용자는 이메일 또는 Google 계정으로 가입할 수 있고, 가입 시 선생님 또는 학생 역할을 선택한다. 선생님은 강의실, 주차, PDF 자료를 관리하고 학생을 초대한다. 학생은 초대받은 강의실과 선생님이 올린 자료만 볼 수 있으며, 학습 세션과 퀴즈 기록은 사용자별로 분리된다.

## 2. 이번 구현 범위

- [x] 이메일 회원가입, 이메일 인증 코드, 로그인, 로그아웃, 현재 사용자 조회
- [x] 회원가입 시 `teacher` / `student` 역할 선택
- [x] HttpOnly 쿠키 기반 서버 세션
- [x] 비밀번호 `scrypt` 해시 저장
- [x] 선생님/학생 역할별 API 권한 검사
- [x] 학생 초대용 `이름 + 4자리 코드` 검색 및 강의실 등록
- [x] 학생은 초대받은 강의실만 조회
- [x] 학생은 강의실/주차/자료 생성, 삭제, 업로드 불가
- [x] 사용자별 학습 세션 분리
- [x] 인증/권한을 통과한 사용자만 PDF 파일 조회
- [x] Google OAuth는 환경 변수가 있을 때만 활성화되는 경로 제공

## 3. 이번 구현 비범위

- 실제 SMTP 발송 연동은 제외한다. 개발 환경에서는 명시적 dev flag가 켜졌을 때만 인증 코드를 화면에 보여준다.
- 운영용 관리자 콘솔과 역할 변경 승인 시스템은 제외한다.
- 학생별 상세 리포트 UI는 이번 범위에서 최소화한다. 기존 리포트 화면은 강의실 소유 선생님 전용 classroom aggregate로 유지한다.
- 외부 인증 SaaS 전환은 추후 가능성을 남기되 이번에는 자체 서버 세션으로 구현한다.

## 4. 보안 원칙

- `/api/auth/*`와 `/api/health`를 제외한 모든 API는 인증 완료 사용자를 요구한다.
- 인증/권한 검사는 스트리밍 헤더를 flush하기 전에 끝낸다.
- 프론트엔드에서 버튼을 숨겨도 서버 API에서 반드시 권한을 다시 검사한다.
- 세션 토큰 원문은 서버에 저장하지 않고 SHA-256 해시만 저장한다.
- 비밀번호는 Node `crypto.scrypt`와 사용자별 salt로 저장한다.
- 이메일 인증 코드는 해시해서 저장하고 만료 시간, 시도 횟수, 성공 후 삭제를 적용한다.
- 학생 초대용 4자리 코드는 권한 키가 아니라 학생 식별 보조값이다.
- 학생 초대 검색/등록에는 rate limit, 정확한 이름 매칭, 인증된 학생 계정 검사, 소유 교사 검사, 감사 로그를 적용한다.
- PDF 파일 URL도 인증/권한 검사를 통과해야 내려준다.
- 학생별 학습 세션은 절대 공유하지 않는다.
- 쿠키 기반 세션을 쓰므로 상태 변경 API에는 Origin/Referer 검사를 적용한다.
- 레거시 강의실을 첫 번째 가입 교사에게 자동 이전하지 않는다.

## 5. 데이터 모델

### 5.1 새 타입

`apps/server/src/types/domain.ts`에 추가한다.

```ts
export type UserRole = "teacher" | "student";

export interface User {
  id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  role: UserRole;
  inviteCode: string;
  passwordHash?: string;
  passwordSalt?: string;
  emailVerifiedAt?: IsoString;
  emailVerificationCodeHash?: string;
  emailVerificationExpiresAt?: IsoString;
  emailVerificationAttempts?: number;
  googleSub?: string;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: IsoString;
  expiresAt: IsoString;
  revokedAt?: IsoString;
  userAgent?: string;
}

export interface ClassroomEnrollment {
  id: string;
  classroomId: string;
  studentUserId: string;
  invitedByTeacherId: string;
  createdAt: IsoString;
}

export interface InviteAuditLogEntry {
  id: string;
  classroomId: string;
  teacherId: string;
  studentUserId?: string;
  action: "SEARCH" | "ENROLL" | "REMOVE";
  result: "SUCCESS" | "NOT_FOUND" | "FORBIDDEN" | "DUPLICATE";
  createdAt: IsoString;
}

export interface OAuthState {
  id: string;
  stateHash: string;
  role: UserRole;
  createdAt: IsoString;
  expiresAt: IsoString;
}

export interface RateLimitBucket {
  key: string;
  count: number;
  resetAt: IsoString;
}
```

### 5.2 기존 타입 확장

- `Classroom.teacherId?: string`
  - 기존 데이터 호환을 위해 타입은 optional로 두되, 새 데이터는 항상 채운다.
- `SessionState.ownerUserId?: string`
  - 기존 세션 호환을 위해 optional로 두되, 새 사용자 경로는 항상 채운다.
- `StudentCompetencyReport.reportScope?: "CLASSROOM_AGGREGATE" | "STUDENT"`
- `StudentCompetencyReport.studentUserId?: string`
  - 기존 저장본은 `CLASSROOM_AGGREGATE`로 간주한다.

### 5.3 JSON 파일

`apps/server/src/services/storage/paths.ts`에 추가한다.

- `users.json`
- `auth-sessions.json`
- `classroom-enrollments.json`
- `oauth-states.json`
- `invite-audit-log.json`
- `rate-limits.json`

## 6. 저장소 설계

`apps/server/src/services/storage/JsonStore.ts`에 아래 API를 추가한다.

`JsonStore`는 테스트 가능한 형태로 생성자를 받는다.

```ts
interface JsonStoreOptions {
  dataDir?: string;
  uploadDir?: string;
}

new JsonStore(options?: JsonStoreOptions)
```

기본값은 기존 `appConfig.dataDir`, `appConfig.uploadDir`이고, 테스트에서는 temp dir을 직접 주입한다. `paths.ts`의 singleton은 기본 path 생성 helper로 남기거나 `createStoragePaths(options)` 함수로 바꾼다.

### 사용자/인증

- `listUsers()`
- `getUser(userId)`
- `getUserByEmail(emailNormalized)`
- `getUserByGoogleSub(googleSub)`
- `createUser(input)`
- `updateUser(userId, patch)`
- `findStudentByInviteTag(displayName, inviteCode)`
- `createAuthSession(input)`
- `getAuthSessionByTokenHash(tokenHash)`
- `revokeAuthSession(sessionId)`
- `deleteExpiredAuthSessions(now)`
- `createOAuthState(input)`
- `consumeOAuthState(stateHash)`
- `deleteExpiredOAuthStates(now)`
- `checkAndIncrementRateLimit(key, limit, windowMs)`

### 강의실 소유권/등록

- `getClassroom(classroomId)`
- `listClassroomsForUser(user)`
- `createClassroom(title, teacherId)`
- `claimLegacyClassroomsForTeacher(teacherId, bootstrapSecret)`
- `listEnrollmentsByClassroom(classroomId)`
- `listEnrollmentsByStudent(studentUserId)`
- `isStudentEnrolled(classroomId, studentUserId)`
- `enrollStudent(classroomId, studentUserId, invitedByTeacherId)`
- `removeEnrollment(classroomId, studentUserId)`
- `deleteEnrollmentsByClassroom(classroomId)`
- `appendInviteAuditLog(entry)`

### 주차/강의 역참조

- `getWeek(weekId)`
- `getClassroomByWeek(weekId)`
- `getClassroomByLecture(lectureId)`
- `findLectureByPdfFileName(fileName)`

### 사용자별 세션

- `sessionIdFromLecture(lectureId)`는 레거시 호환 전용으로 유지한다.
- `getSessionByLectureForOwner(lectureId, ownerUserId)`
- `getOrCreateSessionByLectureForOwner(lectureId, ownerUserId)`
- `createSession(lectureId, ownerUserId)`
- `listSessionsByLecture(lectureId)`
- `deleteSessionsByLecture(lectureId)`
- `deleteSessionsByClassroom(classroomId)`

새 세션 ID는 `ses_${crypto.randomBytes(16).toString("hex")}`처럼 랜덤으로 만든다. 세션 파일 내부에 `lectureId`와 `ownerUserId`를 저장하고, `getSessionByLectureForOwner`는 세션 파일을 조회해 해당 조합을 찾는다. 기존 `ses_${lectureId}`는 레거시 확인용으로만 남기고 인증 사용자 경로에서는 재사용하거나 자동 복사하지 않는다.

강의 삭제 시 `deleteSessionsByLecture`는 레거시 `ses_${lectureId}.json`과 새 랜덤 세션 중 `lectureId`가 같은 모든 파일을 제거한다. 강의실 삭제 시에는 주차, 강의, 강의실 세션, 학생 등록, 리포트 저장본을 함께 정리한다.

## 7. 인증 서비스

`apps/server/src/services/auth/AuthService.ts`를 추가한다.

### 책임

- 이메일 정규화
- 비밀번호 해시 생성/검증
- 이메일 인증 코드 생성/검증
- 세션 토큰 생성/해시/검증
- Google OAuth 시작/콜백 처리
- API 응답용 사용자 공개 필드 변환

### 세션 쿠키

- 이름: `appConfig.authCookieName`
- 속성: `HttpOnly`, `SameSite=Lax`, `Path=/`
- 운영 환경에서는 `Secure`
- 기본 만료: 14일
- 로그인과 OAuth 콜백마다 새 세션을 생성한다.
- `loadAuth`는 세션 만료와 폐기 여부를 검사한다.
- 로그아웃은 같은 cookie 속성으로 쿠키를 삭제한다.

### CSRF/Origin 방어

- `GET`, `HEAD`, `OPTIONS`를 제외한 모든 상태 변경 요청에서 `Origin` 또는 `Referer`를 검사한다.
- 허용 origin은 `APP_ORIGIN`, 개발 기본값 `http://localhost:${WEB_PORT}`로 제한한다.
- Origin이 없고 JSON/API 상태 변경 요청이면 거부한다.

### Rate limit

JSON 저장소 기반 간단한 window rate limit을 둔다.

- 회원가입: IP 기준
- 로그인: IP + 이메일 기준
- 이메일 인증: IP + 이메일 기준
- 학생 검색/초대: 교사 ID + IP 기준

## 8. 서버 미들웨어

`apps/server/src/middleware/auth.ts`를 추가한다.

- `loadAuth`
  - 쿠키에서 세션 토큰을 읽고 유효한 사용자를 `req.authUser`에 붙인다.
- `requireAuth`
  - 로그인하지 않았으면 `401`
- `requireVerifiedEmail`
  - 이메일 인증 전이면 `403 EMAIL_NOT_VERIFIED`
- `requireTeacher`
  - 선생님이 아니면 `403`
- `requireSameOriginForUnsafeMethods`
  - unsafe method에서 Origin/Referer를 검사한다.
- `ensureClassroomReadable`
  - 선생님 소유 또는 학생 등록 여부 확인
- `ensureClassroomOwnedByTeacher`
  - 강의실 소유 선생님만 허용
- `ensureWeekReadable`, `ensureWeekWritable`
- `ensureLectureReadable`, `ensureLectureWritable`
- `ensureSessionOwner`
  - 세션을 로드하고 `session.ownerUserId === req.authUser.id`인지 직접 비교한다. 세션 ID 모양이나 suffix는 신뢰하지 않는다.

## 9. API 계약

### 인증 API

- `POST /api/auth/register`
- `POST /api/auth/signup`
  - 동일한 회원가입 동작을 제공한다.
  - body: `{ email, password, displayName, role }`
  - response: `{ ok, data: { user }, devVerificationCode? }`
  - `devVerificationCode`는 `NODE_ENV !== "production"`이고 `AUTH_DEV_EXPOSE_VERIFICATION_CODE=true`일 때만 반환한다.
- `POST /api/auth/verify-email`
  - body: `{ email, code }`
- `POST /api/auth/login`
  - body: `{ email, password }`
  - 성공 시 세션 쿠키 설정
- `POST /api/auth/logout`
  - 세션 폐기 및 쿠키 삭제
- `GET /api/auth/me`
  - 현재 사용자 조회
- `GET /api/auth/google/status`
  - Google OAuth 활성화 여부
- `GET /api/auth/google`
  - Google OAuth 시작
- `GET /api/auth/google/callback`
  - Google OAuth 콜백

Google OAuth 환경 변수는 모두 optional이다.

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`

필수 값이 없으면 `/api/auth/google/status`는 `{ enabled: false }`를 반환하고, `/api/auth/google`은 `503`을 반환한다. OAuth 콜백 구현 시에는 `state`를 1회성으로 소비하고, Google ID token의 `iss`, `aud`, `exp`, `sub`, `email`, `email_verified`를 검증한다. 기존 이메일 계정과 자동 연결하지 않고, 같은 이메일이 이미 있으면 명시적 오류로 막는다. OAuth role은 URL query가 아니라 서버에 저장된 `OAuthState.role`만 신뢰한다.

### 초대 API

- `GET /api/students/search?name=...&code=1234`
  - 선생님만 사용 가능
  - 인증 완료된 학생만 검색
  - 이름은 공백 정리 후 정확히 매칭한다.
  - 결과는 사용자 ID, 표시 이름, 초대 코드, 마스킹 이메일만 반환한다.
- `GET /api/classrooms/:classroomId/students`
  - 강의실 소유 선생님만 사용 가능
- `POST /api/classrooms/:classroomId/students`
  - body: `{ studentUserId }`
  - 대상이 `student`이고 이메일 인증 완료 상태인지 다시 확인한다.
  - 중복 등록은 새 row를 만들지 않고 기존 등록을 반환한다.
- `DELETE /api/classrooms/:classroomId/students/:studentUserId`

### 기존 API 권한 변경

- `GET /api/classrooms`
  - 선생님: 본인 강의실
  - 학생: 등록된 강의실
- `POST /api/classrooms`
  - 선생님만 가능
- `DELETE /api/classrooms/:classroomId`
  - 강의실 소유 선생님만 가능
- `GET /api/classrooms/:classroomId/weeks`
  - 소유 선생님 또는 등록 학생
- `POST /api/classrooms/:classroomId/weeks`
  - 소유 선생님만 가능
- `DELETE /api/weeks/:weekId`
  - 소유 선생님만 가능
- `POST /api/weeks/bulk-delete`
  - 요청한 모든 주차가 소유 선생님 강의실에 속해야 가능
  - 하나라도 누락되거나 소유권이 다르면 전체 실패
- `GET /api/weeks/:weekId/lectures`
  - 소유 선생님 또는 등록 학생
- `POST /api/weeks/:weekId/lectures`
  - 소유 선생님만 가능
- `DELETE /api/lectures/:lectureId`
  - 소유 선생님만 가능
- `GET /api/session/by-lecture/:lectureId`
  - 소유 선생님 또는 등록 학생
  - 사용자별 세션을 반환
- `POST /api/session/:sessionId/save`
  - 해당 세션 소유자만 가능
- `POST /api/session/:sessionId/event`
  - 해당 세션 소유자만 가능
- `POST /api/session/:sessionId/event/stream`
  - 해당 세션 소유자만 가능
  - `ensureSessionOwner`가 성공한 뒤에만 스트리밍 헤더를 flush한다.

### 리포트 API 권한

- `GET /api/classrooms/:classroomId/report`
  - 강의실 소유 선생님만 가능
  - 기본은 등록된 학생 전체의 세션을 모은 classroom aggregate report다.
- `POST /api/classrooms/:classroomId/report/analyze`
  - 강의실 소유 선생님만 가능
- `POST /api/classrooms/:classroomId/report/analyze/stream`
  - 강의실 소유 선생님만 가능
  - 인증/권한 검증 후 스트리밍 헤더를 flush한다.

새 분석에서는 레거시 공유 세션을 기본 입력으로 쓰지 않는다. 등록 학생이 없으면 선생님 본인의 preview 세션만 별도 표시하거나 데이터 부족 리포트를 반환한다.

### PDF 제공

기존 `/uploads` 정적 공개 제공을 제거하고 다음 경로로 대체한다.

- `GET /api/uploads/:fileName`
  - 파일명으로 lecture를 찾는다.
  - `path.basename`과 저장된 `lecture.pdf.path`의 basename이 정확히 일치해야 한다.
  - `.pdf` 외 파일은 거부한다.
  - page index JSON은 이 경로로 제공하지 않는다.
  - 해당 lecture의 강의실 접근 권한을 검사한다.
  - 인증된 다른 학생 또는 다른 교사의 PDF 직접 접근도 `403`으로 거부한다.
  - 통과 시 `sendFile`로 PDF를 반환한다.
  - 응답 캐시는 `private, no-store`로 둔다.

프론트의 `pdfUrl`은 `/api/uploads/<basename>` 형태가 된다. Vite dev proxy의 `/uploads` 항목은 제거한다.

## 10. 프론트엔드 설계

### 추가 파일

- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/auth/useAuth.ts`
- `apps/web/src/auth/ProtectedRoute.tsx`
- `apps/web/src/auth/RequireRole.tsx`
- `apps/web/src/routes/Login.tsx`
- `apps/web/src/routes/Signup.tsx`
- `apps/web/src/components/auth/AuthLayout.tsx`
- `apps/web/src/components/auth/RoleSegmentedControl.tsx`
- `apps/web/src/components/classrooms/InviteStudentPanel.tsx`
- `apps/web/src/components/layout/AppTopBar.tsx`

### 인증 상태

```ts
type AuthStatus = "checking" | "guest" | "authenticated" | "unverified";
```

`AuthProvider`는 앱 시작 시 `/api/auth/me`를 호출한다.

- checking: 전체 화면 로딩
- guest: 로그인/회원가입만 접근
- authenticated: 보호 라우트 접근
- unverified: 로그인 또는 회원가입 후 인증 코드 입력 패널로 이동

### 라우팅

- `/login`
- `/signup`
- `/`
- `/classrooms/:classroomId`
- `/classrooms/:classroomId/report`
- `/session/:lectureId`

보호 라우트 접근 시 비로그인 사용자는 `/login?next=<현재경로>`로 이동한다. `/classrooms/:classroomId/report`는 `RequireRole("teacher")`로 한 번 더 감싼다.

### API 클라이언트

- Axios 인스턴스는 `withCredentials: true`를 설정한다.
- 모든 raw `fetch` 스트리밍 호출은 `credentials: "include"`를 설정한다.
- `401`이면 auth context를 갱신하고 로그인 화면으로 이동한다.
- `403`이면 현재 화면에 권한 오류 카드를 보여준다.
- `/api/uploads/:fileName` PDF 로딩 실패도 세션 만료 또는 권한 없음 메시지로 연결한다.

### 선생님 UI

- 대시보드 제목: `내 강의실`
- 강의실 생성 카드 표시
- 강의실 삭제 버튼 표시
- 주차 추가/삭제 표시
- 세부 강의 추가/삭제 표시
- 학생 초대 패널 표시
- 학생 리포트 버튼 표시
- 관련 컴포넌트는 `useAuth().user.role === "teacher"`를 직접 확인한다.

### 학생 UI

- 대시보드 제목: `초대받은 강의실`
- 강의실 생성 카드 숨김
- 강의실/주차/자료 삭제 버튼 숨김
- 세부 강의 추가 버튼 숨김
- 학생 초대 패널 숨김
- 프로필 영역에 `이름 #1234` 표시
- 학습 시작만 가능

### 회원가입/이메일 인증 UI

- 회원가입은 역할 선택, 계정 정보 입력, 이메일 인증 코드 입력 3단계로 구성한다.
- 개발 환경에서 서버가 `devVerificationCode`를 반환하면 인증 단계에 작은 안내로 보여준다.
- 인증 코드 오류, 만료, 시도 초과, 네트워크 오류를 각각 표시한다.
- Google OAuth가 비활성화 상태이면 Google 버튼을 숨기거나 비활성 상태로 표시한다.

### 학생 초대 UI

- 이름과 4자리 코드를 분리 입력한다.
- 이름이 비어 있거나 코드가 4자리 숫자가 아니면 요청하지 않는다.
- 검색 중, 없음, 중복, 등록 성공, 제거 성공 상태를 표시한다.
- 현재 등록 학생 목록을 즉시 갱신한다.
- 제거 버튼은 선생님에게만 보인다.

### 모바일/오류 UX

- 로그인/회원가입 폼은 360px 폭에서 넘치지 않아야 한다.
- 대시보드 action row는 작은 화면에서 줄바꿈한다.
- 학생 초대 패널 입력은 작은 화면에서 세로 배치한다.
- 세션 화면의 PDF 오류는 채팅 패널과 겹치지 않게 표시한다.
- 기존 `console.error`만 남기던 초기 로딩 실패는 재시도 버튼이 있는 오류 카드로 바꾼다.

## 11. 마이그레이션

- 기존 강의실에 `teacherId`가 없으면 일반 회원가입 사용자가 자동 claim하지 않는다.
- 레거시 데이터 이전은 별도 오프라인 스크립트 또는 `AUTH_BOOTSTRAP_SECRET`으로 보호된 개발/관리 endpoint에서만 수행한다.
- 이번 구현과 브라우저 검증은 새로 생성한 선생님 계정과 새 강의실을 기준으로 진행한다.
- 기존 세션 `ses_${lectureId}`는 인증 사용자 경로에서 재사용하지 않는다.
- 레거시 세션은 보존하되 새 사용자별 세션으로 자동 복사하지 않는다.
- 새 세션은 항상 사용자별 세션 ID를 사용한다.
- 기존 리포트는 `CLASSROOM_AGGREGATE`로 간주하되 새 분석의 기본 입력으로 레거시 공유 세션을 쓰지 않는다.
- 학생은 새 초대 기록이 생기기 전까지 기존 강의실을 볼 수 없다.

## 12. 테스트 전략

### 서버 테스트

- 모든 non-auth, non-health API는 비로그인 요청에서 `401`을 반환한다.
- 다른 선생님의 classroom/week/lecture/session/report/PDF route 접근은 `403`을 반환한다.
- 학생은 week 생성/삭제, lecture 업로드/삭제, report endpoint 접근이 모두 막힌다.
- session/report stream endpoint는 권한 검증 실패 시 `flushHeaders` 전에 `401/403` JSON 오류를 반환한다.
- bulk delete는 존재하지 않는 week ID 또는 mixed-owner week ID가 있으면 전체 실패하고 아무 것도 삭제하지 않는다.
- 회원가입 시 비밀번호가 해시로 저장된다.
- 이메일 인증 코드가 없거나 틀리면 인증 실패한다.
- 이메일 인증 전 로그인은 거부된다.
- 로그인 성공 시 세션 쿠키와 해시 세션이 생성된다.
- 로그아웃 시 세션이 폐기된다.
- 학생은 강의실을 생성할 수 없다.
- 선생님은 본인 강의실만 삭제할 수 있다.
- 리포트 endpoint는 강의실 소유 선생님만 접근할 수 있다.
- bulk delete는 요청 주차 중 하나라도 소유권이 다르면 전체 실패한다.
- 학생 초대가 성공한다.
- 중복 초대는 중복 저장하지 않는다.
- 학생은 초대받은 강의실만 목록에서 본다.
- 학생은 초대받지 않은 주차/강의/세션에 접근할 수 없다.
- session save/event/stream은 세션 소유자만 성공한다.
- 같은 lecture에 대해 서로 다른 학생은 서로 다른 세션을 받는다.
- PDF 경로는 인증 없이 접근할 수 없다.
- PDF 경로는 인증된 다른 사용자라도 권한이 없으면 접근할 수 없다.
- Google OAuth 비활성 환경에서 status는 disabled를 반환하고 UI는 안전하게 처리한다.
- 레거시 강의실은 일반 첫 가입 교사에게 자동 이전되지 않는다.
- bootstrap claim은 `AUTH_BOOTSTRAP_SECRET` 없이는 실패한다.
- lecture 삭제는 레거시 `ses_${lectureId}`와 랜덤 사용자별 세션을 모두 제거한다.

### 서버 테스트 하네스

`apps/server/src/app.ts`를 추가해 `createApp(deps)`를 export하고, `index.ts`는 app 생성 후 listen만 담당한다. 라우트 테스트는 `createApp`에 fake bridge와 temp path를 받은 `new JsonStore({ dataDir, uploadDir })`를 주입한다. route test helper는 cookie jar를 유지할 수 있게 `fetch` wrapper 또는 작은 helper를 제공한다.

### 웹 빌드

- `npm run build`

### 브라우저 자동 테스트

Playwright를 추가한다.

- `apps/web/playwright.config.ts`
- `apps/web/e2e/auth-role.spec.ts`
- `package.json` script: `test:e2e`
- root devDependency: `@playwright/test`

Playwright 설정은 재현 가능해야 한다.

- `webServer`로 test 전용 서버를 띄운다.
- test 전용 `DATA_DIR`, `UPLOAD_DIR`를 temp 경로로 둔다.
- `AUTH_DEV_EXPOSE_VERIFICATION_CODE=true`를 사용한다.
- AI bridge/Gemini가 없어도 계정/권한/초대 UI 테스트가 가능하도록 PDF 업로드이 필요한 e2e는 API seed 또는 fake bridge mode를 사용한다.
- OAuth env는 비워서 disabled path를 테스트한다.

테스트 대상:

- 비로그인 사용자는 `/`에서 로그인으로 이동한다.
- 선생님 가입/인증/로그인 후 강의실 생성 버튼이 보인다.
- 학생 가입/인증/로그인 후 강의실 생성 버튼이 보이지 않는다.
- Google OAuth 비활성 환경에서 Google 버튼이 비활성/숨김 처리된다.
- 선생님이 학생을 초대하면 학생 대시보드에 강의실이 보인다.
- 학생 강의실 화면에는 업로드/삭제 버튼이 없다.
- PDF와 세션 진입이 인증 쿠키로 동작한다.

### 수동 브라우저 테스트

- 비로그인 접근 시 로그인 화면으로 이동
- 선생님 회원가입, 인증, 로그인
- 선생님 강의실 생성
- 학생 회원가입, 인증, 로그인
- 학생 초대 전 빈 대시보드 확인
- 선생님이 학생 초대
- 학생 초대 후 강의실 표시
- 학생 화면에서 생성/삭제/업로드 UI가 없는지 확인
- 학생이 PDF와 세션을 정상 열 수 있는지 확인
- 로그아웃 후 보호 화면 접근이 막히는지 확인

## 13. 구현 순서

1. domain 타입과 paths 확장
2. JsonStore 인증/등록/소유권/사용자별 세션 API 추가
3. AuthService 추가
4. 인증/CSRF 미들웨어 추가
5. `createApp(deps)` 테스트 하네스 분리
6. auth/students/uploads 라우터 추가
7. `index.ts`의 public `/uploads` static 제거, `session.ts`의 `pdfUrl`을 `/api/uploads/...`로 변경, `apps/web/vite.config.ts`의 `/uploads` proxy 제거
8. classrooms/weeks/lectures/session/report 라우터 권한 적용
9. 서버 테스트 추가
10. 프론트 auth context와 API wrapper 추가
11. 로그인/회원가입/이메일 인증 화면 추가
12. 대시보드/강의실 UI 역할 분기
13. 학생 초대 패널 추가
14. PDF load error UI와 기존 console-only load error 정리
15. Playwright 최소 e2e 추가
16. 빌드/테스트/브라우저 검증

## 14. 합격 기준

- [ ] 이메일 가입/인증/로그인이 실제 브라우저에서 된다.
- [ ] 선생님과 학생 역할이 서버와 UI에서 모두 분기된다.
- [ ] 선생님은 강의실/주차/자료를 만들 수 있다.
- [ ] 학생은 강의실/주차/자료를 만들 수 없다.
- [ ] 선생님은 학생의 `이름 + 4자리 코드`로 초대할 수 있다.
- [ ] 학생은 초대받은 강의실만 볼 수 있다.
- [ ] 학생과 선생님 또는 학생끼리 학습 세션이 섞이지 않는다.
- [ ] 인증 없이 PDF 파일을 직접 열 수 없다.
- [ ] 권한 없는 인증 사용자는 다른 강의실 PDF를 열 수 없다.
- [ ] 레거시 강의실은 일반 첫 가입 교사에게 자동 이전되지 않는다.
- [ ] 서버 테스트, 웹 빌드, 최소 e2e가 통과한다.
