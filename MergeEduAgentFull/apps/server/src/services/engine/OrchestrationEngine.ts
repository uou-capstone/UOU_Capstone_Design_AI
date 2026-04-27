import { appConfig } from "../../config.js";
import {
  AppEvent,
  EventApiRequest,
  EventApiResponse,
  LectureItem,
  QuizRecord,
  QuizType,
  SessionState
} from "../../types/domain.js";
import { parseOrchestratorPlan } from "../llm/JsonSchemaGuards.js";
import { Orchestrator } from "../agents/Orchestrator.js";
import { JsonStore } from "../storage/JsonStore.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";
import { PdfIngestService } from "../pdf/PdfIngestService.js";
import { getPageCommandIntent } from "./PageCommandIntent.js";
import { SummaryService } from "./SummaryService.js";
import { StateReducer } from "./StateReducer.js";
import {
  applyLearnerMemoryWrite,
  buildPageHistoryDigest
} from "./LearnerMemoryService.js";
import {
  markAssessmentsConsumed,
  preparePendingAssessmentHandoff
} from "./QuizAssessmentService.js";
import { StreamProgressEvent, ToolDispatcher } from "./ToolDispatcher.js";
import { ensurePageState, progressText } from "./utils.js";

type ParsedOrchestratorPlan = ReturnType<typeof parseOrchestratorPlan>;
const GENERIC_STREAM_ERROR_MESSAGE =
  "세션 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";

function getSafePassScoreRatio(value: unknown = appConfig.passScoreRatio): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 0.7;
}

class SupersededPageChangeError extends Error {
  constructor() {
    super("Superseded page navigation event");
  }
}

/**
 * Ver3 Phase 1: pedagogy policy single choke point.
 *
 * Called exactly once in processEvent(), right after planWithLlm() returns.
 * Guarantees plan.pedagogyPolicy is always defined before dispatch, covering
 * both the LLM-success path and the deterministic fallback path with a single
 * safety net. ToolDispatcher's R1 rule provides a second defensive layer.
 */
function normalizePlan(plan: ParsedOrchestratorPlan): ParsedOrchestratorPlan {
  if (plan.pedagogyPolicy) return plan;
  return {
    ...plan,
    pedagogyPolicy: {
      mode: "ADVANCE",
      reason: "normalized: policy missing from upstream plan",
      allowDirectAnswer: true,
      hintDepth: "LOW",
      interventionBudget: 1
    }
  };
}

function findLatestQuizRecord(
  state: SessionState,
  quizId: string,
  quizType?: QuizType | string
): QuizRecord | undefined {
  for (let index = state.quizzes.length - 1; index >= 0; index -= 1) {
    const quiz = state.quizzes[index];
    if (quiz?.id !== quizId) continue;
    if (quizType && quiz.quizType !== quizType) continue;
    return quiz;
  }
  return undefined;
}

const PAGE_SCOPED_TOOLS = new Set([
  "SET_CURRENT_PAGE",
  "EXPLAIN_PAGE",
  "ANSWER_QUESTION",
  "GENERATE_QUIZ_MCQ",
  "GENERATE_QUIZ_OX",
  "GENERATE_QUIZ_SHORT",
  "GENERATE_QUIZ_ESSAY"
]);

export function sanitizePlanForUserPageIntent(
  plan: ParsedOrchestratorPlan,
  event: AppEvent,
  currentPage: number
): ParsedOrchestratorPlan {
  if (event.type !== "USER_MESSAGE") {
    return plan;
  }

  const text = String(event.payload?.text ?? "");
  const pageIntent = getPageCommandIntent(text);
  let changed = false;
  const actions: ParsedOrchestratorPlan["actions"] = [];

  for (const action of plan.actions) {
    if (action.type !== "CALL_TOOL" || !PAGE_SCOPED_TOOLS.has(action.tool)) {
      actions.push(action);
      continue;
    }

    if (!pageIntent && action.tool === "SET_CURRENT_PAGE") {
      changed = true;
      continue;
    }

    const args = action.args as Record<string, unknown>;
    const page = Number(args.page);
    if (Number.isFinite(page) && Math.floor(page) !== currentPage) {
      changed = true;
      actions.push(
        {
          ...action,
          args: {
            ...action.args,
            page: currentPage
          }
        } as ParsedOrchestratorPlan["actions"][number]
      );
      continue;
    }

    actions.push(action);
  }

  if (!changed) {
    return plan;
  }

  return {
    ...plan,
    actions
  };
}

export type EventStreamChunk =
  | {
      type: "orchestrator_thought_delta";
      text: string;
    }
  | StreamProgressEvent
  | {
      type: "final";
      data: EventApiResponse;
    }
  | {
      type: "error";
      error: string;
    };

export class OrchestrationEngine {
  private latestPageChangeRunBySession = new Map<string, number>();
  private nextPageChangeRunId = 0;

  constructor(
    private readonly store: JsonStore,
    private readonly reducer: StateReducer,
    private readonly orchestrator: Orchestrator,
    private readonly dispatcher: ToolDispatcher,
    private readonly bridge: GeminiBridgeClient,
    private readonly pdfIngestService: PdfIngestService,
    private readonly summaryService: SummaryService
  ) {}

  async handleEvent(sessionId: string, body: EventApiRequest): Promise<EventApiResponse> {
    return this.withSessionLock(sessionId, () => this.processEvent(sessionId, body));
  }

  async handleEventStream(
    sessionId: string,
    body: EventApiRequest,
    emit: (chunk: EventStreamChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const pageChangeRunId = this.registerPageChangeRun(sessionId, body);
      const response = await this.withSessionLock(sessionId, () =>
        this.processEvent(sessionId, body, emit, signal, pageChangeRunId)
      );
      if (signal?.aborted) return;
      emit({
        type: "final",
        data: response
      });
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof SupersededPageChangeError) {
        const response = await this.buildNoopResponse(sessionId);
        emit({
          type: "final",
          data: response
        });
        return;
      }
      console.warn(
        "[engine_stream_error] " +
          JSON.stringify({
            sessionId,
            message: error instanceof Error ? error.message : "Unknown streaming error"
          })
      );
      emit({
        type: "error",
        error: GENERIC_STREAM_ERROR_MESSAGE
      });
    }
  }

  private withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const store = this.store as JsonStore & {
      withSessionLock?: (sessionId: string, fn: () => Promise<T>) => Promise<T>;
    };
    if (typeof store.withSessionLock === "function") {
      return store.withSessionLock(sessionId, fn);
    }
    return fn();
  }

  private registerPageChangeRun(
    sessionId: string,
    body: EventApiRequest
  ): number | null {
    const runId = ++this.nextPageChangeRunId;
    this.latestPageChangeRunBySession.set(sessionId, runId);
    return body.event.type === "PAGE_CHANGED" ? runId : null;
  }

  private assertPageChangeRunCurrent(sessionId: string, runId: number | null | undefined): void {
    if (!runId) return;
    if (this.latestPageChangeRunBySession.get(sessionId) !== runId) {
      throw new SupersededPageChangeError();
    }
  }

  private async buildNoopResponse(sessionId: string): Promise<EventApiResponse> {
    const stored = await this.store.getSession(sessionId);
    if (!stored) {
      throw new Error("Session not found");
    }
    const state = structuredClone(stored);
    const pageState = ensurePageState(state, state.currentPage);
    return {
      ok: true,
      newMessages: [],
      ui: {
        openQuizModal: false,
        quiz: null,
        disableQuizClose: false,
        passScoreRatio: getSafePassScoreRatio(),
        widgets: []
      },
      patch: {
        currentPage: state.currentPage,
        progressText: progressText(state.currentPage),
        pageState,
        learnerModel: state.learnerModel,
        activeIntervention: state.activeIntervention ?? null,
        quizRecord: undefined
      }
    };
  }

  private buildFallbackThoughtSummary(
    event: EventApiRequest["event"],
    currentPage: number
  ): string {
    switch (event.type) {
      case "SESSION_ENTERED":
        return `세션 초기 진입입니다. 현재 ${currentPage}페이지 기준으로 학습 시작 플로우를 구성합니다.`;
      case "START_EXPLANATION_DECISION":
        return "설명 시작 여부를 확인하고 설명/질문 대기 중 무엇을 할지 결정합니다.";
      case "USER_MESSAGE":
        return "사용자 메시지를 해석해 질문응답, 페이지 이동, 퀴즈 흐름 중 어디로 보낼지 판단합니다.";
      case "PAGE_CHANGED":
        return `페이지 이동을 감지해 ${currentPage}페이지 기준으로 다음 액션을 계획합니다.`;
      case "QUIZ_TYPE_SELECTED":
        return "선택된 퀴즈 유형으로 문제 생성 도구를 호출할 계획입니다.";
      case "QUIZ_SUBMITTED":
        return "퀴즈 제출 결과를 바탕으로 적절한 채점 경로와 후속 학습 조치를 결정합니다.";
      case "QUIZ_DECISION":
        return "퀴즈 진행 여부에 따라 퀴즈 생성 또는 다음 학습 분기로 전환합니다.";
      case "NEXT_PAGE_DECISION":
        return "다음 페이지 이동 결정을 반영하고 경계 페이지인지 확인합니다.";
      case "REVIEW_DECISION":
        return "복습 여부에 따라 상세 설명 또는 다음 학습으로 분기합니다.";
      case "RETEST_DECISION":
        return "재시험 여부에 따라 퀴즈 루프를 재개할지 판단합니다.";
      case "SAVE_AND_EXIT":
        return "세션 저장 및 종료 흐름을 안전하게 마무리합니다.";
      default:
        return "현재 이벤트를 처리할 적절한 tool call 시퀀스를 계획합니다.";
    }
  }

  private emitFallbackThoughts(
    event: EventApiRequest["event"],
    currentPage: number,
    emit?: (chunk: EventStreamChunk) => void
  ): string {
    const summary = this.buildFallbackThoughtSummary(event, currentPage).trim();
    if (!summary) return "";
    if (!emit) return summary;
    for (const word of summary.split(/\s+/g).filter(Boolean)) {
      emit({
        type: "orchestrator_thought_delta",
        text: `${word} `
      });
    }
    return summary;
  }

  private async planWithLlm(
    input: {
      request: EventApiRequest;
      session: SessionState;
      lectureNumPages: number;
      pageContext: { pageText: string; prev: string; next: string };
      fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]> | undefined;
      assessmentDigest?: string;
    },
    emit?: (chunk: EventStreamChunk) => void,
    signal?: AbortSignal
  ): Promise<{ plan: ReturnType<typeof parseOrchestratorPlan>; thoughtSummary: string }> {
    const fallbackThought = this.buildFallbackThoughtSummary(
      input.request.event,
      input.session.currentPage
    );

    const planInput = {
      schemaVersion: "1.0" as const,
      event: input.request.event,
      session: input.session,
      lectureNumPages: input.lectureNumPages,
      pageText: input.pageContext.pageText,
      neighborText: {
        prev: input.pageContext.prev,
        next: input.pageContext.next
      },
      assessmentDigest: input.assessmentDigest ?? "",
      policy: {
        passScoreRatio: appConfig.passScoreRatio,
        recentMessagesN: appConfig.recentMessagesN
      }
    };

    if (input.request.event.type === "SAVE_AND_EXIT" || !input.fileRef) {
      return {
        plan: parseOrchestratorPlan(this.orchestrator.fallback(planInput)),
        thoughtSummary: this.emitFallbackThoughts(
          input.request.event,
          input.session.currentPage,
          emit
        )
      };
    }

    try {
      const prompt = this.orchestrator.buildPrompt(planInput);
      const structured = await this.bridge.orchestrateSessionStream(
        {
          model: appConfig.modelName,
          fileRef: input.fileRef,
          prompt,
          responseJsonSchema: this.orchestrator.getResponseJsonSchema(),
          signal
        },
        (delta) => {
          if (delta.channel !== "thought") return;
          emit?.({
            type: "orchestrator_thought_delta",
            text: delta.text
          });
        }
      );

      return {
        plan: parseOrchestratorPlan(structured.plan),
        thoughtSummary: (structured.thoughtSummary || fallbackThought).trim()
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      return {
        plan: parseOrchestratorPlan(this.orchestrator.fallback(planInput)),
        thoughtSummary: this.emitFallbackThoughts(
          input.request.event,
          input.session.currentPage,
          emit
        )
      };
    }
  }

  private async buildQuizContext(
    state: SessionState,
    pageIndexPath: string,
    currentPage: number
  ): Promise<string> {
    const digest = buildPageHistoryDigest(state, currentPage).trim();
    if (digest) {
      return digest;
    }
    return this.pdfIngestService.readCumulativeContext(pageIndexPath, currentPage);
  }

  private appendQuizResultLogs(before: SessionState, after: SessionState): Promise<void> {
    const beforeSignatures = new Map<string, string>();
    for (const quiz of before.quizzes) {
      if (!quiz.grading || quiz.grading.status !== "GRADED") continue;
      beforeSignatures.set(
        quiz.id,
        `${quiz.grading.score}:${quiz.grading.maxScore}:${quiz.grading.summaryMarkdown}`
      );
    }

    const entries = after.quizzes
      .filter((quiz) => quiz.grading?.status === "GRADED")
      .filter((quiz) => {
        const signature = `${quiz.grading?.score ?? 0}:${quiz.grading?.maxScore ?? 0}:${quiz.grading?.summaryMarkdown ?? ""}`;
        return beforeSignatures.get(quiz.id) !== signature;
      })
      .map((quiz) => ({
        id: `qlog_${Math.random().toString(36).slice(2, 10)}`,
        sessionId: after.sessionId,
        lectureId: after.lectureId,
        quizId: quiz.id,
        quizType: quiz.quizType,
        page: quiz.createdFromPage,
        score: quiz.grading?.score ?? 0,
        maxScore: quiz.grading?.maxScore ?? 0,
        scoreRatio: quiz.grading?.scoreRatio ?? 0,
        summaryMarkdown: quiz.grading?.summaryMarkdown ?? "",
        createdAt: new Date().toISOString()
      }));

    if (entries.length === 0) {
      return Promise.resolve();
    }
    return this.store.appendQuizResultEntries(entries);
  }

  private async processEvent(
    sessionId: string,
    body: EventApiRequest,
    emit?: (chunk: EventStreamChunk) => void,
    signal?: AbortSignal,
    pageChangeRunId?: number | null
  ): Promise<EventApiResponse> {
    if (signal?.aborted) {
      throw new Error("Request aborted");
    }
    this.assertPageChangeRunCurrent(sessionId, pageChangeRunId);
    const state = await this.store.getSession(sessionId);
    if (!state) {
      throw new Error("Session not found");
    }
    this.assertPageChangeRunCurrent(sessionId, pageChangeRunId);

    const reduced = this.reducer.reduce(state, body.event, body.clientContext?.currentPage);
    const reducerNewMessages = reduced.messages.slice(state.messages.length);

    const lecture = await this.store.getLecture(reduced.lectureId);
    if (!lecture) {
      throw new Error("Lecture not found for session");
    }

    const maxPage = Math.max(1, lecture.pdf.numPages || 1);
    if (reduced.currentPage < 1) {
      reduced.currentPage = 1;
    } else if (reduced.currentPage > maxPage) {
      reduced.currentPage = maxPage;
    }
    ensurePageState(reduced, reduced.currentPage);

    const assessmentHandoff =
      body.event.type === "SAVE_AND_EXIT"
        ? { assessmentIds: [] as string[], digest: "" }
        : preparePendingAssessmentHandoff(reduced);

    const submittedQuizId = String(body.event.payload?.quizId ?? "");
    const submittedPayloadQuizType = String(body.event.payload?.quizType ?? "").toUpperCase();
    const submittedQuizRecord = findLatestQuizRecord(
      reduced,
      submittedQuizId,
      submittedPayloadQuizType
    );
    const submittedQuizType = String(submittedQuizRecord?.quizType ?? "").toUpperCase();
    const isDeterministicMcqOxSubmit =
      body.event.type === "QUIZ_SUBMITTED" &&
      Boolean(submittedQuizRecord) &&
      ["MCQ", "OX"].includes(submittedQuizType) &&
      assessmentHandoff.assessmentIds.length === 0;

    const context = isDeterministicMcqOxSubmit
      ? { pageText: "", prev: "", next: "" }
      : await this.pdfIngestService.readPageContext(
          lecture.pdf.pageIndexPath,
          reduced.currentPage
        );

    const { plan: rawPlan, thoughtSummary } = isDeterministicMcqOxSubmit
      ? {
          plan: parseOrchestratorPlan(
            this.orchestrator.fallback({
              schemaVersion: "1.0",
              event: body.event,
              session: reduced,
              lectureNumPages: maxPage,
              pageText: "",
              neighborText: {
                prev: "",
                next: ""
              },
              assessmentDigest: "",
              policy: {
                passScoreRatio: appConfig.passScoreRatio,
                recentMessagesN: appConfig.recentMessagesN
              }
            })
          ),
          thoughtSummary: this.emitFallbackThoughts(
            body.event,
            reduced.currentPage,
            emit
          )
        }
      : await this.planWithLlm(
          {
            request: body,
            session: reduced,
            lectureNumPages: maxPage,
            pageContext: context,
            fileRef: lecture.pdf.geminiFile,
            assessmentDigest: assessmentHandoff.digest
          },
          emit,
          signal
        );
    if (signal?.aborted) {
      throw new Error("Request aborted");
    }
    this.assertPageChangeRunCurrent(sessionId, pageChangeRunId);

    // Ver3 Phase 1 — single normalization choke point. Covers LLM success and
    // fallback paths; guarantees plan.pedagogyPolicy is present before dispatch.
    const plan = sanitizePlanForUserPageIntent(
      normalizePlan(rawPlan),
      body.event,
      reduced.currentPage
    );

    applyLearnerMemoryWrite(reduced, plan.memoryWrite);

    const needsCumulativeQuizContext = plan.actions.some(
      (action) =>
        action.type === "CALL_TOOL" && action.tool.startsWith("GENERATE_QUIZ_")
    );
    const quizContextText = needsCumulativeQuizContext
      ? await this.buildQuizContext(
          reduced,
          lecture.pdf.pageIndexPath,
          reduced.currentPage
        )
      : undefined;

    const { state: dispatchedState, newMessages, ui } = await this.dispatcher.dispatch(
      reduced,
      plan.actions,
      {
        lecture,
        basePage: reduced.currentPage,
        pageContext: {
          ...context,
          quizText: quizContextText
        },
        eventPayload: body.event.payload,
        pedagogyPolicy: plan.pedagogyPolicy,
        resolvePageContext: async (page, stateSnapshot) => {
          const resolved = await this.pdfIngestService.readPageContext(
            lecture.pdf.pageIndexPath,
            page
          );
          const quizText =
            plan.actions.some(
              (action) =>
                action.type === "CALL_TOOL" &&
                action.tool.startsWith("GENERATE_QUIZ_")
            ) && page === stateSnapshot.currentPage
              ? await this.buildQuizContext(
                  stateSnapshot,
                  lecture.pdf.pageIndexPath,
                  page
                )
              : undefined;
          return {
            ...resolved,
            quizText
          };
        }
      },
      {
        onStreamEvent: (chunk) => {
          if (!signal?.aborted) emit?.(chunk);
        },
        abortSignal: signal
      }
    );
    const responseUi = {
      ...ui,
      passScoreRatio: getSafePassScoreRatio(ui.passScoreRatio)
    };
    if (signal?.aborted) {
      throw new Error("Request aborted");
    }
    this.assertPageChangeRunCurrent(sessionId, pageChangeRunId);

    if (thoughtSummary) {
      for (const message of newMessages) {
        if (message.agent === "ORCHESTRATOR" && !message.thoughtSummaryMarkdown) {
          message.thoughtSummaryMarkdown = thoughtSummary;
        }
      }
    }

    const allNewMessages = [...reducerNewMessages, ...newMessages];

    dispatchedState.conversationSummary = this.summaryService.summarize(
      dispatchedState,
      appConfig.recentMessagesN
    );
    if (assessmentHandoff.assessmentIds.length > 0) {
      markAssessmentsConsumed(dispatchedState, assessmentHandoff.assessmentIds);
      console.log(
        "[assessment_consume] " +
          JSON.stringify({
            sessionId: dispatchedState.sessionId,
            deliveredIds: assessmentHandoff.assessmentIds,
            consumedCount: assessmentHandoff.assessmentIds.length
          })
      );
    }
    dispatchedState.updatedAt = new Date().toISOString();

    this.assertPageChangeRunCurrent(sessionId, pageChangeRunId);
    await this.appendQuizResultLogs(state, dispatchedState);
    this.assertPageChangeRunCurrent(sessionId, pageChangeRunId);
    await this.store.saveSession(dispatchedState);
    try {
      this.assertPageChangeRunCurrent(sessionId, pageChangeRunId);
    } catch (error) {
      if (error instanceof SupersededPageChangeError) {
        await this.store.saveSession(state);
      }
      throw error;
    }

    const pageState = ensurePageState(dispatchedState, dispatchedState.currentPage);
    const patchQuizRecord =
      body.event.type === "QUIZ_SUBMITTED" && submittedQuizId
        ? findLatestQuizRecord(
            dispatchedState,
            submittedQuizId,
            submittedPayloadQuizType
          ) ?? null
        : undefined;

    return {
      ok: true,
      newMessages: allNewMessages,
      ui: responseUi,
      patch: {
        currentPage: dispatchedState.currentPage,
        progressText: progressText(dispatchedState.currentPage),
        pageState,
        learnerModel: dispatchedState.learnerModel,
        activeIntervention: dispatchedState.activeIntervention ?? null,
        quizRecord: patchQuizRecord
      }
    };
  }

  async saveAndExit(session: SessionState): Promise<void> {
    await this.store.saveSession(session);
  }
}
