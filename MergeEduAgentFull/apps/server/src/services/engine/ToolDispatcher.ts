import { appConfig } from "../../config.js";
import {
  ChatMessage,
  FeedbackEntry,
  GradingResult,
  LectureItem,
  QaThreadMode,
  QuizJson,
  QuizRecord,
  QuizType,
  SessionState,
  Widget
} from "../../types/domain.js";
import {
  OrchestratorAction,
  PedagogyPolicy
} from "../../types/orchestrator.js";
import { ExplainerAgent } from "../agents/ExplainerAgent.js";
import { GraderAgent } from "../agents/GraderAgent.js";
import { MisconceptionRepairAgent } from "../agents/MisconceptionRepairAgent.js";
import { QaAgent } from "../agents/QaAgent.js";
import { QuizAgents } from "../agents/QuizAgents.js";
import {
  applyLearnerMemoryWrite,
  buildIntegratedMemoryDigest
} from "./LearnerMemoryService.js";
import {
  buildAssessmentLogPayload,
  buildQuizAssessment,
  upsertQuizAssessment
} from "./QuizAssessmentService.js";
import {
  buildRepairMemoryWrite,
  buildRepairQuestion,
  createQuizRepairIntervention
} from "./QuizDiagnosisService.js";
import {
  appendQaThreadTurn,
  buildQaThreadDigest,
  hasActiveQaThreadForPage,
  resetQaThread
} from "./QaThreadService.js";
import { appendMessage, ensurePageState, makeId, nowIso, progressText } from "./utils.js";

interface PageContextBundle {
  pageText: string;
  prev: string;
  next: string;
  quizText?: string;
}

interface DispatchContext {
  lecture: LectureItem;
  basePage: number;
  pageContext: PageContextBundle;
  eventPayload: Record<string, unknown> | undefined;
  resolvePageContext: (
    page: number,
    state: SessionState
  ) => Promise<PageContextBundle>;
  /** Ver3 Phase 1: pedagogy policy forwarded by OrchestrationEngine. Optional
   *  so that test fixtures which predate Ver3 remain valid. */
  pedagogyPolicy?: PedagogyPolicy;
}

/** Ver3 Phase 1: tools that count against `interventionBudget` in verifier R3. */
const INTERVENTION_TOOLS: ReadonlySet<string> = new Set([
  "EXPLAIN_PAGE",
  "ANSWER_QUESTION",
  "REPAIR_MISCONCEPTION",
  "GENERATE_QUIZ_MCQ",
  "GENERATE_QUIZ_OX",
  "GENERATE_QUIZ_SHORT",
  "GENERATE_QUIZ_ESSAY",
  "AUTO_GRADE_MCQ_OX",
  "GRADE_SHORT_OR_ESSAY"
]);

/** Ver3 Phase 1: hard cap on total action count after verifier R10. */
const VERIFIER_HARD_CAP = 8;

export interface StreamProgressEvent {
  type: "agent_delta";
  tool: string;
  agent: "ORCHESTRATOR" | "EXPLAINER" | "QA" | "QUIZ" | "GRADER" | "SYSTEM";
  channel: "thought" | "answer";
  text: string;
}

function isQuizAnswerCorrect(
  quiz: QuizJson,
  questionId: string,
  userAnswer: unknown
): { correct: boolean; maxScore: number; feedback: string } {
  const question = quiz.questions.find((q) => q.id === questionId);
  if (!question) {
    return { correct: false, maxScore: 0, feedback: "문항을 찾을 수 없습니다." };
  }

  const points = question.points ?? 1;
  if (quiz.quizType === "MCQ") {
    const expected = (question as { answer: { choiceId: string } }).answer.choiceId;
    const expectedChoice = (
      question as { choices?: Array<{ id?: string; textMarkdown?: string }> }
    ).choices?.find((choice) => choice.id === expected);
    const expectedLabel = expectedChoice?.textMarkdown?.trim() || expected;
    const correct = String(userAnswer) === expected;
    return {
      correct,
      maxScore: points,
      feedback: correct ? "정답입니다." : `오답입니다. 정답은 ${expectedLabel} 입니다.`
    };
  }

  if (quiz.quizType === "OX") {
    const expected = Boolean((question as { answer: { value: boolean } }).answer.value);
    if (
      userAnswer === undefined ||
      userAnswer === null ||
      (typeof userAnswer === "string" && userAnswer.trim() === "")
    ) {
      return {
        correct: false,
        maxScore: points,
        feedback: "미응답입니다."
      };
    }
    const answer =
      typeof userAnswer === "boolean"
        ? userAnswer
        : String(userAnswer).toLowerCase() === "true";
    const correct = answer === expected;
    return {
      correct,
      maxScore: points,
      feedback: correct ? "정답입니다." : "오답입니다."
    };
  }

  return { correct: false, maxScore: points, feedback: "자동 채점 대상이 아닙니다." };
}

function appendAssistantMessage(
  state: SessionState,
  newMessages: ChatMessage[],
  ui: { widgets?: Widget[] },
  input: {
    agent: "ORCHESTRATOR" | "SYSTEM";
    contentMarkdown: string;
    widget?: Widget;
  }
): void {
  const msg = appendMessage(state, {
    role: "assistant",
    agent: input.agent,
    contentMarkdown: input.contentMarkdown,
    widget: input.widget
  });
  newMessages.push(msg);
  if (input.widget && ui.widgets) {
    ui.widgets.push(input.widget);
  }
}

function findLatestQuizRecord(
  state: SessionState,
  quizId: string,
  allowedTypes?: ReadonlySet<QuizType>
): QuizRecord | undefined {
  for (let index = state.quizzes.length - 1; index >= 0; index -= 1) {
    const quiz = state.quizzes[index];
    if (quiz?.id !== quizId) continue;
    if (allowedTypes && !allowedTypes.has(quiz.quizType)) continue;
    return quiz;
  }
  return undefined;
}

function makeUniqueQuizId(state: SessionState, proposedId: unknown): string {
  const existingIds = new Set(state.quizzes.map((quiz) => quiz.id));
  let quizId = typeof proposedId === "string" ? proposedId.trim() : "";
  if (!quizId || existingIds.has(quizId)) {
    do {
      quizId = makeId("quiz");
    } while (existingIds.has(quizId));
  }
  return quizId;
}

const GENERIC_TOOL_FAILURE_MESSAGE =
  "AI 도구 실행 중 문제가 발생했습니다. 현재 요청은 계속 진행되며 잠시 후 다시 시도할 수 있습니다.";

export class ToolDispatcher {
  constructor(
    private readonly explainer: ExplainerAgent,
    private readonly qa: QaAgent,
    private readonly quizAgents: QuizAgents,
    private readonly grader: GraderAgent,
    private readonly repair: MisconceptionRepairAgent
  ) {}

  async dispatch(
    state: SessionState,
    actions: OrchestratorAction[],
    context: DispatchContext,
    options?: {
      onStreamEvent?: (event: StreamProgressEvent) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<{
    state: SessionState;
    newMessages: ChatMessage[];
    ui: {
      openQuizModal: boolean;
      quiz: QuizJson | null;
      disableQuizClose: boolean;
      passScoreRatio: number;
      widgets?: Widget[];
    };
  }> {
    const next = state;
    const newMessages: ChatMessage[] = [];
    const ui = {
      openQuizModal: false,
      quiz: null as QuizJson | null,
      disableQuizClose: false,
      passScoreRatio: appConfig.passScoreRatio,
      widgets: [] as Widget[]
    };

    // Ver3 Phase 1: inline verifier — apply pedagogy policy rules to actions
    // before dispatch. Returns the (possibly patched) action list; mutations
    // are additive where possible (see R4/R5 hintDirective).
    const patchedActions = this.verifyAndPatchPlan(next, actions, context);

    for (const action of patchedActions) {
      try {
        await this.executeTool(next, action.tool, action.args, context, ui, newMessages, options);
      } catch (error) {
        console.warn(
          "[tool_dispatch_error] " +
            JSON.stringify({
              sessionId: next.sessionId,
              lectureId: next.lectureId,
              tool: action.tool,
              message: error instanceof Error ? error.message : "unknown tool error"
            })
        );
        appendAssistantMessage(next, newMessages, ui, {
          agent: "SYSTEM",
          contentMarkdown: `${GENERIC_TOOL_FAILURE_MESSAGE} (${action.tool})`
        });
      }
    }

    return { state: next, newMessages, ui };
  }

  /**
   * Ver3 Phase 1 — inline pedagogy policy verifier.
   *
   * Applies rules R1..R10 in the fixed order
   *   R1 → R7 → R8 → R6 → R9 → R5 → R4 → R2 → R3 → R10
   * R9 must precede R3 so that EXPLAIN_PAGE is injected before the budget trim.
   *
   * All mutations are additive where possible: existing args keys (notably
   * `questionText`) are never overwritten. `hintDirective`/`hintDepth` are
   * added to `ANSWER_QUESTION.args` so downstream Qa agents may consume them
   * in Phase 2 without breaking existing assertions.
   *
   * Drops (trims) only happen in R2 (HOLD_BACK), R3 (budget) and R10 (hard cap).
   *
   * R8 is intentionally a silent "mode-wins" rule with no action mutation —
   * this preserves the Ver2 "repairs misconception" test path where the
   * fallback default policy (ADVANCE) does not match the active intervention
   * stage but the existing flow must continue unchanged.
   */
  private verifyAndPatchPlan(
    state: SessionState,
    actions: OrchestratorAction[],
    context: DispatchContext
  ): OrchestratorAction[] {
    const verifierWarnings: string[] = [];
    let policy: PedagogyPolicy | undefined = context.pedagogyPolicy;
    let patched: OrchestratorAction[] = [...actions];

    // R1 — Missing policy (safety net; normalizePlan should cover this first).
    if (!policy) {
      policy = {
        mode: "ADVANCE",
        reason: "R1 default",
        allowDirectAnswer: true,
        hintDepth: "LOW",
        interventionBudget: 1
      };
      verifierWarnings.push("policy_missing");
    }

    const stage = state.activeIntervention?.stage;
    const interventionPage = state.activeIntervention?.page ?? state.currentPage;

    // R7 — DIAGNOSE → MISCONCEPTION_REPAIR upgrade when student already replied.
    if (policy.mode === "DIAGNOSE" && stage === "AWAITING_DIAGNOSIS_REPLY") {
      policy = { ...policy, mode: "MISCONCEPTION_REPAIR" };
      verifierWarnings.push("diagnose_upgraded_to_repair");
    }

    // R8 — Stage/mode mismatch. Mode-wins: do not mutate actions. This path
    // preserves the Ver2 "repairs misconception" test where the fallback
    // default policy is ADVANCE but the session still has an awaiting stage.
    if (
      stage === "AWAITING_DIAGNOSIS_REPLY" &&
      policy.mode !== "MISCONCEPTION_REPAIR" &&
      policy.mode !== "DIAGNOSE"
    ) {
      verifierWarnings.push("stage_mode_mismatch");
    }

    // R6 — Auto-inject REPAIR_MISCONCEPTION when mode says repair but action is missing.
    if (
      policy.mode === "MISCONCEPTION_REPAIR" &&
      stage === "AWAITING_DIAGNOSIS_REPLY" &&
      !patched.some(
        (a) => a.type === "CALL_TOOL" && a.tool === "REPAIR_MISCONCEPTION"
      )
    ) {
      const replyText =
        typeof context.eventPayload?.text === "string"
          ? (context.eventPayload.text as string)
          : "";
      if (replyText.trim()) {
        patched = [
          {
            type: "CALL_TOOL",
            tool: "REPAIR_MISCONCEPTION",
            args: {
              page: interventionPage,
              studentReply: replyText
            }
          },
          ...patched
        ];
        verifierWarnings.push("repair_injected");
      } else {
        verifierWarnings.push("repair_injection_skipped_no_reply");
      }
    }

    // R9 — EXPLAIN_FIRST navigation safety: prepend EXPLAIN_PAGE before any quiz.
    if (
      policy.mode === "EXPLAIN_FIRST" &&
      patched.some(
        (a) => a.type === "CALL_TOOL" && a.tool.startsWith("GENERATE_QUIZ_")
      ) &&
      !patched.some((a) => a.type === "CALL_TOOL" && a.tool === "EXPLAIN_PAGE")
    ) {
      patched = [
        {
          type: "CALL_TOOL",
          tool: "EXPLAIN_PAGE",
          args: {
            page: state.currentPage,
            detailLevel: "NORMAL"
          }
        },
        ...patched
      ];
      verifierWarnings.push("explain_prepended");
    }

    // R5 — MINIMAL_HINT: additive hint directive on every ANSWER_QUESTION.
    if (policy.mode === "MINIMAL_HINT") {
      let anyTouched = false;
      patched = patched.map((a) => {
        if (a.type !== "CALL_TOOL" || a.tool !== "ANSWER_QUESTION") return a;
        anyTouched = true;
        return {
          ...a,
          args: {
            ...a.args,
            hintDirective: "HINT_ONLY",
            hintDepth: "LOW"
          }
        };
      });
      if (anyTouched) verifierWarnings.push("minimal_hint_enforced");
    }

    // R4 — Direct answer block: additive hint directive. `questionText` is
    // intentionally untouched to preserve toolDispatcher.test.ts assertions.
    if (policy.allowDirectAnswer === false) {
      let anyTouched = false;
      const directiveDepth = policy.hintDepth;
      patched = patched.map((a) => {
        if (a.type !== "CALL_TOOL" || a.tool !== "ANSWER_QUESTION") return a;
        anyTouched = true;
        return {
          ...a,
          args: {
            ...a.args,
            hintDirective: "HINT_ONLY",
            hintDepth: directiveDepth
          }
        };
      });
      if (anyTouched) verifierWarnings.push("hint_directive_attached");
    }

    // R2 — HOLD_BACK: keep only a single ORCHESTRATOR message. If the plan
    // is empty or has no orchestrator message, synthesize a canned one.
    if (policy.mode === "HOLD_BACK") {
      const firstMsg = patched.find(
        (a) =>
          a.type === "CALL_TOOL" && a.tool === "APPEND_ORCHESTRATOR_MESSAGE"
      );
      if (firstMsg) {
        if (patched.length > 1) {
          patched = [firstMsg];
          verifierWarnings.push("hold_back_trimmed");
        }
      } else {
        patched = [
          {
            type: "CALL_TOOL",
            tool: "APPEND_ORCHESTRATOR_MESSAGE",
            args: {
              contentMarkdown:
                "좋습니다. 잠시 스스로 생각해 볼 시간을 드릴게요. 막히면 언제든 말씀해 주세요."
            }
          }
        ];
        verifierWarnings.push("hold_back_filled");
      }
    }

    // R3 — interventionBudget: trim intervention tools from the end.
    // NOTE: default budget from R1 is 1 (not 0) so existing tests dispatching
    // [EXPLAIN_PAGE, APPEND_ORCHESTRATOR_MESSAGE] (1 intervention tool) are
    // preserved without mutation.
    {
      let interventionCount = 0;
      for (const a of patched) {
        if (a.type === "CALL_TOOL" && INTERVENTION_TOOLS.has(a.tool)) {
          interventionCount += 1;
        }
      }
      if (interventionCount > policy.interventionBudget) {
        let overflow = interventionCount - policy.interventionBudget;
        const kept: OrchestratorAction[] = [];
        for (let i = patched.length - 1; i >= 0; i -= 1) {
          const a = patched[i];
          if (
            overflow > 0 &&
            a.type === "CALL_TOOL" &&
            INTERVENTION_TOOLS.has(a.tool)
          ) {
            overflow -= 1;
            continue;
          }
          kept.push(a);
        }
        patched = kept.reverse();
        verifierWarnings.push("budget_trimmed");
      }
    }

    // R10 — Hard cap on total tool count.
    if (patched.length > VERIFIER_HARD_CAP) {
      patched = patched.slice(0, VERIFIER_HARD_CAP);
      verifierWarnings.push("hard_cap_applied");
    }

    // Observability sink — stable `[verifier]` prefix for grep/incident review.
    if (verifierWarnings.length > 0) {
      console.log(
        "[verifier] " +
          JSON.stringify({
            sessionId: state.sessionId,
            mode: policy.mode,
            reason: policy.reason,
            warnings: verifierWarnings,
            tools: patched.map((a) => (a.type === "CALL_TOOL" ? a.tool : a.type))
          })
      );
    }

    return patched;
  }

  private async getPageContext(
    context: DispatchContext,
    state: SessionState,
    page: number
  ): Promise<PageContextBundle> {
    if (page === context.basePage) {
      return context.pageContext;
    }
    return context.resolvePageContext(page, state);
  }

  private applySubjectiveGradingResult(
    state: SessionState,
    quizRecord: QuizRecord,
    answers: Record<string, unknown>,
    grading: GradingResult,
    thoughtSummary: string | undefined,
    ui: {
      openQuizModal: boolean;
      quiz: QuizJson | null;
      disableQuizClose: boolean;
      passScoreRatio: number;
      widgets?: Widget[];
    },
    newMessages: ChatMessage[]
  ): void {
    const gradingPageState = ensurePageState(state, quizRecord.createdFromPage);
    quizRecord.userAnswers = answers;
    quizRecord.grading = {
      status: "GRADED",
      score: grading.totalScore,
      maxScore: grading.maxScore,
      scoreRatio: grading.maxScore ? grading.totalScore / grading.maxScore : 0,
      items: grading.items,
      summaryMarkdown: grading.summaryMarkdown
    };

    gradingPageState.status = "QUIZ_GRADED";
    gradingPageState.quiz = {
      lastQuizId: quizRecord.id,
      bestScoreRatio: Math.max(
        quizRecord.grading.scoreRatio,
        gradingPageState.quiz?.bestScoreRatio ?? 0
      )
    };

    const gradeMsg = appendMessage(state, {
      role: "assistant",
      agent: "GRADER",
      contentMarkdown: `채점 완료: **${grading.totalScore}/${grading.maxScore}**\n\n${grading.summaryMarkdown}`,
      thoughtSummaryMarkdown: thoughtSummary || undefined
    });
    newMessages.push(gradeMsg);

    try {
      const assessment = buildQuizAssessment({
        quiz: quizRecord,
        grading: quizRecord.grading,
        recentQuizzes: state.quizzes,
        passScoreRatio: appConfig.passScoreRatio,
        integratedMemory: state.integratedMemory,
        activeIntervention: state.activeIntervention
      });
      upsertQuizAssessment(state, assessment);
      console.log(
        "[assessment] " +
          JSON.stringify(
            buildAssessmentLogPayload({
              state,
              assessment,
              repairTriggered: quizRecord.grading.scoreRatio < appConfig.passScoreRatio
            })
          )
      );
    } catch (error) {
      console.warn(
        "[assessment_error] " +
          JSON.stringify({
            sessionId: state.sessionId,
            lectureId: state.lectureId,
            quizId: quizRecord.id,
            message: error instanceof Error ? error.message : "unknown assessment error"
          })
      );
    }

    if (quizRecord.grading.scoreRatio < appConfig.passScoreRatio) {
      const intervention = createQuizRepairIntervention(
        quizRecord,
        state.integratedMemory,
        nowIso(),
        state.quizzes
      );
      if (intervention) {
        state.activeIntervention = intervention;
        gradingPageState.status = "REVIEW_IN_PROGRESS";
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: intervention.diagnosticPrompt
        });
      } else {
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: "점수가 기준 미달입니다. 복습을 진행할까요?",
          widget: {
            type: "BINARY_CHOICE",
            decisionType: "REVIEW_DECISION"
          }
        });
      }
    } else {
      state.activeIntervention = null;
    }

    ui.disableQuizClose = false;
  }

  private executeAutoGradeMcqOx(
    state: SessionState,
    args: Record<string, unknown>,
    ui: {
      openQuizModal: boolean;
      quiz: QuizJson | null;
      disableQuizClose: boolean;
      passScoreRatio: number;
      widgets?: Widget[];
    },
    newMessages: ChatMessage[]
  ): void {
    const quizId = String(args.quizId ?? "");
    const answers = (args.userAnswers ?? {}) as Record<string, unknown>;
    const quizRecord = findLatestQuizRecord(state, quizId);
    if (!quizRecord) return;
    if (quizRecord.quizType !== "MCQ" && quizRecord.quizType !== "OX") {
      appendAssistantMessage(state, newMessages, ui, {
        agent: "SYSTEM",
        contentMarkdown: "자동 채점은 객관식/OX 퀴즈에만 사용할 수 있습니다."
      });
      return;
    }
    const quizPageState = ensurePageState(state, quizRecord.createdFromPage);

    const items = quizRecord.quizJson.questions.map((q) => {
      const check = isQuizAnswerCorrect(quizRecord.quizJson, q.id, answers[q.id]);
      return {
        questionId: q.id,
        score: check.correct ? check.maxScore : 0,
        maxScore: check.maxScore,
        verdict: check.correct ? "CORRECT" : "WRONG",
        feedbackMarkdown: check.feedback
      } as const;
    });

    const totalScore = items.reduce((sum, item) => sum + item.score, 0);
    const maxScore = items.reduce((sum, item) => sum + item.maxScore, 0);
    const ratio = maxScore > 0 ? totalScore / maxScore : 0;

    quizRecord.userAnswers = answers;
    quizRecord.grading = {
      status: "GRADED",
      score: totalScore,
      maxScore,
      scoreRatio: ratio,
      items: [...items],
      summaryMarkdown: `총점 ${totalScore}/${maxScore}`
    };

    quizPageState.status = "QUIZ_GRADED";
    quizPageState.quiz = {
      lastQuizId: quizId,
      bestScoreRatio: Math.max(ratio, quizPageState.quiz?.bestScoreRatio ?? 0)
    };

    const gradeMsg = appendMessage(state, {
      role: "assistant",
      agent: "GRADER",
      contentMarkdown: `채점 완료: **${totalScore}/${maxScore}**`
    });
    newMessages.push(gradeMsg);

    try {
      const assessment = buildQuizAssessment({
        quiz: quizRecord,
        grading: quizRecord.grading,
        recentQuizzes: state.quizzes,
        passScoreRatio: appConfig.passScoreRatio,
        integratedMemory: state.integratedMemory,
        activeIntervention: state.activeIntervention
      });
      upsertQuizAssessment(state, assessment);
      console.log(
        "[assessment] " +
          JSON.stringify(
            buildAssessmentLogPayload({
              state,
              assessment,
              repairTriggered: ratio < appConfig.passScoreRatio
            })
          )
      );
    } catch (error) {
      console.warn(
        "[assessment_error] " +
          JSON.stringify({
            sessionId: state.sessionId,
            lectureId: state.lectureId,
            quizId,
            message: error instanceof Error ? error.message : "unknown assessment error"
          })
      );
    }

    if (ratio < appConfig.passScoreRatio) {
      const intervention = createQuizRepairIntervention(
        quizRecord,
        state.integratedMemory,
        nowIso(),
        state.quizzes
      );
      if (intervention) {
        state.activeIntervention = intervention;
        quizPageState.status = "REVIEW_IN_PROGRESS";
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: intervention.diagnosticPrompt
        });
      } else {
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: "점수가 기준 미달입니다. 복습을 진행할까요?",
          widget: {
            type: "BINARY_CHOICE",
            decisionType: "REVIEW_DECISION"
          }
        });
      }
    } else {
      state.activeIntervention = null;
    }

    ui.disableQuizClose = false;
  }

  private async executeTool(
    state: SessionState,
    tool: string,
    args: Record<string, unknown>,
    context: DispatchContext,
    ui: {
      openQuizModal: boolean;
      quiz: QuizJson | null;
      disableQuizClose: boolean;
      passScoreRatio: number;
      widgets?: Widget[];
    },
    newMessages: ChatMessage[],
    options?: {
      onStreamEvent?: (event: StreamProgressEvent) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<void> {
    const rawPage = Number(args.page ?? state.currentPage);
    const maxPage = Math.max(1, context.lecture.pdf.numPages || 1);
    const page = Math.max(
      1,
      Math.min(
        maxPage,
        Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : state.currentPage
      )
    );
    const pageState = ensurePageState(state, page);
    const fileRef = context.lecture.pdf.geminiFile;
    const learnerMemoryDigest = buildIntegratedMemoryDigest(state);
    const targetDifficulty = state.integratedMemory?.targetDifficulty ?? "BALANCED";

    switch (tool) {
      case "APPEND_ORCHESTRATOR_MESSAGE": {
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: String(args.contentMarkdown ?? "")
        });
        return;
      }

      case "APPEND_SYSTEM_MESSAGE": {
        appendAssistantMessage(state, newMessages, ui, {
          agent: "SYSTEM",
          contentMarkdown: String(args.contentMarkdown ?? "")
        });
        return;
      }

      case "PROMPT_BINARY_DECISION": {
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: String(args.contentMarkdown ?? ""),
          widget: {
            type: "BINARY_CHOICE",
            decisionType: String(args.decisionType ?? "NEXT_PAGE_DECISION") as Widget["decisionType"]
          }
        });
        return;
      }

      case "OPEN_QUIZ_TYPE_PICKER": {
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: String(args.contentMarkdown ?? "퀴즈 유형을 선택해 주세요."),
          widget: {
            type: "QUIZ_TYPE_PICKER",
            options: [
              { id: "MCQ", label: "객관식" },
              { id: "OX", label: "OX" },
              { id: "SHORT", label: "단답형" },
              { id: "ESSAY", label: "서술형" }
            ],
            recommendedId: String(args.recommendedId ?? "") || undefined,
            badgeText: "추천됨"
          }
        });
        return;
      }

      case "SET_CURRENT_PAGE": {
        const previousPage = state.currentPage;
        const targetPage = Math.max(
          1,
          Math.min(context.lecture.pdf.numPages || 1, Number(args.page ?? state.currentPage))
        );
        state.currentPage = targetPage;
        if (targetPage !== previousPage) {
          resetQaThread(state);
        }
        const targetPageState = ensurePageState(state, targetPage);
        targetPageState.lastTouchedAt = nowIso();
        if (targetPageState.status === "NEW") {
          targetPageState.status = "EXPLAINING";
        }
        const contentMarkdown = String(args.contentMarkdown ?? "").trim();
        if (contentMarkdown) {
          appendAssistantMessage(state, newMessages, ui, {
            agent: "ORCHESTRATOR",
            contentMarkdown
          });
        }
        return;
      }

      case "WRITE_FEEDBACK_ENTRY": {
        const hint = String(args.notesHint ?? "학습 진행");
        const item: FeedbackEntry = {
          id: makeId("fb"),
          createdAt: nowIso(),
          page,
          progressText: progressText(state.currentPage),
          learnerLevel: state.learnerModel.level,
          notesMarkdown: `- ${hint}`
        };
        state.feedback.push(item);
        return;
      }
    }

    if (tool === "AUTO_GRADE_MCQ_OX") {
      this.executeAutoGradeMcqOx(state, args, ui, newMessages);
      return;
    }

    if (!fileRef) {
      appendAssistantMessage(state, newMessages, ui, {
        agent: "SYSTEM",
        contentMarkdown:
          "Gemini PDF 파일 연결이 없어 AI 에이전트 작업을 실행할 수 없습니다. 자료를 다시 업로드하거나 API 키와 AI bridge 설정을 확인해 주세요."
      });
      return;
    }

    const toolContext = await this.getPageContext(context, state, page);

    switch (tool) {
      case "EXPLAIN_PAGE": {
        resetQaThread(state);
        const detailLevel =
          String(args.detailLevel ?? "NORMAL").toUpperCase() === "DETAILED"
            ? "DETAILED"
            : "NORMAL";
        const explanation = await this.explainer.runStream(
          {
            fileRef,
            page,
            pageText: toolContext.pageText,
            neighborText: {
              prev: toolContext.prev,
              next: toolContext.next
            },
            detailLevel,
            learnerLevel: state.learnerModel.level,
            learnerMemoryDigest
          },
          (delta) =>
            options?.onStreamEvent?.({
              type: "agent_delta",
              tool,
              agent: "EXPLAINER",
              channel: delta.channel,
              text: delta.text
            }),
          options?.abortSignal
        );
        const markdown = explanation.markdown;
        pageState.status = "EXPLAINED";
        pageState.explainSummary = markdown.slice(0, 300);
        pageState.explainMarkdown = markdown.slice(0, 12000);
        pageState.lastTouchedAt = nowIso();
        const msg = appendMessage(state, {
          role: "assistant",
          agent: "EXPLAINER",
          contentMarkdown: markdown,
          thoughtSummaryMarkdown: explanation.thoughtSummary || undefined
        });
        newMessages.push(msg);
        break;
      }

      case "ANSWER_QUESTION": {
        const question = String(args.questionText ?? context.eventPayload?.text ?? "");
        const threadMode =
          String(args.threadMode ?? "").toUpperCase() === "FOLLOW_UP" ||
          (String(args.threadMode ?? "").trim() === "" && hasActiveQaThreadForPage(state, page))
            ? "FOLLOW_UP"
            : "START_NEW";
        const qaThreadDigest =
          threadMode === "FOLLOW_UP" ? buildQaThreadDigest(state, page) : "";
        const answer = await this.qa.runStream(
          {
            fileRef,
            page,
            question,
            learnerLevel: state.learnerModel.level,
            pageText: toolContext.pageText,
            neighborText: {
              prev: toolContext.prev,
              next: toolContext.next
            },
            learnerMemoryDigest,
            qaThreadDigest
          },
          (delta) =>
            options?.onStreamEvent?.({
              type: "agent_delta",
              tool,
              agent: "QA",
              channel: delta.channel,
              text: delta.text
            }),
          options?.abortSignal
        );
        const msg = appendMessage(state, {
          role: "assistant",
          agent: "QA",
          contentMarkdown: answer.markdown,
          thoughtSummaryMarkdown: answer.thoughtSummary || undefined
        });
        newMessages.push(msg);
        appendQaThreadTurn(state, {
          page,
          question,
          answerMarkdown: answer.markdown,
          threadMode: threadMode as QaThreadMode
        });
        break;
      }

      case "REPAIR_MISCONCEPTION": {
        const intervention = state.activeIntervention;
        const studentReply = String(args.studentReply ?? context.eventPayload?.text ?? "").trim();
        if (!intervention || intervention.stage !== "AWAITING_DIAGNOSIS_REPLY" || !studentReply) {
          appendAssistantMessage(state, newMessages, ui, {
            agent: "SYSTEM",
            contentMarkdown: "진단 답변을 교정 흐름에 연결하지 못했습니다. 다시 시도해 주세요."
          });
          break;
        }

        const repairQuestion = buildRepairQuestion(intervention, studentReply);
        const repaired = await this.repair.runStream(
          {
            fileRef,
            page,
            learnerLevel: state.learnerModel.level,
            pageText: toolContext.pageText,
            neighborText: {
              prev: toolContext.prev,
              next: toolContext.next
            },
            learnerMemoryDigest,
            repairQuestion
          },
          (delta) =>
            options?.onStreamEvent?.({
              type: "agent_delta",
              tool,
              agent: "EXPLAINER",
              channel: delta.channel,
              text: delta.text
            }),
          options?.abortSignal
        );

        const repairMsg = appendMessage(state, {
          role: "assistant",
          agent: "EXPLAINER",
          contentMarkdown: repaired.markdown,
          thoughtSummaryMarkdown: repaired.thoughtSummary || undefined
        });
        newMessages.push(repairMsg);

        applyLearnerMemoryWrite(state, buildRepairMemoryWrite(intervention, studentReply));
        state.activeIntervention = {
          ...intervention,
          stage: "REPAIR_DELIVERED",
          lastUpdatedAt: nowIso()
        };
        pageState.status = "REVIEW_DONE";
        pageState.lastTouchedAt = nowIso();
        state.feedback.push({
          id: makeId("fb"),
          createdAt: nowIso(),
          page,
          progressText: progressText(state.currentPage),
          learnerLevel: state.learnerModel.level,
          notesMarkdown: `- 오답 교정 완료: ${intervention.focusConcepts.join(", ") || "현재 개념"}`
        });
        appendAssistantMessage(state, newMessages, ui, {
          agent: "ORCHESTRATOR",
          contentMarkdown: "방금 헷갈린 부분만 짧게 교정했습니다. 같은 개념을 빠르게 다시 확인해볼까요?",
          widget: {
            type: "BINARY_CHOICE",
            decisionType: "RETEST_DECISION"
          }
        });
        break;
      }

      case "GENERATE_QUIZ_MCQ":
      case "GENERATE_QUIZ_OX":
      case "GENERATE_QUIZ_SHORT":
      case "GENERATE_QUIZ_ESSAY": {
        const quizType = tool.replace("GENERATE_QUIZ_", "") as QuizType;
        const generated = await this.quizAgents.runStream(
          {
            fileRef,
            page,
            pageText: toolContext.quizText || toolContext.pageText,
            quizType,
            coverageStartPage: 1,
            coverageEndPage: page,
            learnerLevel: state.learnerModel.level,
            learnerMemoryDigest,
            targetDifficulty
          },
          (delta) => {
            if (delta.channel !== "thought") {
              return;
            }
            options?.onStreamEvent?.({
              type: "agent_delta",
              tool,
              agent: "QUIZ",
              channel: delta.channel,
              text: delta.text
            });
          },
          options?.abortSignal
        );
        const quizId = makeUniqueQuizId(state, generated.quiz.quizId);
        const quiz =
          quizId === generated.quiz.quizId
            ? generated.quiz
            : {
                ...generated.quiz,
                quizId
              };
        const record: QuizRecord = {
          id: quiz.quizId,
          quizType,
          createdFromPage: page,
          createdAt: nowIso(),
          quizJson: quiz
        };
        state.quizzes.push(record);
        pageState.status = "QUIZ_IN_PROGRESS";
        pageState.quiz = {
          lastQuizId: quiz.quizId,
          bestScoreRatio: pageState.quiz?.bestScoreRatio ?? 0
        };
        ui.openQuizModal = true;
        ui.quiz = quiz;
        ui.disableQuizClose = true;
        const msg = appendMessage(state, {
          role: "assistant",
          agent: "QUIZ",
          contentMarkdown: `${page}페이지 퀴즈가 생성되었습니다. 퀴즈 모달에서 응시해 주세요.`,
          thoughtSummaryMarkdown: generated.thoughtSummary || undefined
        });
        newMessages.push(msg);
        break;
      }

      case "GRADE_SHORT_OR_ESSAY": {
        const quizId = String(args.quizId ?? "");
        const answers = (args.userAnswers ?? {}) as Record<string, unknown>;
        const quizRecord = findLatestQuizRecord(state, quizId, new Set(["SHORT", "ESSAY"]));
        if (!quizRecord) break;
        const gradingPage = Math.max(
          1,
          Math.min(context.lecture.pdf.numPages || 1, quizRecord.createdFromPage)
        );

        const graded = await this.grader.gradeStream(
          {
            fileRef,
            page: gradingPage,
            quiz: quizRecord.quizJson,
            answers,
            learnerMemoryDigest
          },
          (delta) =>
            options?.onStreamEvent?.({
              type: "agent_delta",
              tool,
              agent: "GRADER",
              channel: delta.channel,
              text: delta.text
            }),
          options?.abortSignal
        );
        const grading: GradingResult = graded.grading;
        this.applySubjectiveGradingResult(
          state,
          quizRecord,
          answers,
          grading,
          graded.thoughtSummary,
          ui,
          newMessages
        );
        break;
      }

      default:
        break;
    }
  }
}
