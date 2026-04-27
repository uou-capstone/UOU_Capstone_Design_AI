import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getAuthEmailStatus } from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { AuthLayout } from "../components/auth/AuthLayout";

interface VerifyRouteState {
  email?: string;
  devVerificationCode?: string;
}

export function VerifyEmailRoute() {
  const auth = useAuth();
  const { setPendingVerificationEmail } = auth;
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const routeState = (location.state ?? {}) as VerifyRouteState;
  const initialEmail = useMemo(
    () => routeState.email || params.get("email") || auth.pendingVerificationEmail,
    [auth.pendingVerificationEmail, params, routeState.email]
  );
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [devCode] = useState(routeState.devVerificationCode ?? "");
  const [resendDevCode, setResendDevCode] = useState("");
  const [notice, setNotice] = useState("");
  const [emailStatus, setEmailStatus] = useState<{
    mode: "dev" | "smtp";
    canDeliverToInbox: boolean;
    devVerificationCodeVisible: boolean;
  } | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
      setPendingVerificationEmail(initialEmail);
    }
  }, [initialEmail, setPendingVerificationEmail]);

  useEffect(() => {
    if (!resendAvailableAt || nowMs >= resendAvailableAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nowMs, resendAvailableAt]);

  useEffect(() => {
    getAuthEmailStatus()
      .then(setEmailStatus)
      .catch(() => setEmailStatus(null));
  }, []);

  if (auth.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await auth.verifyEmail({ email, code });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "이메일 인증에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (!email.trim() || nowMs < resendAvailableAt) return;
    setResending(true);
    setError("");
    setNotice("");
    try {
      const result = await auth.resendVerificationEmail({ email });
      setResendDevCode(result.devVerificationCode ?? "");
      setNotice("인증 메일을 다시 보냈습니다. 메일함을 확인해 주세요.");
      const nextAvailableAt = Date.now() + 60_000;
      setNowMs(Date.now());
      setResendAvailableAt(nextAvailableAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증 메일 재전송에 실패했습니다.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={onVerify}>
        <h2>이메일 인증</h2>
        <p className="auth-copy">가입한 이메일로 전송된 6자리 코드를 입력해 주세요.</p>
        {emailStatus && !emailStatus.canDeliverToInbox ? (
          emailStatus.devVerificationCodeVisible ? (
            <div className="form-success" role="status">
              개발 모드입니다. 실제 메일 대신 화면에 표시된 개발용 인증 코드를 사용합니다.
            </div>
          ) : (
            <div className="form-error" role="alert">
              실제 인증 메일 발송이 꺼져 있습니다. SMTP 설정 후 재전송해 주세요.
            </div>
          )
        ) : null}
        {devCode || resendDevCode ? (
          <div className="dev-code">개발용 인증 코드: {resendDevCode || devCode}</div>
        ) : null}
        <div className="form-field">
          <label htmlFor="verify-email">이메일</label>
          <input
            id="verify-email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "verify-error" : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setPendingVerificationEmail(event.target.value);
            }}
          />
        </div>
        <div className="form-field">
          <label htmlFor="verify-code">인증 코드</label>
          <input
            id="verify-code"
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6자리 코드"
            value={code}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "verify-error" : undefined}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </div>
        {notice ? <div className="form-success" role="status">{notice}</div> : null}
        {error ? <div id="verify-error" className="form-error" role="alert">{error}</div> : null}
        <button className="btn" disabled={loading || !email.trim() || !code.trim()}>
          {loading ? "확인 중..." : "인증 완료"}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={resending || !email.trim() || nowMs < resendAvailableAt}
          onClick={onResend}
        >
          {resending
            ? "재전송 중..."
            : nowMs < resendAvailableAt
              ? `재전송 대기 ${Math.ceil((resendAvailableAt - nowMs) / 1000)}초`
              : "인증 메일 재전송"}
        </button>
        <p className="auth-links">
          인증을 마쳤다면 <Link to="/login">로그인</Link>으로 돌아갈 수 있습니다.
        </p>
      </form>
    </AuthLayout>
  );
}
