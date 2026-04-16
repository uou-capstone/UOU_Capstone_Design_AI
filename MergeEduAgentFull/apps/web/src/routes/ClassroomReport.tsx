import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  analyzeClassroomCompetencyReportStream,
  ClassroomReportAnalysisStage,
  getClassroomCompetencyReport
} from "../api/endpoints";
import {
  CompetencyOverallLevel,
  StudentCompetencyReport,
  StudentCompetencyScore
} from "../types";

const levelLabels: Record<CompetencyOverallLevel, string> = {
  EMERGING: "기초 형성",
  DEVELOPING: "성장 중",
  PROFICIENT: "안정권",
  ADVANCED: "우수"
};

const trendLabels: Record<StudentCompetencyScore["trend"], string> = {
  UP: "상승",
  STEADY: "유지",
  DOWN: "하락"
};

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

const analysisStepOrder: ClassroomReportAnalysisStage[] = [
  "COLLECTING_DATA",
  "BUILDING_PROFILE",
  "GEMINI_THINKING",
  "SCORING",
  "WRITING_REPORT",
  "COMPLETE"
];

const analysisStepLabels: Record<ClassroomReportAnalysisStage, string> = {
  COLLECTING_DATA: "자료 수집 중",
  BUILDING_PROFILE: "프로필 구성 중",
  GEMINI_THINKING: "Gemini 분석 중",
  SCORING: "점수 매기는 중",
  WRITING_REPORT: "레포트 작성 중",
  COMPLETE: "저장 완료"
};

interface AnalysisProgressState {
  active: boolean;
  completed: boolean;
  progress: number;
  stage: ClassroomReportAnalysisStage | null;
  label: string;
  thoughtMarkdown: string;
  detail?: string;
}

export function ClassroomReportRoute() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const [report, setReport] = useState<StudentCompetencyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressState>({
    active: false,
    completed: false,
    progress: 0,
    stage: null,
    label: "",
    thoughtMarkdown: ""
  });
  const deferredThoughtMarkdown = useDeferredValue(analysisProgress.thoughtMarkdown);

  async function refreshReport() {
    if (!classroomId) return;
    setLoading(true);
    setError("");
    try {
      const next = await getClassroomCompetencyReport(classroomId);
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "리포트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis() {
    if (!classroomId) return;
    setAnalyzing(true);
    setError("");
    setAnalysisProgress({
      active: true,
      completed: false,
      progress: 4,
      stage: "COLLECTING_DATA",
      label: "리포트 분석을 준비하는 중",
      thoughtMarkdown: ""
    });
    try {
      const next = await analyzeClassroomCompetencyReportStream(classroomId, (event) => {
        if (event.type === "stage") {
          setAnalysisProgress((prev) => ({
            ...prev,
            active: event.stage !== "COMPLETE",
            completed: event.stage === "COMPLETE",
            stage: event.stage,
            progress: event.progress,
            label: event.label,
            detail: event.detail
          }));
          return;
        }

        if (event.type === "thought_delta") {
          setAnalysisProgress((prev) => ({
            ...prev,
            thoughtMarkdown: prev.thoughtMarkdown + event.text
          }));
        }
      });
      startTransition(() => {
        setReport(next);
      });
      setAnalysisProgress((prev) => ({
        ...prev,
        active: false,
        completed: true,
        stage: "COMPLETE",
        progress: 100,
        label:
          next.generationMode === "AI_ANALYZED"
            ? "Gemini 분석이 완료되어 저장되었습니다."
            : "fallback 리포트가 저장되었습니다."
      }));
    } catch (err) {
      setAnalysisProgress((prev) => ({
        ...prev,
        active: false
      }));
      setError(err instanceof Error ? err.message : "Gemini 분석에 실패했습니다.");
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    refreshReport().catch(console.error);
  }, [classroomId]);

  const topCompetencies = useMemo(
    () =>
      [...(report?.competencies ?? [])]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
    [report]
  );

  if (loading && !report) {
    return <main className="page-shell">학생 역량 리포트 생성 중...</main>;
  }

  return (
    <main className="page-shell report-page">
      <div className="heading">
        <div>
          <Link className="report-back-link" to={`/classrooms/${classroomId}`}>
            ← 강의실로 돌아가기
          </Link>
          <h1 style={{ margin: "8px 0 0" }}>
            {report?.classroomTitle ?? "강의실"} 학생 역량 리포트
          </h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            학생 질문, 중간 평가 메모, 퀴즈 결과를 묶어서 만든 누적 역량 분석입니다.
          </p>
        </div>
        <div className="heading-actions">
          <button className="btn ghost" onClick={() => refreshReport()} disabled={loading || analyzing}>
            {loading ? "불러오는 중..." : "저장본 다시 불러오기"}
          </button>
          <button className="btn" onClick={() => runAnalysis()} disabled={analyzing}>
            {analyzing ? "Gemini 분석 중..." : report ? "Gemini로 다시 분석" : "Gemini로 리포트 분석"}
          </button>
        </div>
      </div>

      {analysisProgress.stage ? (
        <section className="card report-progress-card fade-in">
          <div className="report-progress-head">
            <div>
              <strong>학생 역량 리포트 분석 진행 상황</strong>
              <p>{analysisProgress.label}</p>
            </div>
            <div className="report-progress-percent">{analysisProgress.progress}%</div>
          </div>

          <div className="report-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={analysisProgress.progress}>
            <div
              className="report-progress-fill"
              style={{ width: `${analysisProgress.progress}%` }}
            />
          </div>

          <div className="report-progress-steps">
            {analysisStepOrder.map((step) => {
              const currentIndex = analysisProgress.stage
                ? analysisStepOrder.indexOf(analysisProgress.stage)
                : -1;
              const stepIndex = analysisStepOrder.indexOf(step);
              const state =
                stepIndex < currentIndex
                  ? "done"
                  : step === analysisProgress.stage
                    ? "active"
                    : "idle";

              return (
                <span key={step} className={`report-progress-step ${state}`}>
                  {analysisStepLabels[step]}
                </span>
              );
            })}
          </div>

          {analysisProgress.detail === "fallback" ? (
            <div className="report-progress-note">
              Gemini 응답을 그대로 쓰지 못해 로컬 fallback 리포트로 저장했습니다.
            </div>
          ) : null}

          {deferredThoughtMarkdown.trim() ? (
            <div className="report-thought-stream">
              <div className="report-thought-stream-head">Gemini 생각 요약 스트리밍</div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {deferredThoughtMarkdown}
              </ReactMarkdown>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <section className="card session-alert session-alert-error" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span>{error}</span>
            <button className="btn ghost" onClick={() => refreshReport()} disabled={loading}>
              다시 시도
            </button>
          </div>
        </section>
      ) : null}

      {report ? (
        <>
          <section className="card report-meta-strip fade-in">
            <strong>마지막 저장</strong>
            <span>{new Date(report.generatedAt).toLocaleString("ko-KR")}</span>
            <span>
              저장 방식: {report.generationMode === "AI_ANALYZED" ? "Gemini 분석 저장본" : "로컬 추정 저장본"}
            </span>
          </section>

          <section className="card report-hero fade-in">
            <div className="report-hero-main">
              <div>
                <div className="report-badges">
                  <span className="report-badge">{levelLabels[report.overallLevel]}</span>
                  <span className="report-badge subtle">
                    {report.generationMode === "AI_ANALYZED" ? "Gemini 분석" : "로컬 추정"}
                  </span>
                  {report.analysisStatus === "SPARSE_DATA" ? (
                    <span className="report-badge warning">데이터 적음</span>
                  ) : null}
                </div>
                <h2 style={{ margin: "12px 0 8px" }}>{report.headline}</h2>
                <p style={{ margin: 0, color: "var(--muted)", maxWidth: 760 }}>
                  {report.dataQualityNote}
                </p>
              </div>

              <div
                className="report-score-ring"
                aria-label={`종합 점수 ${report.overallScore}점`}
                style={{
                  background: `conic-gradient(from 210deg, var(--accent) 0deg, var(--accent-2) ${
                    report.overallScore * 3.6
                  }deg, rgba(18, 34, 64, 0.08) ${report.overallScore * 3.6}deg)`
                }}
              >
                <div className="report-score-ring-inner">
                  <strong>{report.overallScore}</strong>
                  <span>종합 점수</span>
                </div>
              </div>
            </div>

            <div className="report-stat-row">
              <div className="report-stat-chip">
                <span>강의</span>
                <strong>{report.sourceStats.lectureCount}개</strong>
              </div>
              <div className="report-stat-chip">
                <span>질문</span>
                <strong>{report.sourceStats.questionCount}건</strong>
              </div>
              <div className="report-stat-chip">
                <span>채점 퀴즈</span>
                <strong>{report.sourceStats.gradedQuizCount}건</strong>
              </div>
              <div className="report-stat-chip">
                <span>평균 점수</span>
                <strong>{report.sourceStats.averageQuizScore}점</strong>
              </div>
              <div className="report-stat-chip">
                <span>진도 커버리지</span>
                <strong>{formatPercent(report.sourceStats.pageCoverageRatio * 100)}</strong>
              </div>
            </div>
          </section>

          <section className="report-summary-grid">
            <article className="card report-summary-card fade-in">
              <h3 style={{ marginTop: 0 }}>핵심 요약</h3>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {report.summaryMarkdown}
              </ReactMarkdown>
            </article>

            <article className="card report-summary-card fade-in">
              <h3 style={{ marginTop: 0 }}>두드러진 역량</h3>
              <div className="report-top-score-list">
                {topCompetencies.map((item) => (
                  <div key={item.key} className="report-top-score-item">
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.summary}</p>
                    </div>
                    <span>{item.score}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="card report-competency-panel fade-in">
            <div className="report-section-head">
              <div>
                <h3 style={{ margin: 0 }}>10대 역량 체크리스트</h3>
                <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                  세션 메모, 질문 로그, 퀴즈 성과를 묶어 항목별로 점수를 시각화했습니다.
                </p>
              </div>
            </div>

            <div className="report-competency-list">
              {report.competencies.map((item) => (
                <article key={item.key} className="report-competency-item">
                  <div className="report-competency-header">
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.summary}</p>
                    </div>
                    <div className="report-competency-meta">
                      <strong>{item.score}</strong>
                      <span>{trendLabels[item.trend]}</span>
                    </div>
                  </div>
                  <div className="report-score-track" role="presentation">
                    <div
                      className="report-score-fill"
                      style={{ width: `${item.score}%` }}
                    />
                  </div>
                  <div className="report-evidence-list">
                    {item.evidence.map((evidence) => (
                      <span key={`${item.key}-${evidence}`} className="report-evidence-pill">
                        {evidence}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="report-insight-grid">
            <article className="card report-side-card fade-in">
              <h3 style={{ marginTop: 0 }}>강점</h3>
              <ul className="report-list">
                {report.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="card report-side-card fade-in">
              <h3 style={{ marginTop: 0 }}>보완 포인트</h3>
              <ul className="report-list">
                {report.growthAreas.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="card report-side-card fade-in">
              <h3 style={{ marginTop: 0 }}>코칭 인사이트</h3>
              <ul className="report-list">
                {report.coachingInsights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="card report-side-card fade-in">
              <h3 style={{ marginTop: 0 }}>추천 액션</h3>
              <div className="report-action-list">
                {report.recommendedActions.map((action) => (
                  <div key={action.title} className="report-action-item">
                    <strong>{action.title}</strong>
                    <p>{action.description}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="card report-lecture-panel fade-in">
            <div className="report-section-head">
              <div>
                <h3 style={{ margin: 0 }}>강의별 학습 흐름</h3>
                <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                  강의별 질문량과 퀴즈 성과를 함께 보면서 코칭 우선순위를 정할 수 있습니다.
                </p>
              </div>
            </div>

            <div className="report-lecture-list">
              {report.lectureInsights.map((lecture) => (
                <article key={lecture.lectureId} className="report-lecture-row">
                  <div>
                    <strong>{lecture.lectureTitle}</strong>
                    <p>{lecture.weekTitle}</p>
                  </div>
                  <div className="report-lecture-metrics">
                    <span>질문 {lecture.questionCount}</span>
                    <span>퀴즈 {lecture.quizCount}</span>
                    <span>평균 {lecture.averageQuizScore}점</span>
                    <strong>{lecture.masteryLabel}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : !loading ? (
        <section className="card report-empty-state fade-in">
          <h2 style={{ marginTop: 0 }}>아직 저장된 학생 역량 리포트가 없습니다.</h2>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", maxWidth: 720 }}>
            아래 버튼을 누르면 현재 강의실의 학생 질문, 시험 결과, 중간 평가 메모를 바탕으로 Gemini가
            새 리포트를 분석하고 저장합니다.
          </p>
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => runAnalysis()} disabled={analyzing}>
              {analyzing ? "Gemini 분석 중..." : "Gemini로 첫 리포트 분석"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
