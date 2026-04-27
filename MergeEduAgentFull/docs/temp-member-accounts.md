# 임시 테스트 회원 정보

작성일: 2026-04-27

## 목적

- 로컬 테스트에서 회원가입 이메일 인증을 우회하고, 아이디/비밀번호 로그인 흐름을 바로 확인하기 위한 임시 계정이다.
- 모든 계정은 이메일 인증 완료 상태로 시드된다.
- 활성 사용자 데이터 저장소: `DATA_DIR/users.json`
- 기본 `.env.example` 기준 저장소: `/Users/jhkim/Documents/MergeEduAgentFull/apps/server/data/users.json`

## 계정 생성 방법

저장소에는 실제 `users.json`을 커밋하지 않는다. 새 로컬 환경에서 아래 명령으로 임시 계정을 생성한다.

```bash
npm run seed:temp-accounts -w apps/server
```

Windows에서도 프로젝트 루트에서 같은 명령을 실행하면 된다.

```cmd
npm run seed:temp-accounts -w apps/server
```

명령은 같은 이메일이 이미 있으면 비밀번호, 역할, 이름, 초대 코드를 아래 표 기준으로 갱신한다.

## 공통 로그인 정보

- 비밀번호: `MergeEduTest!2026`
- 로그인 방식: 이메일 + 비밀번호
- 이메일 인증 상태: 완료

## 선생님 계정

| 구분 | 이름 | 이메일 | 비밀번호 | 역할 |
|---|---|---|---|---|
| 선생님 01 | 테스트 선생님 01 | `teacher.test01@mergeedu.local` | `MergeEduTest!2026` | teacher |
| 선생님 02 | 테스트 선생님 02 | `teacher.test02@mergeedu.local` | `MergeEduTest!2026` | teacher |

## 학생 계정

선생님 계정에서 학생을 초대할 때는 아래의 `이름`과 `초대 코드`를 함께 입력한다.

| 구분 | 이름 | 초대 코드 | 이메일 | 비밀번호 | 역할 |
|---|---|---:|---|---|---|
| 학생 01 | 테스트 학생 01 | `7101` | `student.test01@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 02 | 테스트 학생 02 | `7102` | `student.test02@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 03 | 테스트 학생 03 | `7103` | `student.test03@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 04 | 테스트 학생 04 | `7104` | `student.test04@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 05 | 테스트 학생 05 | `7105` | `student.test05@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 06 | 테스트 학생 06 | `7106` | `student.test06@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 07 | 테스트 학생 07 | `7107` | `student.test07@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 08 | 테스트 학생 08 | `7108` | `student.test08@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 09 | 테스트 학생 09 | `7109` | `student.test09@mergeedu.local` | `MergeEduTest!2026` | student |
| 학생 10 | 테스트 학생 10 | `7110` | `student.test10@mergeedu.local` | `MergeEduTest!2026` | student |

## 확인 결과

- 선생님 샘플 로그인: `teacher.test01@mergeedu.local` 정상
- 학생 샘플 로그인: `student.test01@mergeedu.local` 정상
- 두 샘플 모두 암호화 요청 기반 `/api/auth/login`에서 `200 OK` 확인

## 주의

- 이 계정들은 로컬 테스트용 임시 계정이다.
- 실제 배포/공유 환경에서는 동일 비밀번호 계정을 유지하지 말고 삭제하거나 별도 테스트 시드 방식으로 분리한다.
- `apps/server/data/*.json`과 `.env`는 `.gitignore`에 의해 커밋 대상에서 제외된다.
