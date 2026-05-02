import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTeacherExamReport } from "../api/endpoints";
import { TeacherExamReport } from "../types";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ExamReportRoute() {
  const { examId } = useParams<{ examId: string }>();
  const [report, setReport] = useState<TeacherExamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await getTeacherExamReport(examId!);
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "시험 리포트를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [examId]);

  if (loading) {
    return <main className="page-shell card" data-testid="exam-report-page">리포트를 불러오는 중...</main>;
  }

  return (
    <main className="page-shell exam-report-page" data-testid="exam-report-page">
      <section className="classroom-hero">
        <div>
          <span className="eyebrow">EXAM REPORT</span>
          <h1 className="page-title">{report?.exam.publishedRevision?.title ?? "시험 리포트"}</h1>
          <p className="page-subtitle">교사가 배포한 시험의 응시·채점 현황입니다.</p>
        </div>
      </section>

      {error ? <section className="card alert alert-error">{error}</section> : null}

      {report ? (
        <>
          <section className="report-metric-grid" data-testid="exam-report-summary">
            <div className="card report-summary-card">
              <span>응시</span>
              <strong>{report.summary.attemptCount} / {report.summary.enrolledCount}</strong>
            </div>
            <div className="card report-summary-card">
              <span>채점 완료</span>
              <strong>{report.summary.gradedCount}</strong>
            </div>
            <div className="card report-summary-card">
              <span>평균 점수</span>
              <strong>{report.summary.averageScore.toFixed(1)} / {report.summary.maxScore}</strong>
            </div>
            <div className="card report-summary-card">
              <span>완료율</span>
              <strong>{percent(report.summary.completionRatio)}</strong>
            </div>
          </section>

          <section className="card">
            <h2>학생별 현황</h2>
            <div className="exam-report-table">
              {report.students.map((student) => (
                <div
                  key={student.studentUserId}
                  className="exam-report-row"
                  data-testid="exam-report-student-row"
                  data-student-id={student.studentUserId}
                >
                  <strong>{student.displayName}</strong>
                  <span>{student.status}</span>
                  <span>
                    {student.attempt?.grading
                      ? `${student.attempt.grading.totalScore}/${student.attempt.grading.maxScore}`
                      : "-"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>문항별 현황</h2>
            <div className="exam-report-table">
              {report.questionStats.map((stat) => (
                <div
                  key={stat.questionId}
                  className="exam-report-row"
                  data-testid="exam-report-question-row"
                  data-question-id={stat.questionId}
                >
                  <strong>{stat.questionId}</strong>
                  <span>{stat.attempts}명</span>
                  <span>{stat.averageScore.toFixed(1)} / {stat.maxScore}</span>
                </div>
              ))}
            </div>
          </section>

          <Link className="btn ghost" to={`/classrooms/${report.exam.classroomId}`}>
            강의실로 돌아가기
          </Link>
        </>
      ) : null}
    </main>
  );
}
