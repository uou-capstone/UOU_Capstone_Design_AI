import { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="card auth-panel">
        <div className="auth-rail">
          <div>
            <div className="auth-rail-mark" aria-hidden="true">M</div>
            <h1>Merge Edu Agent</h1>
            <p>계정으로 강의실과 학습 기록을 안전하게 분리합니다.</p>
          </div>
          <div className="auth-rail-list" aria-label="서비스 핵심 기능">
            <span>✓ 선생님과 학생 권한 분리</span>
            <span>✓ PDF 기반 AI 학습 세션</span>
            <span>✓ 학생별 역량 리포트</span>
          </div>
        </div>
        <div className="auth-content">{children}</div>
      </section>
    </main>
  );
}
