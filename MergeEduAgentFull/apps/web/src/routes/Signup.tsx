import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { getAuthEmailStatus, getGoogleOAuthStatus } from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { AuthLayout } from "../components/auth/AuthLayout";
import { RoleSegmentedControl } from "../components/auth/RoleSegmentedControl";
import { UserRole } from "../types";

export function SignupRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<UserRole>("teacher");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{
    mode: "dev" | "smtp";
    canDeliverToInbox: boolean;
    devVerificationCodeVisible: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getGoogleOAuthStatus()
      .then((status) => setGoogleEnabled(status.enabled))
      .catch(() => setGoogleEnabled(false));
    getAuthEmailStatus()
      .then(setEmailStatus)
      .catch(() => setEmailStatus(null));
  }, []);

  if (auth.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  async function onSignup(event: FormEvent) {
    event.preventDefault();
    if (
      emailStatus &&
      !emailStatus.canDeliverToInbox &&
      !emailStatus.devVerificationCodeVisible
    ) {
      setError("현재 서버는 인증 메일을 보낼 수 없습니다. SMTP 설정을 확인해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await auth.signup({ email, password, displayName, role });
      navigate("/verify-email", {
        replace: true,
        state: {
          email: result.user.email,
          devVerificationCode: result.devVerificationCode ?? ""
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원가입에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={onSignup}>
        <h2>회원가입</h2>
        {emailStatus && !emailStatus.canDeliverToInbox ? (
          emailStatus.devVerificationCodeVisible ? (
            <div className="form-success" role="status">
              개발 모드입니다. 실제 메일 대신 다음 화면에 인증 코드가 표시됩니다.
            </div>
          ) : (
            <div className="form-error" role="alert">
              실제 인증 메일 발송이 꺼져 있습니다. SMTP 설정 후 가입을 진행해 주세요.
            </div>
          )
        ) : null}
        <RoleSegmentedControl value={role} onChange={setRole} />
        <div className="form-field">
          <label htmlFor="signup-name">이름</label>
          <input
            id="signup-name"
            className="input"
            autoComplete="name"
            placeholder="홍길동"
            value={displayName}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "signup-error" : undefined}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="signup-email">이메일</label>
          <input
            id="signup-email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "signup-error" : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="signup-password">비밀번호</label>
          <input
            id="signup-password"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="비밀번호 8자 이상"
            value={password}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "signup-error" : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <div id="signup-error" className="form-error" role="alert">{error}</div> : null}
        <button
          className="btn"
          disabled={
            loading ||
            Boolean(emailStatus && !emailStatus.canDeliverToInbox && !emailStatus.devVerificationCodeVisible)
          }
        >
          {loading ? "가입 중..." : "가입하고 인증하기"}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!googleEnabled}
          onClick={() => {
            window.location.href = `/api/auth/google?role=${role}`;
          }}
        >
          Google 계정으로 가입
        </button>
        <p className="auth-links">
          이미 계정이 있다면 <Link to="/login">로그인</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
