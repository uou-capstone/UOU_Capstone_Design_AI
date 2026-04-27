import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";

export function AppTopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <header className="app-topbar">
      <button className="topbar-brand" onClick={() => navigate("/")}>
        Merge Edu Agent
      </button>
      <div className="topbar-user">
        <span>{user.displayName}</span>
        <span className="topbar-role">{user.role === "teacher" ? "선생님" : "학생"}</span>
        {user.role === "student" ? (
          <span className="topbar-invite">#{user.inviteCode}</span>
        ) : null}
        <button
          className="btn ghost"
          onClick={async () => {
            await logout();
            navigate("/login", { replace: true });
          }}
        >
          로그아웃
        </button>
      </div>
    </header>
  );
}
