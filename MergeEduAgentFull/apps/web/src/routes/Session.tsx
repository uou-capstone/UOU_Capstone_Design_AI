import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  getSessionByLecture,
  sendSessionEvent,
  sendSessionEventStream,
  SessionStreamEvent
} from "../api/endpoints";
import { ChatInput } from "../components/chat/ChatInput";
import { ChatPanel } from "../components/chat/ChatPanel";
import { PdfViewer } from "../components/pdf/PdfViewer";
import { QuizModal } from "../components/quiz/QuizModal";
import { useAuth } from "../auth/useAuth";
import { AgentName, AiStatus, ChatMessage, QuizJson, QuizRecord, QuizType, SessionState } from "../types";
import {
  findCurrentQuizRecord,
  findLatestQuizRecord,
  getPageCommandIntent
} from "./sessionHelpers";

interface StreamDraft {
  key: string;
  id: string;
  agent: AgentName;
  answer: string;
  thought: string;
}

interface GradingInsightState {
  open: boolean;
  thoughtMarkdown: string;
  answerMarkdown: string;
}

function isBoundedRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function SessionRoute() {
  const { lectureId } = useParams<{ lectureId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();

  const [session, setSession] = useState<SessionState | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [lectureNumPages, setLectureNumPages] = useState(1);
  const [progressText, setProgressText] = useState("");
  const [quizOpen, setQuizOpen] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizJson | null>(null);
  const [disableQuizClose, setDisableQuizClose] = useState(false);
  const [passScoreRatio, setPassScoreRatio] = useState(0.7);
  const [eventError, setEventError] = useState("");
  const [aiStatus, setAiStatus] = useState<AiStatus>({ connected: true });
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [streamDrafts, setStreamDrafts] = useState<StreamDraft[]>([]);
  const [gradingInsight, setGradingInsight] = useState<GradingInsightState>({
    open: false,
    thoughtMarkdown: "",
    answerMarkdown: ""
  });
  const bootstrappedSessionId = useRef<string | null>(null);
  const consumedDecisionMessageIds = useRef<Set<string>>(new Set());
  const streamRunId = useRef(0);
  const streamDraftBufferRef = useRef<Map<string, StreamDraft>>(new Map());
  const gradingInsightBufferRef = useRef<GradingInsightState>({
    open: false,
    thoughtMarkdown: "",
    answerMarkdown: ""
  });
  const streamFlushRafRef = useRef<number | null>(null);
  const activeStreamAbortRef = useRef<AbortController | null>(null);
  const activeStreamEventTypeRef = useRef<string | null>(null);
  const activeStreamRunIdRef = useRef<number | null>(null);
  const ignoredStreamRunIdsRef = useRef<Set<number>>(new Set());
  const mountedRef = useRef(false);
  const closedGradingInsightRunRef = useRef<number | null>(null);
  const lastQuizRecordPatchRef = useRef<QuizRecord | null>(null);
  const latestSessionRef = useRef<SessionState | null>(null);
  const activeQuizRef = useRef<QuizJson | null>(null);

  const commitSession = useCallback((nextOrUpdater: SessionState | null | ((prev: SessionState | null) => SessionState | null)) => {
    setSession((prev) => {
      const next =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(prev)
          : nextOrUpdater;
      latestSessionRef.current = next;
      return next;
    });
  }, []);

  const commitActiveQuiz = useCallback((next: QuizJson | null) => {
    activeQuizRef.current = next;
    setActiveQuiz(next);
  }, []);

  const currentQuizRecord = useMemo(() => {
    if (!session || !activeQuiz) return undefined;
    return findCurrentQuizRecord(session.quizzes, activeQuiz);
  }, [session, activeQuiz]);

  const cancelPendingStreamFlush = useCallback(() => {
    if (streamFlushRafRef.current !== null) {
      cancelAnimationFrame(streamFlushRafRef.current);
      streamFlushRafRef.current = null;
    }
  }, []);

  const resetStreamBuffers = useCallback(() => {
    streamDraftBufferRef.current.clear();
    gradingInsightBufferRef.current = {
      open: false,
      thoughtMarkdown: "",
      answerMarkdown: ""
    };
  }, []);

  const flushStreamBuffers = useCallback((runId: number) => {
    if (
      !mountedRef.current ||
      runId !== streamRunId.current ||
      ignoredStreamRunIdsRef.current.has(runId)
    ) return;
    setStreamDrafts(Array.from(streamDraftBufferRef.current.values()));
    const insight = gradingInsightBufferRef.current;
    if (insight.open || insight.thoughtMarkdown || insight.answerMarkdown) {
      setGradingInsight(insight);
    }
  }, []);

  const scheduleStreamFlush = useCallback((runId: number) => {
    if (
      !mountedRef.current ||
      runId !== streamRunId.current ||
      ignoredStreamRunIdsRef.current.has(runId)
    ) return;
    if (streamFlushRafRef.current !== null) return;
    streamFlushRafRef.current = requestAnimationFrame(() => {
      streamFlushRafRef.current = null;
      flushStreamBuffers(runId);
    });
  }, [flushStreamBuffers]);

  const cleanupStreamRun = useCallback((runId: number, options?: { abort?: boolean }) => {
    if (runId !== streamRunId.current) return;
    if (options?.abort) {
      activeStreamAbortRef.current?.abort();
    }
    activeStreamAbortRef.current = null;
    activeStreamEventTypeRef.current = null;
    activeStreamRunIdRef.current = null;
    cancelPendingStreamFlush();
    resetStreamBuffers();
    if (mountedRef.current) {
      setStreamDrafts([]);
    }
  }, [cancelPendingStreamFlush, resetStreamBuffers]);

  const cleanupAllStreams = useCallback(() => {
    activeStreamAbortRef.current?.abort();
    activeStreamAbortRef.current = null;
    activeStreamEventTypeRef.current = null;
    activeStreamRunIdRef.current = null;
    ignoredStreamRunIdsRef.current.clear();
    cancelPendingStreamFlush();
    resetStreamBuffers();
    streamRunId.current += 1;
  }, [cancelPendingStreamFlush, resetStreamBuffers]);

  async function loadSession() {
    if (!lectureId) return;
    setBootLoading(true);
    setBootError("");
    try {
      const data = await getSessionByLecture(lectureId);
      commitSession(data.session);
      setPdfUrl(data.pdfUrl);
      setLectureNumPages(Math.max(1, data.lecture.pdf.numPages || 1));
      setAiStatus(data.aiStatus);
      setProgressText(`~${data.session.currentPage}페이지까지 진행`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "세션을 불러오지 못했습니다.";
      setBootError(message);
      if (error instanceof ApiError && error.status === 401) {
        await auth.refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        navigate("/verify-email", { replace: true });
      }
    } finally {
      setBootLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
  }, [lectureId]);

  useEffect(() => {
    latestSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    activeQuizRef.current = activeQuiz;
  }, [activeQuiz]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupAllStreams();
    };
  }, [cleanupAllStreams]);

  useEffect(() => {
    if (!session) return;
    if (bootstrappedSessionId.current === session.sessionId) return;
    if (session.messages.length > 0) {
      bootstrappedSessionId.current = session.sessionId;
      return;
    }

    bootstrappedSessionId.current = session.sessionId;
    runEvent(
      { type: "SESSION_ENTERED" },
      undefined,
      { suppressThrow: true, suppressTopError: true }
    ).then((ok) => {
      if (!ok) {
        bootstrappedSessionId.current = null;
      }
    });
  }, [session?.sessionId, session?.messages.length]);

  const mergedMessages = useMemo(() => {
    if (!session) return [];
    const draftMessages: ChatMessage[] = streamDrafts.map((draft) => ({
      id: draft.id,
      role: "assistant",
      agent: draft.agent,
      contentMarkdown:
        draft.answer || (draft.thought ? "_사고 요약 스트리밍 중..._" : "_응답 생성 중..._"),
      thoughtSummaryMarkdown: draft.thought || undefined,
      createdAt: new Date().toISOString()
    }));
    return [...session.messages, ...draftMessages];
  }, [session, streamDrafts]);

  const updateStreamDraftBuffer = useCallback((key: string, agent: AgentName, channel: "thought" | "answer", text: string) => {
    if (!text) return;
    const current = streamDraftBufferRef.current.get(key);
    if (!current) {
      streamDraftBufferRef.current.set(key, {
        key,
        id: `stream_${key}`,
        agent,
        answer: channel === "answer" ? text : "",
        thought: channel === "thought" ? text : ""
      });
      return;
    }
    streamDraftBufferRef.current.set(key, {
      ...current,
      answer: channel === "answer" ? current.answer + text : current.answer,
      thought: channel === "thought" ? current.thought + text : current.thought
    });
  }, []);

  const handleStreamEvent = useCallback((event: SessionStreamEvent, runId: number) => {
    if (
      !mountedRef.current ||
      runId !== streamRunId.current ||
      ignoredStreamRunIdsRef.current.has(runId)
    ) return;

    if (event.type === "error") {
      setEventError(event.error);
      return;
    }

    if (event.type === "orchestrator_thought_delta") {
      updateStreamDraftBuffer(`${runId}:ORCHESTRATOR:thought`, "ORCHESTRATOR", "thought", event.text);
      scheduleStreamFlush(runId);
      return;
    }

    const key = `${runId}:${event.agent}:${event.tool}`;
    updateStreamDraftBuffer(key, event.agent, event.channel, event.text);

    if (event.agent === "GRADER" && closedGradingInsightRunRef.current !== runId) {
      const current = gradingInsightBufferRef.current;
      gradingInsightBufferRef.current = {
        ...current,
        open: true,
        thoughtMarkdown:
          event.channel === "thought" ? current.thoughtMarkdown + event.text : current.thoughtMarkdown,
        answerMarkdown:
          event.channel === "answer" ? current.answerMarkdown + event.text : current.answerMarkdown
      };
    }
    scheduleStreamFlush(runId);
  }, [scheduleStreamFlush, updateStreamDraftBuffer]);

  const runEvent = useCallback(async (
    event: {
      type:
        | "SESSION_ENTERED"
        | "START_EXPLANATION_DECISION"
        | "USER_MESSAGE"
        | "PAGE_CHANGED"
        | "QUIZ_TYPE_SELECTED"
        | "QUIZ_DECISION"
        | "QUIZ_SUBMITTED"
        | "NEXT_PAGE_DECISION"
        | "REVIEW_DECISION"
        | "RETEST_DECISION"
        | "SAVE_AND_EXIT";
      payload?: Record<string, unknown>;
    },
    pageOverride?: number,
    options?: {
      suppressThrow?: boolean;
      suppressTopError?: boolean;
      optimisticUserMessageId?: string;
    }
  ): Promise<boolean> => {
    const snapshot = latestSessionRef.current;
    if (!snapshot) return false;
    const previousPage = snapshot.currentPage;
    const extractNumber = (value: unknown): number | null => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return Math.floor(parsed);
    };
    let optimisticPage: number | null = null;
    let streamController: AbortController | null = null;
    let runId = streamRunId.current;
    try {
      setEventError("");
      if (activeStreamEventTypeRef.current === "PAGE_CHANGED") {
        if (activeStreamRunIdRef.current !== null) {
          ignoredStreamRunIdsRef.current.add(activeStreamRunIdRef.current);
        }
        activeStreamAbortRef.current?.abort();
        activeStreamAbortRef.current = null;
        activeStreamEventTypeRef.current = null;
        activeStreamRunIdRef.current = null;
      }
      cancelPendingStreamFlush();
      resetStreamBuffers();
      setStreamDrafts([]);
      runId = ++streamRunId.current;
      closedGradingInsightRunRef.current = null;

      if (event.type === "PAGE_CHANGED") {
        const target = extractNumber(event.payload?.page);
        if (target) {
          optimisticPage = Math.max(1, Math.min(lectureNumPages, target));
        }
      }
      if (event.type === "USER_MESSAGE") {
        const text = String(event.payload?.text ?? "");
        const pageIntent = getPageCommandIntent(text);
        if (pageIntent === "NEXT") {
          optimisticPage = Math.max(1, Math.min(lectureNumPages, snapshot.currentPage + 1));
        }
        if (pageIntent === "PREVIOUS") {
          optimisticPage = Math.max(1, Math.min(lectureNumPages, snapshot.currentPage - 1));
        }
      }
      if (event.type === "NEXT_PAGE_DECISION" && Boolean(event.payload?.accept)) {
        const fromPage = extractNumber(event.payload?.fromPage) ?? snapshot.currentPage;
        optimisticPage = Math.max(1, Math.min(lectureNumPages, fromPage + 1));
      }
      if (optimisticPage && optimisticPage !== snapshot.currentPage) {
        commitSession((prev) => (prev ? { ...prev, currentPage: optimisticPage! } : prev));
      }

      const quizType = String(event.payload?.quizType ?? "").toUpperCase();
      if (event.type === "QUIZ_SUBMITTED" && (quizType === "SHORT" || quizType === "ESSAY")) {
        gradingInsightBufferRef.current = {
          open: true,
          thoughtMarkdown: "",
          answerMarkdown: ""
        };
        setGradingInsight({
          open: true,
          thoughtMarkdown: "",
          answerMarkdown: ""
        });
      }

      const quizSubmitPage =
        event.type === "QUIZ_SUBMITTED"
          ? (() => {
              const quizId = String(event.payload?.quizId ?? "");
              const quizType = String(event.payload?.quizType ?? activeQuizRef.current?.quizType ?? "");
              const quizRecord = findLatestQuizRecord(
                latestSessionRef.current?.quizzes ?? [],
                quizId,
                quizType
              );
              return quizRecord?.createdFromPage ?? activeQuizRef.current?.page ?? null;
            })()
          : null;
      const contextPage =
        quizSubmitPage ??
        pageOverride ??
        (event.type === "USER_MESSAGE" ? snapshot.currentPage : optimisticPage) ??
        (event.type === "USER_MESSAGE" ? null : latestSessionRef.current?.currentPage) ??
        snapshot.currentPage;
      const clientContext = { currentPage: contextPage };
      if (event.type !== "SAVE_AND_EXIT") {
        streamController = new AbortController();
        activeStreamAbortRef.current = streamController;
        activeStreamEventTypeRef.current = event.type;
        activeStreamRunIdRef.current = runId;
      }
      const response =
        event.type === "SAVE_AND_EXIT"
          ? await sendSessionEvent(snapshot.sessionId, event, clientContext)
          : await sendSessionEventStream(
              snapshot.sessionId,
              event,
              (streamEvent) => handleStreamEvent(streamEvent, runId),
              clientContext,
              streamController?.signal
            );

      flushStreamBuffers(runId);
      if (!mountedRef.current || ignoredStreamRunIdsRef.current.has(runId)) {
        return false;
      }

      setPassScoreRatio(isBoundedRatio(response.ui.passScoreRatio) ? response.ui.passScoreRatio : 0.7);

      const isCurrentRun = runId === streamRunId.current;
      commitSession((prev) =>
        prev
          ? (() => {
              const patchedQuiz = response.patch.quizRecord ?? null;
              if (patchedQuiz) {
                lastQuizRecordPatchRef.current = patchedQuiz;
              }
              const baseMessages =
                event.type === "USER_MESSAGE" && options?.optimisticUserMessageId
                  ? prev.messages.filter((message) => message.id !== options.optimisticUserMessageId)
                  : prev.messages;
              const quizzes = patchedQuiz
                ? prev.quizzes.some((quiz) => quiz.id === patchedQuiz.id)
                  ? prev.quizzes.map((quiz) => (quiz.id === patchedQuiz.id ? patchedQuiz : quiz))
                  : [...prev.quizzes, patchedQuiz]
                : prev.quizzes;
              return {
                ...prev,
                currentPage: isCurrentRun ? response.patch.currentPage : prev.currentPage,
                learnerModel: isCurrentRun ? response.patch.learnerModel : prev.learnerModel,
                activeIntervention:
                  isCurrentRun && response.patch.activeIntervention !== undefined
                    ? response.patch.activeIntervention
                    : prev.activeIntervention ?? null,
                quizzes: isCurrentRun ? quizzes : prev.quizzes,
                messages: [
                  ...baseMessages,
                  ...response.newMessages
                ]
              };
            })()
          : prev
      );
      if (isCurrentRun) {
        setProgressText(response.patch.progressText);
      }

      if (isCurrentRun && response.ui.openQuizModal && response.ui.quiz) {
        setQuizOpen(true);
        commitActiveQuiz(response.ui.quiz);
      }
      if (isCurrentRun && typeof response.ui.disableQuizClose === "boolean") {
        setDisableQuizClose(response.ui.disableQuizClose);
      }

      if (event.type === "SESSION_ENTERED") {
        setBootError("");
      }

      if (event.type === "QUIZ_SUBMITTED") {
        setDisableQuizClose(false);
      }
      setStreamDrafts([]);
      return true;
    } catch (error) {
      if (
        !mountedRef.current ||
        ignoredStreamRunIdsRef.current.has(runId) ||
        streamController?.signal.aborted
      ) {
        return false;
      }
      if (optimisticPage !== null && optimisticPage !== previousPage) {
        commitSession((prev) => (prev ? { ...prev, currentPage: previousPage } : prev));
      }
      if (error instanceof ApiError && error.status === 401) {
        await auth.refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
        return false;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        navigate("/verify-email", { replace: true });
        return false;
      }
      const message = error instanceof Error ? error.message : "이벤트 처리 중 오류가 발생했습니다.";
      if (!options?.suppressTopError) {
        setEventError(message);
      }
      if (event.type === "SESSION_ENTERED") {
        setBootError(message);
      }
      if (!options?.suppressThrow) {
        throw error;
      }
      return false;
    } finally {
      cleanupStreamRun(runId);
    }
  }, [
    auth,
    cancelPendingStreamFlush,
    cleanupStreamRun,
    commitActiveQuiz,
    commitSession,
    flushStreamBuffers,
    handleStreamEvent,
    lectureNumPages,
    location.pathname,
    navigate,
    resetStreamBuffers
  ]);

  async function handleSaveAndExit() {
    if (!session) return;
    const ok = await runEvent({ type: "SAVE_AND_EXIT" }, undefined, { suppressThrow: true });
    if (!ok) return;
    navigate("/");
  }

  async function handleQuizSubmit(quizId: string, quizType: string, answers: Record<string, unknown>) {
    lastQuizRecordPatchRef.current = null;
    const ok = await runEvent({
      type: "QUIZ_SUBMITTED",
      payload: {
        quizId,
        quizType,
        answers
      }
    });
    if (!ok) return undefined;
    return lastQuizRecordPatchRef.current ?? undefined;
  }

  const handleQuizTypeSelect = useCallback(async (quizType: QuizType) => {
    await runEvent({
      type: "QUIZ_TYPE_SELECTED",
      payload: { quizType }
    });
  }, [runEvent]);

  const handleBinaryDecision = useCallback(async (
    messageId: string,
    decisionType:
      | "START_EXPLANATION_DECISION"
      | "QUIZ_DECISION"
      | "NEXT_PAGE_DECISION"
      | "REVIEW_DECISION"
      | "RETEST_DECISION",
    accept: boolean
  ) => {
    if (!session) return;
    if (consumedDecisionMessageIds.current.has(messageId)) {
      return;
    }
    consumedDecisionMessageIds.current.add(messageId);
    const payload: Record<string, unknown> = { accept };
    if (decisionType === "NEXT_PAGE_DECISION") {
      payload.fromPage = latestSessionRef.current?.currentPage ?? session.currentPage;
    }
    const ok = await runEvent({
      type: decisionType,
      payload
    }, undefined, { suppressThrow: true });
    if (!ok) {
      consumedDecisionMessageIds.current.delete(messageId);
    }
  }, [runEvent, session]);

  const handleChatSend = useCallback(async (text: string) => {
    const optimisticId = `optimistic_user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      role: "user",
      agent: "SYSTEM",
      contentMarkdown: text,
      createdAt: new Date().toISOString()
    };
    commitSession((prev) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, optimisticMessage]
          }
        : prev
    );
    await runEvent(
      { type: "USER_MESSAGE", payload: { text } },
      undefined,
      { optimisticUserMessageId: optimisticId }
    );
  }, [commitSession, runEvent]);

  const handleCloseGradingInsight = useCallback(() => {
    closedGradingInsightRunRef.current = streamRunId.current;
    gradingInsightBufferRef.current = {
      open: false,
      thoughtMarkdown: "",
      answerMarkdown: ""
    };
    setGradingInsight({
      open: false,
      thoughtMarkdown: "",
      answerMarkdown: ""
    });
  }, []);

  if (!session) {
    return (
      <main className="page-shell">
        {bootLoading ? "세션 로딩 중..." : null}
        {!bootLoading && bootError ? (
          <section className="card session-alert session-alert-error">
            <strong>세션을 열 수 없습니다.</strong>
            <div>{bootError}</div>
            <div className="form-actions">
              <button className="btn" onClick={loadSession}>
                다시 시도
              </button>
              <button className="btn ghost" onClick={() => navigate(-1)}>
                돌아가기
              </button>
            </div>
          </section>
        ) : null}
      </main>
    );
  }

  return (
    <main className="page-shell session-page">
      {!aiStatus.connected ? (
        <section className="card session-alert session-alert-error">
          <strong>AI 에이전트 연결 실패</strong>
          <div>{aiStatus.message ?? "Gemini PDF 연결이 없어 학습 에이전트를 실행할 수 없습니다."}</div>
        </section>
      ) : null}

      <div className="heading session-heading">
        <div>
          <span className="eyebrow">LEARNING SESSION</span>
          <h1 className="page-title">학습 세션</h1>
        </div>
        <div className="session-header-actions">
          <strong className="session-progress-pill">{progressText}</strong>
          <button className="btn" onClick={handleSaveAndExit}>
            저장 및 종료
          </button>
        </div>
      </div>

      <section className="session-layout">
        <PdfViewer
          pdfUrl={pdfUrl}
          knownNumPages={lectureNumPages}
          currentPage={session.currentPage}
          onPageChange={async (page) => {
            const safePage = Math.max(1, Math.min(lectureNumPages, page));
            if (safePage === (latestSessionRef.current?.currentPage ?? session.currentPage)) return;
            await runEvent(
              { type: "PAGE_CHANGED", payload: { page: safePage } },
              safePage,
              { suppressThrow: true }
            );
          }}
        />

        <section className="card session-chat-shell">
          {eventError ? (
            <div className="card session-alert session-alert-error session-alert-row" role="alert">
              {eventError}
            </div>
          ) : null}
          {bootError ? (
            <div className="card session-alert session-alert-error session-alert-row" role="alert">
              <div className="toolbar">
                <div>강의 시작 이벤트가 실패했습니다. 다시 시도해 주세요.</div>
                <button
                  className="btn ghost"
                  onClick={async () => {
                    setBootError("");
                    bootstrappedSessionId.current = null;
                    if (!session) return;
                    bootstrappedSessionId.current = session.sessionId;
                    const ok = await runEvent(
                      { type: "SESSION_ENTERED" },
                      undefined,
                      { suppressThrow: true, suppressTopError: true }
                    );
                    if (!ok) {
                      bootstrappedSessionId.current = null;
                    }
                  }}
                >
                  강의 시작 다시 시도
                </button>
              </div>
            </div>
          ) : null}
          <ChatPanel
            messages={mergedMessages}
            onQuizTypeSelect={handleQuizTypeSelect}
            onBinaryDecision={handleBinaryDecision}
          />
          <div className="session-composer">
            <ChatInput onSend={handleChatSend} />
          </div>
        </section>
      </section>

      <QuizModal
        open={quizOpen}
        quiz={activeQuiz}
        disableClose={disableQuizClose}
        passScoreRatio={passScoreRatio}
        gradedRecord={currentQuizRecord}
        gradingInsight={gradingInsight}
        onCloseInsight={handleCloseGradingInsight}
        onClose={() => {
          if (!disableQuizClose) {
            setQuizOpen(false);
            commitActiveQuiz(null);
          }
        }}
        onSubmit={handleQuizSubmit}
      />
    </main>
  );
}
