import { appConfig } from "../../config.js";
import {
  EventApiRequest,
  EventApiResponse,
  LectureItem,
  SessionState
} from "../../types/domain.js";
import { parseOrchestratorPlan } from "../llm/JsonSchemaGuards.js";
import { Orchestrator } from "../agents/Orchestrator.js";
import { JsonStore } from "../storage/JsonStore.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";
import { PdfIngestService } from "../pdf/PdfIngestService.js";
import { SummaryService } from "./SummaryService.js";
import { StateReducer } from "./StateReducer.js";
import {
  applyLearnerMemoryWrite,
  buildPageHistoryDigest
} from "./LearnerMemoryService.js";
import { StreamProgressEvent, ToolDispatcher } from "./ToolDispatcher.js";
import { ensurePageState, progressText } from "./utils.js";

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
    return this.processEvent(sessionId, body);
  }

  async handleEventStream(
    sessionId: string,
    body: EventApiRequest,
    emit: (chunk: EventStreamChunk) => void
  ): Promise<void> {
    try {
      const response = await this.processEvent(sessionId, body, emit);
      emit({
        type: "final",
        data: response
      });
    } catch (error) {
      emit({
        type: "error",
        error: error instanceof Error ? error.message : "Unknown streaming error"
      });
    }
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
    },
    emit?: (chunk: EventStreamChunk) => void
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
          responseJsonSchema: this.orchestrator.getResponseJsonSchema()
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
    } catch {
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
    emit?: (chunk: EventStreamChunk) => void
  ): Promise<EventApiResponse> {
    const state = await this.store.getSession(sessionId);
    if (!state) {
      throw new Error("Session not found");
    }

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

    const context = await this.pdfIngestService.readPageContext(
      lecture.pdf.pageIndexPath,
      reduced.currentPage
    );

    const { plan, thoughtSummary } = await this.planWithLlm(
      {
        request: body,
        session: reduced,
        lectureNumPages: maxPage,
        pageContext: context,
        fileRef: lecture.pdf.geminiFile
      },
      emit
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
        onStreamEvent: (chunk) => emit?.(chunk)
      }
    );

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
    dispatchedState.updatedAt = new Date().toISOString();

    await this.appendQuizResultLogs(state, dispatchedState);
    await this.store.saveSession(dispatchedState);

    const pageState = ensurePageState(dispatchedState, dispatchedState.currentPage);

    return {
      ok: true,
      newMessages: allNewMessages,
      ui,
      patch: {
        currentPage: dispatchedState.currentPage,
        progressText: progressText(dispatchedState.currentPage),
        pageState,
        learnerModel: dispatchedState.learnerModel
      }
    };
  }

  async saveAndExit(session: SessionState): Promise<void> {
    await this.store.saveSession(session);
  }
}
