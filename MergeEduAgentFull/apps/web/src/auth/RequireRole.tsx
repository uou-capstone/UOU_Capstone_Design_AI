import { ReactNode } from "react";
import { UserRole } from "../types";
import { useAuth } from "./useAuth";

export function RequireRole({
  allow,
  children
}: {
  allow: UserRole[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !allow.includes(user.role)) {
    return (
      <main className="page-shell">
        <section className="card alert alert-error">
          이 기능을 사용할 권한이 없습니다.
        </section>
      </main>
    );
  }
  return <>{children}</>;
}
