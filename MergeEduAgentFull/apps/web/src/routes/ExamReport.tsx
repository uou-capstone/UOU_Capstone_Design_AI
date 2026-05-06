import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTeacherExamReport } from "../api/endpoints";
import {
  TeacherExamReport,
  TeacherExamReportQuestionStat,
  TeacherExamReportStudentStatus
} from "../types";

type ReportIconName = "users" | "clipboard" | "star" | "ring" | "file" | "search" | "eye";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function score(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statKey(stat: TeacherExamReportQuestionStat): string {
  return stat.statId ?? stat.questionId;
}

function normalizeStatus(status: string | undefined): TeacherExamReportStudentStatus {
  if (status === "SUBMITTED" || status === "MISSED" || status === "IN_PROGRESS" || status === "NOT_STARTED") {
    return status;
  }
  if (status === "GRADED" || status === "GRADING") return "SUBMITTED";
  return "NOT_STARTED";
}

function statusLabel(status: TeacherExamReportStudentStatus): string {
  if (status === "SUBMITTED") return "응시 완료";
  if (status === "IN_PROGRESS") return "응시중";
  if (status === "MISSED") return "미응시";
  return "응시전";
}

function resultLabel(result: string): string {
  if (result === "CORRECT") return "정답";
  if (result === "PARTIAL") return "부분";
  if (result === "UNANSWERED") return "미응답";
  if (result === "UNSUPPORTED") return "지원 안함";
  return "오답";
}

function questionTypeLabel(type?: string): string {
  if (type === "MCQ") return "객관식";
  if (type === "OX") return "OX";
  if (type === "SHORT") return "단답형";
  if (type === "ESSAY") return "서술형";
  return "문항";
}

function formatDateRange(from?: string, until?: string): string {
  if (!from || !until) return "";
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return `${formatter.format(new Date(from))} - ${formatter.format(new Date(until))}`;
}

function ReportIcon({ name }: { name: ReportIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  if (name === "users") {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  if (name === "clipboard") {
    return (
      <svg {...common}>
        <path d="M9 3h6l1 2h3v16H5V5h3l1-2Z" />
        <path d="m9 13 2 2 4-5" />
      </svg>
    );
  }
  if (name === "star") {
    return (
      <svg {...common}>
        <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.3 6.1-.9L12 3Z" />
      </svg>
    );
  }
  if (name === "ring") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 8 8" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="m16 16 4 4" />
      </svg>
    );
  }
  if (name === "eye") {
    return (
      <svg {...common}>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M7 3h7l3 3v15H7V3Z" />
      <path d="M14 3v4h4" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

export function ExamReportRoute() {
  const { examId } = useParams<{ examId: string }>();
  const [report, setReport] = useState<TeacherExamReport | null>(null);
  const [selectedStatId, setSelectedStatId] = useState<string | null>(null);
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

  const questionStats = useMemo(() => report?.questionStats ?? [], [report?.questionStats]);
  const supportedStats = useMemo(
    () => questionStats.filter((stat) => !stat.unsupportedReason),
    [questionStats]
  );
  const unsupportedStats = useMemo(
    () => questionStats.filter((stat) => stat.unsupportedReason),
    [questionStats]
  );
  const hasQuestionResponseData = supportedStats.some((stat) => stat.attempts > 0);
  const showUnsupportedOnly = questionStats.length > 0 && supportedStats.length === 0 && unsupportedStats.length > 0;
  const visibleQuestionStats = hasQuestionResponseData ? questionStats : showUnsupportedOnly ? unsupportedStats : [];

  useEffect(() => {
    const keys = new Set(visibleQuestionStats.map(statKey));
    if (selectedStatId && keys.has(selectedStatId)) return;
    const firstSupported = visibleQuestionStats.find((stat) => !stat.unsupportedReason && stat.attempts > 0);
    setSelectedStatId(firstSupported ? statKey(firstSupported) : null);
  }, [selectedStatId, visibleQuestionStats]);

  const selectedStat = useMemo(
    () => visibleQuestionStats.find((stat) => statKey(stat) === selectedStatId) ?? null,
    [selectedStatId, visibleQuestionStats]
  );

  if (loading) {
    return (
      <main className="page-shell card" data-testid="app-shell-content">
        <span data-testid="exam-report-page">리포트를 불러오는 중...</span>
      </main>
    );
  }

  const revision = report?.exam.publishedRevision;
  const submittedCount = report?.summary.submittedCount ?? report?.summary.gradedCount ?? 0;
  const completionRatio = report?.summary.completionRatio ?? 0;
  const dateRange = formatDateRange(revision?.availableFrom, revision?.availableUntil);

  return (
    <main className="page-shell exam-report-page" data-testid="app-shell-content">
      <div className="exam-report-dashboard" data-testid="exam-report-page">
        <section className="exam-report-hero">
          <div>
            <span className="eyebrow">EXAM REPORT</span>
            <h1>{revision?.title ?? "시험 리포트"}</h1>
            <p>교사가 배포한 시험의 응시·채점 현황입니다.</p>
          </div>
          <div className="exam-report-hero-meta" aria-label="시험 정보">
            {dateRange ? (
              <span>
                <strong>시험 기간</strong>
                <small>{dateRange}</small>
              </span>
            ) : null}
            <span>
              <strong>출제 문항</strong>
              <small>
                {revision?.questions?.length ?? report?.questionStats.length ?? 0}문항 · 총점 {report?.summary.maxScore ?? 0}점
              </small>
            </span>
          </div>
        </section>

        {error ? <section className="card alert alert-error">{error}</section> : null}

        {report ? (
          <>
            <section className="exam-report-metrics" data-testid="exam-report-summary">
              <article className="exam-report-metric-card">
                <span className="exam-report-metric-icon"><ReportIcon name="users" /></span>
                <div>
                  <span>응시</span>
                  <strong>{report.summary.attemptCount} / {report.summary.enrolledCount}</strong>
                  <small>시작 기준</small>
                </div>
              </article>
              <article className="exam-report-metric-card">
                <span className="exam-report-metric-icon"><ReportIcon name="clipboard" /></span>
                <div>
                  <span>채점 완료</span>
                  <strong>{report.summary.gradedCount}</strong>
                  <small>제출 {submittedCount}명</small>
                </div>
              </article>
              <article className="exam-report-metric-card">
                <span className="exam-report-metric-icon"><ReportIcon name="star" /></span>
                <div>
                  <span>평균 점수</span>
                  <strong>{score(report.summary.averageScore)} / {score(report.summary.maxScore)}</strong>
                  <small>서술형 제외</small>
                </div>
              </article>
              <article className="exam-report-metric-card">
                <span className="exam-report-metric-icon ring"><ReportIcon name="ring" /></span>
                <div>
                  <span>완료율</span>
                  <strong>{percent(completionRatio)}</strong>
                  <small>응시 완료 기준</small>
                </div>
              </article>
            </section>

            <section className="exam-report-panel exam-report-students">
              <div className="exam-report-section-head">
                <div>
                  <h2>학생별 현황</h2>
                  <p>학생별 응시 상태와 점수, 정답률을 확인할 수 있습니다.</p>
                </div>
              </div>
              {report.students.length > 0 ? (
                <div className="exam-report-student-table">
                  <div className="exam-report-student-header" aria-hidden="true">
                    <span>학생</span>
                    <span>응시 상태</span>
                    <span>점수</span>
                    <span>응시 결과</span>
                  </div>
                  {report.students.map((student) => {
                    const normalized = normalizeStatus(student.status);
                    const studentScore = student.reportScore;
                    return (
                      <div
                        key={student.studentUserId}
                        className="exam-report-student-row"
                        data-testid="exam-report-student-row"
                        data-student-id={student.studentUserId}
                      >
                        <div className="exam-report-student-name">
                          <span>{student.displayName.slice(0, 1) || "학"}</span>
                          <div>
                            <strong>{student.displayName}</strong>
                            <small>응시 상태 확인</small>
                          </div>
                        </div>
                        <span className={`exam-report-status ${normalized.toLowerCase()}`}>
                          {statusLabel(normalized)}
                        </span>
                        <strong>
                          {studentScore ? `${score(studentScore.score)} / ${score(studentScore.maxScore)}` : "-"}
                        </strong>
                        <span className="exam-report-student-action">
                          <ReportIcon name="eye" />
                          응시 결과 보기
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="exam-report-soft-empty">등록된 학생 현황이 없습니다.</div>
              )}
            </section>

            <section className="exam-report-panel exam-question-analytics">
              <div className="exam-report-section-head">
                <div>
                  <h2>문항별 현황</h2>
                  <p>문항별 응답과 정답률을 현황입니다.</p>
                </div>
              </div>
              {visibleQuestionStats.length === 0 ? (
                <div className="exam-report-question-empty" data-testid="exam-report-empty-questions">
                  <span><ReportIcon name="file" /></span>
                  <div>
                    <strong>아직 문항별 응답 데이터가 없습니다.</strong>
                    <p>학생들이 시험에 응시하면 문항별 현황이 표시됩니다.</p>
                  </div>
                </div>
              ) : (
                <div className="exam-question-analytics-grid">
                  <div className="exam-question-list">
                    <div className="exam-question-toolbar">
                      <label>
                        <ReportIcon name="search" />
                        <input aria-label="문항 검색" placeholder="문항 검색 (번호, 내용)" />
                      </label>
                      <span>{visibleQuestionStats.length}개 문항</span>
                    </div>
                    <div className="exam-question-table">
                      <div className="exam-question-table-head" aria-hidden="true">
                        <span>문항</span>
                        <span>유형</span>
                        <span>정답</span>
                        <span>정답률</span>
                        <span>응답</span>
                      </div>
                      {visibleQuestionStats.map((stat, index) => {
                        const key = statKey(stat);
                        const isUnsupported = Boolean(stat.unsupportedReason);
                        const accuracy = stat.attempts > 0 ? (stat.correctCount ?? 0) / stat.attempts : 0;
                        return (
                          <button
                            key={key}
                            className={`exam-question-row${selectedStatId === key ? " selected" : ""}${isUnsupported ? " unsupported" : ""}`}
                            data-testid={isUnsupported ? "exam-report-unsupported-question" : "exam-report-question-row"}
                            data-question-id={stat.questionId}
                            type="button"
                            onClick={() => setSelectedStatId(key)}
                          >
                            <strong>{stat.questionNumber ?? index + 1}번</strong>
                            <span>{questionTypeLabel(stat.type)}</span>
                            <span>{isUnsupported ? "지원 안함" : stat.correctAnswerLabel ?? "-"}</span>
                            <span className="exam-question-rate">
                              <i style={{ width: `${Math.round(accuracy * 100)}%` }} />
                              {isUnsupported ? "-" : percent(accuracy)}
                            </span>
                            <span className="exam-question-count">
                              {stat.isArchivedQuestion ? <em>이전 버전</em> : `${stat.attempts}명`}
                              <b data-testid="exam-report-question-chevron">›</b>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <aside className="exam-question-detail-panel" data-testid="exam-report-question-detail">
                    {selectedStat ? (
                      selectedStat.unsupportedReason ? (
                        <div className="exam-question-unsupported">
                          <span><ReportIcon name="file" /></span>
                          <strong>{selectedStat.questionNumber ?? ""}번 문항 상세</strong>
                          <p>{selectedStat.unsupportedReason}</p>
                        </div>
                      ) : (
                        <>
                          <div className="exam-question-detail-head">
                            <div>
                              <h3>{selectedStat.questionNumber ?? ""}번 문항 상세</h3>
                              <p>{questionTypeLabel(selectedStat.type)} · 응답 {selectedStat.attempts}명</p>
                            </div>
                            <Link className="btn ghost" to={`/exams/${report.exam.id}/report`}>
                              문항 해설 보기
                            </Link>
                          </div>
                          <p className="exam-question-prompt">{selectedStat.promptMarkdown ?? selectedStat.questionId}</p>
                          <div className="exam-question-distribution">
                            {(selectedStat.distribution ?? []).map((bucket) => (
                              <article key={bucket.key} className={bucket.isCorrect ? "correct" : ""}>
                                <strong>{bucket.label}</strong>
                                <span>{bucket.count}명 ({percent(bucket.ratio)})</span>
                                <i style={{ width: `${Math.round(bucket.ratio * 100)}%` }} />
                              </article>
                            ))}
                          </div>
                          <div className="exam-question-respondents">
                            <div className="exam-question-respondent-head" aria-hidden="true">
                              <span>학생</span>
                              <span>제출 답안</span>
                              <span>결과</span>
                              <span>획득 점수</span>
                            </div>
                            {(selectedStat.respondents ?? []).map((respondent) => (
                              <div key={`${respondent.studentUserId}-${respondent.answerLabel}`} className="exam-question-respondent">
                                <strong>{respondent.displayName}</strong>
                                <span>{respondent.answerLabel}</span>
                                <em className={respondent.result.toLowerCase()}>{resultLabel(respondent.result)}</em>
                                <span>{score(respondent.score)} / {score(respondent.maxScore)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    ) : (
                      <div className="exam-question-unsupported">
                        <span><ReportIcon name="file" /></span>
                        <strong>문항을 선택해 주세요.</strong>
                        <p>문항 위에 마우스를 올리고 표시되는 화살표를 눌러 상세를 확인하세요.</p>
                      </div>
                    )}
                  </aside>
                </div>
              )}
            </section>

            <Link className="btn ghost exam-report-back" to={`/classrooms/${report.exam.classroomId}`}>
              강의실로 돌아가기
            </Link>
          </>
        ) : null}
      </div>
    </main>
  );
}
