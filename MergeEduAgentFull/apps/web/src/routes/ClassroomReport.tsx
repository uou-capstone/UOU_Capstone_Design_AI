import { memo, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  analyzeStudentCompetencyReportStream,
  ClassroomReportAnalysisStage,
  createClassroomReportCriterion,
  deleteClassroomReportCriterion,
  getClassroomReportCriteria,
  getClassroomReportStudents,
  getStudentCompetencyReport,
  ReportCriteriaAssistantMessageInput,
  ReportCriteriaAssistantStreamEvent,
  ReportCriteriaAssistantStreamStage,
  streamReportCriteriaAssistantChat,
  streamStudentReportChat,
  StudentReportChatMessageInput,
  updateClassroomReportCriterion
} from "../api/endpoints";
import { ApiError } from "../api/client";
import {
  BuiltInStudentCompetencyKey,
  CompetencyOverallLevel,
  ReportCriteriaAssistantProposal,
  ReportCriteriaAssistantSummaryCard,
  StudentCompetencyReport,
  StudentCompetencyScore,
  StudentReportCustomCriterion,
  StudentReportListItem
} from "../types";

const levelLabels: Record<CompetencyOverallLevel, string> = {
  EMERGING: "기초 형성",
  DEVELOPING: "성장 중",
  PROFICIENT: "안정권",
  ADVANCED: "우수"
};

interface BuiltInReportCriterion {
  key: BuiltInStudentCompetencyKey;
  name: string;
  description: string;
}

const BUILT_IN_REPORT_CRITERIA = [
  {
    key: "CONCEPT_UNDERSTANDING",
    name: "개념 이해도",
    description: "핵심 개념을 정확히 파악하고 연결해서 이해하는 힘"
  },
  {
    key: "QUESTION_QUALITY",
    name: "질문 구체성",
    description: "수업 중 질문이 구체적이고 학습 병목을 잘 드러내는 정도"
  },
  {
    key: "PROBLEM_SOLVING",
    name: "문제 해결력",
    description: "퀴즈와 문항 풀이에서 답을 구성해내는 능력"
  },
  {
    key: "APPLICATION_TRANSFER",
    name: "응용·전이력",
    description: "배운 내용을 새로운 문제나 문맥에 연결하는 능력"
  },
  {
    key: "QUIZ_ACCURACY",
    name: "퀴즈 정확도",
    description: "시험·퀴즈에서 실제 정답률로 드러난 성취도"
  },
  {
    key: "LEARNING_PERSISTENCE",
    name: "학습 지속성",
    description: "페이지 이동, 누적 세션, 반복 학습에서 보이는 꾸준함"
  },
  {
    key: "SELF_REFLECTION",
    name: "오답 성찰력",
    description: "피드백과 약점 메모를 바탕으로 스스로 보완하는 힘"
  },
  {
    key: "CLASS_PARTICIPATION",
    name: "수업 참여도",
    description: "질문, 응답, 세션 활동량으로 확인되는 참여 수준"
  },
  {
    key: "CONFIDENCE_GROWTH",
    name: "학습 자신감",
    description: "학습자 모델 confidence와 반응 흐름에서 보이는 자신감"
  },
  {
    key: "IMPROVEMENT_MOMENTUM",
    name: "성장 모멘텀",
    description: "최근 흐름이 좋아지고 있는지, 다음 상승 여지가 있는지"
  }
] satisfies ReadonlyArray<BuiltInReportCriterion>;

const REPORT_CRITERIA_PRESETS = [
  {
    name: "피드백 수용력",
    description: "교사와 AI 피드백 이후 설명 방식, 풀이 전략, 학습 태도를 조정하는 정도를 평가합니다."
  },
  {
    name: "자료 탐색력",
    description: "학습 자료와 대화 기록에서 필요한 근거를 찾아 답변이나 질문에 연결하는 능력을 봅니다."
  },
  {
    name: "학습 계획성",
    description: "복습, 질문, 과제 수행을 스스로 계획하고 다음 학습 행동으로 이어가는 정도를 평가합니다."
  }
] satisfies ReadonlyArray<{ name: string; description: string }>;

function normalizeCriterionName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function createEmptyCriterionForm() {
  return { name: "", description: "" };
}

const trendLabels: Record<StudentCompetencyScore["trend"], string> = {
  UP: "상승",
  STEADY: "유지",
  DOWN: "하락"
};

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function clampVisualPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
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

function formatTeacherExamMetric(stats: StudentCompetencyReport["sourceStats"] | null | undefined): string {
  const count = stats?.teacherExamResultCount ?? 0;
  if (count <= 0) return "0건";
  const average = stats?.teacherExamAverageScore;
  return typeof average === "number" && Number.isFinite(average)
    ? `${count}건 · ${average}점`
    : `${count}건 · -`;
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

interface ReportChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ReportChatMessage[];
}

type StudentReportStatusFilter = "ALL" | "MISSING" | "GENERATED";

const studentReportStatusFilterLabels: Record<StudentReportStatusFilter, string> = {
  ALL: "전체",
  MISSING: "리포트 없음",
  GENERATED: "리포트 생성됨"
};

function normalizeStudentSearch(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function studentReportStatusLabel(student: StudentReportListItem): string {
  return student.reportSummary ? "리포트 생성됨" : "리포트 없음";
}

function StudentStatusMetrics({ student }: { student: StudentReportListItem }) {
  const summary = student.reportSummary;
  const stats = summary?.sourceStats;
  const teacherExamCount = stats?.teacherExamResultCount ?? 0;

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
      {teacherExamCount > 0 ? (
        <span>
          <small>교사 시험</small>
          <strong>{formatTeacherExamMetric(stats)}</strong>
        </span>
      ) : null}
    </span>
  );
}

function scrollDrawerThreadToBottom(marker: HTMLDivElement | null) {
  const scroller = marker?.parentElement;
  if (!scroller) return;
  scroller.scrollTop = scroller.scrollHeight;
}

const reportChatMarkdownPayloadKeys = [
  "report",
  "markdown",
  "answerMarkdown",
  "replyMarkdown",
  "contentMarkdown",
  "answer",
  "message"
];

function createReportChatSession(index = 1): ReportChatSession {
  const createdAt = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 9);
  return {
    id: `report_chat_session_${createdAt}_${suffix}`,
    title: `새 채팅 ${index}`,
    createdAt,
    updatedAt: createdAt,
    messages: []
  };
}

function stripJsonMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json|markdown)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractMarkdownPayload(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of reportChatMarkdownPayloadKeys) {
    const extracted = extractMarkdownPayload(record[key]);
    if (extracted?.trim()) return extracted;
  }
  const stringValues = Object.values(record).filter((item): item is string => typeof item === "string");
  return stringValues.length === 1 ? stringValues[0] : null;
}

function normalizeReportChatMarkdown(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parseTarget = stripJsonMarkdownFence(trimmed);
  try {
    const parsed = JSON.parse(parseTarget) as unknown;
    return extractMarkdownPayload(parsed)?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function deriveReportChatSessionTitle(messages: ReportChatMessage[], index: number): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const base = normalizeReportChatMarkdown(firstUserMessage?.contentMarkdown ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return base ? base.slice(0, 28) : `새 채팅 ${index + 1}`;
}

const ReportChatMessageView = memo(function ReportChatMessageView({
  message
}: {
  message: ReportChatMessage;
}) {
  const content = normalizeReportChatMarkdown(message.contentMarkdown);

  return (
    <article className={`report-chat-message ${message.role}`}>
      {message.role === "assistant" ? (
        <span className="report-chat-assistant-avatar" data-testid="report-chat-assistant-avatar" aria-hidden="true" />
      ) : null}
      <div className="report-chat-message-bubble" data-testid="report-chat-message-bubble">
        <span className="report-chat-message-label">
          {message.role === "user" ? "교사" : "AI 학습 코치"}
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
      </div>
    </article>
  );
});

interface CriteriaAssistantScopedProposal {
  action: "create" | "update" | "delete";
  name?: string;
  description?: string;
  rationale?: string;
  summaryCards?: ReportCriteriaAssistantSummaryCard[];
  targetCriterionId?: string;
  targetCriterionName?: string;
  targetCriterionDescription?: string;
  targetCriterionUpdatedAt?: string;
  classroomId: string;
  requestId: number;
  fallback?: boolean;
}

interface CriteriaAssistantMessage {
  id: string;
  role: "user" | "assistant";
  contentMarkdown: string;
  createdAt: string;
  proposal?: CriteriaAssistantScopedProposal;
}

interface CriteriaAssistantProgressItem {
  stage: ReportCriteriaAssistantStreamStage;
  label: string;
  progress: number;
  detail?: string;
  status: "done" | "active" | "idle";
}

const criteriaAssistantStageOrder: ReportCriteriaAssistantStreamStage[] = [
  "UNDERSTANDING_REQUEST",
  "CHECKING_CRITERIA",
  "GENERATING_CRITERION",
  "VALIDATING_APPLICABILITY",
  "READY_TO_APPLY",
  "COMPLETE"
];

const criteriaAssistantStageLabels: Record<ReportCriteriaAssistantStreamStage, string> = {
  UNDERSTANDING_REQUEST: "요청 이해",
  CHECKING_CRITERIA: "기본 항목 검토",
  GENERATING_CRITERION: "새 항목 초안 생성",
  VALIDATING_APPLICABILITY: "적용 가능성 확인",
  READY_TO_APPLY: "항목 추가 준비 완료",
  COMPLETE: "완료"
};

const initialCriteriaAssistantProgress: CriteriaAssistantProgressItem[] =
  criteriaAssistantStageOrder.map((stage, index) => ({
    stage,
    label: criteriaAssistantStageLabels[stage],
    progress: index / (criteriaAssistantStageOrder.length - 1),
    status: "idle"
  }));

function CriteriaAssistantProposalCard({
  proposal,
  disabled,
  onApply
}: {
  proposal: CriteriaAssistantScopedProposal;
  disabled: boolean;
  onApply: (proposal: CriteriaAssistantScopedProposal) => void;
}) {
  const isUpdate = proposal.action === "update";
  const isDelete = proposal.action === "delete";
  const heading = isDelete
    ? "기존 항목 제거 확인"
    : isUpdate
      ? "기존 항목 수정"
      : "추천 새 항목";
  const actionLabel = isDelete ? "제거하기" : isUpdate ? "수정하기" : "항목에 반영";
  const ariaLabel = isDelete
    ? "기존 항목 제거 확인"
    : isUpdate
      ? "기존 항목 수정"
      : "추천 새 항목";

  return (
    <section
      className={`report-criteria-ai-proposal ${proposal.action}`}
      data-testid="report-criteria-ai-proposal-card"
      aria-label={ariaLabel}
    >
      <div className="report-criteria-ai-proposal-head">
        <div>
          <span className="report-criteria-ai-mini-icon document" aria-hidden="true" />
          <strong>{heading}</strong>
        </div>
        {proposal.fallback ? <span className="report-badge subtle">검토 필요</span> : null}
      </div>
      {isUpdate || isDelete ? (
        <div className="report-criteria-ai-target" data-testid="report-criteria-ai-target">
          <span>{isDelete ? "삭제 대상" : "현재 항목"}</span>
          <strong>{proposal.targetCriterionName}</strong>
          <p>{proposal.targetCriterionDescription}</p>
        </div>
      ) : null}
      {isUpdate ? (
        <div className="report-criteria-ai-target next" data-testid="report-criteria-ai-next">
          <span>수정 후</span>
          <strong>{proposal.name}</strong>
          <p>{proposal.description}</p>
        </div>
      ) : isDelete ? (
        <p className="report-criteria-ai-rationale">
          이 추가 평가 항목을 평가 항목 관리에서 제거할까요? 기본 항목은 삭제되지 않습니다.
        </p>
      ) : (
        <>
          <h3>{proposal.name}</h3>
          <p>{proposal.description}</p>
        </>
      )}
      {proposal.rationale ? (
        <p className="report-criteria-ai-rationale">{proposal.rationale}</p>
      ) : null}
      <button
        className={`btn report-criteria-ai-apply${isDelete ? " danger" : ""}`}
        type="button"
        data-testid="report-criteria-ai-apply"
        disabled={disabled}
        onClick={() => onApply(proposal)}
      >
        {actionLabel}
      </button>
    </section>
  );
}

function CriteriaAssistantMessageView({
  message,
  applyDisabled,
  onApply
}: {
  message: CriteriaAssistantMessage;
  applyDisabled: boolean;
  onApply: (proposal: CriteriaAssistantScopedProposal) => void;
}) {
  return (
    <article className={`report-criteria-ai-message ${message.role}`}>
      <span className="report-criteria-ai-message-label">
        {message.role === "user" ? "교사" : "AI 에이전트"}
      </span>
      <div className="report-criteria-ai-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.contentMarkdown}</ReactMarkdown>
      </div>
      {message.proposal ? (
        <CriteriaAssistantProposalCard
          proposal={message.proposal}
          disabled={applyDisabled}
          onApply={onApply}
        />
      ) : null}
    </article>
  );
}

const reportChatDrawerId = "student-report-chat-drawer";
const criteriaAssistantDrawerId = "report-criteria-ai-drawer";
const initialAnalysisProgress: AnalysisProgressState = {
  active: false,
  completed: false,
  progress: 0,
  stage: null,
  label: "",
  thoughtMarkdown: ""
};

type ReportSection = "students" | "criteria" | "content";

const REPORT_SECTIONS: ReportSection[] = ["students", "criteria", "content"];

function getReportSection(value: string | null): ReportSection {
  return REPORT_SECTIONS.includes(value as ReportSection) ? value as ReportSection : "content";
}

export function ClassroomReportRoute() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeReportSection = getReportSection(searchParams.get("reportSection"));
  const [students, setStudents] = useState<StudentReportListItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentStatusFilter, setStudentStatusFilter] =
    useState<StudentReportStatusFilter>("ALL");
  const [expandedStudentId, setExpandedStudentId] = useState("");
  const [report, setReport] = useState<StudentCompetencyReport | null>(null);
  const [criteria, setCriteria] = useState<StudentReportCustomCriterion[]>([]);
  const [criteriaLoading, setCriteriaLoading] = useState(false);
  const [criteriaSaving, setCriteriaSaving] = useState(false);
  const [criteriaHydrated, setCriteriaHydrated] = useState(false);
  const [criteriaLoadError, setCriteriaLoadError] = useState("");
  const [criteriaFormError, setCriteriaFormError] = useState("");
  const [criteriaActionError, setCriteriaActionError] = useState("");
  const [criteriaComposerOpen, setCriteriaComposerOpen] = useState(false);
  const [editingCriterionId, setEditingCriterionId] = useState("");
  const [criterionForm, setCriterionForm] = useState(createEmptyCriterionForm);
  const [editingCriterionForm, setEditingCriterionForm] = useState(createEmptyCriterionForm);
  const [editingCriterionError, setEditingCriterionError] = useState("");
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressState>(
    initialAnalysisProgress
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ReportChatSession[]>(() => {
    const initialSession = createReportChatSession(1);
    return [initialSession];
  });
  const [activeChatSessionId, setActiveChatSessionId] = useState("");
  const [chatMessages, setChatMessages] = useState<ReportChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [criteriaAssistantOpen, setCriteriaAssistantOpen] = useState(false);
  const [criteriaAssistantInput, setCriteriaAssistantInput] = useState("");
  const [criteriaAssistantBusy, setCriteriaAssistantBusy] = useState(false);
  const [criteriaAssistantMessages, setCriteriaAssistantMessages] = useState<
    CriteriaAssistantMessage[]
  >([]);
  const [criteriaAssistantProgress, setCriteriaAssistantProgress] = useState<
    CriteriaAssistantProgressItem[]
  >(initialCriteriaAssistantProgress);
  const [criteriaAssistantThought, setCriteriaAssistantThought] = useState("");
  const [criteriaAssistantProposal, setCriteriaAssistantProposal] =
    useState<CriteriaAssistantScopedProposal | null>(null);
  const [criteriaAssistantAppliedSummary, setCriteriaAssistantAppliedSummary] = useState("");
  const [criteriaAssistantError, setCriteriaAssistantError] = useState("");
  const studentsRequestSeq = useRef(0);
  const reportRequestSeq = useRef(0);
  const criteriaRequestSeq = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const currentClassroomIdRef = useRef("");
  const currentSelectedStudentIdRef = useRef("");
  const chatRequestSeqRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatRafRef = useRef<number | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const chatToggleRef = useRef<HTMLButtonElement | null>(null);
  const reportChatScopeRef = useRef({
    activeSessionId: "",
    studentId: "",
    reportGeneratedAt: ""
  });
  const criteriaAssistantRequestSeqRef = useRef(0);
  const criteriaAssistantAbortRef = useRef<AbortController | null>(null);
  const criteriaAssistantBottomRef = useRef<HTMLDivElement | null>(null);
  const criteriaAssistantAppliedRequestsRef = useRef<Set<string>>(new Set());
  const criteriaAssistantApplyLocksRef = useRef<Set<string>>(new Set());
  const criteriaAssistantClassroomRef = useRef("");
  const editingCriterionIdRef = useRef("");
  const editingCriterionNameInputRef = useRef<HTMLInputElement | null>(null);
  const activeReportSectionRef = useRef<ReportSection>(activeReportSection);
  const studentsRef = useRef<StudentReportListItem[]>([]);
  const deferredThoughtMarkdown = useDeferredValue(analysisProgress.thoughtMarkdown);
  const deferredStudentSearch = useDeferredValue(studentSearch);
  currentClassroomIdRef.current = classroomId ?? "";
  currentSelectedStudentIdRef.current = selectedStudentId;
  criteriaAssistantClassroomRef.current = classroomId ?? "";
  editingCriterionIdRef.current = editingCriterionId;
  activeReportSectionRef.current = activeReportSection;
  studentsRef.current = students;

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [selectedStudentId, students]
  );
  const selectedStudentReportKey = selectedStudent
    ? `${selectedStudent.id}:${selectedStudent.reportSummary?.generatedAt ?? "NO_REPORT"}`
    : "";
  const reportGeneratedStudents = useMemo(
    () => students.filter((student) => Boolean(student.reportSummary)),
    [students]
  );
  const reportMissingStudents = useMemo(
    () => students.filter((student) => !student.reportSummary),
    [students]
  );
  const normalizedStudentSearch = normalizeStudentSearch(deferredStudentSearch);
  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      const matchesStatus =
        studentStatusFilter === "ALL" ||
        (studentStatusFilter === "MISSING" && !student.reportSummary) ||
        (studentStatusFilter === "GENERATED" && Boolean(student.reportSummary));
      if (!matchesStatus) return false;
      if (!normalizedStudentSearch) return true;
      const searchable = normalizeStudentSearch(
        `${student.displayName} ${student.inviteCode} ${student.maskedEmail}`
      );
      return searchable.includes(normalizedStudentSearch);
    });
  }, [normalizedStudentSearch, studentStatusFilter, students]);
  const studentFilterActive = Boolean(normalizedStudentSearch) || studentStatusFilter !== "ALL";
  const selectedStudentHiddenByFilters = Boolean(
    selectedStudent &&
      studentFilterActive &&
      !filteredStudents.some((student) => student.id === selectedStudent.id)
  );

  const selectedStudentReportSummary = selectedStudent?.reportSummary ?? null;
  const visibleReport =
    report?.reportScope === "STUDENT" &&
    report.classroomId === classroomId &&
    report.studentUserId === selectedStudentId &&
    selectedStudentReportSummary &&
    report.generatedAt === selectedStudentReportSummary.generatedAt
      ? report
      : null;
  reportChatScopeRef.current = {
    activeSessionId: activeChatSessionId,
    studentId: selectedStudentId,
    reportGeneratedAt: visibleReport?.generatedAt ?? ""
  };
  const canChat = Boolean(classroomId && selectedStudent && visibleReport);
  const reportChatActive = activeReportSection === "content";
  const criteriaAssistantActive = activeReportSection === "criteria";
  const reportChatVisible = chatOpen && reportChatActive;
  const criteriaAssistantVisible = criteriaAssistantOpen && criteriaAssistantActive;
  const reportAiAvailable = reportChatActive || criteriaAssistantActive;
  const aiToggleOpen = reportChatVisible || criteriaAssistantVisible;
  const criteriaDisplayState = criteriaLoading
    ? "loading"
    : criteriaLoadError
      ? "error"
      : criteriaHydrated
        ? "ready"
        : "loading";
  const criteriaReady = criteriaDisplayState === "ready";
  const criteriaControlsDisabled = criteriaSaving || analyzing || !criteriaReady;
  const criteriaStatusText =
    criteriaDisplayState === "loading"
      ? "추가 항목 불러오는 중"
      : criteriaDisplayState === "error"
        ? "추가 항목 불러오기 실패"
        : `추가 ${criteria.length}개`;
  const criteriaHeroAdditionalText =
    criteriaDisplayState === "loading"
      ? "확인 중"
      : criteriaDisplayState === "error"
        ? "확인 실패"
        : `${criteria.length}개`;
  const criteriaHeroBasisText = criteriaReady ? "반영 중" : "확인 중";
  const visibleCustomCriteria = criteriaDisplayState === "ready" ? criteria : [];
  const analysisBlocked = analyzing || criteriaLoading || criteriaSaving || Boolean(criteriaLoadError);
  const reportSetupStats =
    activeReportSection === "students"
      ? [
          {
            id: "participants",
            testId: "report-setup-stat-students-total",
            icon: "users",
            label: "참여 학생",
            value: `${students.length}명`
          },
          {
            id: "selected",
            testId: "report-setup-stat-students-selected",
            icon: "selected",
            label: "선택 학생",
            value: selectedStudent ? "1명" : "0명"
          },
          {
            id: "missing",
            testId: "report-setup-stat-students-missing",
            icon: "missing",
            label: "리포트 없음",
            value: `${reportMissingStudents.length}명`
          }
        ]
        : [
          {
            id: "basic",
            testId: "report-setup-stat-basic",
            icon: "document",
            label: "기본 항목",
            value: `${BUILT_IN_REPORT_CRITERIA.length}개`
          },
          {
            id: "custom",
            testId: "report-setup-stat-custom",
            icon: "plus",
            label: "추가 항목",
            value: criteriaHeroAdditionalText
          },
          {
            id: "basis",
            testId: "report-setup-stat-basis",
            icon: "sparkle",
            label: "분석 기준",
            value: criteriaHeroBasisText
          }
        ];
  const visibleTeacherExamCount = visibleReport?.sourceStats.teacherExamResultCount ?? 0;

  function setReportSection(section: ReportSection) {
    const next = new URLSearchParams(searchParams);
    next.set("reportSection", section);
    setSearchParams(next);
  }

  function cancelPendingChatFrame() {
    if (chatRafRef.current !== null) {
      window.cancelAnimationFrame(chatRafRef.current);
      chatRafRef.current = null;
    }
  }

  function isCurrentReportChatRequest(
    requestSeq: number,
    requestSessionId: string,
    requestStudentId: string,
    requestReportGeneratedAt: string
  ) {
    const scope = reportChatScopeRef.current;
    return (
      chatRequestSeqRef.current === requestSeq &&
      scope.activeSessionId === requestSessionId &&
      scope.studentId === requestStudentId &&
      scope.reportGeneratedAt === requestReportGeneratedAt
    );
  }

  function resetReportChat() {
    chatRequestSeqRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    cancelPendingChatFrame();
    const session = createReportChatSession(1);
    setChatSessions([session]);
    setActiveChatSessionId(session.id);
    setChatMessages([]);
    setChatInput("");
    setChatError("");
    setChatLoading(false);
  }

  function startNewReportChatSession() {
    if (chatLoading) return;
    const session = createReportChatSession(chatSessions.length + 1);
    setChatSessions((prev) => [...prev, session]);
    setActiveChatSessionId(session.id);
    setChatMessages([]);
    setChatInput("");
    setChatError("");
  }

  function switchReportChatSession(sessionId: string) {
    if (chatLoading || sessionId === activeChatSessionId) return;
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveChatSessionId(session.id);
    setChatMessages(session.messages);
    setChatInput("");
    setChatError("");
  }

  function closeReportChat() {
    chatRequestSeqRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    cancelPendingChatFrame();
    setChatLoading(false);
    setChatOpen(false);
    window.requestAnimationFrame(() => chatToggleRef.current?.focus());
  }

  function resetCriteriaAssistant(options: { clearMessages?: boolean } = {}) {
    criteriaAssistantRequestSeqRef.current += 1;
    criteriaAssistantAbortRef.current?.abort();
    criteriaAssistantAbortRef.current = null;
    criteriaAssistantAppliedRequestsRef.current.clear();
    criteriaAssistantApplyLocksRef.current.clear();
    setCriteriaAssistantBusy(false);
    setCriteriaAssistantInput("");
    setCriteriaAssistantError("");
    setCriteriaAssistantThought("");
    setCriteriaAssistantProgress(initialCriteriaAssistantProgress);
    setCriteriaAssistantProposal(null);
    setCriteriaAssistantAppliedSummary("");
    if (options.clearMessages ?? true) {
      setCriteriaAssistantMessages([]);
    }
  }

  function closeCriteriaAssistant() {
    criteriaAssistantRequestSeqRef.current += 1;
    setCriteriaAssistantOpen(false);
    criteriaAssistantAbortRef.current?.abort();
    criteriaAssistantAbortRef.current = null;
    setCriteriaAssistantBusy(false);
    window.requestAnimationFrame(() => chatToggleRef.current?.focus());
  }

  function resetAddCriterionForm() {
    setCriterionForm(createEmptyCriterionForm());
    setCriteriaFormError("");
  }

  function openCriterionComposer() {
    if (criteriaControlsDisabled) return;
    closeCriterionEdit();
    setCriteriaActionError("");
    setCriteriaFormError("");
    setCriteriaComposerOpen(true);
  }

  function cancelCriterionCreate() {
    resetAddCriterionForm();
    setCriteriaComposerOpen(false);
  }

  function closeCriterionEdit(options: { restoreFocus?: boolean } = {}) {
    const closingCriterionId = editingCriterionIdRef.current;
    setEditingCriterionId("");
    setEditingCriterionForm(createEmptyCriterionForm());
    setEditingCriterionError("");
    if (options.restoreFocus && closingCriterionId) {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(`[data-criterion-edit-button-id="${closingCriterionId}"]`)
          ?.focus();
      });
    }
  }

  function resetAllCriterionForms() {
    resetAddCriterionForm();
    setCriteriaComposerOpen(false);
    setCriteriaActionError("");
    closeCriterionEdit();
  }

  function selectReportStudent(studentId: string) {
    if (analyzing || studentId === selectedStudentId) return;
    setExpandedStudentId(studentId);
    setSelectedStudentId(studentId);
  }

  function resetStudentFilters() {
    setStudentSearch("");
    setStudentStatusFilter("ALL");
  }

  function toggleStudentDetails(studentId: string, event?: MouseEvent<HTMLElement>) {
    event?.stopPropagation();
    if (analyzing) return;
    setExpandedStudentId((prev) => (prev === studentId ? "" : studentId));
  }

  function handleStudentRowClick(student: StudentReportListItem, event: MouseEvent<HTMLElement>) {
    if (analyzing) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button,input,select,a")) return;
    selectReportStudent(student.id);
  }

  async function refreshCriteria() {
    if (!classroomId) return;
    const requestSeq = ++criteriaRequestSeq.current;
    const requestClassroomId = classroomId;
    setCriteriaLoading(true);
    setCriteriaLoadError("");
    setCriteriaActionError("");
    try {
      const next = await getClassroomReportCriteria(requestClassroomId);
      if (
        requestSeq !== criteriaRequestSeq.current ||
        currentClassroomIdRef.current !== requestClassroomId
      ) {
        return;
      }
      setCriteria(next);
      setCriteriaHydrated(true);
      setCriteriaLoadError("");
    } catch (err) {
      if (
        requestSeq !== criteriaRequestSeq.current ||
        currentClassroomIdRef.current !== requestClassroomId
      ) {
        return;
      }
      setCriteriaLoadError(err instanceof Error ? err.message : "평가 항목을 불러오지 못했습니다.");
      setCriteriaComposerOpen(false);
      setCriteriaFormError("");
    } finally {
      if (
        requestSeq === criteriaRequestSeq.current &&
        currentClassroomIdRef.current === requestClassroomId
      ) {
        setCriteriaLoading(false);
      }
    }
  }

  function beginCriterionEdit(criterion: StudentReportCustomCriterion) {
    setCriteriaComposerOpen(false);
    setCriteriaFormError("");
    setCriteriaActionError("");
    setEditingCriterionId(criterion.id);
    setEditingCriterionForm({ name: criterion.name, description: criterion.description });
    setEditingCriterionError("");
  }

  function duplicateCriterionNameError(name: string, currentCriterionId = "") {
    const normalizedName = normalizeCriterionName(name);
    if (
      BUILT_IN_REPORT_CRITERIA.some(
        (criterion) => normalizeCriterionName(criterion.name) === normalizedName
      )
    ) {
      return "이미 사용 중인 평가 항목 이름입니다.";
    }
    if (
      criteria.some(
        (criterion) =>
          criterion.id !== currentCriterionId &&
          normalizeCriterionName(criterion.name) === normalizedName
      )
    ) {
      return "이미 사용 중인 평가 항목 이름입니다.";
    }
    return "";
  }

  function applyCriterionPreset(preset: (typeof REPORT_CRITERIA_PRESETS)[number]) {
    if (criteriaSaving || analyzing || criteriaDisplayState !== "ready") return;
    closeCriterionEdit();
    setCriteriaComposerOpen(true);
    setCriterionForm({ name: preset.name, description: preset.description });
    setCriteriaFormError("");
    setCriteriaActionError("");
  }

  function scopedCriteriaAssistantProposal(
    proposal: ReportCriteriaAssistantProposal,
    requestId: number,
    requestClassroomId: string
  ): CriteriaAssistantScopedProposal | null {
    const method = proposal.operation.method;
    const params = proposal.operation.params;
    const criterion = proposal.operation.params?.criterion;
    const name = criterion?.name.trim() ?? "";
    const description = criterion?.description.trim() ?? "";
    const targetCriterionId = params?.targetCriterionId?.trim() ?? "";
    const targetCriterionName = params?.targetCriterionName?.trim() ?? "";
    const targetCriterionDescription = params?.targetCriterionDescription?.trim() ?? "";
    const targetCriterionUpdatedAt = params?.targetCriterionUpdatedAt?.trim() ?? "";
    if (method === "updateCriterion") {
      if (
        !targetCriterionId ||
        !targetCriterionName ||
        !targetCriterionDescription ||
        !targetCriterionUpdatedAt ||
        !name ||
        !description
      ) {
        return null;
      }
      return {
        action: "update",
        name,
        description,
        targetCriterionId,
        targetCriterionName,
        targetCriterionDescription,
        targetCriterionUpdatedAt,
        rationale: params?.rationale,
        summaryCards: params?.summaryCards,
        classroomId: requestClassroomId,
        requestId,
        fallback: proposal.fallback === true
      };
    }
    if (method === "deleteCriterion") {
      if (
        !targetCriterionId ||
        !targetCriterionName ||
        !targetCriterionDescription ||
        !targetCriterionUpdatedAt
      ) {
        return null;
      }
      return {
        action: "delete",
        targetCriterionId,
        targetCriterionName,
        targetCriterionDescription,
        targetCriterionUpdatedAt,
        rationale: params?.rationale,
        summaryCards: params?.summaryCards,
        classroomId: requestClassroomId,
        requestId,
        fallback: proposal.fallback === true
      };
    }
    if (
      method !== "draftCriterion" &&
      method !== "reviseCriterion" &&
      method !== "createCriterion"
    ) {
      return null;
    }
    if (!name || !description) return null;
    return {
      action: "create",
      name,
      description,
      rationale: params?.rationale,
      summaryCards: params?.summaryCards,
      classroomId: requestClassroomId,
      requestId,
      fallback: proposal.fallback === true
    };
  }

  function updateCriteriaAssistantStage(event: Extract<ReportCriteriaAssistantStreamEvent, { type: "stage" }>) {
    const currentIndex = criteriaAssistantStageOrder.indexOf(event.stage);
    setCriteriaAssistantProgress((prev) =>
      prev.map((item) => {
        const itemIndex = criteriaAssistantStageOrder.indexOf(item.stage);
        const status =
          itemIndex < currentIndex || event.stage === "COMPLETE"
            ? "done"
            : item.stage === event.stage
              ? "active"
              : "idle";
        return item.stage === event.stage
          ? {
              ...item,
              label: event.label,
              progress: event.progress,
              detail: event.detail,
              status
            }
          : { ...item, status };
      })
    );
  }

  async function applyCriteriaAssistantProposal(
    proposal: CriteriaAssistantScopedProposal,
    options: { auto?: boolean } = {}
  ) {
    if (!classroomId) return;
    if (
      proposal.classroomId !== classroomId ||
      proposal.requestId !== criteriaAssistantRequestSeqRef.current ||
      currentClassroomIdRef.current !== proposal.classroomId ||
      activeReportSectionRef.current !== "criteria"
    ) {
      setCriteriaAssistantProposal(null);
      setCriteriaAssistantError("이전 강의실 또는 화면에서 만든 제안입니다. 다시 요청해 주세요.");
      return;
    }
    if (!options.auto && criteriaAssistantBusy) {
      setCriteriaAssistantError("현재 요청 처리가 끝난 뒤 반영해 주세요.");
      return;
    }
    if (!criteriaReady || criteriaSaving || analyzing || Boolean(criteriaLoadError)) {
      setCriteriaAssistantError("평가 항목 목록을 불러온 뒤 다시 반영해 주세요.");
      return;
    }
    const targetCriterion = proposal.targetCriterionId
      ? criteria.find((criterion) => criterion.id === proposal.targetCriterionId)
      : null;
    if (proposal.action !== "create") {
      if (!targetCriterion) {
        setCriteriaAssistantError("대상 평가 항목을 찾을 수 없습니다. 다시 요청해 주세요.");
        return;
      }
      if (
        targetCriterion.name !== proposal.targetCriterionName ||
        targetCriterion.description !== proposal.targetCriterionDescription ||
        targetCriterion.updatedAt !== proposal.targetCriterionUpdatedAt
      ) {
        setCriteriaAssistantError("대상 평가 항목이 변경되었습니다. 다시 요청해 주세요.");
        return;
      }
    }
    const name = proposal.name?.trim() ?? "";
    const description = proposal.description?.trim() ?? "";
    if (proposal.action !== "delete") {
      if (!name || !description) {
        setCriteriaAssistantError("항목 이름과 세부 설명이 모두 있어야 반영할 수 있습니다.");
        return;
      }
      const duplicateError = duplicateCriterionNameError(
        name,
        proposal.action === "update" ? proposal.targetCriterionId : ""
      );
      if (duplicateError) {
        setCriteriaAssistantError(duplicateError);
        return;
      }
    }
    const actionKey = [
      proposal.requestId,
      proposal.action,
      proposal.targetCriterionId ?? name
    ].join(":");
    if (
      criteriaAssistantAppliedRequestsRef.current.has(actionKey) ||
      criteriaAssistantApplyLocksRef.current.has(actionKey)
    ) {
      return;
    }
    criteriaAssistantApplyLocksRef.current.add(actionKey);

    setCriteriaSaving(true);
    setCriteriaAssistantError("");
    try {
      if (proposal.action === "update") {
        await updateClassroomReportCriterion(proposal.classroomId, proposal.targetCriterionId!, {
          name,
          description
        });
      } else if (proposal.action === "delete") {
        await deleteClassroomReportCriterion(proposal.classroomId, proposal.targetCriterionId!);
      } else {
        await createClassroomReportCriterion(proposal.classroomId, { name, description });
      }
      if (
        currentClassroomIdRef.current !== proposal.classroomId ||
        activeReportSectionRef.current !== "criteria"
      ) {
        return;
      }
      criteriaAssistantAppliedRequestsRef.current.add(actionKey);
      if (
        (proposal.action === "update" || proposal.action === "delete") &&
        editingCriterionIdRef.current === proposal.targetCriterionId
      ) {
        closeCriterionEdit();
      }
      await refreshCriteria();
      setCriteriaAssistantProposal(null);
      const resultLabel =
        proposal.action === "delete"
          ? `${proposal.targetCriterionName} 항목을 평가 항목 관리에서 제거했습니다.`
          : proposal.action === "update"
            ? `${name} 항목 수정 사항을 평가 항목 관리에 반영했습니다.`
            : `${name} 항목을 평가 항목 관리에 반영했습니다.`;
      setCriteriaAssistantAppliedSummary(resultLabel);
      setCriteriaAssistantMessages((prev) => [
        ...prev.map((item) =>
          item.proposal?.requestId === proposal.requestId ? { ...item, proposal: undefined } : item
        ),
        {
          id: `criteria_ai_apply_${proposal.requestId}_${Date.now()}`,
          role: "assistant",
          contentMarkdown: `**${resultLabel}**`,
          createdAt: new Date().toISOString()
        }
      ]);
    } catch (err) {
      if (currentClassroomIdRef.current !== proposal.classroomId) return;
      criteriaAssistantApplyLocksRef.current.delete(actionKey);
      setCriteriaAssistantError(
        err instanceof Error ? err.message : "평가 항목을 반영하지 못했습니다."
      );
    } finally {
      if (currentClassroomIdRef.current === proposal.classroomId) {
        setCriteriaSaving(false);
      }
    }
  }

  async function createCriterion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroomId || criteriaSaving || analyzing || criteriaDisplayState !== "ready") return;
    const actionClassroomId = classroomId;
    const name = criterionForm.name.trim();
    const description = criterionForm.description.trim();
    if (!name || !description) {
      setCriteriaComposerOpen(true);
      setCriteriaFormError("항목 이름과 세부 설명을 모두 입력해 주세요.");
      return;
    }
    const duplicateError = duplicateCriterionNameError(name);
    if (duplicateError) {
      setCriteriaComposerOpen(true);
      setCriteriaFormError(duplicateError);
      return;
    }
    setCriteriaSaving(true);
    setCriteriaFormError("");
    setCriteriaActionError("");
    try {
      await createClassroomReportCriterion(actionClassroomId, {
        name,
        description
      });
      if (currentClassroomIdRef.current !== actionClassroomId) return;
      resetAddCriterionForm();
      setCriteriaComposerOpen(false);
      await refreshCriteria();
    } catch (err) {
      if (currentClassroomIdRef.current !== actionClassroomId) return;
      setCriteriaComposerOpen(true);
      setCriteriaFormError(err instanceof Error ? err.message : "평가 항목을 저장하지 못했습니다.");
    } finally {
      if (currentClassroomIdRef.current === actionClassroomId) {
        setCriteriaSaving(false);
      }
    }
  }

  async function saveCriterionEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroomId || criteriaSaving || analyzing || criteriaDisplayState !== "ready") return;
    const actionClassroomId = classroomId;
    const actionCriterionId = editingCriterionId;
    if (!actionCriterionId) return;
    const name = editingCriterionForm.name.trim();
    const description = editingCriterionForm.description.trim();
    if (!name || !description) {
      setEditingCriterionError("항목 이름과 세부 설명을 모두 입력해 주세요.");
      return;
    }
    const duplicateError = duplicateCriterionNameError(name, actionCriterionId);
    if (duplicateError) {
      setEditingCriterionError(duplicateError);
      return;
    }
    setCriteriaSaving(true);
    setEditingCriterionError("");
    setCriteriaActionError("");
    try {
      await updateClassroomReportCriterion(actionClassroomId, actionCriterionId, {
        name,
        description
      });
      if (
        currentClassroomIdRef.current !== actionClassroomId ||
        editingCriterionIdRef.current !== actionCriterionId
      ) {
        return;
      }
      closeCriterionEdit();
      await refreshCriteria();
    } catch (err) {
      if (
        currentClassroomIdRef.current !== actionClassroomId ||
        editingCriterionIdRef.current !== actionCriterionId
      ) {
        return;
      }
      setEditingCriterionError(err instanceof Error ? err.message : "평가 항목을 저장하지 못했습니다.");
    } finally {
      if (currentClassroomIdRef.current === actionClassroomId) {
        setCriteriaSaving(false);
      }
    }
  }

  async function removeCriterion(criterion: StudentReportCustomCriterion) {
    if (!classroomId || criteriaSaving || analyzing) return;
    const actionClassroomId = classroomId;
    setCriteriaSaving(true);
    setCriteriaFormError("");
    setCriteriaActionError("");
    if (editingCriterionIdRef.current === criterion.id) {
      setEditingCriterionError("");
    }
    try {
      await deleteClassroomReportCriterion(actionClassroomId, criterion.id);
      if (currentClassroomIdRef.current !== actionClassroomId) return;
      if (editingCriterionIdRef.current === criterion.id) {
        closeCriterionEdit();
      }
      await refreshCriteria();
    } catch (err) {
      if (currentClassroomIdRef.current !== actionClassroomId) return;
      const message = err instanceof Error ? err.message : "평가 항목을 삭제하지 못했습니다.";
      if (editingCriterionIdRef.current === criterion.id) {
        setEditingCriterionError(message);
      } else {
        setCriteriaActionError(message);
      }
    } finally {
      if (currentClassroomIdRef.current === actionClassroomId) {
        setCriteriaSaving(false);
      }
    }
  }

  async function sendReportChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroomId || !selectedStudent || !visibleReport) {
      setChatError("학생 리포트를 먼저 생성하면 질문할 수 있습니다.");
      return;
    }

    const message = chatInput.trim();
    if (!message || chatLoading) return;
    const requestSessionId = activeChatSessionId || chatSessions[0]?.id || "";
    if (!requestSessionId) return;
    const requestStudentId = selectedStudent.id;
    const requestReportGeneratedAt = visibleReport.generatedAt;

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
      .filter((item) => item.contentMarkdown.trim() && !item.streaming)
      .slice(-8)
      .map((item) => ({
        role: item.role,
        contentMarkdown: normalizeReportChatMarkdown(item.contentMarkdown)
      }));

    let assistantText = "";
    const flushAssistantText = () => {
      chatRafRef.current = null;
      if (
        !isCurrentReportChatRequest(
          requestSeq,
          requestSessionId,
          requestStudentId,
          requestReportGeneratedAt
        )
      ) {
        return;
      }
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
          if (
            !isCurrentReportChatRequest(
              requestSeq,
              requestSessionId,
              requestStudentId,
              requestReportGeneratedAt
            )
          ) {
            return;
          }
          if (streamEvent.type === "answer_delta") {
            assistantText += streamEvent.text;
            scheduleAssistantFlush();
          }
          if (streamEvent.type === "done" && streamEvent.answerText !== undefined) {
            assistantText = normalizeReportChatMarkdown(streamEvent.answerText);
          }
        },
        controller.signal
      );

      if (
        !isCurrentReportChatRequest(
          requestSeq,
          requestSessionId,
          requestStudentId,
          requestReportGeneratedAt
        )
      ) {
        return;
      }
      cancelPendingChatFrame();
      assistantText = normalizeReportChatMarkdown(result.answerText || assistantText);
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, contentMarkdown: assistantText, streaming: false }
            : item
        )
      );
    } catch (err) {
      if (
        controller.signal.aborted ||
        !isCurrentReportChatRequest(
          requestSeq,
          requestSessionId,
          requestStudentId,
          requestReportGeneratedAt
        )
      ) {
        return;
      }
      cancelPendingChatFrame();
      const messageText =
        err instanceof ApiError && err.status === 409
          ? "학생 리포트를 먼저 생성하면 질문할 수 있습니다."
          : err instanceof Error
            ? err.message
            : "학생 리포트 챗봇 응답을 받지 못했습니다.";
      setChatError(messageText);
      assistantText = normalizeReportChatMarkdown(assistantText);
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
      if (
        isCurrentReportChatRequest(
          requestSeq,
          requestSessionId,
          requestStudentId,
          requestReportGeneratedAt
        )
      ) {
        setChatLoading(false);
        chatAbortRef.current = null;
      }
    }
  }

  async function sendCriteriaAssistantMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroomId) return;
    const message = criteriaAssistantInput.trim();
    if (!message || criteriaAssistantBusy) return;

    criteriaAssistantAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = criteriaAssistantRequestSeqRef.current + 1;
    criteriaAssistantRequestSeqRef.current = requestId;
    criteriaAssistantAbortRef.current = controller;
    const requestClassroomId = classroomId;
    const createdAt = new Date().toISOString();
    const history: ReportCriteriaAssistantMessageInput[] = criteriaAssistantMessages
      .filter((item) => item.contentMarkdown.trim())
      .slice(-8)
      .map((item) => ({
        role: item.role,
        contentMarkdown: item.contentMarkdown
      }));
    const currentProposal =
      criteriaAssistantProposal?.classroomId === requestClassroomId &&
      criteriaAssistantProposal.action === "create" &&
      criteriaAssistantProposal.name &&
      criteriaAssistantProposal.description
        ? {
            name: criteriaAssistantProposal.name,
            description: criteriaAssistantProposal.description
          }
        : null;
    const userMessage: CriteriaAssistantMessage = {
      id: `criteria_ai_user_${createdAt}_${requestId}`,
      role: "user",
      contentMarkdown: message,
      createdAt
    };

    setCriteriaAssistantInput("");
    setCriteriaAssistantBusy(true);
    setCriteriaAssistantError("");
    setCriteriaAssistantThought("");
    setCriteriaAssistantAppliedSummary("");
    setCriteriaAssistantProgress(initialCriteriaAssistantProgress);
    setCriteriaAssistantProposal(null);
    setCriteriaAssistantMessages((prev) => [...prev, userMessage]);

    try {
      const result = await streamReportCriteriaAssistantChat(
        requestClassroomId,
        {
          message,
          history,
          currentProposal
        },
        (streamEvent) => {
          if (
            controller.signal.aborted ||
            criteriaAssistantRequestSeqRef.current !== requestId ||
            currentClassroomIdRef.current !== requestClassroomId ||
            activeReportSectionRef.current !== "criteria"
          ) {
            return;
          }
          if (streamEvent.type === "stage") {
            updateCriteriaAssistantStage(streamEvent);
            return;
          }
          if (streamEvent.type === "thought_delta") {
            setCriteriaAssistantThought(streamEvent.text);
            return;
          }
          if (streamEvent.type === "proposal") {
            const scoped = scopedCriteriaAssistantProposal(
              streamEvent.data,
              requestId,
              requestClassroomId
            );
            if (scoped) setCriteriaAssistantProposal(scoped);
            setCriteriaAssistantMessages((prev) => [
              ...prev,
              {
                id: `criteria_ai_assistant_${createdAt}_${requestId}`,
                role: "assistant",
                contentMarkdown: streamEvent.data.replyMarkdown,
                createdAt: new Date().toISOString()
              }
            ]);
          }
        },
        controller.signal
      );

      if (
        controller.signal.aborted ||
        criteriaAssistantRequestSeqRef.current !== requestId ||
        currentClassroomIdRef.current !== requestClassroomId ||
        activeReportSectionRef.current !== "criteria"
      ) {
        return;
      }

      const scoped = scopedCriteriaAssistantProposal(result, requestId, requestClassroomId);
      if (
        scoped &&
        result.operation.method === "createCriterion" &&
        result.fallback !== true
      ) {
        await applyCriteriaAssistantProposal(scoped, { auto: true });
      }
    } catch (err) {
      if (controller.signal.aborted || criteriaAssistantRequestSeqRef.current !== requestId) return;
      setCriteriaAssistantError(
        err instanceof Error ? err.message : "평가 항목 도우미 응답을 받지 못했습니다."
      );
    } finally {
      if (criteriaAssistantRequestSeqRef.current === requestId) {
        setCriteriaAssistantBusy(false);
        criteriaAssistantAbortRef.current = null;
      }
    }
  }

  async function refreshStudents(
    preferredStudentId = selectedStudentId,
    options: { expectedReport?: StudentCompetencyReport | null } = {}
  ) {
    if (!classroomId) return "";
    const requestSeq = ++studentsRequestSeq.current;
    const requestClassroomId = classroomId;
    setStudentsLoading(true);
    setError("");
    try {
      const nextStudents = await getClassroomReportStudents(requestClassroomId);
      if (
        requestSeq !== studentsRequestSeq.current ||
        currentClassroomIdRef.current !== requestClassroomId
      ) {
        return null;
      }
      setStudents(nextStudents);
      const nextSelected =
        nextStudents.find((student) => student.id === preferredStudentId)?.id ??
        nextStudents[0]?.id ??
        "";
      setSelectedStudentId(nextSelected);
      setExpandedStudentId((prev) =>
        prev && nextStudents.some((student) => student.id === prev) ? prev : nextSelected
      );
      if (!nextSelected) {
        reportRequestSeq.current += 1;
        setReport(null);
        setReportLoading(false);
      } else if (nextSelected === currentSelectedStudentIdRef.current) {
        const nextSelectedStudent = nextStudents.find((student) => student.id === nextSelected);
        if (!nextSelectedStudent?.reportSummary) {
          reportRequestSeq.current += 1;
          setReport(null);
          setReportLoading(false);
        } else {
          const currentReport = options.expectedReport ?? report;
          if (
            currentReport?.reportScope === "STUDENT" &&
            currentReport.studentUserId === nextSelected &&
            currentReport.generatedAt !== nextSelectedStudent.reportSummary.generatedAt
          ) {
            reportRequestSeq.current += 1;
            setReport(null);
            refreshSelectedReport(nextSelected).catch(console.error);
          }
        }
      }
      return nextSelected;
    } catch (err) {
      if (
        requestSeq !== studentsRequestSeq.current ||
        currentClassroomIdRef.current !== requestClassroomId
      ) {
        return null;
      }
      setError(err instanceof Error ? err.message : "학생 목록을 불러오지 못했습니다.");
      return null;
    } finally {
      if (
        requestSeq === studentsRequestSeq.current &&
        currentClassroomIdRef.current === requestClassroomId
      ) {
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
      const currentSummary = studentsRef.current.find(
        (student) => student.id === requestStudentId
      )?.reportSummary;
      if (!currentSummary || (next && next.generatedAt !== currentSummary.generatedAt)) {
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
    if (!classroomId || !selectedStudentId || analysisBlocked) return;
    setReportSection("content");
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
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
        },
        controller.signal
      );
      if (
        controller.signal.aborted ||
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
      const refreshedStudentId = await refreshStudents(analysisStudentId, { expectedReport: next });
      if (
        controller.signal.aborted ||
        requestSeq !== reportRequestSeq.current ||
        currentClassroomIdRef.current !== analysisClassroomId ||
        currentSelectedStudentIdRef.current !== analysisStudentId ||
        refreshedStudentId !== analysisStudentId
      ) {
        return;
      }
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
      if (controller.signal.aborted) return;
      if (requestSeq !== reportRequestSeq.current) return;
      setAnalysisProgress((prev) => ({
        ...prev,
        active: false
      }));
      setError(err instanceof Error ? err.message : "Gemini 학생별 분석에 실패했습니다.");
    } finally {
      if (requestSeq === reportRequestSeq.current) {
        setAnalyzing(false);
        if (analysisAbortRef.current === controller) {
          analysisAbortRef.current = null;
        }
      }
    }
  }

  useEffect(() => {
    studentsRequestSeq.current += 1;
    reportRequestSeq.current += 1;
    criteriaRequestSeq.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setStudents([]);
    setSelectedStudentId("");
    setStudentSearch("");
    setStudentStatusFilter("ALL");
    setExpandedStudentId("");
    setReport(null);
    setCriteria([]);
    setCriteriaSaving(false);
    setCriteriaLoading(false);
    setCriteriaHydrated(false);
    setReportLoading(false);
    setAnalyzing(false);
    setAnalysisProgress(initialAnalysisProgress);
    setCriteriaAssistantOpen(false);
    resetCriteriaAssistant({ clearMessages: true });
    resetAllCriterionForms();
    refreshStudents("").catch(console.error);
    refreshCriteria().catch(console.error);
  }, [classroomId]);

  useEffect(() => {
    if (!editingCriterionId) return;
    window.requestAnimationFrame(() => editingCriterionNameInputRef.current?.focus());
  }, [editingCriterionId]);

  useEffect(() => {
    if (!selectedStudentId) return;
    if (!selectedStudent) {
      if (students.length > 0) setReport(null);
      return;
    }
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setAnalyzing(false);
    setAnalysisProgress(initialAnalysisProgress);
    if (!selectedStudent.reportSummary) {
      reportRequestSeq.current += 1;
      setReport(null);
      setReportLoading(false);
      return;
    }
    refreshSelectedReport(selectedStudentId).catch(console.error);
  }, [classroomId, selectedStudentId, selectedStudentReportKey, students.length]);

  useEffect(() => {
    resetReportChat();
  }, [classroomId, selectedStudentId, visibleReport?.generatedAt]);

  useEffect(() => {
    if (!activeChatSessionId && chatSessions[0]) {
      setActiveChatSessionId(chatSessions[0].id);
    }
  }, [activeChatSessionId, chatSessions]);

  useEffect(() => {
    if (!activeChatSessionId) return;
    setChatSessions((prev) => {
      let changed = false;
      const next = prev.map((session, index) => {
        if (session.id !== activeChatSessionId) return session;
        changed = true;
        return {
          ...session,
          title: deriveReportChatSessionTitle(chatMessages, index),
          updatedAt: chatMessages.length > 0 ? new Date().toISOString() : session.updatedAt,
          messages: chatMessages
        };
      });
      return changed ? next : prev;
    });
  }, [activeChatSessionId, chatMessages]);

  useEffect(() => {
    if (!reportChatActive) {
      setChatOpen(false);
      resetReportChat();
    }
    if (!criteriaAssistantActive) {
      setCriteriaAssistantOpen(false);
      resetCriteriaAssistant({ clearMessages: true });
    }
  }, [activeReportSection]);

  useEffect(
    () => () => {
      analysisAbortRef.current?.abort();
      analysisAbortRef.current = null;
      chatRequestSeqRef.current += 1;
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      criteriaAssistantRequestSeqRef.current += 1;
      criteriaAssistantAbortRef.current?.abort();
      criteriaAssistantAbortRef.current = null;
      cancelPendingChatFrame();
    },
    []
  );

  useEffect(() => {
    if (!chatOpen && !criteriaAssistantOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (criteriaAssistantOpen) {
        closeCriteriaAssistant();
      } else {
        closeReportChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, criteriaAssistantOpen]);

  useEffect(() => {
    if (!chatOpen) return;
    scrollDrawerThreadToBottom(chatBottomRef.current);
  }, [chatOpen, chatMessages]);

  useEffect(() => {
    if (!criteriaAssistantOpen) return;
    scrollDrawerThreadToBottom(criteriaAssistantBottomRef.current);
  }, [criteriaAssistantOpen, criteriaAssistantMessages, criteriaAssistantProgress]);

  const topCompetencies = useMemo(
    () =>
      [...(visibleReport?.competencies ?? [])]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
    [visibleReport]
  );
  const reportPageClassName = [
    "page-shell",
    "report-page",
    aiToggleOpen ? "report-page-chat-open" : "",
    criteriaAssistantOpen && criteriaAssistantActive ? "report-page-criteria-ai-open" : "",
    criteriaAssistantActive && editingCriterionId ? "report-page-criteria-editing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (studentsLoading && students.length === 0) {
    return <main className="page-shell" data-testid="app-shell-content">학생별 역량 리포트 화면을 준비하는 중...</main>;
  }

  return (
    <main
      className={reportPageClassName}
      data-testid="app-shell-content"
    >
      <header
        className={`report-setup${activeReportSection === "criteria" ? " report-setup-criteria" : ""}`}
        data-testid="report-setup"
      >
        <Link className="report-back-link report-setup-back" to={`/classrooms/${classroomId}`}>
          ← 강의실로 돌아가기
        </Link>
        {activeReportSection === "criteria" ? (
          <section
            className="report-criteria-page-head"
            data-testid="report-criteria-page-head"
            aria-labelledby="report-criteria-page-title"
          >
            <div className="report-criteria-page-title-row">
              <span className="report-criteria-page-icon" aria-hidden="true" />
              <div>
                <h1 id="report-criteria-page-title" className="page-title report-heading-title">
                  평가 항목 분석 기준
                </h1>
                <p className="report-heading-copy">
                  학생 리포트 분석에 적용되는 평가 항목을 관리하고 분석 기준을 설정합니다.
                </p>
              </div>
            </div>
            <span className="report-criteria-guide-pill" data-testid="report-criteria-guide-pill">
              관리 안내
            </span>
          </section>
        ) : (
          <>
            <section
              className="report-setup-hero"
              data-testid="report-setup-hero"
              aria-labelledby="report-setup-title"
            >
              <div className="report-setup-copy">
                <span className="report-setup-kicker">리포트 설정</span>
                <h1 id="report-setup-title" className="page-title report-heading-title">
                  {visibleReport?.classroomTitle ?? "강의실"} 학생별 역량 리포트
                </h1>
                <p className="report-heading-copy">
                  참여 학생을 선택하면 해당 학생의 질문, 퀴즈, 세션 메모만 묶어 Gemini 리포트를 생성합니다.
                </p>
              </div>
              <div className="report-setup-metrics" aria-label="리포트 설정 지표">
                {reportSetupStats.map((stat) => (
                  <article className="report-setup-stat" data-testid={stat.testId} key={stat.id}>
                    <span className={`report-setup-stat-icon ${stat.icon}`} aria-hidden="true" />
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </article>
                ))}
              </div>
              <span className="report-setup-shape one" aria-hidden="true" />
              <span className="report-setup-shape two" aria-hidden="true" />
            </section>
            <div className="heading-actions report-setup-actions" data-testid="report-setup-actions">
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
                disabled={!selectedStudentId || analysisBlocked}
              >
                {analyzing
                  ? "Gemini 분석 중..."
                  : visibleReport
                    ? "선택 학생 다시 분석"
                    : "선택 학생 리포트 분석"}
              </button>
            </div>
          </>
        )}
      </header>

      <section className="report-workspace">
        <section className="report-section-panel" data-testid="report-section-panel">
          {criteriaLoadError && activeReportSection !== "criteria" ? (
            <section
              className="card alert alert-error report-global-alert"
              data-testid="report-global-criteria-alert"
              role="alert"
            >
              {criteriaLoadError}
            </section>
          ) : null}

      {activeReportSection === "students" ? (
        <section className="report-student-panel fade-in" aria-label="학생 선택">
          <div className="report-student-panel-head">
            <div>
              <strong>참여 학생</strong>
              <p>이름 또는 화살표로 상세 정보를 펼치고, 선택한 학생의 리포트는 리포트 내용에서 확인합니다.</p>
            </div>
            <span data-testid="report-student-total-badge">총 {filteredStudents.length}명</span>
          </div>

          <div className="report-student-controls" data-testid="report-student-controls">
            <label className="report-student-search">
              <span className="sr-only">참여 학생 검색</span>
              <span className="report-student-search-icon" aria-hidden="true" />
              <input
                type="search"
                aria-label="참여 학생 검색"
                value={studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
                placeholder="이름 또는 학생 검색"
                disabled={analyzing}
              />
            </label>
            <label className="report-student-filter">
              <span className="report-student-filter-icon" aria-hidden="true" />
              <select
                aria-label="리포트 상태 필터"
                value={studentStatusFilter}
                onChange={(event) =>
                  setStudentStatusFilter(event.target.value as StudentReportStatusFilter)
                }
                disabled={analyzing}
              >
                {Object.entries(studentReportStatusFilterLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <span className="report-student-count-chip" data-testid="report-student-status-counts">
              리포트 생성됨 {reportGeneratedStudents.length}명 · 리포트 없음 {reportMissingStudents.length}명
            </span>
          </div>

          {selectedStudentHiddenByFilters ? (
            <div className="report-student-hidden-selected" data-testid="report-student-hidden-selected">
              <span>
                현재 선택 학생 <strong>{selectedStudent?.displayName}</strong>은 필터 밖에 있습니다.
              </span>
              <button className="btn ghost" type="button" onClick={resetStudentFilters} disabled={analyzing}>
                필터 초기화
              </button>
            </div>
          ) : null}

          {students.length === 0 ? (
            <div className="report-student-empty">아직 참여 학생이 없습니다.</div>
          ) : filteredStudents.length > 0 ? (
            <div className="report-student-selector" role="list" data-testid="report-student-selector">
              {filteredStudents.map((student, index) => {
                const selected = student.id === selectedStudentId;
                const expanded = student.id === expandedStudentId;
                const detailId = `report-student-detail-${student.id}`;
                const generated = Boolean(student.reportSummary);
                return (
                  <article
                    key={student.id}
                    className={`report-student-option${selected ? " active" : ""}${expanded ? " expanded" : ""}`}
                    data-testid="report-student-option"
                    data-report-status={generated ? "generated" : "missing"}
                    role="listitem"
                    aria-current={selected ? "true" : undefined}
                    aria-disabled={analyzing}
                    onClick={(event) => handleStudentRowClick(student, event)}
                  >
                    <div className="report-student-row-main">
                      <span className="report-student-index" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="report-student-identity">
                        <button
                          className="report-student-name"
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={(event) => toggleStudentDetails(student.id, event)}
                          disabled={analyzing}
                        >
                          {student.displayName}
                        </button>
                        <span className="report-student-code">#{student.inviteCode}</span>
                        <span className="report-student-email">{student.maskedEmail}</span>
                      </div>
                      <span
                        className={`report-student-status-badge ${generated ? "generated" : "missing"}`}
                        data-testid="report-student-status-badge"
                      >
                        {studentReportStatusLabel(student)}
                      </span>
                      <div className="report-student-row-actions">
                        {selected ? (
                          <span className="report-student-selected-pill" data-testid="report-student-selected-pill">
                            선택됨
                          </span>
                        ) : (
                          <button
                            className="btn ghost report-student-select-btn"
                            type="button"
                            aria-label={`${student.displayName} 선택하기`}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectReportStudent(student.id);
                            }}
                            disabled={analyzing}
                          >
                            선택하기
                          </button>
                        )}
                        <button
                          className="report-student-expand-btn"
                          type="button"
                          aria-label={`${student.displayName} 상세 ${expanded ? "접기" : "펼치기"}`}
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={(event) => toggleStudentDetails(student.id, event)}
                          disabled={analyzing}
                        >
                          <span aria-hidden="true">⌄</span>
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <div
                        className="report-student-detail"
                        id={detailId}
                        data-testid="report-student-detail"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <StudentStatusMetrics student={student} />
                        <p>
                          {selected
                            ? "선택된 학생입니다. 리포트 내용 메뉴에서 결과를 확인할 수 있습니다."
                            : "선택하기를 누르면 이 학생을 리포트 분석 대상으로 지정합니다."}
                        </p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="report-student-empty filtered" data-testid="report-student-filter-empty">
              <strong>조건에 맞는 학생이 없습니다.</strong>
              <p>검색어나 리포트 상태 필터를 조정해 주세요.</p>
              <button className="btn ghost" type="button" onClick={resetStudentFilters} disabled={analyzing}>
                필터 초기화
              </button>
            </div>
          )}
        </section>
      ) : null}

      {activeReportSection === "criteria" ? (
        <section
          className="report-criteria-panel report-criteria-split-panel fade-in"
          aria-label="평가 항목 분석 기준"
        >
          <section
            className="card report-criteria-card report-criteria-custom-card"
            data-testid="report-criteria-custom-card"
            aria-labelledby="report-criteria-custom-title"
          >
            <div
              className="report-criteria-card-head report-criteria-custom-head"
              data-testid="report-criteria-custom-head"
            >
              <div>
                <div className="report-criteria-card-title-row">
                  <h2 id="report-criteria-custom-title">추가된 평가 항목</h2>
                  <span className="report-badge subtle" data-testid="report-criteria-custom-count">
                    <span data-testid="report-criteria-status">{criteriaStatusText}</span>
                  </span>
                </div>
                <p className="report-copy">
                  필요한 평가 항목을 직접 추가하여 학생 리포트 분석에 활용할 수 있습니다.
                </p>
              </div>
              <button
                className="btn report-criteria-add-toggle"
                type="button"
                data-testid="report-criteria-add-toggle"
                onClick={openCriterionComposer}
                disabled={criteriaControlsDisabled}
              >
                <span aria-hidden="true">+</span>
                평가 항목 추가
              </button>
            </div>

            {criteriaComposerOpen && criteriaDisplayState === "ready" ? (
              <form className="report-criteria-form" data-testid="report-criteria-form" onSubmit={createCriterion}>
                <div className="report-criteria-composer" data-testid="report-criteria-composer">
                  <div className="report-criteria-presets" data-testid="report-criteria-presets">
                    <span className="report-criteria-preset-copy">
                      빠르게 시작해 보세요 <small>(선택)</small>
                    </span>
                    {REPORT_CRITERIA_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        className="report-criteria-preset"
                        type="button"
                        data-testid="report-criteria-preset"
                        aria-label={`${preset.name} 프리셋 적용`}
                        onClick={() => applyCriterionPreset(preset)}
                        disabled={criteriaControlsDisabled}
                      >
                        <span aria-hidden="true">+</span>
                        {preset.name}
                      </button>
                    ))}
                  </div>

                  <label className="form-field report-criteria-field">
                    <span className="report-criteria-field-label">항목 이름</span>
                    <div className="report-criteria-input-shell">
                      <span className="report-criteria-input-icon document" aria-hidden="true" />
                      <input
                        type="text"
                        maxLength={60}
                        value={criterionForm.name}
                        onChange={(event) =>
                          setCriterionForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                        disabled={criteriaControlsDisabled}
                        placeholder="예: 피드백 수용력"
                      />
                    </div>
                  </label>
                  <label className="form-field report-criteria-field">
                    <span className="report-criteria-field-label">세부 설명</span>
                    <div className="report-criteria-input-shell textarea">
                      <span className="report-criteria-input-icon pencil" aria-hidden="true" />
                      <textarea
                        rows={3}
                        maxLength={600}
                        value={criterionForm.description}
                        onChange={(event) =>
                          setCriterionForm((prev) => ({ ...prev, description: event.target.value }))
                        }
                        disabled={criteriaControlsDisabled}
                        placeholder="이 항목에서 어떤 근거를 보고 평가할지 적어 주세요."
                      />
                    </div>
                  </label>
                  <div className="report-criteria-composer-foot">
                    <p className="report-criteria-helper" data-testid="report-criteria-helper">
                      <span aria-hidden="true">i</span>
                      추가한 항목은 이후 학생 리포트 재분석 시 함께 반영됩니다.
                    </p>
                    <div
                      className="form-actions report-criteria-form-actions"
                      data-testid="report-criteria-form-actions"
                    >
                      <button
                        className="btn ghost"
                        type="button"
                        data-testid="report-criteria-create-cancel"
                        onClick={cancelCriterionCreate}
                        disabled={criteriaSaving}
                      >
                        취소
                      </button>
                      <button className="btn" type="submit" disabled={criteriaControlsDisabled}>
                        {criteriaSaving ? "저장 중..." : "항목 추가"}
                      </button>
                    </div>
                  </div>
                </div>
                {criteriaFormError ? (
                  <div className="form-error" role="alert">
                    {criteriaFormError}
                  </div>
                ) : null}
              </form>
            ) : null}

            {criteriaActionError ? (
              <div className="form-error report-criteria-action-error" data-testid="report-criteria-action-error" role="alert">
                {criteriaActionError}
              </div>
            ) : null}

            {criteriaDisplayState === "error" ? (
              <div className="form-error report-criteria-load-error" role="alert">
                <span>{criteriaLoadError}</span>
                <button
                  className="btn ghost"
                  type="button"
                  data-testid="report-criteria-retry"
                  onClick={() => refreshCriteria()}
                  disabled={criteriaLoading || analyzing}
                >
                  다시 불러오기
                </button>
              </div>
            ) : null}

            {criteriaDisplayState === "loading" ? (
              <div className="report-criteria-empty-state loading" data-testid="report-criteria-loading-state">
                추가 평가 항목을 불러오는 중...
              </div>
            ) : null}

            {criteriaDisplayState === "ready" && visibleCustomCriteria.length === 0 && !criteriaComposerOpen ? (
              <div className="report-criteria-empty-state" data-testid="report-criteria-empty-state">
                <span className="report-criteria-empty-icon" aria-hidden="true" />
                <div>
                  <strong>아직 추가된 평가 항목이 없습니다.</strong>
                  <p>아래 버튼으로 새 평가 항목을 추가해 학생 리포트 재분석에 반영할 수 있습니다.</p>
                  <button
                    className="btn report-criteria-empty-add"
                    type="button"
                    data-testid="report-criteria-empty-add"
                    onClick={openCriterionComposer}
                    disabled={criteriaControlsDisabled}
                  >
                    <span aria-hidden="true">+</span>
                    평가 항목 추가
                  </button>
                </div>
              </div>
            ) : null}

            {visibleCustomCriteria.length > 0 ? (
              <div className="report-criteria-custom-list" data-testid="report-criteria-custom-list">
                {visibleCustomCriteria.map((criterion, index) => {
                  const isEditing = editingCriterionId === criterion.id;
                  const editErrorId = `report-criterion-edit-error-${criterion.id}`;
                  return (
                    <article
                      key={criterion.id}
                      className={`report-criteria-item report-criteria-row report-criteria-item-custom${
                        isEditing ? " editing" : ""
                      }`}
                      data-testid="report-criterion-custom"
                    >
                      <div className="report-criteria-item-summary" data-testid="report-criterion-summary">
                        {!isEditing ? <span className="report-criteria-drag-handle" aria-hidden="true" /> : null}
                        <span
                          className={`report-criteria-row-icon custom icon-${(index % 5) + 1}`}
                          aria-hidden="true"
                        />
                        <div className="report-criteria-main">
                          <div className="report-criteria-title-row">
                            <strong>{criterion.name}</strong>
                            <span className="report-badge subtle" data-testid="report-criterion-source-badge">
                              추가 항목
                            </span>
                          </div>
                          {!isEditing ? <p>{criterion.description}</p> : null}
                        </div>
                        <div className="report-criteria-actions">
                          {isEditing ? (
                            <button
                              className="btn ghost"
                              type="button"
                              aria-label={`${criterion.name} 수정 취소`}
                              onClick={() => closeCriterionEdit({ restoreFocus: true })}
                              disabled={criteriaSaving}
                            >
                              취소
                            </button>
                          ) : (
                            <button
                              className="btn ghost"
                              type="button"
                              aria-label={`${criterion.name} 수정`}
                              data-criterion-edit-button-id={criterion.id}
                              onClick={() => beginCriterionEdit(criterion)}
                              disabled={criteriaSaving || analyzing}
                            >
                              수정
                            </button>
                          )}
                          <button
                            className="btn danger"
                            type="button"
                            aria-label={`${criterion.name} 삭제`}
                            onClick={() => removeCriterion(criterion)}
                            disabled={criteriaSaving || analyzing}
                          >
                            삭제
                          </button>
                          {isEditing ? <span className="report-criteria-edit-chevron" aria-hidden="true" /> : null}
                        </div>
                      </div>

                      {isEditing ? (
                        <form
                          className="report-criterion-edit-form"
                          data-testid="report-criterion-edit-form"
                          aria-label={`${criterion.name} 평가 항목 수정`}
                          onSubmit={saveCriterionEdit}
                        >
                          <strong className="report-criterion-edit-title">평가 항목 수정</strong>
                          <label className="report-criterion-edit-field">
                            <span>평가 항목 이름</span>
                            <input
                              ref={editingCriterionNameInputRef}
                              type="text"
                              maxLength={60}
                              value={editingCriterionForm.name}
                              onChange={(event) =>
                                setEditingCriterionForm((prev) => ({ ...prev, name: event.target.value }))
                              }
                              disabled={criteriaSaving || analyzing}
                              aria-label="수정할 평가 항목 이름"
                              aria-describedby={editingCriterionError ? editErrorId : undefined}
                              aria-invalid={editingCriterionError ? "true" : undefined}
                            />
                          </label>
                          <label className="report-criterion-edit-field">
                            <span>세부 내용</span>
                            <textarea
                              rows={3}
                              maxLength={600}
                              value={editingCriterionForm.description}
                              onChange={(event) =>
                                setEditingCriterionForm((prev) => ({
                                  ...prev,
                                  description: event.target.value
                                }))
                              }
                              disabled={criteriaSaving || analyzing}
                              aria-label="수정할 세부 내용"
                              aria-describedby={editingCriterionError ? editErrorId : undefined}
                              aria-invalid={editingCriterionError ? "true" : undefined}
                            />
                          </label>
                          {editingCriterionError ? (
                            <div className="form-error report-criterion-edit-error" id={editErrorId} role="alert">
                              {editingCriterionError}
                            </div>
                          ) : null}
                          <div className="report-criterion-edit-foot">
                            <p className="report-criterion-edit-helper">변경 내용은 즉시 반영됩니다.</p>
                            <div className="report-criterion-edit-actions" data-testid="report-criterion-edit-actions">
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() => closeCriterionEdit({ restoreFocus: true })}
                                disabled={criteriaSaving}
                              >
                                취소
                              </button>
                              <button className="btn" type="submit" disabled={criteriaSaving || analyzing}>
                                {criteriaSaving ? "저장 중..." : "저장"}
                              </button>
                            </div>
                          </div>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            {criteriaDisplayState === "ready" && visibleCustomCriteria.length > 0 ? (
              <p className="report-criteria-list-helper">
                <span aria-hidden="true">i</span>
                추가한 항목은 학생 리포트 재분석 시 함께 반영됩니다.
              </p>
            ) : null}
          </section>

          <section
            className="card report-criteria-card report-criteria-built-in-card"
            data-testid="report-criteria-built-in-card"
            aria-labelledby="report-criteria-built-in-title"
          >
            <div className="report-criteria-card-head">
              <div>
                <div className="report-criteria-card-title-row">
                  <h2 id="report-criteria-built-in-title">기본 평가 항목</h2>
                  <span className="report-badge subtle">기본 {BUILT_IN_REPORT_CRITERIA.length}개</span>
                </div>
                <p className="report-copy">
                  기본 제공되는 평가 항목으로 학생 리포트 분석에 항상 포함됩니다. 삭제하거나 수정할 수 없습니다.
                </p>
              </div>
            </div>
            <div className="report-criteria-built-in-list" data-testid="report-criteria-built-in-list">
              {BUILT_IN_REPORT_CRITERIA.map((criterion, index) => (
                <article
                  key={criterion.key}
                  className="report-criteria-item report-criteria-row report-criteria-item-fixed"
                  data-testid="report-criterion-built-in"
                >
                  <span
                    className={`report-criteria-row-icon built-in icon-${(index % 5) + 1}`}
                    aria-hidden="true"
                  />
                  <div className="report-criteria-main">
                    <div className="report-criteria-title-row">
                      <strong>{criterion.name}</strong>
                    </div>
                    <p>{criterion.description}</p>
                  </div>
                  <div className="report-criteria-actions">
                    <span className="report-badge subtle" data-testid="report-criterion-source-badge">
                      기본
                    </span>
                    <span
                      className="report-criterion-fixed-status"
                      data-testid="report-criterion-fixed-status"
                    >
                      삭제 불가
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {activeReportSection === "content" ? (
        <section className="report-content-section" data-testid="report-content-section">
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
            aria-label="학생별 역량 리포트 분석 진행률"
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
        <section className="card report-meta-strip report-result-meta-strip fade-in">
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
          <section className="card report-hero report-result-hero fade-in">
            <div className="report-hero-main report-result-hero-main">
              <div className="report-result-hero-copy">
                <div className="report-badges report-result-badges">
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
                    clampVisualPercent(visibleReport.overallScore) * 3.6
                  }deg, rgba(18, 34, 64, 0.08) ${
                    clampVisualPercent(visibleReport.overallScore) * 3.6
                  }deg)`
                }}
              >
                <div className="report-score-ring-inner">
                  <strong>{visibleReport.overallScore}</strong>
                  <span>종합 점수</span>
                </div>
              </div>
            </div>

            <div className="report-stat-row report-result-stat-row">
              <div className="report-stat-chip report-result-stat-chip">
                <span className="report-result-stat-icon book" aria-hidden="true" />
                <div>
                  <span>강의</span>
                  <strong>{visibleReport.sourceStats.lectureCount}개</strong>
                </div>
              </div>
              <div className="report-stat-chip report-result-stat-chip">
                <span className="report-result-stat-icon question" aria-hidden="true" />
                <div>
                  <span>질문</span>
                  <strong>{visibleReport.sourceStats.questionCount}건</strong>
                </div>
              </div>
              <div className="report-stat-chip report-result-stat-chip">
                <span className="report-result-stat-icon check" aria-hidden="true" />
                <div>
                  <span>채점 퀴즈</span>
                  <strong>{visibleReport.sourceStats.gradedQuizCount}건</strong>
                </div>
              </div>
              <div className="report-stat-chip report-result-stat-chip">
                <span className="report-result-stat-icon star" aria-hidden="true" />
                <div>
                  <span>평균 점수</span>
                  <strong>{visibleReport.sourceStats.averageQuizScore}점</strong>
                </div>
              </div>
              <div className="report-stat-chip report-result-stat-chip">
                <span className="report-result-stat-icon exam" aria-hidden="true" />
                <div>
                  <span>교사 시험</span>
                  <strong>
                    {visibleTeacherExamCount > 0
                      ? formatTeacherExamMetric(visibleReport.sourceStats)
                      : "0건"}
                  </strong>
                </div>
              </div>
              <div className="report-stat-chip report-result-stat-chip">
                <span className="report-result-stat-icon page" aria-hidden="true" />
                <div>
                  <span>페이지 커버리지</span>
                  <strong>{formatPercent(visibleReport.sourceStats.pageCoverageRatio * 100)}</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="report-summary-grid report-result-summary-grid">
            <article className="card report-summary-card report-result-card report-result-summary-card fade-in">
              <h3 className="report-result-section-title">
                <span className="report-result-section-icon sparkle" aria-hidden="true" />
                핵심 요약
              </h3>
              <div className="markdown-content report-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {visibleReport.summaryMarkdown}
                </ReactMarkdown>
              </div>
            </article>

            <article className="card report-summary-card report-result-card report-result-summary-card fade-in">
              <h3 className="report-result-section-title">
                <span className="report-result-section-icon medal" aria-hidden="true" />
                두드러진 역량
              </h3>
              <div className="report-top-score-list">
                {topCompetencies.map((item) => (
                  <div key={item.key} className="report-top-score-item report-result-top-score-item">
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

          <section className="card report-competency-panel report-result-competency-panel fade-in">
            <div className="report-section-head">
              <div>
                <h3 className="report-result-section-title">
                  <span className="report-result-section-icon clipboard" aria-hidden="true" />
                  {visibleReport.competencies.length}개 역량 체크리스트
                </h3>
                <p className="report-copy">
                  세션 메모, 질문 로그, 퀴즈 성과를 묶어 항목별로 점수를 시각화했습니다.
                </p>
              </div>
            </div>

            <div className="report-competency-list">
              {visibleReport.competencies.map((item) => (
                <article key={item.key} className="report-competency-item report-result-competency-item">
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
                      style={{ width: `${clampVisualPercent(item.score)}%` }}
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

          <section className="report-insight-grid report-result-insight-grid">
            <article className="card report-side-card report-result-side-card fade-in">
              <h3 className="report-result-section-title">
                <span className="report-result-section-icon sparkle" aria-hidden="true" />
                강점
              </h3>
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

            <article className="card report-side-card report-result-side-card fade-in">
              <h3 className="report-result-section-title">
                <span className="report-result-section-icon shield" aria-hidden="true" />
                보완 포인트
              </h3>
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

            <article className="card report-side-card report-result-side-card fade-in">
              <h3 className="report-result-section-title">
                <span className="report-result-section-icon bulb" aria-hidden="true" />
                코칭 인사이트
              </h3>
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

            <article className="card report-side-card report-result-side-card fade-in">
              <h3 className="report-result-section-title">
                <span className="report-result-section-icon star" aria-hidden="true" />
                추천 액션
              </h3>
              {visibleReport.recommendedActions.length > 0 ? (
                <div className="report-action-list">
                  {visibleReport.recommendedActions.map((action) => (
                    <div key={action.title} className="report-action-item report-result-action-item">
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

          <section className="card report-lecture-panel report-result-lecture-panel fade-in">
            <div className="report-section-head">
              <div>
                <h3 className="report-result-section-title">
                  <span className="report-result-section-icon book" aria-hidden="true" />
                  강의별 학습 흐름
                </h3>
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
                    className="report-lecture-row report-result-lecture-row"
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
            <button className="btn" onClick={() => runAnalysis()} disabled={analysisBlocked}>
              {analyzing ? "Gemini 분석 중..." : "Gemini로 첫 학생 리포트 분석"}
            </button>
          </div>
        </section>
      ) : null}
        </section>
      ) : null}
        </section>
      </section>

      {reportAiAvailable ? (
        <button
          ref={chatToggleRef}
          type="button"
          className={`report-chat-toggle ${aiToggleOpen ? "active" : ""}`}
          aria-label={
            criteriaAssistantActive
              ? criteriaAssistantOpen
                ? "AI 리포트 도우미 닫기"
                : "AI 리포트 도우미 열기"
              : chatOpen
                ? "학생 리포트 챗봇 닫기"
                : "학생 리포트 챗봇 열기"
          }
          aria-expanded={aiToggleOpen}
          aria-controls={criteriaAssistantActive ? criteriaAssistantDrawerId : reportChatDrawerId}
          onClick={() => {
            if (criteriaAssistantActive) {
              setChatOpen(false);
              resetReportChat();
              if (criteriaAssistantOpen) {
                closeCriteriaAssistant();
              } else {
                setCriteriaAssistantOpen(true);
              }
              return;
            }
            setCriteriaAssistantOpen(false);
            resetCriteriaAssistant({ clearMessages: true });
            if (chatOpen) {
              closeReportChat();
            } else {
              setChatOpen(true);
            }
          }}
        >
          <span className="report-chat-toggle-icon" aria-hidden="true">
            AI
          </span>
        </button>
      ) : null}

      {criteriaAssistantVisible ? (
        <aside
          id={criteriaAssistantDrawerId}
          className="report-criteria-ai-drawer"
          role="dialog"
          aria-labelledby="criteria-assistant-title"
          data-testid="report-criteria-ai-drawer"
        >
          <header className="report-criteria-ai-header">
            <div className="report-criteria-ai-title-row">
              <span className="report-criteria-ai-logo" aria-hidden="true">AI</span>
              <div>
                <h2 id="criteria-assistant-title">AI 리포트 도우미</h2>
                <p>평가 항목 추가 · 분석 기준 제안</p>
              </div>
            </div>
            <div className="report-criteria-ai-header-actions">
              <span className="report-criteria-ai-mode">에이전트 모드</span>
              <button
                type="button"
                className="report-criteria-ai-close"
                aria-label="AI 리포트 도우미 닫기"
                onClick={closeCriteriaAssistant}
              >
                ×
              </button>
            </div>
          </header>

          <div className="report-criteria-ai-thread" aria-live="polite">
            {criteriaAssistantMessages.length === 0 ? (
              <div className="report-criteria-ai-empty">
                <span className="report-criteria-ai-empty-icon" aria-hidden="true">AI</span>
                <strong>학생 평가 항목을 함께 설계해 보세요.</strong>
                <p>예: 발표 태도, 협업 방식, 탐구 확장성처럼 기본 항목 밖의 관점을 요청할 수 있습니다.</p>
              </div>
            ) : (
              criteriaAssistantMessages.map((message) => (
                <CriteriaAssistantMessageView
                  key={message.id}
                  message={message}
                  applyDisabled={criteriaAssistantBusy || criteriaSaving || analyzing || !criteriaReady}
                  onApply={(proposal) => {
                    void applyCriteriaAssistantProposal(proposal);
                  }}
                />
              ))
            )}

            {(criteriaAssistantBusy || criteriaAssistantProgress.some((item) => item.status !== "idle")) ? (
              <section
                className="report-criteria-ai-progress"
                data-testid="report-criteria-ai-progress"
                aria-label="AI 요청 처리 단계"
              >
                <div className="report-criteria-ai-progress-head">
                  <strong>AI 에이전트가 요청을 처리하고 있어요</strong>
                  {criteriaAssistantThought ? <span>{criteriaAssistantThought}</span> : null}
                </div>
                <ol className="report-criteria-ai-steps">
                  {criteriaAssistantProgress.map((item, index) => (
                    <li
                      key={item.stage}
                      className={`report-criteria-ai-step ${item.status}`}
                      data-testid={`report-criteria-ai-stage-${item.stage}`}
                    >
                      <span className="report-criteria-ai-step-index">{index + 1}</span>
                      <div>
                        <strong>{item.label}</strong>
                        {item.detail ? <p>{item.detail}</p> : null}
                      </div>
                      <em>
                        {item.status === "done"
                          ? "완료"
                          : item.status === "active"
                            ? "진행 중"
                            : "대기"}
                      </em>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {criteriaAssistantProposal?.summaryCards?.length ? (
              <section className="report-criteria-ai-summary" aria-label="에이전트 분석 요약">
                <strong>에이전트 분석 요약</strong>
                <div className="report-criteria-ai-summary-grid">
                  {criteriaAssistantProposal.summaryCards.map((card) => (
                    <article key={`${card.title}-${card.body}`} data-testid="report-criteria-ai-summary-card">
                      <span className="report-criteria-ai-mini-icon sparkle" aria-hidden="true" />
                      <strong>{card.title}</strong>
                      <p>{card.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {criteriaAssistantProposal ? (
              <CriteriaAssistantProposalCard
                proposal={criteriaAssistantProposal}
                disabled={criteriaAssistantBusy || criteriaSaving || analyzing || !criteriaReady}
                onApply={(proposal) => {
                  void applyCriteriaAssistantProposal(proposal);
                }}
              />
            ) : null}

            {criteriaAssistantAppliedSummary ? (
              <div className="report-criteria-ai-applied" role="status">
                {criteriaAssistantAppliedSummary}
              </div>
            ) : null}
            <div ref={criteriaAssistantBottomRef} />
          </div>

          {criteriaAssistantError ? (
            <div className="report-criteria-ai-error" role="alert">
              {criteriaAssistantError}
            </div>
          ) : null}

          <form
            className="report-criteria-ai-composer"
            data-testid="report-criteria-ai-composer"
            onSubmit={sendCriteriaAssistantMessage}
          >
            <button type="button" className="report-criteria-ai-tool" aria-label="파일 첨부">
              ⎋
            </button>
            <textarea
              value={criteriaAssistantInput}
              onChange={(event) => setCriteriaAssistantInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={2000}
              disabled={criteriaAssistantBusy}
              placeholder="AI에게 평가 항목을 요청해 보세요"
              aria-label="AI 리포트 도우미 메시지"
            />
            <button type="button" className="report-criteria-ai-tool" aria-label="이미지 첨부">
              ▧
            </button>
            <button
              type="submit"
              className="report-criteria-ai-send"
              aria-label="AI 도우미 전송"
              disabled={criteriaAssistantBusy || !criteriaAssistantInput.trim()}
            >
              ➤
            </button>
          </form>
        </aside>
      ) : null}

      {reportChatVisible ? (
        <aside
          id={reportChatDrawerId}
          className="report-chat-drawer"
          data-testid="report-chat-drawer"
          role="dialog"
          aria-label="리포트 챗봇"
        >
          <header className="report-chat-header">
            <div className="report-chat-coach-title-row">
              <span className="report-chat-coach-avatar" data-testid="report-chat-coach-avatar" aria-hidden="true" />
              <div>
                <h2 id="report-chat-title" data-testid="report-chat-coach-title">AI 학습 코치</h2>
                <p data-testid="report-chat-coach-subtitle">
                  {selectedStudent
                    ? `${selectedStudent.displayName} 학생`
                    : "학생 선택 필요"}
                </p>
              </div>
            </div>
            <div className="report-chat-header-actions">
              <label className="report-chat-session-select">
                <span className="sr-only">리포트 챗봇 대화 세션</span>
                <select
                  aria-label="리포트 챗봇 대화 세션"
                  value={activeChatSessionId}
                  onChange={(event) => switchReportChatSession(event.target.value)}
                  disabled={chatLoading || chatSessions.length < 2}
                >
                  {chatSessions.map((session, index) => (
                    <option value={session.id} key={session.id}>
                      {session.title || `새 채팅 ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="report-chat-new"
                onClick={startNewReportChatSession}
                disabled={chatLoading || !canChat}
              >
                새 채팅
              </button>
              <button
                type="button"
                className="report-chat-close"
                aria-label="학생 리포트 챗봇 닫기"
                onClick={closeReportChat}
              >
                ×
              </button>
            </div>
          </header>

          <div className="report-chat-messages" aria-live="polite">
            {!selectedStudent ? (
              <div className="report-chat-welcome" data-testid="report-chat-welcome">
                <span className="report-chat-welcome-avatar" data-testid="report-chat-welcome-avatar" aria-hidden="true" />
                <div className="report-chat-welcome-bubble" data-testid="report-chat-welcome-bubble">
                  학생을 선택하면 대화를 시작할 수 있습니다.
                </div>
              </div>
            ) : !visibleReport ? (
              <div className="report-chat-welcome" data-testid="report-chat-welcome">
                <span className="report-chat-welcome-avatar" data-testid="report-chat-welcome-avatar" aria-hidden="true" />
                <div className="report-chat-welcome-bubble" data-testid="report-chat-welcome-bubble">
                  {selectedStudent.displayName} 학생의 리포트를 먼저 생성해 주세요.
                </div>
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="report-chat-welcome" data-testid="report-chat-welcome">
                <span className="report-chat-welcome-avatar" data-testid="report-chat-welcome-avatar" aria-hidden="true" />
                <div className="report-chat-welcome-bubble" data-testid="report-chat-welcome-bubble">
                  <p>{selectedStudent.displayName} 학생에 대한 질문을 기다리고 있습니다.</p>
                  <p>궁금한 내용이나 도움이 필요한 부분을 자유롭게 질문해 주세요.</p>
                  <span className="report-chat-welcome-sparkle" aria-hidden="true">✦</span>
                </div>
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

          <form className="report-chat-form" data-testid="report-chat-form" onSubmit={sendReportChat}>
            <label className="report-chat-input-shell">
              <span className="sr-only">학생 리포트 챗봇 질문</span>
              <textarea
                className="report-chat-input"
                data-testid="report-chat-input"
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
            </label>
            <div className="report-chat-form-actions">
              <p className="report-chat-advisory" data-testid="report-chat-advisory">
                AI 답변은 참고용이며, 최종 판단은 선생님께서 해주세요.
              </p>
              <button
                type="submit"
                className="btn report-chat-send"
                data-testid="report-chat-send"
                aria-label="전송"
                disabled={!canChat || chatLoading || !chatInput.trim()}
              >
                <span className="report-chat-send-icon" aria-hidden="true">↗</span>
                <span>전송</span>
              </button>
            </div>
          </form>
        </aside>
      ) : null}
    </main>
  );
}
