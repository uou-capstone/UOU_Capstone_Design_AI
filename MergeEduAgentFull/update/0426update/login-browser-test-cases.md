# Login/Auth Manual Browser Checklist

Use a fresh browser profile or clear cookies/local storage before starting. Run the app with `./run.sh` for full AI/PDF behavior, or `npm run e2e:serve` when you want exposed development verification codes and isolated e2e data. Open the web app at `http://localhost:5173` for `./run.sh` or `http://127.0.0.1:5180` for `e2e:serve`.

## Test Data To Create

- Teacher A: verified teacher account.
- Teacher B: verified teacher account for cross-owner denial checks.
- Student A: verified student account.
- Student B: verified student account that is not invited to Teacher A's classroom.
- Use unique emails each run, for example `teacher-a-<timestamp>@example.com`.

## Signup And Email Verification

- Go to `/signup`.
- Select `선생님`, enter name/email/password of at least 8 characters, then click `가입하고 인증하기`.
- Expected: routed to `이메일 인증`; email field is prefilled; in dev/e2e mode `개발용 인증 코드: ######` is visible.
- Enter a wrong code first.
- Expected: verification fails with a visible form error and the account is not logged in.
- Enter the correct 6-digit code and click `인증 완료`.
- Expected: redirected to dashboard, top bar shows display name and role badge `선생님`.
- Repeat for Student A with role `학생`.
- Expected: student dashboard heading is `초대받은 강의실`; top bar shows role `학생` and an invite tag like `#1234`.
- Before verifying a newly signed-up account, try to log in with its email/password.
- Expected: routed back to `/verify-email`, not the dashboard.

## Login, Logout, And Session Persistence

- From `/login`, log in as Teacher A with the correct password.
- Expected: redirected to `/`; heading is `내 강의실`.
- Click `로그아웃`.
- Expected: redirected to `/login`; protected URLs such as `/` route back to `/login?next=...`.
- Log in with a wrong password.
- Expected: visible login error, no top bar, no protected content.
- Log in again with the correct password, refresh the page, and open a new tab to `/`.
- Expected: auth cookie persists; dashboard loads without re-login.

## Teacher Classroom And Invite Flow

- As Teacher A, click `강의실 추가`, enter a unique classroom name, and click `생성`.
- Expected: classroom card appears with `입장` and `삭제`.
- Enter the classroom.
- Expected: heading `강의실 주차`; teacher-only controls are visible: `학생 리포트 보기`, `+ 주차 추가`, `선택 주차 삭제`, and `학생 초대`.
- In `학생 초대`, search Student A by exact display name and 4-digit top-bar invite code.
- Expected: candidate row shows `Student A #code` plus a masked email.
- Click `초대`.
- Expected: success message `학생을 초대했습니다.` and Student A appears in the student list.
- Search with a wrong code or unknown name.
- Expected: visible not-found/validation error; no student is enrolled.

## Teacher/Student Role Distinction

- As Student A, log in and check the dashboard.
- Expected: heading is `초대받은 강의실`; Teacher A's classroom is visible after invite; no `강의실 추가` card and no classroom `삭제` button.
- Enter Teacher A's classroom as Student A.
- Expected: `+ 주차 추가`, `선택 주차 삭제`, `학생 초대`, `학생 리포트 보기`, lecture upload, week delete, and lecture delete controls are absent.
- Directly open `/classrooms/<classroomId>/report` as Student A.
- Expected: page shows `이 기능을 사용할 권한이 없습니다.` or the API denies access; no report content is shown.
- As Student B, open `/classrooms/<teacherAClassroomId>`.
- Expected: access is denied or no classroom data loads.
- As Teacher B, open `/classrooms/<teacherAClassroomId>`.
- Expected: access is denied; Teacher B cannot read or mutate Teacher A's classroom.

## Read-Only Student Classroom Behavior

- As Teacher A, add at least one week with `+ 주차 추가`.
- Upload a small valid PDF lecture using `세부 강의 추가` if the AI bridge/API key is available; otherwise use existing seeded lecture data for read checks.
- As Student A, expand the week.
- Expected: lecture rows and `학습 시작` links are visible, but there are no add/upload/delete controls.
- With devtools or direct URL attempts, try student write endpoints/actions if practical: create week, delete week, create lecture, delete lecture, invite/remove student.
- Expected: server returns `403`/teacher-only errors; UI state remains unchanged after refresh.

## Session And PDF Authorization

- As Student A, click `학습 시작` on an invited lecture.
- Expected: `/session/<lectureId>` loads, PDF viewer renders the authorized PDF, chat panel appears, and `저장 및 종료` returns to dashboard.
- Copy the session URL and the PDF request URL from the network panel, usually `/api/uploads/<fileName>.pdf`.
- Log out, then paste both URLs.
- Expected: session redirects to login or returns `401`; PDF request returns `401` and does not display the PDF.
- Log in as Student B and paste Student A's session URL and PDF URL.
- Expected: session/PDF are denied with `403` or an error state; no PDF content is readable.
- Log in as Teacher B and paste Teacher A/Student A session and PDF URLs.
- Expected: cross-owner access is denied.
- Log back in as Student A and paste the same URLs.
- Expected: access succeeds again for the invited classroom lecture.
- Optional tamper check: submit a session save/event request for a session id that belongs to another user.
- Expected: `403 Forbidden`; session state for the rightful owner is unchanged.
