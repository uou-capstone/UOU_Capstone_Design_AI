import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/useAuth";

interface AccountProfilePanelProps {
  onCancel?: () => void;
  verificationNext?: string;
}

function buildVerifyEmailPath(email: string, next?: string) {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (next) params.set("next", next);
  const query = params.toString();
  return `/verify-email${query ? `?${query}` : ""}`;
}

export function AccountProfilePanel({
  onCancel,
  verificationNext = "/account"
}: AccountProfilePanelProps) {
  const auth = useAuth();
  const user = auth.user;
  const navigate = useNavigate();
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user?.email]);

  if (!user) return null;

  const currentUser = user;
  const normalizedEmail = email.trim().toLowerCase();
  const emailChanged = normalizedEmail !== currentUser.email.trim().toLowerCase();
  const passwordRequested = password.length > 0;

  function resetSensitiveFields() {
    setCurrentPassword("");
    setPassword("");
    setPasswordConfirm("");
  }

  function cancelEdit() {
    setEmail(currentUser.email);
    resetSensitiveFields();
    setError("");
    setNotice("");
    onCancel?.();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim();
    setError("");
    setNotice("");

    if (!nextEmail || !nextEmail.includes("@")) {
      setError("올바른 이메일을 입력해 주세요.");
      return;
    }
    if (passwordRequested && password.length < 8) {
      setError("새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (currentUser.hasPassword && (emailChanged || passwordRequested) && !currentPassword) {
      setError("현재 비밀번호를 입력해 주세요.");
      return;
    }
    if (!emailChanged && !passwordRequested && nextEmail === currentUser.email) {
      setNotice("변경된 회원 정보가 없습니다.");
      return;
    }

    setSaving(true);
    try {
      const result = await auth.updateAccount({
        email: nextEmail,
        currentPassword: currentPassword || undefined,
        password: password || undefined
      });
      resetSensitiveFields();
      if (!result.user.emailVerified) {
        navigate(buildVerifyEmailPath(result.user.email, verificationNext), {
          replace: true,
          state: {
            email: result.user.email,
            devVerificationCode: result.devVerificationCode ?? "",
            next: verificationNext
          }
        });
        return;
      }
      setEmail(result.user.email);
      setNotice("회원 정보가 저장되었습니다.");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "INVALID_CREDENTIALS") {
          setError(err.message);
          return;
        }
        if (err.code === "AUTH_REQUIRED") {
          const refreshed = await auth.refreshMe().catch(() => null);
          if (!refreshed) {
            navigate(`/login?next=${encodeURIComponent(verificationNext)}`, { replace: true });
            return;
          }
        }
        if (err.code === "EMAIL_NOT_VERIFIED") {
          const verifyEmail = nextEmail || currentUser.email;
          auth.setPendingVerificationEmail(verifyEmail);
          navigate(buildVerifyEmailPath(verifyEmail, verificationNext), {
            replace: true,
            state: { email: verifyEmail, next: verificationNext }
          });
          return;
        }
      }
      setError(err instanceof Error ? err.message : "회원 정보 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card account-profile-panel fade-in" aria-labelledby="account-profile-title">
      <div className="account-profile-head">
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h2 id="account-profile-title">계정 정보</h2>
        </div>
      </div>

      <dl className="account-profile-list" aria-label="현재 계정 요약">
        <div>
          <dt>아이디</dt>
          <dd>{currentUser.email}</dd>
        </div>
        <div>
          <dt>비밀번호</dt>
          <dd>
            <span className="account-password-mask">********</span>
            <small>
              {currentUser.hasPassword ? "보안상 표시하지 않음" : "로컬 비밀번호 미설정"}
            </small>
          </dd>
        </div>
        <div>
          <dt>역할</dt>
          <dd>{currentUser.role === "teacher" ? "선생님" : "학생"}</dd>
        </div>
      </dl>

      <form className="account-profile-form" onSubmit={onSubmit}>
        <div className="form-field">
          <label htmlFor="account-email">아이디</label>
          <input
            id="account-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {currentUser.hasPassword ? (
          <div className="form-field">
            <label htmlFor="account-current-password">현재 비밀번호</label>
            <input
              id="account-current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="현재 비밀번호"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
        ) : null}
        <div className="account-profile-password-grid">
          <div className="form-field">
            <label htmlFor="account-new-password">새 비밀번호</label>
            <input
              id="account-new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="변경할 때만 입력"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="account-new-password-confirm">새 비밀번호 확인</label>
            <input
              id="account-new-password-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="새 비밀번호 확인"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
          </div>
        </div>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {notice ? <div className="form-success" role="status">{notice}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={cancelEdit}>
            취소
          </button>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </section>
  );
}
