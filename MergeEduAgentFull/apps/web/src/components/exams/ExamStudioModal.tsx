import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createTeacherExam,
  publishTeacherExam,
  streamExamStudioChat,
  ExamStudioChatStreamEvent,
  ExamStudioStreamStage,
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
import { clearExamStudioRecovery, examStudioRecoveryKey } from "./examStudioRecovery";

interface Props {
  open: boolean;
  weekId: string;
  classroomId: string;
  actorUserId: string;
  exam?: TeacherExam | null;
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
  skippedCount: number;
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

const EXAM_STUDIO_PROGRESS_STAGES: Array<{ id: ExamStudioStreamStage; label: string }> = [
  { id: "PREPARING", label: "요청 정리" },
  { id: "ANALYZING_SOURCE", label: "자료 분석" },
  { id: "AI_THINKING", label: "사고 요약 스트리밍" },
  { id: "VALIDATING_JSON", label: "JSON 검증" },
  { id: "APPLYING_TO_STUDIO", label: "스튜디오 반영" }
];

function toLocalInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
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
    questions: revision?.questions?.length ? revision.questions : [makeQuestion("MCQ")]
  };
}

function toPayload(draft: DraftState): TeacherExamDraftPayload {
  return {
    ...draft,
    availableFrom: fromLocalInput(draft.availableFrom),
    availableUntil: fromLocalInput(draft.availableUntil)
  };
}

export function ExamStudioModal({
  open,
  weekId,
  classroomId,
  actorUserId,
  exam,
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const sourceTextRef = useRef("");
  const draftRef = useRef(draft);
  const chatRequestRef = useRef<{
    id: number;
    scopeKey: string;
    controller: AbortController;
  } | null>(null);
  const chatRequestSeqRef = useRef(0);
  useDialogFocus(open, dialogRef, backdropRef);

  const recoveryKey = useMemo(
    () =>
      examStudioRecoveryKey({
        actorUserId,
        classroomId,
        weekId,
        examId: exam?.id ?? "new",
        examVersion: exam?.activePublishedVersion
      }),
    [actorUserId, classroomId, exam?.activePublishedVersion, exam?.id, weekId]
  );
  const modalScopeKey = useMemo(
    () => `${weekId}:${exam?.id ?? "new"}:${exam?.activePublishedVersion ?? "draft"}:${open ? "open" : "closed"}`,
    [exam?.activePublishedVersion, exam?.id, open, weekId]
  );
  const modalScopeKeyRef = useRef(modalScopeKey);

  useEffect(() => {
    modalScopeKeyRef.current = modalScopeKey;
  }, [modalScopeKey]);

  useEffect(() => {
    return () => {
      abortActiveChatRequest();
    };
  }, [modalScopeKey]);

  useEffect(() => {
    if (!open) {
      abortActiveChatRequest();
      clearAttachmentContext();
      return;
    }
    abortActiveChatRequest();
    setDraft(buildInitialDraft(exam));
    setError("");
    setPendingProposal(null);
    setAppliedProposalSummary("");
    setChatMessages([]);
    setChatBusy(false);
    setStudioProgress(null);
    setStreamingThought("");
    setThoughtExpanded(false);
    clearAttachmentContext();
  }, [exam, open, weekId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!open) return;
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
  }, [draft, open, recoveryKey]);

  if (!open) return null;

  function setAttachmentContext(text: string, status: string) {
    sourceTextRef.current = text;
    setAttachmentStatus(status);
  }

  function clearAttachmentContext() {
    sourceTextRef.current = "";
    setAttachmentStatus("");
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
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
        modalScopeKeyRef.current === scopeKey &&
        !current.controller.signal.aborted
    );
  }

  function handleChatStreamEvent(
    event: ExamStudioChatStreamEvent,
    requestId: number,
    scopeKey: string
  ) {
    if (!isActiveChatRequest(requestId, scopeKey)) return;
    if (event.type === "stage") {
      setStudioProgress({
        stage: event.stage,
        label: event.label,
        progress: event.progress,
        detail: event.detail
      });
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

  function draftSnapshotKey(value: DraftState) {
    return JSON.stringify(toPayload(value));
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
    let skippedCount = 0;
    for (const operation of proposalOperations(proposal)) {
      if (operation.method === "patchExamSettings") {
        next = applySettingsPatch(next, operation.params);
        appliedMethods.push("설정 변경");
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
          next = { ...next, questions: [...next.questions, ...questions] };
          appliedMethods.push(`문항 ${questions.length}개 추가`);
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
            question.id === operation.params.replaceQuestionId ? operation.params.question : question
          )
        };
        appliedMethods.push("문항 교체");
      }
    }
    return { draft: next, appliedMethods, skippedCount };
  }

  function summarizeApplyResult(result: ProposalApplyResult) {
    const applied = result.appliedMethods.length ? result.appliedMethods.join(", ") : "적용된 변경 없음";
    return result.skippedCount > 0 ? `${applied} · ${result.skippedCount}개 항목은 건너뜀` : applied;
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
    setSaving(true);
    setError("");
    try {
      const payload = toPayload(draft);
      const saved = exam
        ? publish
          ? await publishTeacherExam(exam.id, payload)
          : await updateTeacherExam(exam.id, payload)
        : publish
          ? await publishTeacherExam((await createTeacherExam(weekId, payload)).id, payload)
          : await createTeacherExam(weekId, payload);
      clearExamStudioRecovery();
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "시험을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || chatBusy) return;
    const contextForMessage = sourceTextRef.current;
    const requestDraftSnapshotKey = draftSnapshotKey(draftRef.current);
    abortActiveChatRequest();
    const requestId = chatRequestSeqRef.current + 1;
    chatRequestSeqRef.current = requestId;
    const scopeKey = modalScopeKeyRef.current;
    const controller = new AbortController();
    chatRequestRef.current = { id: requestId, scopeKey, controller };
    setChatInput("");
    setChatBusy(true);
    setAppliedProposalSummary("");
    setPendingProposal(null);
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
        if (draftSnapshotKey(draftRef.current) === requestDraftSnapshotKey) {
          const result = applyProposalToDraft(draftRef.current, proposal);
          draftRef.current = result.draft;
          setDraft(result.draft);
          const summary = summarizeApplyResult(result);
          setAppliedProposalSummary(summary);
          assistantText = `${assistantText}\n\n왼쪽 스튜디오에 바로 반영했습니다: ${summary}`;
        } else {
          setPendingProposal(proposal);
          assistantText = `${assistantText}\n\n그 사이 왼쪽 draft가 변경되어 자동 반영하지 않았습니다. 검토 후 반영해 주세요.`;
        }
      }
      setChatMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
      setThoughtExpanded(false);
    } catch (err) {
      if (controller.signal.aborted || !isActiveChatRequest(requestId, scopeKey)) return;
      const text = err instanceof Error ? err.message : "AI 응답을 가져오지 못했습니다.";
      setThoughtExpanded(false);
      setStudioProgress((prev) => ({
        stage: prev?.stage ?? "AI_THINKING",
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
    if (!pendingProposal) return;
    const result = applyProposalToDraft(draftRef.current, pendingProposal);
    draftRef.current = result.draft;
    setDraft(result.draft);
    setAppliedProposalSummary(summarizeApplyResult(result));
    setPendingProposal(null);
  }

  async function handleAttachment(file: File | null) {
    if (!file) return;
    setError("");
    try {
      if (file.type.startsWith("image/")) {
        const metadata = `첨부 이미지: ${file.name} (${file.type}, ${file.size} bytes). 이미지 내용은 현재 직접 분석하지 못하므로, 필요한 내용은 메시지에 설명해 주세요.`;
        setAttachmentContext(metadata, `이미지 첨부됨: ${file.name}`);
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", text: "이미지를 첨부했습니다. 이미지에서 참고할 내용을 메시지에 함께 설명해 주세요." }
        ]);
        return;
      }
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError("PDF 또는 이미지 파일만 첨부할 수 있습니다.");
        return;
      }
      const result = await uploadExamStudioPdfContext(weekId, file);
      setAttachmentContext(result.text, `PDF 첨부됨: ${file.name}${result.truncated ? " · 일부만 사용" : ""}`);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: `PDF ${result.numPages}쪽에서 시험 제작용 문맥을 불러왔습니다.` }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF를 읽지 못했습니다.");
    } finally {
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
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
        <form className="exam-studio-layout" onSubmit={(event) => saveDraft(event, false)}>
          <section className="exam-studio-editor">
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

            <div className="exam-question-toolbar">
              <h4>문항</h4>
              <button
                type="button"
                className="btn"
                data-testid="exam-add-question"
                onClick={() => setDraft((prev) => ({ ...prev, questions: [...prev.questions, makeQuestion()] }))}
              >
                + 문항
              </button>
            </div>

            {draft.questions.map((question, index) => (
              <article
                key={question.id}
                className="exam-question-card"
                data-testid="exam-question-card"
                data-question-id={question.id}
              >
                <div className="exam-question-row">
                  <strong>{index + 1}</strong>
                  <select
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
                  <input
                    className="input"
                    type="number"
                    min={0.5}
                    data-testid="exam-question-points"
                    data-question-id={question.id}
                    value={question.points}
                    onChange={(event) => patchQuestion(question.id, { points: Number(event.target.value) })}
                  />
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
                <textarea
                  className="input"
                  rows={3}
                  data-testid="exam-question-prompt"
                  data-question-id={question.id}
                  placeholder="문항 지문"
                  value={question.promptMarkdown}
                  onChange={(event) => patchQuestion(question.id, { promptMarkdown: event.target.value })}
                />
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
                {question.type === "SHORT" ? (
                  <input
                    className="input"
                    data-testid="exam-question-answer"
                    data-question-id={question.id}
                    placeholder="기준 답안"
                    value={question.referenceAnswer?.text ?? ""}
                    onChange={(event) => patchQuestion(question.id, { referenceAnswer: { text: event.target.value } })}
                  />
                ) : null}
                {(question.type === "SHORT" || question.type === "ESSAY") ? (
                  <>
                    <textarea
                      className="input"
                      rows={2}
                      data-testid="exam-question-rubric"
                      data-question-id={question.id}
                      placeholder="채점 기준"
                      value={question.rubricMarkdown ?? ""}
                      onChange={(event) => patchQuestion(question.id, { rubricMarkdown: event.target.value })}
                    />
                    <textarea
                      className="input"
                      rows={2}
                      data-testid="exam-question-model-answer"
                      data-question-id={question.id}
                      placeholder="모범 답안"
                      value={question.modelAnswerMarkdown ?? ""}
                      onChange={(event) => patchQuestion(question.id, { modelAnswerMarkdown: event.target.value })}
                    />
                  </>
                ) : null}
              </article>
            ))}
          </section>

          <aside className="exam-studio-ai" data-testid="exam-studio-ai-panel">
            <div className="exam-ai-panel-head">
              <div>
                <strong>AI 설계 도우미</strong>
                <span>자료와 요구사항을 바탕으로 시험 구성을 제안합니다.</span>
              </div>
            </div>
            <div className="exam-ai-thread" data-testid="exam-ai-thread">
              {studioProgress ? (
                <div
                  className={`exam-ai-progress ${studioProgress.failed ? "failed" : ""}`}
                  data-testid="exam-ai-progress"
                >
                  <div className="exam-ai-progress-head">
                    <div>
                      <strong>작업 진행 상황</strong>
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
            {pendingProposal ? (
              <div className="exam-ai-proposal" data-testid="exam-ai-proposal-card">
                <strong>검토 필요</strong>
                <p>{pendingProposal.replyMarkdown}</p>
                <button type="button" className="btn" data-testid="exam-ai-apply-proposal" onClick={applyProposal}>
                  검토 후 반영
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

          {error ? <div className="form-error exam-studio-error">{error}</div> : null}
          <div className="form-actions exam-studio-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" className="btn ghost" data-testid="exam-save-draft" disabled={saving}>
              임시 저장
            </button>
            <button type="button" className="btn" data-testid="exam-publish" disabled={saving} onClick={() => saveDraft(undefined, true)}>
              게시
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
