import { memo, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  analyzeStudentCompetencyReportStream,
  ClassroomReportAnalysisStage,
  getClassroomReportStudents,
  getStudentCompetencyReport,
  streamStudentReportChat,
  StudentReportChatMessageInput
} from "../api/endpoints";
import { ApiError } from "../api/client";
import {
  CompetencyOverallLevel,
  StudentCompetencyReport,
  StudentCompetencyScore,
  StudentReportListItem
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatPageProgress(summary: StudentReportListItem["reportSummary"]): string {
  if (!summary) return "-";
  const stats = summary.sourceStats;
  const pageCount = stats.progressPageCount ?? stats.completedPageCount;
  const coverageRatio = stats.progressCoverageRatio ?? stats.pageCoverageRatio;
  if (coverageRatio <= 0) return `${pageCount}p`;
  const totalPages = Math.max(
    pageCount,
    Math.round(pageCount / coverageRatio)
  );
  return `${pageCount}/${totalPages}p`;
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

interface ReportChatMessage {
  id: string;
  role: "user" | "assistant";
  contentMarkdown: string;
  createdAt: string;
  streaming?: boolean;
}

function summarizeStudent(student: StudentReportListItem): string {
  const summary = student.reportSummary;
  if (!summary) return "리포트 없음";
  return `${summary.overallScore}점 · ${levelLabels[summary.overallLevel]}`;
}

function StudentStatusMetrics({ student }: { student: StudentReportListItem }) {
  const summary = student.reportSummary;
  const stats = summary?.sourceStats;

  return (
    <span className="report-student-metrics" aria-label={`${student.displayName} 리포트 지표`}>
      <span>
        <small>생성</small>
        <strong>{summary ? formatDateTime(summary.generatedAt) : "없음"}</strong>
      </span>
      <span>
        <small>퀴즈 평균</small>
        <strong>{stats ? `${stats.averageQuizScore}점` : "-"}</strong>
      </span>
      <span>
        <small>채점 퀴즈</small>
        <strong>{stats ? `${stats.gradedQuizCount}건` : "-"}</strong>
      </span>
      <span>
        <small>진도</small>
        <strong>{formatPageProgress(summary)}</strong>
      </span>
    </span>
  );
}

const ReportChatMessageView = memo(function ReportChatMessageView({
  message
}: {
  message: ReportChatMessage;
}) {
  const content = message.contentMarkdown.trim();

  return (
    <article className={`report-chat-message ${message.role}`}>
      <span className="report-chat-message-label">
        {message.role === "user" ? "교사" : "리포트 챗봇"}
      </span>
      {content ? (
        <div className="report-chat-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="report-chat-waiting">
          {message.streaming ? "답변 생성 중..." : "내용이 없습니다."}
        </p>
      )}
    </article>
  );
});

const reportChatDrawerId = "student-report-chat-drawer";

export function ClassroomReportRoute() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const [students, setStudents] = useState<StudentReportListItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [report, setReport] = useState<StudentCompetencyReport | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
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
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ReportChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const studentsRequestSeq = useRef(0);
  const reportRequestSeq = useRef(0);
  const chatRequestSeqRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatRafRef = useRef<number | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const chatToggleRef = useRef<HTMLButtonElement | null>(null);
  const deferredThoughtMarkdown = useDeferredValue(analysisProgress.thoughtMarkdown);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [selectedStudentId, students]
  );

  const visibleReport =
    report?.reportScope === "STUDENT" &&
    report.classroomId === classroomId &&
    report.studentUserId === selectedStudentId
      ? report
      : null;
  const canChat = Boolean(classroomId && selectedStudent && visibleReport);

  function cancelPendingChatFrame() {
    if (chatRafRef.current !== null) {
      window.cancelAnimationFrame(chatRafRef.current);
      chatRafRef.current = null;
    }
  }

  function resetReportChat() {
    chatRequestSeqRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    cancelPendingChatFrame();
    setChatMessages([]);
    setChatInput("");
    setChatError("");
    setChatLoading(false);
  }

  function closeReportChat() {
    setChatOpen(false);
    window.requestAnimationFrame(() => chatToggleRef.current?.focus());
  }

  async function sendReportChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroomId || !selectedStudent || !visibleReport) {
      setChatError("학생 리포트를 먼저 생성하면 질문할 수 있습니다.");
      return;
    }

    const message = chatInput.trim();
    if (!message || chatLoading) return;

    chatAbortRef.current?.abort();
    cancelPendingChatFrame();
    const controller = new AbortController();
    const requestSeq = chatRequestSeqRef.current + 1;
    chatRequestSeqRef.current = requestSeq;
    chatAbortRef.current = controller;

    const createdAt = new Date().toISOString();
    const userMessage: ReportChatMessage = {
      id: `report_chat_user_${createdAt}_${chatMessages.length}`,
      role: "user",
      contentMarkdown: message,
      createdAt
    };
    const assistantId = `report_chat_assistant_${createdAt}_${chatMessages.length}`;
    const assistantMessage: ReportChatMessage = {
      id: assistantId,
      role: "assistant",
      contentMarkdown: "",
      createdAt,
      streaming: true
    };
    const history: StudentReportChatMessageInput[] = chatMessages
      .filter((item) => item.contentMarkdown.trim())
      .slice(-8)
      .map((item) => ({
        role: item.role,
        contentMarkdown: item.contentMarkdown
      }));

    let assistantText = "";
    const flushAssistantText = () => {
      chatRafRef.current = null;
      if (chatRequestSeqRef.current !== requestSeq) return;
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId ? { ...item, contentMarkdown: assistantText } : item
        )
      );
    };
    const scheduleAssistantFlush = () => {
      if (chatRafRef.current !== null) return;
      chatRafRef.current = window.requestAnimationFrame(flushAssistantText);
    };

    setChatInput("");
    setChatError("");
    setChatLoading(true);
    setChatMessages((prev) => [...prev, userMessage, assistantMessage]);

    try {
      const result = await streamStudentReportChat(
        classroomId,
        selectedStudent.id,
        {
          message,
          history
        },
        (streamEvent) => {
          if (chatRequestSeqRef.current !== requestSeq) return;
          if (streamEvent.type === "answer_delta") {
            assistantText += streamEvent.text;
            scheduleAssistantFlush();
          }
          if (streamEvent.type === "done" && streamEvent.answerText !== undefined) {
            assistantText = streamEvent.answerText;
          }
        },
        controller.signal
      );

      if (chatRequestSeqRef.current !== requestSeq) return;
      cancelPendingChatFrame();
      assistantText = result.answerText || assistantText;
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, contentMarkdown: assistantText, streaming: false }
            : item
        )
      );
    } catch (err) {
      if (controller.signal.aborted || chatRequestSeqRef.current !== requestSeq) return;
      cancelPendingChatFrame();
      const messageText =
        err instanceof ApiError && err.status === 409
          ? "학생 리포트를 먼저 생성하면 질문할 수 있습니다."
          : err instanceof Error
            ? err.message
            : "학생 리포트 챗봇 응답을 받지 못했습니다.";
      setChatError(messageText);
      setChatMessages((prev) =>
        prev
          .map((item) =>
            item.id === assistantId
              ? { ...item, contentMarkdown: assistantText, streaming: false }
              : item
          )
          .filter((item) => item.id !== assistantId || item.contentMarkdown.trim())
      );
    } finally {
      if (chatRequestSeqRef.current === requestSeq) {
        setChatLoading(false);
        chatAbortRef.current = null;
      }
    }
  }

  async function refreshStudents(preferredStudentId = selectedStudentId) {
    if (!classroomId) return;
    const requestSeq = ++studentsRequestSeq.current;
    const requestClassroomId = classroomId;
    setStudentsLoading(true);
    setError("");
    try {
      const nextStudents = await getClassroomReportStudents(requestClassroomId);
      if (requestSeq !== studentsRequestSeq.current) return;
      setStudents(nextStudents);
      const nextSelected =
        nextStudents.find((student) => student.id === preferredStudentId)?.id ??
        nextStudents[0]?.id ??
        "";
      setSelectedStudentId(nextSelected);
      if (!nextSelected) {
        setReport(null);
      }
    } catch (err) {
      if (requestSeq !== studentsRequestSeq.current) return;
      setError(err instanceof Error ? err.message : "학생 목록을 불러오지 못했습니다.");
    } finally {
      if (requestSeq === studentsRequestSeq.current) {
        setStudentsLoading(false);
      }
    }
  }

  async function refreshSelectedReport(studentId = selectedStudentId) {
    if (!classroomId || !studentId) return;
    const requestSeq = ++reportRequestSeq.current;
    const requestClassroomId = classroomId;
    const requestStudentId = studentId;
    setReportLoading(true);
    setError("");
    try {
      const next = await getStudentCompetencyReport(requestClassroomId, requestStudentId);
      if (requestSeq !== reportRequestSeq.current) return;
      if (
        next &&
        (next.reportScope !== "STUDENT" ||
          next.classroomId !== requestClassroomId ||
          next.studentUserId !== requestStudentId)
      ) {
        setReport(null);
        return;
      }
      setReport(next);
    } catch (err) {
      if (requestSeq !== reportRequestSeq.current) return;
      setError(err instanceof Error ? err.message : "학생 리포트를 불러오지 못했습니다.");
    } finally {
      if (requestSeq === reportRequestSeq.current) {
        setReportLoading(false);
      }
    }
  }

  async function runAnalysis() {
    if (!classroomId || !selectedStudentId) return;
    const requestSeq = ++reportRequestSeq.current;
    const analysisClassroomId = classroomId;
    const analysisStudentId = selectedStudentId;
    setAnalyzing(true);
    setReportLoading(false);
    setError("");
    setAnalysisProgress({
      active: true,
      completed: false,
      progress: 4,
      stage: "COLLECTING_DATA",
      label: "학생별 리포트 분석을 준비하는 중",
      thoughtMarkdown: ""
    });
    try {
      const next = await analyzeStudentCompetencyReportStream(
        analysisClassroomId,
        analysisStudentId,
        (event) => {
          if (requestSeq !== reportRequestSeq.current) return;
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
        }
      );
      if (
        requestSeq !== reportRequestSeq.current ||
        next.reportScope !== "STUDENT" ||
        next.classroomId !== analysisClassroomId ||
        next.studentUserId !== analysisStudentId
      ) {
        return;
      }
      startTransition(() => {
        setReport(next);
      });
      await refreshStudents(analysisStudentId);
      setAnalysisProgress((prev) => ({
        ...prev,
        active: false,
        completed: true,
        stage: "COMPLETE",
        progress: 100,
        label:
          next.generationMode === "AI_ANALYZED"
            ? "Gemini 학생별 분석이 완료되어 저장되었습니다."
            : "학생별 fallback 리포트가 저장되었습니다."
      }));
    } catch (err) {
      if (requestSeq !== reportRequestSeq.current) return;
      setAnalysisProgress((prev) => ({
        ...prev,
        active: false
      }));
      setError(err instanceof Error ? err.message : "Gemini 학생별 분석에 실패했습니다.");
    } finally {
      if (requestSeq === reportRequestSeq.current) {
        setAnalyzing(false);
      }
    }
  }

  useEffect(() => {
    studentsRequestSeq.current += 1;
    reportRequestSeq.current += 1;
    setStudents([]);
    setSelectedStudentId("");
    setReport(null);
    setReportLoading(false);
    setAnalyzing(false);
    refreshStudents("").catch(console.error);
  }, [classroomId]);

  useEffect(() => {
    if (!selectedStudentId) return;
    refreshSelectedReport(selectedStudentId).catch(console.error);
  }, [classroomId, selectedStudentId]);

  useEffect(() => {
    resetReportChat();
  }, [classroomId, selectedStudentId, visibleReport?.generatedAt]);

  useEffect(
    () => () => {
      chatRequestSeqRef.current += 1;
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      cancelPendingChatFrame();
    },
    []
  );

  useEffect(() => {
    if (!chatOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeReportChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;
    chatBottomRef.current?.scrollIntoView({ block: "end" });
  }, [chatOpen, chatMessages]);

  const topCompetencies = useMemo(
    () =>
      [...(visibleReport?.competencies ?? [])]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
    [visibleReport]
  );

  if (studentsLoading && students.length === 0) {
    return <main className="page-shell">학생별 역량 리포트 화면을 준비하는 중...</main>;
  }

  return (
    <main className="page-shell report-page">
      <div className="heading">
        <div>
          <Link className="report-back-link" to={`/classrooms/${classroomId}`}>
            ← 강의실로 돌아가기
          </Link>
          <h1 className="page-title report-heading-title">
            {visibleReport?.classroomTitle ?? "강의실"} 학생별 역량 리포트
          </h1>
          <p className="report-heading-copy">
            참여 학생을 선택하면 해당 학생의 질문, 퀴즈, 세션 메모만 묶어 Gemini 리포트를 생성합니다.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="btn ghost"
            onClick={() => refreshStudents()}
            disabled={studentsLoading || reportLoading || analyzing}
          >
            {studentsLoading ? "불러오는 중..." : "학생 목록 새로고침"}
          </button>
          <button
            className="btn"
            onClick={() => runAnalysis()}
            disabled={!selectedStudentId || analyzing}
          >
            {analyzing
              ? "Gemini 분석 중..."
              : visibleReport
                ? "선택 학생 다시 분석"
                : "선택 학생 리포트 분석"}
          </button>
        </div>
      </div>

      <section className="report-student-panel fade-in" aria-label="학생 선택">
        <div className="report-student-panel-head">
          <div>
            <strong>참여 학생</strong>
            <p>학생별 저장본과 분석 대상을 여기서 전환합니다.</p>
          </div>
          <span>{students.length}명</span>
        </div>
        {students.length > 0 ? (
          <fieldset className="report-student-selector">
            <legend className="sr-only">리포트 분석 대상 학생</legend>
            {students.map((student) => (
              <label
                key={student.id}
                className={`report-student-option ${
                  student.id === selectedStudentId ? "active" : ""
                }`}
                aria-disabled={analyzing}
              >
                <input
                  type="radio"
                  name="report-student"
                  checked={student.id === selectedStudentId}
                  disabled={analyzing}
                  onChange={() => setSelectedStudentId(student.id)}
                />
                <span className="report-student-name">{student.displayName}</span>
                <span className="report-student-code">#{student.inviteCode}</span>
                <span className="report-student-summary">{summarizeStudent(student)}</span>
                <StudentStatusMetrics student={student} />
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="report-student-empty">아직 초대된 학생이 없습니다.</div>
        )}
      </section>

      {analysisProgress.stage ? (
        <section className="card report-progress-card fade-in">
          <div className="report-progress-head">
            <div>
              <strong>학생별 역량 리포트 분석 진행 상황</strong>
              <p>{analysisProgress.label}</p>
            </div>
            <div className="report-progress-percent">{analysisProgress.progress}%</div>
          </div>

          <div
            className="report-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={analysisProgress.progress}
          >
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
        <section className="card alert alert-error" role="alert">
          <div className="report-error-row">
            <span>{error}</span>
            <button
              className="btn ghost"
              onClick={() => refreshSelectedReport()}
              disabled={reportLoading || !selectedStudentId}
            >
              다시 시도
            </button>
          </div>
        </section>
      ) : null}

      {selectedStudent ? (
        <section className="card report-meta-strip fade-in">
          <strong>선택 학생</strong>
          <span>{selectedStudent.displayName}</span>
          <span>초대 코드 #{selectedStudent.inviteCode}</span>
          <span>{selectedStudent.maskedEmail}</span>
          {visibleReport ? (
            <span>마지막 저장 {new Date(visibleReport.generatedAt).toLocaleString("ko-KR")}</span>
          ) : (
            <span>저장된 리포트 없음</span>
          )}
        </section>
      ) : null}

      {reportLoading && selectedStudent ? (
        <section className="card report-empty-state fade-in">
          {selectedStudent.displayName} 학생의 저장본을 불러오는 중...
        </section>
      ) : null}

      {visibleReport ? (
        <>
          <section className="card report-hero fade-in">
            <div className="report-hero-main">
              <div>
                <div className="report-badges">
                  <span className="report-badge">{levelLabels[visibleReport.overallLevel]}</span>
                  <span className="report-badge subtle">
                    {visibleReport.generationMode === "AI_ANALYZED" ? "Gemini 분석" : "로컬 추정"}
                  </span>
                  {visibleReport.analysisStatus === "SPARSE_DATA" ? (
                    <span className="report-badge warning">데이터 적음</span>
                  ) : null}
                </div>
                <h2>{visibleReport.headline}</h2>
                <p className="report-copy">
                  {visibleReport.dataQualityNote}
                </p>
              </div>

              <div
                className="report-score-ring"
                aria-label={`종합 점수 ${visibleReport.overallScore}점`}
                style={{
                  background: `conic-gradient(from 210deg, var(--accent) 0deg, var(--accent-2) ${
                    visibleReport.overallScore * 3.6
                  }deg, rgba(18, 34, 64, 0.08) ${
                    visibleReport.overallScore * 3.6
                  }deg)`
                }}
              >
                <div className="report-score-ring-inner">
                  <strong>{visibleReport.overallScore}</strong>
                  <span>종합 점수</span>
                </div>
              </div>
            </div>

            <div className="report-stat-row">
              <div className="report-stat-chip">
                <span>강의</span>
                <strong>{visibleReport.sourceStats.lectureCount}개</strong>
              </div>
              <div className="report-stat-chip">
                <span>질문</span>
                <strong>{visibleReport.sourceStats.questionCount}건</strong>
              </div>
              <div className="report-stat-chip">
                <span>채점 퀴즈</span>
                <strong>{visibleReport.sourceStats.gradedQuizCount}건</strong>
              </div>
              <div className="report-stat-chip">
                <span>평균 점수</span>
                <strong>{visibleReport.sourceStats.averageQuizScore}점</strong>
              </div>
              <div className="report-stat-chip">
                <span>페이지 커버리지</span>
                <strong>{formatPercent(visibleReport.sourceStats.pageCoverageRatio * 100)}</strong>
              </div>
            </div>
          </section>

          <section className="report-summary-grid">
            <article className="card report-summary-card fade-in">
              <h3>핵심 요약</h3>
              <div className="markdown-content report-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {visibleReport.summaryMarkdown}
                </ReactMarkdown>
              </div>
            </article>

            <article className="card report-summary-card fade-in">
              <h3>두드러진 역량</h3>
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
                <h3>10대 역량 체크리스트</h3>
                <p className="report-copy">
                  세션 메모, 질문 로그, 퀴즈 성과를 묶어 항목별로 점수를 시각화했습니다.
                </p>
              </div>
            </div>

            <div className="report-competency-list">
              {visibleReport.competencies.map((item) => (
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
                    <div className="report-score-fill" style={{ width: `${item.score}%` }} />
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
              <h3>강점</h3>
              {visibleReport.strengths.length > 0 ? (
                <ul className="report-list">
                  {visibleReport.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="report-empty-note">아직 충분한 강점 근거가 없습니다.</p>
              )}
            </article>

            <article className="card report-side-card fade-in">
              <h3>보완 포인트</h3>
              {visibleReport.growthAreas.length > 0 ? (
                <ul className="report-list">
                  {visibleReport.growthAreas.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="report-empty-note">아직 뚜렷한 보완 포인트가 없습니다.</p>
              )}
            </article>

            <article className="card report-side-card fade-in">
              <h3>코칭 인사이트</h3>
              {visibleReport.coachingInsights.length > 0 ? (
                <ul className="report-list">
                  {visibleReport.coachingInsights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="report-empty-note">추가 학습 기록이 쌓이면 코칭 인사이트가 표시됩니다.</p>
              )}
            </article>

            <article className="card report-side-card fade-in">
              <h3>추천 액션</h3>
              {visibleReport.recommendedActions.length > 0 ? (
                <div className="report-action-list">
                  {visibleReport.recommendedActions.map((action) => (
                    <div key={action.title} className="report-action-item">
                      <strong>{action.title}</strong>
                      <p>{action.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="report-empty-note">추천 액션을 만들 만큼의 데이터가 아직 없습니다.</p>
              )}
            </article>
          </section>

          <section className="card report-lecture-panel fade-in">
            <div className="report-section-head">
              <div>
                <h3>강의별 학습 흐름</h3>
                <p className="report-copy">
                  선택한 학생의 질문량과 퀴즈 성과만 모아 코칭 우선순위를 정할 수 있습니다.
                </p>
              </div>
            </div>

            {visibleReport.lectureInsights.length > 0 ? (
              <div className="report-lecture-list">
                {visibleReport.lectureInsights.map((lecture, index) => (
                  <article
                    key={`${lecture.lectureId}-${index}`}
                    className="report-lecture-row"
                  >
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
            ) : (
              <p className="report-empty-note">아직 강의별 학습 흐름 데이터가 없습니다.</p>
            )}
          </section>
        </>
      ) : selectedStudent && !reportLoading ? (
        <section className="card report-empty-state fade-in">
          <h2>
            {selectedStudent.displayName} 학생의 저장된 역량 리포트가 없습니다.
          </h2>
          <p className="report-copy">
            아래 버튼을 누르면 이 학생의 세션 메모, 질문, 시험 결과만 바탕으로 Gemini가 새 리포트를
            분석하고 저장합니다.
          </p>
          <div className="form-actions">
            <button className="btn" onClick={() => runAnalysis()} disabled={analyzing}>
              {analyzing ? "Gemini 분석 중..." : "Gemini로 첫 학생 리포트 분석"}
            </button>
          </div>
        </section>
      ) : null}

      <button
        ref={chatToggleRef}
        type="button"
        className={`report-chat-toggle ${chatOpen ? "active" : ""}`}
        aria-label={chatOpen ? "학생 리포트 챗봇 닫기" : "학생 리포트 챗봇 열기"}
        aria-expanded={chatOpen}
        aria-controls={reportChatDrawerId}
        onClick={() => setChatOpen((prev) => !prev)}
      >
        <span className="report-chat-toggle-icon" aria-hidden="true">
          AI
        </span>
      </button>

      {chatOpen ? (
        <aside
          id={reportChatDrawerId}
          className="report-chat-drawer"
          role="dialog"
          aria-labelledby="report-chat-title"
        >
          <header className="report-chat-header">
            <div>
              <h2 id="report-chat-title">리포트 챗봇</h2>
              <p>
                {selectedStudent
                  ? `${selectedStudent.displayName} 학생`
                  : "학생 선택 필요"}
              </p>
            </div>
            <button
              type="button"
              className="report-chat-close"
              aria-label="학생 리포트 챗봇 닫기"
              onClick={closeReportChat}
            >
              ×
            </button>
          </header>

          <div className="report-chat-messages" aria-live="polite">
            {!selectedStudent ? (
              <div className="report-chat-empty">학생을 선택하면 대화를 시작할 수 있습니다.</div>
            ) : !visibleReport ? (
              <div className="report-chat-empty">
                {selectedStudent.displayName} 학생의 리포트를 먼저 생성해 주세요.
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="report-chat-empty">
                {selectedStudent.displayName} 학생에 대한 질문을 기다리고 있습니다.
              </div>
            ) : (
              chatMessages.map((message) => (
                <ReportChatMessageView key={message.id} message={message} />
              ))
            )}
            <div ref={chatBottomRef} />
          </div>

          {chatError ? (
            <div className="report-chat-error" role="alert">
              {chatError}
            </div>
          ) : null}

          <form className="report-chat-form" onSubmit={sendReportChat}>
            <textarea
              className="report-chat-input"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              rows={3}
              maxLength={2000}
              disabled={!canChat || chatLoading}
              placeholder={
                canChat
                  ? `${selectedStudent?.displayName ?? "학생"}에 대해 질문하기`
                  : "리포트 생성 후 질문할 수 있습니다."
              }
              aria-label="학생 리포트 챗봇 질문"
            />
            <button
              type="submit"
              className="btn report-chat-send"
              disabled={!canChat || chatLoading || !chatInput.trim()}
            >
              {chatLoading ? "응답 중..." : "전송"}
            </button>
          </form>
        </aside>
      ) : null}
    </main>
  );
}
