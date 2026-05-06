import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/layout/AppTopBar";
import { useAuth } from "./useAuth";

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "checking") {
    return <main className="page-shell" data-testid="app-shell-content">로그인 상태 확인 중...</main>;
  }

  if (auth.status === "unverified") {
    const attemptedPath = `${location.pathname}${location.search}${location.hash}`;
    const hasMeaningfulNext = attemptedPath && attemptedPath !== "/";
    const verifyPath = hasMeaningfulNext
      ? `/verify-email?next=${encodeURIComponent(attemptedPath)}`
      : "/verify-email";
    return (
      <Navigate
        to={verifyPath}
        replace
        state={hasMeaningfulNext ? { next: attemptedPath } : undefined}
      />
    );
  }

  if (auth.status === "guest") {
    const attemptedPath = `${location.pathname}${location.search}${location.hash}`;
    const hasMeaningfulNext = attemptedPath && attemptedPath !== "/";
    const loginPath = hasMeaningfulNext
      ? `/login?next=${encodeURIComponent(attemptedPath)}`
      : "/login";
    return (
      <Navigate
        to={loginPath}
        replace
        state={hasMeaningfulNext ? { next: attemptedPath } : undefined}
      />
    );
  }

  return (
    <>
      <AppTopBar />
      <Outlet />
    </>
  );
}
