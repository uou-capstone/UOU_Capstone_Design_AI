import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError } from "../../api/client";
import {
  createTeacherExam,
  publishTeacherExam,
  ExamStudioStreamError,
  streamExamStudioChat,
  ExamStudioChatStreamEvent,
  ExamStudioStreamStage,
  ExamStudioStreamFailureReason,
  TeacherExamDraftPayload,
  updateTeacherExam,
  uploadExamStudioPdfContext
} from "../../api/endpoints";
import { useDialogFocus } from "../ui/useDialogFocus";
import {
  ExamStudioProposal,
  ExamStudioOperation,
  TeacherExam,
  TeacherExamQuestion,
  TeacherExamQuestionType
} from "../../types";
import {
  clearExamStudioRecoveryKey,
  clearMaterializedExam,
  examStudioRecoveryKey,
  migrateExamStudioRecoveryKey,
  rememberMaterializedExam
} from "./examStudioRecovery";

interface Props {
  open: boolean;
  weekId: string;
  classroomId: string;
  actorUserId: string;
  exam?: TeacherExam | null;
  variant?: "modal" | "page";
  initialDraftScopeKey?: string;
  entityScopeKey?: string;
  materializedExamId?: string | null;
  onExamMaterialized?: (exam: TeacherExam) => void;
  onClose: () => void;
  onSaved: (exam: TeacherExam) => void;
}

type DraftState = Omit<TeacherExamDraftPayload, "questions"> & {
  title: string;
  descriptionMarkdown: string;
  availableFrom: string;
  availableUntil: string;
  timeLimitMinutes: number;
  passScoreRatio: number;
  aiGradingEnabled: boolean;
  questions: TeacherExamQuestion[];
};

type ProposalApplyResult = {
  draft: DraftState;
  appliedMethods: string[];
  settingPatchCount: number;
  appendQuestionCount: number;
  replaceQuestionCount: number;
  skippedCount: number;
};

type ProposalSummaryCard = {
  title: string;
  body: string;
  method: string;
};

type StudioProgressState = {
  stage: ExamStudioStreamStage;
  label: string;
  progress: number;
  detail?: string;
  failed?: boolean;
};

const QUESTION_TYPES: Array<{ id: TeacherExamQuestionType; label: string }> = [
  { id: "MCQ", label: "객관식" },
  { id: "OX", label: "OX" },
  { id: "SHORT", label: "단답식" },
  { id: "ESSAY", label: "서술형" }
];

const MIN_MCQ_CHOICES = 2;
const MAX_MCQ_CHOICES = 6;
const EXAM_ENDED_LOCK_MESSAGE = "종료된 시험은 수정하거나 다시 게시할 수 없습니다.";

const EXAM_STUDIO_PROGRESS_STAGES: Array<{ id: ExamStudioStreamStage; label: string }> = [
  { id: "PREPARING", label: "요청 정리" },
  { id: "ANALYZING_SOURCE", label: "자료 분석" },
  { id: "AI_THINKING", label: "사고 요약 스트리밍" },
  { id: "VALIDATING_JSON", label: "JSON 검증" },
  { id: "APPLYING_TO_STUDIO", label: "제안 준비" }
];

const QUESTION_PROMPT_PLACEHOLDER = "문제를 입력해 주세요.";
const RUBRIC_PLACEHOLDER = "채점 기준을 입력해 주세요.\n예: 핵심 키워드 포함 여부, 논리적 구성";
const MODEL_ANSWER_PLACEHOLDER = "여기에 모범 답안을 입력하세요.";
const QUESTION_PROMPT_HELP = "학생에게 보여질 문제 내용을 입력하세요.";
const RUBRIC_HELP = "부분 점수 부여 기준을 포함하여 입력하세요.";
const MODEL_ANSWER_HELP = "학생에게 제공하지 않는 상세한 모범 답안을 입력하세요.";
const LEGACY_PROMPT_PLACEHOLDERS = new Set([QUESTION_PROMPT_PLACEHOLDER]);
const LEGACY_RUBRIC_PLACEHOLDERS = new Set([
  "1. 핵심 키워드 포함 여부 (3점)\n2. 논리적 구성 (2점)",
  "1. 핵심 키워드 포함 여부 (3점)\r\n2. 논리적 구성 (2점)"
]);
const LEGACY_MODEL_ANSWER_PLACEHOLDERS = new Set([MODEL_ANSWER_PLACEHOLDER]);
const DRAFT_VALIDATION_MESSAGE = "시험 시작/종료 시간과 제한 시간을 올바르게 입력해 주세요.";

class ExamStudioDraftValidationError extends Error {
  constructor(message = DRAFT_VALIDATION_MESSAGE) {
    super(message);
    this.name = "ExamStudioDraftValidationError";
  }
}

function emitExamStudioAiObservation(eventName: string, payload: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("exam-studio-ai-observation", {
      detail: {
        eventName,
        ...payload
      }
    })
  );
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function makeChoice(existingChoices: NonNullable<TeacherExamQuestion["choices"]> = []) {
  const usedIds = new Set(existingChoices.map((choice) => choice.id));
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    if (!usedIds.has(id)) return { id, textMarkdown: "" };
  }
  return { id: `c_${Math.random().toString(36).slice(2, 8)}`, textMarkdown: "" };
}

function makeQuestion(type: TeacherExamQuestionType = "MCQ"): TeacherExamQuestion {
  const id = `q_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    type,
    promptMarkdown: "",
    points: 5,
    choices:
      type === "MCQ"
        ? [{ id: "a", textMarkdown: "" }, { id: "b", textMarkdown: "" }]
        : undefined,
    answer: type === "OX" ? { value: true } : { choiceId: "a" },
    referenceAnswer: { text: "" },
    rubricMarkdown: "",
    modelAnswerMarkdown: "",
    explanationMarkdown: ""
  };
}

function stripLegacyPlaceholder(value: string | undefined, placeholders: Set<string>): string {
  const text = value ?? "";
  return placeholders.has(text.trim()) ? "" : text;
}

function sanitizeQuestionPlaceholders(question: TeacherExamQuestion): TeacherExamQuestion {
  const sanitized = {
    ...question,
    promptMarkdown: stripLegacyPlaceholder(question.promptMarkdown, LEGACY_PROMPT_PLACEHOLDERS),
    rubricMarkdown: stripLegacyPlaceholder(question.rubricMarkdown, LEGACY_RUBRIC_PLACEHOLDERS),
    modelAnswerMarkdown: stripLegacyPlaceholder(
      question.modelAnswerMarkdown,
      LEGACY_MODEL_ANSWER_PLACEHOLDERS
    )
  };
  if (sanitized.type !== "SHORT") return sanitized;
  const referenceText = sanitized.referenceAnswer?.text ?? "";
  const modelAnswer = sanitized.modelAnswerMarkdown ?? "";
  return {
    ...sanitized,
    referenceAnswer: { text: "" },
    modelAnswerMarkdown: modelAnswer.trim() ? modelAnswer : referenceText
  };
}

function sanitizeQuestionListPlaceholders(questions: TeacherExamQuestion[]): TeacherExamQuestion[] {
  return questions.map(sanitizeQuestionPlaceholders);
}

function buildInitialDraft(exam?: TeacherExam | null): DraftState {
  const revision = exam?.draftRevision;
  const now = new Date();
  const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: revision?.title ?? "새 시험",
    descriptionMarkdown: revision?.descriptionMarkdown ?? "",
    availableFrom: toLocalInput(revision?.availableFrom ?? now.toISOString()),
    availableUntil: toLocalInput(revision?.availableUntil ?? until.toISOString()),
    timeLimitMinutes: revision?.timeLimitMinutes ?? 30,
    passScoreRatio: revision?.passScoreRatio ?? 0.7,
    aiGradingEnabled: revision?.aiGradingEnabled ?? true,
    questions: revision?.questions?.length
      ? sanitizeQuestionListPlaceholders(revision.questions)
      : [makeQuestion("MCQ")]
  };
}

function toPayload(draft: DraftState): TeacherExamDraftPayload {
  const availableFrom = fromLocalInput(draft.availableFrom);
  const availableUntil = fromLocalInput(draft.availableUntil);
  const fromTime = availableFrom ? new Date(availableFrom).getTime() : NaN;
  const untilTime = availableUntil ? new Date(availableUntil).getTime() : NaN;
  const timeLimitMinutes = Number(draft.timeLimitMinutes);
  if (
    !availableFrom ||
    !availableUntil ||
    !Number.isFinite(fromTime) ||
    !Number.isFinite(untilTime) ||
    fromTime >= untilTime ||
    !Number.isInteger(timeLimitMinutes) ||
    timeLimitMinutes < 1 ||
    timeLimitMinutes > 240
  ) {
    throw new ExamStudioDraftValidationError();
  }
  return {
    ...draft,
    availableFrom,
    availableUntil,
    timeLimitMinutes,
    questions: sanitizeQuestionListPlaceholders(draft.questions)
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasValidQuestionShape(question: unknown): question is TeacherExamQuestion {
  if (!isObject(question)) return false;
  if (typeof question.id !== "string" || !question.id) return false;
  if (!QUESTION_TYPES.some((type) => type.id === question.type)) return false;
  if (typeof question.promptMarkdown !== "string") return false;
  if (typeof question.points !== "number" || !Number.isFinite(question.points)) return false;
  if (question.type === "MCQ") {
    if (!Array.isArray(question.choices) || question.choices.length < MIN_MCQ_CHOICES) return false;
    if (!question.choices.every((choice) => isObject(choice) && typeof choice.id === "string" && typeof choice.textMarkdown === "string")) {
      return false;
    }
  }
  return true;
}

export function isTeacherExamDto(value: unknown): value is TeacherExam {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || !value.id) return false;
  if (typeof value.classroomId !== "string" || typeof value.weekId !== "string") return false;
  if (value.status !== "DRAFT" && value.status !== "PUBLISHED") return false;
  if (!isObject(value.draftRevision)) return false;
  const draftRevision = value.draftRevision;
  if (typeof draftRevision.version !== "number" || !Number.isFinite(draftRevision.version)) return false;
  if (typeof draftRevision.title !== "string") return false;
  if (typeof draftRevision.descriptionMarkdown !== "string") return false;
  if (typeof draftRevision.availableFrom !== "string" || Number.isNaN(new Date(draftRevision.availableFrom).getTime())) return false;
  if (typeof draftRevision.availableUntil !== "string" || Number.isNaN(new Date(draftRevision.availableUntil).getTime())) return false;
  if (typeof draftRevision.timeLimitMinutes !== "number" || !Number.isFinite(draftRevision.timeLimitMinutes)) return false;
  if (typeof draftRevision.passScoreRatio !== "number" || !Number.isFinite(draftRevision.passScoreRatio)) return false;
  if (typeof draftRevision.aiGradingEnabled !== "boolean") return false;
  if (!Array.isArray(draftRevision.questions) || !draftRevision.questions.every(hasValidQuestionShape)) return false;
  return true;
}

function validateExamResponse(
  value: unknown,
  input: {
    classroomId: string;
    weekId: string;
    expectedId?: string;
    expectPublished?: boolean;
  }
): TeacherExam {
  if (!isTeacherExamDto(value)) {
    throw new Error("시험 응답 형식이 올바르지 않습니다.");
  }
  if (value.classroomId !== input.classroomId || value.weekId !== input.weekId) {
    throw new Error("현재 강의실 주차와 다른 시험 응답입니다.");
  }
  if (input.expectedId && value.id !== input.expectedId) {
    throw new Error("요청한 시험과 다른 응답이 반환되었습니다.");
  }
  if (input.expectPublished && value.status !== "PUBLISHED") {
    throw new Error("시험 게시 결과가 올바르지 않습니다.");
  }
  return value;
}

function makeScopeKey(input: {
  actorUserId: string;
  classroomId: string;
  weekId: string;
  examId: string;
}) {
  return `${input.actorUserId}:${input.classroomId}:${input.weekId}:${input.examId}`;
}

export function ExamStudioModal({
  open,
  weekId,
  classroomId,
  actorUserId,
  exam,
  variant = "modal",
  initialDraftScopeKey,
  entityScopeKey,
  materializedExamId,
  onExamMaterialized,
  onClose,
  onSaved
}: Props) {
  const [draft, setDraft] = useState<DraftState>(() => buildInitialDraft(exam));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [appliedProposalSummary, setAppliedProposalSummary] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [pendingProposal, setPendingProposal] = useState<ExamStudioProposal | null>(null);
  const [studioProgress, setStudioProgress] = useState<StudioProgressState | null>(null);
  const [streamingThought, setStreamingThought] = useState("");
  const [thoughtExpanded, setThoughtExpanded] = useState(false);
  const [createdExamForRetry, setCreatedExamForRetry] = useState<TeacherExam | null>(null);
  const [examEndedLocked, setExamEndedLocked] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const sourceTextRef = useRef("");
  const draftRef = useRef(draft);
  const pendingProposalRef = useRef<ExamStudioProposal | null>(pendingProposal);
  const createdExamForRetryRef = useRef<TeacherExam | null>(null);
  const chatRequestRef = useRef<{
    id: number;
    scopeKey: string;
    controller: AbortController;
  } | null>(null);
  const chatRequestSeqRef = useRef(0);
  const attachmentRequestRef = useRef<{
    id: number;
    scopeKey: string;
    controller: AbortController;
  } | null>(null);
  const attachmentRequestSeqRef = useRef(0);
  const saveRequestRef = useRef<{
    id: number;
    initialDraftScopeKey: string;
    entityScopeKey: string;
  } | null>(null);
  const saveRequestSeqRef = useRef(0);
  const savingRef = useRef(false);
  useDialogFocus(open && variant === "modal", dialogRef, backdropRef);

  const directExam = exam ?? null;
  const effectiveExamId = directExam?.id ?? createdExamForRetry?.id ?? materializedExamId ?? "new";
  const effectiveExamVersion =
    directExam?.activePublishedVersion ??
    directExam?.draftRevision.version ??
    createdExamForRetry?.activePublishedVersion ??
    createdExamForRetry?.draftRevision.version;
  const resolvedInitialDraftScopeKey = useMemo(
    () =>
      initialDraftScopeKey ??
      makeScopeKey({
        actorUserId,
        classroomId,
        weekId,
        examId: directExam?.id ?? "new"
      }),
    [actorUserId, classroomId, directExam?.id, initialDraftScopeKey, weekId]
  );
  const resolvedEntityScopeKey = useMemo(
    () =>
      entityScopeKey ??
      makeScopeKey({
        actorUserId,
        classroomId,
        weekId,
        examId: effectiveExamId
      }),
    [actorUserId, classroomId, effectiveExamId, entityScopeKey, weekId]
  );
  const initialDraftScopeKeyRef = useRef(resolvedInitialDraftScopeKey);
  const entityScopeKeyRef = useRef(resolvedEntityScopeKey);

  const recoveryKey = useMemo(
    () =>
      examStudioRecoveryKey({
        actorUserId,
        classroomId,
        weekId,
        examId: effectiveExamId,
        examVersion: effectiveExamVersion
      }),
    [actorUserId, classroomId, effectiveExamId, effectiveExamVersion, weekId]
  );
  const asyncScopeKey = useMemo(
    () => `${resolvedInitialDraftScopeKey}:${open ? "open" : "closed"}`,
    [open, resolvedInitialDraftScopeKey]
  );
  const asyncScopeKeyRef = useRef(asyncScopeKey);

  useEffect(() => {
    asyncScopeKeyRef.current = asyncScopeKey;
    initialDraftScopeKeyRef.current = resolvedInitialDraftScopeKey;
    entityScopeKeyRef.current = resolvedEntityScopeKey;
  }, [asyncScopeKey, resolvedEntityScopeKey, resolvedInitialDraftScopeKey]);

  useEffect(() => {
    return () => {
      discardPendingProposal("close_or_scope_change", false);
      abortActiveChatRequest();
      invalidateAttachmentRequest();
      invalidateSaveRequest();
    };
  }, [asyncScopeKey]);

  useEffect(() => {
    if (!open) {
      abortActiveChatRequest();
      invalidateAttachmentRequest();
      invalidateSaveRequest();
      discardPendingProposal("close_or_scope_change");
      clearAttachmentContext();
      return;
    }
    abortActiveChatRequest();
    invalidateAttachmentRequest();
    invalidateSaveRequest();
    discardPendingProposal("close_or_scope_change");
    setDraft(buildInitialDraft(exam));
    setError("");
    setAppliedProposalSummary("");
    setChatMessages([]);
    setChatBusy(false);
    setStudioProgress(null);
    setStreamingThought("");
    setThoughtExpanded(false);
    setCreatedExamForRetry(null);
    setExamEndedLocked(false);
    createdExamForRetryRef.current = null;
    clearAttachmentContext();
  }, [exam, open, resolvedInitialDraftScopeKey]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    pendingProposalRef.current = pendingProposal;
  }, [pendingProposal]);

  useEffect(() => {
    createdExamForRetryRef.current = createdExamForRetry;
  }, [createdExamForRetry]);

  useEffect(() => {
    if (!open || examEndedLocked) return;
    window.localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        savedAt: Date.now(),
        title: draft.title,
        availableFrom: draft.availableFrom,
        availableUntil: draft.availableUntil,
        timeLimitMinutes: draft.timeLimitMinutes,
        passScoreRatio: draft.passScoreRatio,
        questionMeta: draft.questions.map((question) => ({
          id: question.id,
          type: question.type,
          points: question.points
        }))
      })
    );
  }, [draft, examEndedLocked, open, recoveryKey]);

  if (!open) return null;

  function setPendingProposalState(proposal: ExamStudioProposal | null) {
    pendingProposalRef.current = proposal;
    setPendingProposal(proposal);
  }

  function discardPendingProposal(
    reason: "new_chat" | "stream_failure" | "close_or_scope_change",
    updateState = true
  ) {
    if (pendingProposalRef.current) {
      emitExamStudioAiObservation("proposal_discarded", { reason });
    }
    pendingProposalRef.current = null;
    if (updateState) {
      setPendingProposal(null);
    }
  }

  function setAttachmentContext(text: string, status: string) {
    sourceTextRef.current = text;
    setAttachmentStatus(status);
  }

  function clearAttachmentContext(invalidate = true) {
    if (invalidate) {
      invalidateAttachmentRequest();
    }
    sourceTextRef.current = "";
    setAttachmentStatus("");
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }

  function invalidateAttachmentRequest() {
    if (attachmentRequestRef.current) {
      attachmentRequestRef.current.controller.abort();
      attachmentRequestRef.current = null;
    }
  }

  function isActiveAttachmentRequest(requestId: number, scopeKey: string) {
    const current = attachmentRequestRef.current;
    return Boolean(
      current &&
        current.id === requestId &&
        current.scopeKey === scopeKey &&
        asyncScopeKeyRef.current === scopeKey &&
        !current.controller.signal.aborted
    );
  }

  function abortActiveChatRequest() {
    if (chatRequestRef.current) {
      chatRequestRef.current.controller.abort();
      chatRequestRef.current = null;
    }
    setThoughtExpanded(false);
  }

  function isActiveChatRequest(requestId: number, scopeKey: string) {
    const current = chatRequestRef.current;
    return Boolean(
      current &&
        current.id === requestId &&
        current.scopeKey === scopeKey &&
        asyncScopeKeyRef.current === scopeKey &&
        !current.controller.signal.aborted
    );
  }

  function invalidateSaveRequest() {
    saveRequestRef.current = null;
    savingRef.current = false;
  }

  function isActiveSaveRequest(requestId: number, initialKey: string, entityKey?: string) {
    const current = saveRequestRef.current;
    return Boolean(
      current &&
        current.id === requestId &&
        current.initialDraftScopeKey === initialKey &&
        initialDraftScopeKeyRef.current === initialKey &&
        (!entityKey || current.entityScopeKey === entityKey)
    );
  }

  function rebindSaveRequest(requestId: number, initialKey: string, entityKey: string) {
    if (!isActiveSaveRequest(requestId, initialKey)) return false;
    saveRequestRef.current = { id: requestId, initialDraftScopeKey: initialKey, entityScopeKey: entityKey };
    entityScopeKeyRef.current = entityKey;
    return true;
  }

  function handleChatStreamEvent(
    event: ExamStudioChatStreamEvent,
    requestId: number,
    scopeKey: string
  ) {
    if (!isActiveChatRequest(requestId, scopeKey)) return;
    if (event.type === "stage") {
      setStudioProgress(normalizeStudioProgress(event));
      if (event.stage === "COMPLETE") {
        setThoughtExpanded(false);
      }
      return;
    }
    if (event.type === "thought_delta") {
      setStreamingThought((prev) => `${prev}${event.text}`.slice(-2400));
      return;
    }
    if (event.type === "proposal" && event.thoughtSummary) {
      setStreamingThought((prev) => prev || event.thoughtSummary || "");
    }
  }

  function patchQuestion(questionId: string, patch: Partial<TeacherExamQuestion>) {
    setDraft((prev) => ({
      ...prev,
      questions: prev.questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question
      )
    }));
  }

  function proposalOperations(proposal: ExamStudioProposal): ExamStudioOperation[] {
    return proposal.operations ?? [];
  }

  function applySettingsPatch(prev: DraftState, patch: ExamStudioOperation["params"]): DraftState {
    const settings = patch as NonNullable<ExamStudioProposal["settingsPatch"]>;
    return {
      ...prev,
      ...(settings.title !== undefined ? { title: settings.title } : {}),
      ...(settings.descriptionMarkdown !== undefined
        ? { descriptionMarkdown: settings.descriptionMarkdown }
        : {}),
      ...(settings.availableFrom ? { availableFrom: toLocalInput(settings.availableFrom) } : {}),
      ...(settings.availableUntil ? { availableUntil: toLocalInput(settings.availableUntil) } : {}),
      ...(settings.timeLimitMinutes !== undefined
        ? { timeLimitMinutes: settings.timeLimitMinutes }
        : {}),
      ...(settings.passScoreRatio !== undefined ? { passScoreRatio: settings.passScoreRatio } : {}),
      ...(settings.aiGradingEnabled !== undefined
        ? { aiGradingEnabled: settings.aiGradingEnabled }
        : {})
    };
  }

  function applyProposalToDraft(prev: DraftState, proposal: ExamStudioProposal): ProposalApplyResult {
    let next = prev;
    const appliedMethods: string[] = [];
    let settingPatchCount = 0;
    let appendQuestionCount = 0;
    let replaceQuestionCount = 0;
    let skippedCount = 0;
    for (const operation of proposalOperations(proposal)) {
      if (operation.method === "patchExamSettings") {
        next = applySettingsPatch(next, operation.params);
        appliedMethods.push("설정 변경");
        settingPatchCount += 1;
        continue;
      }
      if (operation.method === "appendQuestions") {
        const seenIds = new Set(next.questions.map((question) => question.id));
        const questions = operation.params.questions.filter((question) => {
          if (seenIds.has(question.id)) {
            skippedCount += 1;
            return false;
          }
          seenIds.add(question.id);
          return true;
        });
        if (questions.length > 0) {
          next = { ...next, questions: [...next.questions, ...sanitizeQuestionListPlaceholders(questions)] };
          appliedMethods.push(`문항 ${questions.length}개 추가`);
          appendQuestionCount += questions.length;
        }
        continue;
      }
      if (operation.method === "replaceQuestion") {
        const targetIndex = next.questions.findIndex(
          (question) => question.id === operation.params.replaceQuestionId
        );
        const duplicateId = next.questions.some(
          (question) =>
            question.id === operation.params.question.id &&
            question.id !== operation.params.replaceQuestionId
        );
        if (targetIndex < 0 || duplicateId) {
          skippedCount += 1;
          continue;
        }
        next = {
          ...next,
          questions: next.questions.map((question) =>
            question.id === operation.params.replaceQuestionId
              ? sanitizeQuestionPlaceholders(operation.params.question)
              : question
          )
        };
        appliedMethods.push("문항 교체");
        replaceQuestionCount += 1;
      }
    }
    return { draft: next, appliedMethods, settingPatchCount, appendQuestionCount, replaceQuestionCount, skippedCount };
  }

  function summarizeApplyResult(result: ProposalApplyResult) {
    const applied = result.appliedMethods.length ? result.appliedMethods.join(", ") : "적용된 변경 없음";
    return result.skippedCount > 0 ? `${applied} · ${result.skippedCount}개 항목은 건너뜀` : applied;
  }

  function proposalOperationCounts(proposal: ExamStudioProposal) {
    return proposalOperations(proposal).reduce(
      (counts, operation) => {
        counts.operationCount += 1;
        if (operation.method === "patchExamSettings") {
          counts.settingPatchCount += 1;
        } else if (operation.method === "appendQuestions") {
          counts.appendQuestionCount += operation.params.questions.length;
        } else if (operation.method === "replaceQuestion") {
          counts.replaceQuestionCount += 1;
        }
        return counts;
      },
      {
        operationCount: 0,
        settingPatchCount: 0,
        appendQuestionCount: 0,
        replaceQuestionCount: 0
      }
    );
  }

  function proposalSummaryCards(proposal: ExamStudioProposal): ProposalSummaryCard[] {
    const cards: ProposalSummaryCard[] = [];
    for (const operation of proposalOperations(proposal)) {
      if (operation.method === "patchExamSettings") {
        const fieldCount = Object.keys(operation.params).length;
        cards.push({
          method: operation.method,
          title: "시험 설정 조정",
          body: fieldCount > 0 ? `${fieldCount}개 설정을 검토할 제안` : "시험 설정 변경 제안"
        });
      } else if (operation.method === "appendQuestions") {
        const typeSummary = Array.from(
          new Set(operation.params.questions.map((question) => QUESTION_TYPES.find((type) => type.id === question.type)?.label ?? question.type))
        ).join(", ");
        cards.push({
          method: operation.method,
          title: "새 문항 추가",
          body: `${operation.params.questions.length}개 문항${typeSummary ? ` · ${typeSummary}` : ""}`
        });
      } else if (operation.method === "replaceQuestion") {
        cards.push({
          method: operation.method,
          title: "기존 문항 수정",
          body: "선택된 문항을 새 초안으로 교체"
        });
      }
    }
    return cards;
  }

  function proposalHasQuestionMutation(proposal: ExamStudioProposal) {
    return proposalOperations(proposal).some(
      (operation) => operation.method === "appendQuestions" || operation.method === "replaceQuestion"
    );
  }

  function proposalActionLabel(proposal: ExamStudioProposal) {
    return proposalHasQuestionMutation(proposal) ? "문항에 반영" : "변경 사항 반영";
  }

  function sanitizedProposalReviewText(proposal: ExamStudioProposal) {
    const raw = proposal.replyMarkdown.trim() || proposal.answerMarkdown?.trim() || "";
    const mutationClaimPattern = /(반영했습니다|변경했습니다|적용했습니다|바꿨습니다|추가했습니다|수정했습니다)/;
    const lead = raw && !mutationClaimPattern.test(raw)
      ? raw
      : "요청을 바탕으로 시험 설계 변경안을 준비했습니다.";
    return `${lead}\n\n검토 후 반영 버튼을 누르면 왼쪽 시험 설계에 적용됩니다.`;
  }

  function normalizeStudioProgress(event: Extract<ExamStudioChatStreamEvent, { type: "stage" }>): StudioProgressState {
    if (event.stage === "APPLYING_TO_STUDIO") {
      return {
        stage: event.stage,
        label: "제안 준비",
        progress: event.progress,
        detail: "교사가 검토 후 반영할 제안을 준비했습니다."
      };
    }
    return {
      stage: event.stage,
      label: event.label,
      progress: event.progress,
      detail: event.detail
    };
  }

  function streamFailureReason(error: unknown): ExamStudioStreamFailureReason {
    return error instanceof ExamStudioStreamError ? error.reason : "unknown";
  }

  function streamFailureCopy(reason: ExamStudioStreamFailureReason) {
    switch (reason) {
      case "missing_done":
        return "AI 응답 완료 신호를 받지 못했습니다. 다시 요청해 주세요.";
      case "missing_proposal":
        return "AI 제안 결과를 받지 못했습니다. 다시 요청해 주세요.";
      case "invalid_ndjson":
      case "malformed_order":
        return "AI 응답 형식이 올바르지 않아 반영하지 않았습니다.";
      case "stream_error":
        return "AI 응답 처리 중 오류가 발생했습니다. 다시 요청해 주세요.";
      default:
        return "AI 응답을 가져오지 못했습니다.";
    }
  }

  function addChoice(question: TeacherExamQuestion) {
    const choices = question.choices ?? [];
    if (choices.length >= MAX_MCQ_CHOICES) return;
    patchQuestion(question.id, { choices: [...choices, makeChoice(choices)] });
  }

  function removeChoice(question: TeacherExamQuestion, choiceId: string) {
    const choices = question.choices ?? [];
    if (choices.length <= MIN_MCQ_CHOICES) return;
    const nextChoices = choices.filter((choice) => choice.id !== choiceId);
    const nextAnswer =
      question.answer?.choiceId === choiceId
        ? { choiceId: nextChoices[0]?.id ?? "a" }
        : { choiceId: question.answer?.choiceId ?? nextChoices[0]?.id ?? "a" };
    patchQuestion(question.id, { choices: nextChoices, answer: nextAnswer });
  }

  async function saveDraft(event?: FormEvent, publish = false) {
    event?.preventDefault();
    if (examEndedLocked) {
      setError(EXAM_ENDED_LOCK_MESSAGE);
      return;
    }
    if (savingRef.current) return;
    const requestId = saveRequestSeqRef.current + 1;
    saveRequestSeqRef.current = requestId;
    const requestInitialScopeKey = initialDraftScopeKeyRef.current;
    let requestEntityScopeKey = entityScopeKeyRef.current;
    saveRequestRef.current = {
      id: requestId,
      initialDraftScopeKey: requestInitialScopeKey,
      entityScopeKey: requestEntityScopeKey
    };
    savingRef.current = true;
    const recoveryKeyAtSaveStart = recoveryKey;
    let recoveryKeyToClear = recoveryKeyAtSaveStart;
    setSaving(true);
    setError("");
    try {
      const payload = toPayload(draftRef.current);
      let saved: TeacherExam;
      const existingExamId = directExam?.id ?? createdExamForRetryRef.current?.id ?? materializedExamId ?? null;
      if (existingExamId) {
        if (!isActiveSaveRequest(requestId, requestInitialScopeKey, requestEntityScopeKey)) return;
        const response = publish
          ? await publishTeacherExam(existingExamId, payload)
          : await updateTeacherExam(existingExamId, payload);
        if (!isActiveSaveRequest(requestId, requestInitialScopeKey, requestEntityScopeKey)) return;
        saved = validateExamResponse(response, {
          classroomId,
          weekId,
          expectedId: existingExamId,
          expectPublished: publish
        });
      } else if (publish) {
        const createdResponse = await createTeacherExam(weekId, payload);
        const created = validateExamResponse(createdResponse, { classroomId, weekId });
        const createdEntityScopeKey = makeScopeKey({
          actorUserId,
          classroomId,
          weekId,
          examId: created.id
        });
        if (!isActiveSaveRequest(requestId, requestInitialScopeKey, requestEntityScopeKey)) {
          rememberMaterializedExam({
            actorUserId,
            classroomId,
            weekId,
            examId: created.id,
            originalScopeKey: requestInitialScopeKey
          });
          return;
        }
        const createdRecoveryKey = examStudioRecoveryKey({
          actorUserId,
          classroomId,
          weekId,
          examId: created.id,
          examVersion: created.draftRevision.version
        });
        migrateExamStudioRecoveryKey(recoveryKeyAtSaveStart, createdRecoveryKey);
        recoveryKeyToClear = createdRecoveryKey;
        setCreatedExamForRetry(created);
        createdExamForRetryRef.current = created;
        onExamMaterialized?.(created);
        rememberMaterializedExam({
          actorUserId,
          classroomId,
          weekId,
          examId: created.id,
          originalScopeKey: requestInitialScopeKey
        });
        requestEntityScopeKey = createdEntityScopeKey;
        if (!rebindSaveRequest(requestId, requestInitialScopeKey, requestEntityScopeKey)) return;
        const publishResponse = await publishTeacherExam(created.id, payload);
        if (!isActiveSaveRequest(requestId, requestInitialScopeKey, requestEntityScopeKey)) return;
        saved = validateExamResponse(publishResponse, {
          classroomId,
          weekId,
          expectedId: created.id,
          expectPublished: true
        });
      } else {
        const response = await createTeacherExam(weekId, payload);
        const created = validateExamResponse(response, { classroomId, weekId });
        if (!isActiveSaveRequest(requestId, requestInitialScopeKey, requestEntityScopeKey)) {
          rememberMaterializedExam({
            actorUserId,
            classroomId,
            weekId,
            examId: created.id,
            originalScopeKey: requestInitialScopeKey
          });
          return;
        }
        saved = created;
      }
      clearExamStudioRecoveryKey(recoveryKeyToClear);
      clearMaterializedExam({ actorUserId, classroomId, weekId });
      onSaved(saved);
      onClose();
    } catch (err) {
      if (!isActiveSaveRequest(requestId, requestInitialScopeKey)) return;
      if (err instanceof ApiError && err.code === "EXAM_ENDED") {
        setExamEndedLocked(true);
        setError(EXAM_ENDED_LOCK_MESSAGE);
        clearExamStudioRecoveryKey(recoveryKeyToClear);
        clearMaterializedExam({ actorUserId, classroomId, weekId });
        return;
      }
      setError(err instanceof Error ? err.message : "시험을 저장하지 못했습니다.");
    } finally {
      if (isActiveSaveRequest(requestId, requestInitialScopeKey)) {
        saveRequestRef.current = null;
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || chatBusy) return;
    const contextForMessage = sourceTextRef.current;
    abortActiveChatRequest();
    const requestId = chatRequestSeqRef.current + 1;
    chatRequestSeqRef.current = requestId;
    const scopeKey = asyncScopeKeyRef.current;
    const controller = new AbortController();
    chatRequestRef.current = { id: requestId, scopeKey, controller };
    setChatInput("");
    setChatBusy(true);
    setAppliedProposalSummary("");
    discardPendingProposal("new_chat");
    setStreamingThought("");
    setThoughtExpanded(true);
    setStudioProgress({
      stage: "PREPARING",
      label: "요청 정리",
      progress: 0.06,
      detail: "현재 draft와 메시지를 AI 설계 요청으로 준비하고 있습니다."
    });
    clearAttachmentContext();
    setChatMessages((prev) => [...prev, { role: "user", text: message }]);
    try {
      const proposal = await streamExamStudioChat(
        {
          weekId,
          message,
          currentDraft: toPayload(draftRef.current),
          sourceText: contextForMessage
        },
        (event) => handleChatStreamEvent(event, requestId, scopeKey),
        controller.signal
      );
      if (!isActiveChatRequest(requestId, scopeKey)) return;
      let assistantText = proposal.replyMarkdown;
      const hasOperations = !proposal.fallback && proposalOperations(proposal).length > 0;
      if (hasOperations) {
        setPendingProposalState(proposal);
        const counts = proposalOperationCounts(proposal);
        emitExamStudioAiObservation("proposal_pending", counts);
        assistantText = sanitizedProposalReviewText(proposal);
      }
      setChatMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
      setThoughtExpanded(false);
    } catch (err) {
      if (controller.signal.aborted || !isActiveChatRequest(requestId, scopeKey)) return;
      if (err instanceof ExamStudioDraftValidationError) {
        discardPendingProposal("stream_failure");
        setError(err.message);
        setThoughtExpanded(false);
        setStudioProgress((prev) => ({
          stage: prev?.stage && prev.stage !== "COMPLETE" ? prev.stage : "PREPARING",
          label: "오류",
          progress: prev?.progress ?? 1,
          detail: err.message,
          failed: true
        }));
        return;
      }
      const reason = streamFailureReason(err);
      const text = streamFailureCopy(reason);
      discardPendingProposal("stream_failure");
      emitExamStudioAiObservation("stream_failure_no_proposal", { reason });
      setThoughtExpanded(false);
      setStudioProgress((prev) => ({
        stage: prev?.stage && prev.stage !== "COMPLETE" ? prev.stage : "AI_THINKING",
        label: "오류",
        progress: prev?.progress ?? 1,
        detail: text,
        failed: true
      }));
      setChatMessages((prev) => [...prev, { role: "assistant", text }]);
    } finally {
      if (isActiveChatRequest(requestId, scopeKey)) {
        chatRequestRef.current = null;
        setChatBusy(false);
      }
    }
  }

  function applyProposal() {
    if (!pendingProposal || savingRef.current) return;
    emitExamStudioAiObservation("proposal_apply_clicked", {
      operationCount: proposalOperations(pendingProposal).length
    });
    const result = applyProposalToDraft(draftRef.current, pendingProposal);
    draftRef.current = result.draft;
    setDraft(result.draft);
    setAppliedProposalSummary(summarizeApplyResult(result));
    emitExamStudioAiObservation("proposal_apply_result", {
      settingPatchCount: result.settingPatchCount,
      appendQuestionCount: result.appendQuestionCount,
      replaceQuestionCount: result.replaceQuestionCount,
      skippedCount: result.skippedCount
    });
    setPendingProposalState(null);
  }

  async function handleAttachment(file: File | null) {
    if (!file) return;
    invalidateAttachmentRequest();
    const requestId = attachmentRequestSeqRef.current + 1;
    attachmentRequestSeqRef.current = requestId;
    const scopeKey = asyncScopeKeyRef.current;
    const controller = new AbortController();
    attachmentRequestRef.current = { id: requestId, scopeKey, controller };
    setError("");
    try {
      if (file.type.startsWith("image/")) {
        const metadata = `첨부 이미지: ${file.name} (${file.type}, ${file.size} bytes). 이미지 내용은 현재 직접 분석하지 못하므로, 필요한 내용은 메시지에 설명해 주세요.`;
        if (!isActiveAttachmentRequest(requestId, scopeKey)) return;
        setAttachmentContext(metadata, `이미지 첨부됨: ${file.name}`);
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", text: "이미지를 첨부했습니다. 이미지에서 참고할 내용을 메시지에 함께 설명해 주세요." }
        ]);
        return;
      }
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        if (!isActiveAttachmentRequest(requestId, scopeKey)) return;
        setError("PDF 또는 이미지 파일만 첨부할 수 있습니다.");
        return;
      }
      const result = await uploadExamStudioPdfContext(weekId, file, controller.signal);
      if (!isActiveAttachmentRequest(requestId, scopeKey)) return;
      setAttachmentContext(result.text, `PDF 첨부됨: ${file.name}${result.truncated ? " · 일부만 사용" : ""}`);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: `PDF ${result.numPages}쪽에서 시험 제작용 문맥을 불러왔습니다.` }
      ]);
    } catch (err) {
      if (controller.signal.aborted || !isActiveAttachmentRequest(requestId, scopeKey)) return;
      setError(err instanceof Error ? err.message : "PDF를 읽지 못했습니다.");
    } finally {
      if (isActiveAttachmentRequest(requestId, scopeKey) && attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
      if (isActiveAttachmentRequest(requestId, scopeKey)) {
        attachmentRequestRef.current = null;
      }
    }
  }

  function progressStageStatus(stageId: ExamStudioStreamStage) {
    if (!studioProgress) return "waiting";
    const currentIndex = EXAM_STUDIO_PROGRESS_STAGES.findIndex((stage) => stage.id === studioProgress.stage);
    const itemIndex = EXAM_STUDIO_PROGRESS_STAGES.findIndex((stage) => stage.id === stageId);
    if (studioProgress.failed && stageId === studioProgress.stage) return "failed";
    if (studioProgress.stage === "COMPLETE" || itemIndex < currentIndex) return "done";
    if (itemIndex === currentIndex) return "active";
    return "waiting";
  }

  const questionCount = draft.questions.length;
  const aiPanelHasActivity = Boolean(
    studioProgress ||
      chatMessages.length > 0 ||
      pendingProposal ||
      appliedProposalSummary ||
      attachmentStatus
  );
  const pendingProposalSummaryCards = pendingProposal ? proposalSummaryCards(pendingProposal) : [];
  const modalHeader = (
    <div className="exam-studio-head" data-testid="exam-studio-header">
          <div className="exam-studio-heading-copy">
            <div className="exam-studio-title-row">
              <h3>{exam ? "시험 스튜디오" : "새 과제/시험"}</h3>
              <span className="exam-studio-kicker" data-testid="exam-studio-kicker">
                시험 스튜디오
              </span>
            </div>
            <p className="modal-subcopy">직접 편집하거나 AI 제안을 승인해 시험을 구성합니다.</p>
          </div>
          <button
            type="button"
            className="exam-studio-close"
            data-testid="exam-studio-close"
            onClick={onClose}
            disabled={saving}
            aria-label="닫기"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="sr-only">닫기</span>
          </button>
        </div>
  );
  const studioForm = (
        <form className={variant === "page" ? "exam-studio-page-form" : "exam-studio-layout"} onSubmit={(event) => saveDraft(event, false)}>
          <section className="exam-studio-editor" data-testid="exam-studio-editor">
            <section className="exam-studio-card-panel exam-studio-basic-panel" data-testid="exam-studio-basic-info">
              <h2>기본 정보</h2>
            <div className="exam-settings-grid">
              <label className="form-field">
                시험 제목
                <input
                  className="input"
                  data-testid="exam-title-input"
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label className="form-field">
                시작
                <input
                  className="input"
                  type="datetime-local"
                  data-testid="exam-available-from-input"
                  value={draft.availableFrom}
                  onChange={(event) => setDraft((prev) => ({ ...prev, availableFrom: event.target.value }))}
                />
              </label>
              <label className="form-field">
                종료
                <input
                  className="input"
                  type="datetime-local"
                  data-testid="exam-available-until-input"
                  value={draft.availableUntil}
                  onChange={(event) => setDraft((prev) => ({ ...prev, availableUntil: event.target.value }))}
                />
              </label>
              <label className="form-field">
                제한 시간(분)
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={240}
                  data-testid="exam-time-limit-input"
                  value={draft.timeLimitMinutes}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, timeLimitMinutes: Number(event.target.value) }))
                  }
                />
              </label>
            </div>
            <label className="form-field">
              설명
              <textarea
                className="input"
                rows={2}
                value={draft.descriptionMarkdown}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, descriptionMarkdown: event.target.value }))
                }
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.aiGradingEnabled}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, aiGradingEnabled: event.target.checked }))
                }
              />
              서술형 AI 채점 사용
            </label>
            </section>

            <section className="exam-studio-card-panel exam-studio-question-panel" data-testid="exam-studio-question-design">
            <div className="exam-question-toolbar">
              <h4>문항</h4>
              <button
                type="button"
                className="btn"
                data-testid="exam-add-question"
                onClick={() => setDraft((prev) => ({ ...prev, questions: [...prev.questions, makeQuestion()] }))}
              >
                + 문항 추가
              </button>
            </div>

            {draft.questions.map((question, index) => (
              <article
                key={question.id}
                className="exam-question-card"
                data-testid="exam-question-card"
                data-question-id={question.id}
              >
                <div className="exam-studio-question-layout">
                  <strong className="exam-studio-question-index">{index + 1}</strong>
                  <div className="exam-studio-question-main">
                    <div className="exam-studio-question-controls">
                      <label className="exam-studio-question-control" htmlFor={`exam-question-type-${question.id}`}>
                        <span>문항 유형</span>
                        <select
                          id={`exam-question-type-${question.id}`}
                          className="input"
                          data-testid="exam-question-type"
                          data-question-id={question.id}
                          value={question.type}
                          onChange={(event) => {
                            const type = event.target.value as TeacherExamQuestionType;
                            patchQuestion(question.id, { ...makeQuestion(type), id: question.id, type });
                          }}
                        >
                          {QUESTION_TYPES.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="exam-studio-question-control" htmlFor={`exam-question-points-${question.id}`}>
                        <span>배점</span>
                        <span className="exam-question-points-field">
                          <input
                            id={`exam-question-points-${question.id}`}
                            className="input"
                            type="number"
                            min={0.5}
                            step={0.5}
                            data-testid="exam-question-points"
                            data-question-id={question.id}
                            value={question.points}
                            onChange={(event) => patchQuestion(question.id, { points: Number(event.target.value) })}
                          />
                          <span aria-hidden="true">점</span>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="exam-question-delete"
                        data-testid="exam-delete-question"
                        aria-label="문항 삭제"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            questions: prev.questions.filter((item) => item.id !== question.id)
                          }))
                        }
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path
                            d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13h8l1-13M10 11v5M14 11v5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>

                    <div className="exam-studio-question-body">
                      <div className="exam-studio-question-field">
                        <label className="exam-studio-question-field-title" htmlFor={`exam-question-prompt-${question.id}`}>
                          문제
                        </label>
                        <p className="exam-studio-question-field-help" id={`exam-question-prompt-help-${question.id}`}>
                          {QUESTION_PROMPT_HELP}
                        </p>
                        <textarea
                          id={`exam-question-prompt-${question.id}`}
                          className="input"
                          rows={3}
                          data-testid="exam-question-prompt"
                          data-question-id={question.id}
                          aria-describedby={`exam-question-prompt-help-${question.id}`}
                          placeholder={QUESTION_PROMPT_PLACEHOLDER}
                          value={question.promptMarkdown}
                          onChange={(event) => patchQuestion(question.id, { promptMarkdown: event.target.value })}
                        />
                      </div>

                      {question.type === "MCQ" ? (
                        <div className="exam-choice-list">
                          {(question.choices ?? []).map((choice, choiceIndex) => (
                            <div key={choice.id} className="exam-choice-editor">
                              <label className="exam-choice-answer-control" aria-label={`정답 선택지 ${choiceIndex + 1}`}>
                                <input
                                  type="radio"
                                  name={`answer-${question.id}`}
                                  data-testid="exam-question-answer"
                                  data-question-id={question.id}
                                  checked={question.answer?.choiceId === choice.id}
                                  onChange={() => patchQuestion(question.id, { answer: { choiceId: choice.id } })}
                                />
                              </label>
                              <input
                                className="input"
                                data-testid="exam-question-choice"
                                data-question-id={question.id}
                                data-choice-id={choice.id}
                                value={choice.textMarkdown}
                                placeholder={`선택지 ${choiceIndex + 1}`}
                                onChange={(event) =>
                                  patchQuestion(question.id, {
                                    choices: (question.choices ?? []).map((item) =>
                                      item.id === choice.id ? { ...item, textMarkdown: event.target.value } : item
                                    )
                                  })
                                }
                              />
                              <button
                                type="button"
                                className="exam-choice-remove"
                                data-testid="exam-remove-choice"
                                aria-label={`선택지 ${choiceIndex + 1} 삭제`}
                                disabled={(question.choices ?? []).length <= MIN_MCQ_CHOICES}
                                onClick={() => removeChoice(question, choice.id)}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                  <path
                                    d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13h8l1-13M10 11v5M14 11v5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="exam-choice-add"
                            data-testid="exam-add-choice"
                            disabled={(question.choices ?? []).length >= MAX_MCQ_CHOICES}
                            onClick={() => addChoice(question)}
                          >
                            + 선택지
                          </button>
                        </div>
                      ) : null}
                      {question.type === "OX" ? (
                        <select
                          className="input"
                          data-testid="exam-question-answer"
                          data-question-id={question.id}
                          value={String(question.answer?.value ?? true)}
                          onChange={(event) => patchQuestion(question.id, { answer: { value: event.target.value === "true" } })}
                        >
                          <option value="true">O</option>
                          <option value="false">X</option>
                        </select>
                      ) : null}
                      {(question.type === "SHORT" || question.type === "ESSAY") ? (
                        <>
                          <div className="exam-studio-question-field">
                            <label className="exam-studio-question-field-title" htmlFor={`exam-question-rubric-${question.id}`}>
                              채점 기준
                            </label>
                            <p className="exam-studio-question-field-help" id={`exam-question-rubric-help-${question.id}`}>
                              {RUBRIC_HELP}
                            </p>
                            <textarea
                              id={`exam-question-rubric-${question.id}`}
                              className="input"
                              rows={2}
                              data-testid="exam-question-rubric"
                              data-question-id={question.id}
                              aria-describedby={`exam-question-rubric-help-${question.id}`}
                              placeholder={RUBRIC_PLACEHOLDER}
                              value={question.rubricMarkdown ?? ""}
                              onChange={(event) => patchQuestion(question.id, { rubricMarkdown: event.target.value })}
                            />
                          </div>
                          <div className="exam-studio-question-field">
                            <label className="exam-studio-question-field-title" htmlFor={`exam-question-model-answer-${question.id}`}>
                              모범 답안
                            </label>
                            <p className="exam-studio-question-field-help" id={`exam-question-model-answer-help-${question.id}`}>
                              {MODEL_ANSWER_HELP}
                            </p>
                            <textarea
                              id={`exam-question-model-answer-${question.id}`}
                              className="input"
                              rows={2}
                              data-testid="exam-question-model-answer"
                              data-question-id={question.id}
                              aria-describedby={`exam-question-model-answer-help-${question.id}`}
                              placeholder={MODEL_ANSWER_PLACEHOLDER}
                              value={question.modelAnswerMarkdown ?? ""}
                              onChange={(event) => patchQuestion(question.id, { modelAnswerMarkdown: event.target.value })}
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            ))}
            </section>
          </section>

          <aside className="exam-studio-ai" data-testid="exam-studio-ai-panel">
            <div className="exam-ai-panel-head">
              <span className="exam-ai-panel-orb" aria-hidden="true">AI</span>
              <div>
                <div className="exam-ai-panel-title-row">
                  <strong>AI 시험 설계 도우미</strong>
                  <em>에이전트 모드</em>
                </div>
                <span>문항 추가 · 난이도 조정 · 평가 기준 제안</span>
              </div>
            </div>
            <div className="exam-ai-thread" data-testid="exam-ai-thread">
              {!aiPanelHasActivity ? (
                <div className="exam-ai-empty-state" data-testid="exam-studio-ai-empty-state">
                  <div className="exam-ai-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 48 48" fill="none">
                      <path d="M13 22h22a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5v-8a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="3" />
                      <path d="M18 22v-4a6 6 0 0 1 12 0v4M18 31h.01M30 31h.01M22 36h4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      <path d="M38 15h4M40 13v4M8 15h4M10 13v4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </div>
                  <strong>AI 도우미와 함께 효과적인 시험을 설계해 보세요.</strong>
                  <p>학습 자료와 요구사항을 바탕으로 문항 구성과 평가 기준을 제안해 드립니다.</p>
                  <div className="exam-ai-recommendation-card" data-testid="exam-studio-ai-recommendation-card">
                    <strong>추천 활용 방법</strong>
                    <ul>
                      <li>난이도별 문항 구성 제안</li>
                      <li>학습자료 기반 문제 추천</li>
                      <li>서술형 평가 기준 초안 생성</li>
                    </ul>
                  </div>
                </div>
              ) : null}
              {studioProgress ? (
                <div
                  className={`exam-ai-progress ${studioProgress.failed ? "failed" : ""}`}
                  data-testid="exam-ai-progress"
                >
                  <div className="exam-ai-progress-head">
                    <div>
                      <strong>AI 에이전트가 요청을 처리하고 있어요</strong>
                      <span>{studioProgress.label}</span>
                    </div>
                    <span>{Math.round(studioProgress.progress * 100)}%</span>
                  </div>
                  <div className="exam-ai-stage-list">
                    {EXAM_STUDIO_PROGRESS_STAGES.map((stage) => {
                      const status = progressStageStatus(stage.id);
                      return (
                        <div
                          key={stage.id}
                          className={`exam-ai-stage ${status}`}
                          data-testid={`exam-ai-stage-${stage.id}`}
                        >
                          <span className="exam-ai-stage-dot" aria-hidden="true" />
                          <span>{stage.label}</span>
                          <em>{status === "done" ? "완료" : status === "active" ? "진행 중" : status === "failed" ? "오류" : "대기"}</em>
                        </div>
                      );
                    })}
                  </div>
                  <div className="exam-ai-progress-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(6, Math.round(studioProgress.progress * 100))}%` }} />
                  </div>
                  <div
                    className={`exam-ai-thought-card ${thoughtExpanded ? "expanded" : "collapsed"}`}
                    data-testid="exam-ai-thought-summary"
                  >
                    <button
                      type="button"
                      className="exam-ai-thought-toggle"
                      data-testid="exam-ai-thought-toggle"
                      aria-expanded={thoughtExpanded}
                      onClick={() => setThoughtExpanded((prev) => !prev)}
                    >
                      <strong>사고 요약 스트리밍</strong>
                      <span>{chatBusy && !studioProgress.failed ? "LIVE" : studioProgress.failed ? "CHECK" : "DONE"}</span>
                    </button>
                    {thoughtExpanded ? (
                      <p>{streamingThought.trim() || studioProgress.detail || "AI 작업 흐름을 수신하고 있습니다."}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {chatMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`exam-ai-message ${message.role}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                </div>
              ))}
            </div>
            {pendingProposal || appliedProposalSummary || attachmentStatus ? (
              <div className="exam-ai-review-stack" data-testid="exam-ai-review-stack">
                {pendingProposal ? (
                  <div className="exam-ai-proposal" data-testid="exam-ai-proposal-card">
                    <span className="exam-ai-proposal-kicker">추천 변경</span>
                    <strong>{proposalHasQuestionMutation(pendingProposal) ? "추천 문항" : "추천 설정"}</strong>
                    <p>{sanitizedProposalReviewText(pendingProposal)}</p>
                    {pendingProposalSummaryCards.length > 0 ? (
                      <div className="exam-ai-proposal-summary" data-testid="exam-ai-proposal-summary">
                        {pendingProposalSummaryCards.map((card) => (
                          <div
                            key={`${card.method}-${card.title}-${card.body}`}
                            className="exam-ai-proposal-summary-card"
                            data-testid="exam-ai-proposal-summary-card"
                            data-operation-method={card.method}
                          >
                            <strong>{card.title}</strong>
                            <span>{card.body}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="btn"
                      data-testid="exam-ai-apply-proposal"
                      onClick={applyProposal}
                      disabled={saving}
                    >
                      {proposalActionLabel(pendingProposal)}
                    </button>
                  </div>
                ) : null}
                {appliedProposalSummary ? (
                  <div className="exam-ai-proposal" data-testid="exam-ai-applied-card">
                    <strong>왼쪽에 반영됨</strong>
                    <p>{appliedProposalSummary}</p>
                  </div>
                ) : null}
                {attachmentStatus ? (
                  <div className="exam-ai-attachment-status" data-testid="exam-ai-attachment-status">
                    <span>{attachmentStatus}</span>
                    <button
                      type="button"
                      className="exam-ai-attachment-clear"
                      aria-label="첨부 해제"
                      onClick={() => {
                        clearAttachmentContext();
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="exam-ai-input-row" data-testid="exam-ai-composer">
              <input
                ref={attachmentInputRef}
                className="exam-ai-attachment-input"
                data-testid="exam-ai-attachment-input"
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => handleAttachment(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="exam-ai-attach-btn"
                data-testid="exam-ai-attach"
                aria-label="파일 첨부"
                onClick={() => attachmentInputRef.current?.click()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M21 10.5 12.4 19a5.2 5.2 0 0 1-7.4 0 5.2 5.2 0 0 1 0-7.4l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.3 9.3a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <textarea
                className="input"
                data-testid="exam-ai-chat-input"
                rows={2}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendChat();
                  }
                }}
                placeholder="AI와 시험을 설계해 보세요"
              />
              <button
                type="button"
                className="exam-ai-send-btn"
                data-testid="exam-ai-send"
                aria-label="전송"
                onClick={sendChat}
                disabled={chatBusy}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M4 12 20 4l-5.2 16-3.2-6.8L4 12Zm7.6 1.2L20 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </aside>

          {error ? <div className="form-error exam-studio-error" data-testid="exam-studio-error">{error}</div> : null}
          <div className="form-actions exam-studio-actions" data-testid="exam-studio-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" className="btn ghost" data-testid="exam-save-draft" disabled={saving || examEndedLocked}>
              임시 저장
            </button>
            <button type="button" className="btn" data-testid="exam-publish" disabled={saving || examEndedLocked} onClick={() => saveDraft(undefined, true)}>
              게시
            </button>
          </div>
        </form>
  );

  if (variant === "page") {
    return (
      <main className="page-shell exam-studio-page" data-testid="app-shell-content">
        <div className="exam-studio-page-inner" data-testid="exam-studio-page">
          <section className="exam-studio-page-hero" data-testid="exam-studio-hero">
            <div className="exam-studio-page-title">
              <span className="dashboard-status-pill">평가 관리</span>
              <h1 className="page-title">시험 설계</h1>
              <p className="page-subtitle">
                시험 정보를 직접 구성하고 게시하여 학생들이 응시할 수 있도록 설정합니다.
              </p>
            </div>
            <div className="exam-studio-page-metrics" aria-label="시험 설계 요약">
              <span data-testid="exam-studio-metric-card">
                <small>문항 수</small>
                <strong>{questionCount}</strong>
              </span>
              <span data-testid="exam-studio-metric-card">
                <small>제한 시간</small>
                <strong>{draft.timeLimitMinutes}분</strong>
              </span>
              <span data-testid="exam-studio-metric-card">
                <small>서술형 AI 채점</small>
                <strong>{draft.aiGradingEnabled ? "사용" : "미사용"}</strong>
              </span>
            </div>
            <div className="exam-studio-page-visual" aria-hidden="true">
              <span />
              <span />
            </div>
          </section>
          {studioForm}
        </div>
      </main>
    );
  }

  return createPortal(
    <div ref={backdropRef} className="modal-backdrop exam-studio-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="modal-panel exam-studio-modal"
        role="dialog"
        aria-modal="true"
        data-testid="exam-studio-modal"
        tabIndex={-1}
      >
        {modalHeader}
        {studioForm}
      </div>
    </div>,
    document.body
  );
}
