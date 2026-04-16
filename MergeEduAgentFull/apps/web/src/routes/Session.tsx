import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getSessionByLecture,
  saveSession,
  sendSessionEvent,
  sendSessionEventStream,
  SessionStreamEvent
} from "../api/endpoints";
import { ChatInput } from "../components/chat/ChatInput";
import { ChatPanel } from "../components/chat/ChatPanel";
import { PdfViewer } from "../components/pdf/PdfViewer";
import { QuizModal } from "../components/quiz/QuizModal";
import { AgentName, AiStatus, ChatMessage, QuizJson, QuizRecord, QuizType, SessionState } from "../types";

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

export function SessionRoute() {
  const { lectureId } = useParams<{ lectureId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionState | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [lectureNumPages, setLectureNumPages] = useState(1);
  const [progressText, setProgressText] = useState("");
  const [quizOpen, setQuizOpen] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizJson | null>(null);
  const [disableQuizClose, setDisableQuizClose] = useState(false);
  const [eventError, setEventError] = useState("");
  const [aiStatus, setAiStatus] = useState<AiStatus>({ connected: true });
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

  const currentQuizRecord = useMemo(() => {
    if (!session || !activeQuiz) return undefined;
    return session.quizzes.find((q) => q.id === activeQuiz.quizId);
  }, [session, activeQuiz]);

  async function loadSession() {
    if (!lectureId) return;
    const data = await getSessionByLecture(lectureId);
    setSession(data.session);
    setPdfUrl(data.pdfUrl);
    setLectureNumPages(Math.max(1, data.lecture.pdf.numPages || 1));
    setAiStatus(data.aiStatus);
    setProgressText(`~${data.session.currentPage}페이지까지 진행`);
  }

  useEffect(() => {
    loadSession().catch(console.error);
  }, [lectureId]);

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

  const updateStreamDraft = useCallback((key: string, agent: AgentName, channel: "thought" | "answer", text: string) => {
    if (!text) return;
    setStreamDrafts((prev) => {
      const next = [...prev];
      const index = next.findIndex((item) => item.key === key);
      if (index === -1) {
        next.push({
          key,
          id: `stream_${key}`,
          agent,
          answer: channel === "answer" ? text : "",
          thought: channel === "thought" ? text : ""
        });
        return next;
      }
      const current = next[index];
      next[index] = {
        ...current,
        answer: channel === "answer" ? current.answer + text : current.answer,
        thought: channel === "thought" ? current.thought + text : current.thought
      };
      return next;
    });
  }, []);

  const handleStreamEvent = useCallback((event: SessionStreamEvent, runId: number) => {
    if (runId !== streamRunId.current) return;

    if (event.type === "error") {
      setEventError(event.error);
      return;
    }

    if (event.type === "orchestrator_thought_delta") {
      updateStreamDraft(`${runId}:ORCHESTRATOR:thought`, "ORCHESTRATOR", "thought", event.text);
      return;
    }

    const key = `${runId}:${event.agent}:${event.tool}`;
    updateStreamDraft(key, event.agent, event.channel, event.text);

    if (event.agent === "GRADER") {
      setGradingInsight((prev) => ({
        ...prev,
        open: true,
        thoughtMarkdown:
          event.channel === "thought" ? prev.thoughtMarkdown + event.text : prev.thoughtMarkdown,
        answerMarkdown:
          event.channel === "answer" ? prev.answerMarkdown + event.text : prev.answerMarkdown
      }));
    }
  }, [updateStreamDraft]);

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
    if (!session) return false;
    const previousPage = session.currentPage;
    const extractNumber = (value: unknown): number | null => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return Math.floor(parsed);
    };
    let optimisticPage: number | null = null;
    try {
      setEventError("");
      const runId = ++streamRunId.current;
      setStreamDrafts([]);

      if (event.type === "PAGE_CHANGED") {
        const target = extractNumber(event.payload?.page);
        if (target) {
          optimisticPage = Math.max(1, Math.min(lectureNumPages, target));
        }
      }
      if (event.type === "USER_MESSAGE") {
        const text = String(event.payload?.text ?? "");
        if (/(다음\s*페이지|다음으로|넘어가|다음\s*슬라이드|next\s*page|next\b)/i.test(text)) {
          optimisticPage = Math.max(1, Math.min(lectureNumPages, session.currentPage + 1));
        }
      }
      if (event.type === "NEXT_PAGE_DECISION" && Boolean(event.payload?.accept)) {
        const fromPage = extractNumber(event.payload?.fromPage) ?? session.currentPage;
        optimisticPage = Math.max(1, Math.min(lectureNumPages, fromPage + 1));
      }
      if (optimisticPage && optimisticPage !== session.currentPage) {
        setSession((prev) => (prev ? { ...prev, currentPage: optimisticPage! } : prev));
      }

      const quizType = String(event.payload?.quizType ?? "").toUpperCase();
      if (event.type === "QUIZ_SUBMITTED" && (quizType === "SHORT" || quizType === "ESSAY")) {
        setGradingInsight({
          open: true,
          thoughtMarkdown: "",
          answerMarkdown: ""
        });
      }

      const clientContext = pageOverride ? { currentPage: pageOverride } : { currentPage: session.currentPage };
      const response =
        event.type === "SAVE_AND_EXIT"
          ? await sendSessionEvent(session.sessionId, event, clientContext)
          : await sendSessionEventStream(
              session.sessionId,
              event,
              (streamEvent) => handleStreamEvent(streamEvent, runId),
              clientContext
            );

      setSession((prev) =>
        prev
          ? {
              ...prev,
              currentPage: response.patch.currentPage,
              learnerModel: response.patch.learnerModel,
              activeIntervention:
                response.patch.activeIntervention ?? prev.activeIntervention ?? null,
              messages: [
                ...(
                  event.type === "USER_MESSAGE" && options?.optimisticUserMessageId
                    ? prev.messages.filter((message) => message.id !== options.optimisticUserMessageId)
                    : prev.messages
                ),
                ...response.newMessages
              ]
            }
          : prev
      );
      setProgressText(response.patch.progressText);

      if (response.ui.openQuizModal && response.ui.quiz) {
        setQuizOpen(true);
        setActiveQuiz(response.ui.quiz);
      }
      if (typeof response.ui.disableQuizClose === "boolean") {
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
      if (optimisticPage !== null && optimisticPage !== previousPage) {
        setSession((prev) => (prev ? { ...prev, currentPage: previousPage } : prev));
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
    }
  }, [handleStreamEvent, lectureNumPages, session]);

  async function handleSaveAndExit() {
    if (!session) return;
    const ok = await runEvent({ type: "SAVE_AND_EXIT" }, undefined, { suppressThrow: true });
    if (!ok) return;
    await saveSession(session.sessionId);
    navigate("/");
  }

  async function handleQuizSubmit(quizId: string, quizType: string, answers: Record<string, unknown>) {
    await runEvent({
      type: "QUIZ_SUBMITTED",
      payload: {
        quizId,
        quizType,
        answers
      }
    });
    const refreshed = await getSessionByLecture(lectureId!);
    setSession(refreshed.session);
    setAiStatus(refreshed.aiStatus);
    const graded = refreshed.session.quizzes.find((q) => q.id === quizId);
    return graded;
  }

  if (!session) {
    return <main className="page-shell">세션 로딩 중...</main>;
  }

  return (
    <main className="page-shell">
      {!aiStatus.connected ? (
        <section className="card session-alert session-alert-error">
          <strong>AI 에이전트 연결이 비정상입니다.</strong>
          <div>{aiStatus.message ?? "PDF 기반 AI 연결 복구에 실패했습니다. 잠시 후 다시 시도해 주세요."}</div>
        </section>
      ) : null}

      <div className="heading">
        <h1 style={{ margin: 0 }}>학습 세션</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong>{progressText}</strong>
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
            if (safePage === session.currentPage) return;
            await runEvent(
              { type: "PAGE_CHANGED", payload: { page: safePage } },
              safePage,
              { suppressThrow: true }
            );
          }}
        />

        <section className="card" style={{ padding: 12, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {eventError ? (
            <div className="card session-alert session-alert-error" style={{ marginBottom: 10 }}>
              {eventError}
            </div>
          ) : null}
          {bootError ? (
            <div className="card session-alert session-alert-error" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
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
            onQuizTypeSelect={async (quizType: QuizType) => {
              await runEvent({
                type: "QUIZ_TYPE_SELECTED",
                payload: { quizType }
              });
            }}
            onBinaryDecision={async (messageId, decisionType, accept) => {
              if (consumedDecisionMessageIds.current.has(messageId)) {
                return;
              }
              consumedDecisionMessageIds.current.add(messageId);
              const payload: Record<string, unknown> = { accept };
              if (decisionType === "NEXT_PAGE_DECISION") {
                payload.fromPage = session.currentPage;
              }
              const ok = await runEvent({
                type: decisionType,
                payload
              }, undefined, { suppressThrow: true });
              if (!ok) {
                consumedDecisionMessageIds.current.delete(messageId);
              }
            }}
          />
          <div style={{ marginTop: "auto", paddingTop: 10 }}>
            <ChatInput
              onSend={async (text) => {
                const optimisticId = `optimistic_user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                const optimisticMessage: ChatMessage = {
                  id: optimisticId,
                  role: "user",
                  agent: "SYSTEM",
                  contentMarkdown: text,
                  createdAt: new Date().toISOString()
                };
                setSession((prev) =>
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
              }}
            />
          </div>
        </section>
      </section>

      <QuizModal
        open={quizOpen}
        quiz={activeQuiz}
        disableClose={disableQuizClose}
        gradedRecord={currentQuizRecord}
        gradingInsight={gradingInsight}
        onCloseInsight={() => {
          setGradingInsight({
            open: false,
            thoughtMarkdown: "",
            answerMarkdown: ""
          });
        }}
        onClose={() => {
          if (!disableQuizClose) {
            setQuizOpen(false);
          }
        }}
        onSubmit={handleQuizSubmit}
      />
    </main>
  );
}
