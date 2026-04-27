# Google 로그인 / 이메일 인증 / 요청 암호화 구현 결과

## 구현 범위

- 이메일 회원가입 시 6자리 난수 인증 코드를 생성하고, 서버에는 평문 코드가 아니라 이메일별 HMAC-SHA256 해시만 저장하도록 변경했다.
- 인증 메일 발송 계층을 분리했다.
  - 개발 모드: 화면에 인증 코드를 노출해 로컬 테스트 가능
  - SMTP 모드: `nodemailer`로 실제 메일 발송
- 이메일 인증 코드 재전송 API와 화면 버튼을 추가했다.
- Google OAuth 시작/콜백 흐름에 PKCE와 nonce 검증을 추가했고, 신규 Google 계정 생성 시 선생님/학생 역할을 선택할 수 있게 했다.
- 회원가입, 로그인, 이메일 인증, 인증 메일 재전송 요청에 대해 WebCrypto 기반 하이브리드 요청 암호화를 적용했다.
  - 클라이언트: AES-GCM으로 JSON 본문 암호화, RSA-OAEP-SHA256으로 AES 키 래핑
  - 서버: nonce/타임스탬프/AAD 검증 후 복호화
  - production 기본값은 암호화 required, 개발 기본값은 optional

## 주요 파일

- `apps/server/src/services/auth/AuthService.ts`
- `apps/server/src/services/auth/EmailSender.ts`
- `apps/server/src/services/security/RequestEncryptionService.ts`
- `apps/server/src/middleware/requestEncryption.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/app.ts`
- `apps/server/src/bootstrap.ts`
- `apps/web/src/api/requestEncryption.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/routes/Login.tsx`
- `apps/web/src/routes/VerifyEmail.tsx`
- `.env.example`

## 검증 결과

- 서버 전체 테스트: 통과
  - `npm run test -w apps/server`
  - 14개 테스트 파일, 84개 테스트 통과
- 서버 빌드: 통과
  - `npm run build -w apps/server`
- 웹 빌드: 통과
  - `npm run build -w apps/web`
- Comet 브라우저 수동 테스트: 통과
  - `[개인 테스트 이메일]` 교사 계정 회원가입
  - 인증 코드 재전송
  - 이메일 인증 완료 후 교사 대시보드 진입
  - 로그아웃 후 동일 계정 재로그인
  - `REQUEST_ENCRYPTION_MODE=required` 상태에서 회원가입/인증/로그인이 정상 동작함을 확인

## 실제 Naver 메일 발송 상태

현재 로컬 `.env`와 실행 환경에 SMTP 설정이 없어 실제 Naver 메일함 수신까지는 완료하지 못했다.

필요한 값:

- `AUTH_EMAIL_DELIVERY_MODE=smtp`
- `AUTH_VERIFICATION_CODE_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

위 값이 설정되지 않은 상태에서 production 또는 smtp 모드로 실행하면 서버가 시작 단계에서 실패하도록 막아 두었다. 따라서 실제 배포/실메일 환경에서 조용히 개발용 인증 코드가 노출되는 일은 없도록 처리했다.

## 남은 확인 항목

- Google OAuth 실제 로그인은 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`가 설정된 뒤 Google 콘솔의 승인된 리디렉션 URI와 함께 실계정으로 확인해야 한다.
- 실제 Naver 수신 테스트는 SMTP 계정 또는 메일 발송 서비스 자격 증명이 설정된 뒤 같은 회원가입 시나리오로 재실행하면 된다.
