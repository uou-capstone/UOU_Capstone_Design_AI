import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";

export function AppTopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuId = "topbar-profile-menu";

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (!user) return null;

  async function onLogout() {
    setMenuOpen(false);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <header className="app-topbar">
      <button className="topbar-brand" onClick={() => navigate("/")}>
        Merge Edu Agent
      </button>
      <div className="topbar-user">
        <span className="topbar-display-name">{user.displayName}</span>
        <span className="topbar-role">{user.role === "teacher" ? "선생님" : "학생"}</span>
        {user.role === "student" ? (
          <span className="topbar-invite">#{user.inviteCode}</span>
        ) : null}
        <div className="topbar-profile" ref={profileRef}>
          <button
            ref={triggerRef}
            type="button"
            className="profile-menu-button"
            aria-label="회원 메뉴"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? profileMenuId : undefined}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="26"
              height="26"
              fill="none"
            >
              <path
                d="M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M4.8 20c.9-3.7 3.5-5.6 7.2-5.6s6.3 1.9 7.2 5.6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {menuOpen ? (
            <div
              id={profileMenuId}
              className="profile-menu card"
              role="menu"
              aria-label="회원 메뉴"
            >
              <button
                type="button"
                role="menuitem"
                className="profile-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/account");
                }}
              >
                회원 정보 수정
              </button>
              <button
                type="button"
                role="menuitem"
                className="profile-menu-item danger"
                onClick={onLogout}
              >
                로그아웃
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
