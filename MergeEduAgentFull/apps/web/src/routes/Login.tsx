import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { getGoogleOAuthStatus } from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { AuthLayout } from "../components/auth/AuthLayout";
import { RoleSegmentedControl } from "../components/auth/RoleSegmentedControl";
import { UserRole } from "../types";

export function LoginRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [googleRole, setGoogleRole] = useState<UserRole>("student");
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getGoogleOAuthStatus()
      .then((status) => setGoogleEnabled(status.enabled))
      .catch(() => setGoogleEnabled(false));
  }, []);

  if (auth.status === "authenticated") {
    return <Navigate to={params.get("next") || "/"} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await auth.login({ email, password });
      navigate(params.get("next") || "/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        auth.setPendingVerificationEmail(email);
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={onSubmit}>
        <h2>로그인</h2>
        <div className="form-field">
          <label>Google 신규 계정 역할</label>
          <RoleSegmentedControl value={googleRole} onChange={setGoogleRole} />
        </div>
        <div className="form-field">
          <label htmlFor="login-email">이메일</label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="login-password">비밀번호</label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="비밀번호"
            value={password}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {params.get("error") ? (
          <div className="form-error" role="alert">Google 로그인에 실패했습니다. 다시 시도해 주세요.</div>
        ) : null}
        {error ? <div id="login-error" className="form-error" role="alert">{error}</div> : null}
        <button className="btn" disabled={loading}>
          {loading ? "로그인 중..." : "로그인"}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!googleEnabled}
          onClick={() => {
            window.location.href = `/api/auth/google?role=${googleRole}`;
          }}
        >
          Google 계정으로 계속
        </button>
        {!googleEnabled ? (
          <p className="auth-copy">Google OAuth 설정이 준비되면 버튼이 활성화됩니다.</p>
        ) : null}
        <p className="auth-links">
          계정이 없다면 <Link to="/signup">회원가입</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
