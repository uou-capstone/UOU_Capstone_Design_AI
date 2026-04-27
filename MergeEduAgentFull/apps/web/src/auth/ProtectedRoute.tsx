import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/layout/AppTopBar";
import { useAuth } from "./useAuth";

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "checking") {
    return <main className="page-shell">로그인 상태 확인 중...</main>;
  }

  if (auth.status === "unverified") {
    return <Navigate to="/verify-email" replace />;
  }

  if (auth.status === "guest") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return (
    <>
      <AppTopBar />
      <Outlet />
    </>
  );
}
