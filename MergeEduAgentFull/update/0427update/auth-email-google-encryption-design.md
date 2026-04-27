# 0427 Auth Email, Google OAuth, Request Encryption Design

## 목표

- 이메일/비밀번호 회원가입 시 6자리 난수 인증 코드를 실제 이메일로 발송한다.
- 개발 테스트용 인증 코드 화면 노출은 실제 메일 모드와 분리한다.
- Google 계정 가입/로그인을 실제 OAuth 설정이 있을 때 사용할 수 있게 하고, 신규 계정 역할 선택이 보존되도록 한다.
- 클라이언트와 서버 사이의 민감한 JSON 요청 본문에 앱 레벨 envelope 암호화를 적용한다.
- 기존 선생님/학생 권한, 이메일 인증 필수, HttpOnly 세션 쿠키, same-origin 방어는 유지한다.

## 비목표

- Google OAuth Client ID/Secret, SMTP 계정 비밀번호를 코드에 하드코딩하지 않는다.
- TLS/HTTPS를 앱 레벨 암호화로 대체하지 않는다. 운영 환경에서는 HTTPS가 필수다.
- PDF 업로드 파일, PDF 다운로드 응답, NDJSON 응답 스트림 자체를 1차 범위에서 암호화하지 않는다.
- 사용자의 Naver/Google 계정 비밀번호를 저장하거나 브라우저 저장소에 기록하지 않는다.

## 현재 구조

- `AuthService`는 회원가입 시 6자리 코드를 만들고 해시를 `users.json`에 저장한다.
- `/api/auth/signup`, `/api/auth/verify-email`, `/api/auth/login`, Google OAuth routes가 이미 있다.
- 현재 개발 모드에서는 `devVerificationCode`가 API 응답과 인증 화면에 표시될 수 있다.
- Google OAuth 환경 변수가 없으면 Google 버튼은 비활성화된다.
- API client는 `axios`를 사용하며 `withCredentials: true`로 HttpOnly cookie 세션을 사용한다.

## 제안 구조

### 1. 이메일 발송

- `EmailSender` 인터페이스를 추가한다.
  - `sendVerificationCode({ to, displayName, code, expiresAt })`
- 운영 SMTP 구현은 검증된 메일러 라이브러리 `nodemailer`를 사용한다.
  - 직접 `net`/`tls` SMTP 클라이언트를 구현하지 않는다.
  - TLS 인증서 검증 실패, STARTTLS 실패, 인증 실패는 발송 실패로 처리한다.
  - SMTP 사용자/비밀번호는 로그나 API 응답에 노출하지 않는다.
- `AuthService`는 `AuthService(store, { emailSender, codeGenerator, clock })` 형태로 의존성을 주입받는다.
  - 운영 bootstrap은 `createEmailSender()`로 SMTP 또는 dev sender를 만든다.
  - 테스트는 fake sender가 받은 `code`로 인증한다.
  - 토큰/시각 안정성이 필요한 테스트를 위해 `tokenGenerator`, `clock`도 주입 가능하게 둔다.
- 설정값:
  - `AUTH_EMAIL_DELIVERY_MODE=dev|smtp`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_SECURE`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM`
  - `AUTH_VERIFICATION_CODE_SECRET`
  - `AUTH_EMAIL_RESEND_COOLDOWN_SECONDS`
- `smtp` 모드에서는 `devVerificationCode`를 절대 응답하지 않는다.
- `dev` 모드 + non-production + `AUTH_DEV_EXPOSE_VERIFICATION_CODE=true`일 때만 기존 개발 편의를 유지한다.
- `smtp` 모드 또는 `NODE_ENV=production`에서는 `AUTH_VERIFICATION_CODE_SECRET`과 SMTP 필수값이 없으면 서버 시작 또는 발송 시 명확한 `EMAIL_SENDER_NOT_CONFIGURED` 오류를 낸다.

### 2. 인증 코드 저장

- 기존 단순 `sha256(code)` 대신 `v2:HMAC-SHA256(secret, emailNormalized + ":" + code)`를 저장한다.
- 검증은 timing-safe compare로 수행한다.
- 기존 pending 계정 호환을 위해 legacy `sha256(code)`도 한시적으로 검증 가능하게 둔다.
  - legacy 허용은 `AUTH_ALLOW_LEGACY_VERIFICATION_HASH=true` 또는 dev 모드에서만 허용한다.
  - 새로 생성되는 코드는 항상 v2 HMAC이다.
- 성공 시 `emailVerificationCodeHash`, `emailVerificationExpiresAt`, `emailVerificationAttempts`, `emailVerificationSentAt`을 정리한다.
- `User` 타입에 `emailVerificationSentAt?: IsoString`을 추가한다.

### 3. 인증 코드 재전송

- `POST /api/auth/resend-verification`을 추가한다.
- body: `{ email }`
- 미인증 사용자면 새 코드를 생성하고 이전 코드는 무효화한다.
- 같은 이메일에 rate limit과 cooldown을 적용한다.
- 이메일 존재 여부를 외부에 노출하지 않도록 일반 성공 응답은 동일하게 유지한다.
- 프론트 인증 화면에는 재전송 버튼과 성공/실패 메시지를 제공한다.

### 4. Google OAuth

- 기존 OAuth route는 유지한다.
- OAuth state에 PKCE `codeVerifier`와 nonce hash를 저장한다.
- `OAuthState` 타입에 `codeVerifier`, `nonceHash`를 추가한다.
- Google token 교환과 userinfo 조회는 `GoogleOAuthClient` 인터페이스로 분리해 `ServerDeps`에 주입한다.
  - 운영은 fetch 기반 client를 사용한다.
  - 테스트는 fake client로 callback 성공/실패를 검증한다.
- Google auth URL에 `code_challenge`, `code_challenge_method=S256`, `nonce`, `prompt=select_account`를 추가한다.
- token 교환 시 `code_verifier`를 포함한다.
- ID token 검증은 기존 `aud`, `iss`, `exp`, `sub`, `email`, `email_verified`에 nonce 검증을 추가한다.
- 로그인 화면에도 역할 선택 컨트롤을 제공해 신규 Google 사용자가 선생님/학생 중 올바른 역할로 생성되게 한다.
- 현재 서비스 정책은 이메일 가입과 동일하게 누구나 선생님 계정을 만들 수 있으므로 Google 선생님 가입도 같은 정책을 따른다. 이후 승인제 요구가 생기면 별도 정책으로 분리한다.

### 5. 요청 본문 암호화

- 서버에 `GET /api/crypto/request-key`를 추가한다.
- 서버는 시작 시 RSA-OAEP SHA-256 키쌍을 메모리에 생성한다.
- public JWK, `kid`, 알고리즘, 만료 시간, mode를 반환한다.
- `RequestEncryptionService`는 `createApp` deps로 주입한다.
  - 테스트에서 deterministic clock/nonce cache/key service를 쓸 수 있도록 한다.
- `ServerDeps`는 명시적 interface로 선언한다.
  - `store`, `auth`, `requestEncryption`, `googleOAuth`, `bridge`, `pdfIngest`, `engine`을 optional이 아닌 필드로 둔다.
  - 기존 테스트 object literal은 fake 의존성을 채워 컴파일 안정성을 유지한다.
- 클라이언트는 unsafe JSON 요청에서 다음 envelope를 만든다.

```json
{
  "enc": "req-v1",
  "kid": "request-key-id",
  "alg": "RSA-OAEP-256+A256GCM",
  "ek": "rsa-encrypted-aes-key",
  "iv": "aes-gcm-iv",
  "ts": 1777200000000,
  "nonce": "random-nonce",
  "ciphertext": "aes-gcm-ciphertext-with-tag"
}
```

- AES-GCM AAD는 `METHOD + " " + originalUrl + " " + ts + " " + nonce`로 한다.
- 서버는 `X-Request-Encryption: req-v1` 또는 body `enc=req-v1`를 감지하면 복호화 후 `req.body`를 평문 JSON으로 치환한다.
- replay 방지를 위해 `ts` 허용 오차와 nonce 메모리 cache를 둔다.
- 미들웨어 순서는 `express.json()` 뒤, `loadAuth()`와 `requireSameOriginForUnsafeMethods` 앞이다.
- 기본 모드는 개발에서 `optional`로 두어 기존 테스트와 수동 API 호출을 깨지 않는다.
- production에서는 `REQUEST_ENCRYPTION_MODE=required`가 요구사항이다.
  - `NODE_ENV=production`에서 `REQUEST_ENCRYPTION_MODE=off` 또는 `optional`은 서버 시작 실패로 처리한다.
  - 최소 강제 경로는 `/api/auth/signup`, `/api/auth/login`, `/api/auth/verify-email`, `/api/auth/resend-verification`이다.
  - 호환 alias인 `/api/auth/register`도 같은 required path에 포함한다.
  - 이 경로들의 unsafe JSON body 요청은 평문이면 400 `REQUEST_ENCRYPTION_REQUIRED`로 거절한다.
- `required` 강제 범위는 `Content-Type: application/json` + unsafe method + body 존재 요청으로 제한한다.
  - `multipart/form-data` PDF 업로드, GET/HEAD/OPTIONS, 빈 body POST, fetch 기반 NDJSON response stream은 제외한다.
- AAD URL 기준은 서버 `req.originalUrl`이며, 클라이언트는 `/api`를 포함한 최종 path/query를 사용한다.
- AES-GCM ciphertext는 WebCrypto가 반환한 `ciphertext+tag` 결합 ArrayBuffer를 base64url로 전송한다.

## 변경 대상

- `apps/server/src/config.ts`
- `apps/server/src/types/domain.ts`
- `apps/server/src/services/auth/AuthService.ts`
- `apps/server/src/services/auth/EmailSender.ts`
- `apps/server/src/services/security/RequestEncryptionService.ts`
- `apps/server/src/middleware/requestEncryption.ts`
- `apps/server/src/app.ts`
- `apps/server/src/bootstrap.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/tests/authFlow.test.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/api/endpoints.ts`
- `apps/web/src/api/requestEncryption.ts`
- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/routes/Login.tsx`
- `apps/web/src/routes/Signup.tsx`
- `apps/web/src/routes/VerifyEmail.tsx`
- `.env.example`
- `apps/server/package.json`

## 실패와 복구

- SMTP 설정 누락:
  - `smtp` 모드에서는 `EMAIL_SENDER_NOT_CONFIGURED`로 명확히 실패한다.
  - `dev` 모드에서는 기존 개발 코드 노출 테스트를 유지한다.
- SMTP 발송 실패:
  - 가입 계정은 남을 수 있다.
  - 사용자는 인증 화면에서 재전송으로 복구한다.
- 암호화 미지원 브라우저:
  - optional 모드에서는 평문 JSON 요청으로 fallback한다.
  - required 모드 또는 auth required path에서는 서버가 400으로 거절한다.
- Google OAuth 설정 누락:
  - status는 disabled를 반환하고 UI 버튼은 비활성화한다.

## 테스트 전략

- 서버 단위 테스트
  - fake `EmailSender`로 signup 시 실제 코드 발송 여부 확인.
  - fake sender 호출 인자, 발송 실패 응답, 설정 누락 `EMAIL_SENDER_NOT_CONFIGURED` 확인.
  - smtp 모드에서 `devVerificationCode`가 응답되지 않는지 확인.
  - resend가 새 코드를 만들고 이전 코드를 무효화하는지 확인.
  - encrypted `/auth/login` 요청이 정상 처리되는지 확인.
  - encryption optional 평문 허용, required 평문 거부 확인.
  - replay nonce 재사용, stale/future timestamp, AAD method/path 불일치, unknown `kid`, 깨진 ciphertext가 400으로 거절되는지 확인.
  - Google OAuth disabled path가 유지되는지 확인.
  - Google OAuth enabled path는 fake token exchange/verifier로 callback 성공, nonce 불일치, 신규 사용자 role 보존을 확인한다.
- 프론트 빌드
  - WebCrypto helper와 axios interceptor 타입 검증.
- Computer Use 수동 테스트
  - 실행 환경:
    - 실제 메일 테스트: `AUTH_EMAIL_DELIVERY_MODE=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `AUTH_VERIFICATION_CODE_SECRET` 설정.
    - 암호화 테스트: 개발은 `REQUEST_ENCRYPTION_MODE=optional`, 운영 검증은 `REQUEST_ENCRYPTION_MODE=required`.
    - Google 테스트: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:<serverPort>/api/auth/google/callback`.
  - Naver 메일 인증:
    - Comet에서 `/signup` 진입, 선생님 선택, `[개인 테스트 이메일]`으로 가입.
    - 인증 화면에서 개발용 코드 박스가 보이지 않아야 한다.
    - Comet에서 Naver 메일함을 열고 `MergeEdu 이메일 인증 코드` 메일을 찾는다.
    - 6자리 코드를 앱 인증 화면에 입력한다.
    - 성공 기준: 대시보드로 이동하고 상단에 선생님 계정이 표시된다.
    - 실패 기준: 메일 미수신, 코드 불일치, `EMAIL_SENDER_NOT_CONFIGURED`, `REQUEST_ENCRYPTION_REQUIRED`, 인증 후 로그인 실패를 기록한다.
  - Google OAuth:
    - Google Cloud Console redirect URI가 callback URL과 정확히 일치해야 한다.
    - 로그인/회원가입 화면에서 선생님/학생 역할을 각각 선택해 Google 시작 URL에 역할이 보존되는지 확인한다.
    - 성공 기준: callback 후 대시보드로 이동하고, 신규 사용자의 역할이 선택값과 일치한다.
    - 실패 기준: `google_invalid_state`, `google_token_invalid`, nonce 불일치, `email_verified=false` 거부, role 불일치를 기록한다.

## 운영 메모

- 실제 Naver 메일 수신 테스트를 위해서는 SMTP host/port/user/pass/from 설정이 필요하다.
- Google OAuth 실제 테스트를 위해서는 Google Cloud OAuth Client ID/Secret/Redirect URI 설정이 필요하다.
- 앱 레벨 암호화는 서버에 도달한 뒤 복호화되므로 서버 로그/저장소 보호와 HTTPS 운영이 여전히 중요하다.
- production 출시 조건:
  - HTTPS 또는 trusted reverse proxy TLS가 반드시 있어야 한다.
  - `NODE_ENV=production`에서 auth cookie는 `Secure`로 발급되어야 한다.
  - HSTS는 reverse proxy 또는 app gateway에서 적용한다.
  - `REQUEST_ENCRYPTION_MODE=required` 또는 auth required path 강제가 켜져 있어야 한다.
  - `AUTH_VERIFICATION_CODE_SECRET`은 32바이트 이상의 랜덤 secret이어야 한다.
- legacy verification hash:
  - 운영에서 `AUTH_ALLOW_LEGACY_VERIFICATION_HASH=true`를 켜면 서버 시작 로그에 경고를 남긴다.
  - legacy 검증은 이미 발급된 미인증 코드의 TTL 안에서만 의미가 있다.
  - 새 코드 생성과 재전송은 항상 v2 HMAC으로 전환한다.
