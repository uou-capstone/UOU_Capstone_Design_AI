import { useNavigate } from "react-router-dom";
import { AccountProfilePanel } from "../components/account/AccountProfilePanel";

export function AccountSettingsRoute() {
  const navigate = useNavigate();

  return (
    <main className="page-shell account-settings-page">
      <section className="account-settings-header fade-in">
        <button
          type="button"
          className="account-settings-back"
          onClick={() => navigate("/")}
        >
          ← 대시보드로 돌아가기
        </button>
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h1 className="page-title">회원 정보 수정</h1>
          <p className="page-subtitle">
            로그인한 계정의 아이디와 비밀번호를 이곳에서 관리합니다.
          </p>
        </div>
      </section>

      <div className="account-settings-shell">
        <AccountProfilePanel onCancel={() => navigate("/")} verificationNext="/account" />
      </div>
    </main>
  );
}
