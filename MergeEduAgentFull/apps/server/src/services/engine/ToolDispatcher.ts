import { appConfig } from "../../config.js";
import {
  ChatMessage,
  FeedbackEntry,
  GradingResult,
  LectureItem,
  QuizJson,
  QuizRecord,
  QuizType,
  SessionState,
  Widget
} from "../../types/domain.js";
import { OrchestratorAction } from "../../types/orchestrator.js";
import { ExplainerAgent } from "../agents/ExplainerAgent.js";
import { GraderAgent } from "../agents/GraderAgent.js";
import { QaAgent } from "../agents/QaAgent.js";
import { QuizAgents } from "../agents/QuizAgents.js";
import {
  buildIntegratedMemoryDigest
} from "./LearnerMemoryService.js";
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
}

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
    const correct = String(userAnswer) === expected;
    return {
      correct,
      maxScore: points,
      feedback: correct ? "정답입니다." : `오답입니다. 정답은 ${expected} 입니다.`
    };
  }

  if (quiz.quizType === "OX") {
    const expected = Boolean((question as { answer: { value: boolean } }).answer.value);
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

export class ToolDispatcher {
  constructor(
    private readonly explainer: ExplainerAgent,
    private readonly qa: QaAgent,
    private readonly quizAgents: QuizAgents,
    private readonly grader: GraderAgent
  ) {}

  async dispatch(
    state: SessionState,
    actions: OrchestratorAction[],
    context: DispatchContext,
    options?: {
      onStreamEvent?: (event: StreamProgressEvent) => void;
    }
  ): Promise<{
    state: SessionState;
    newMessages: ChatMessage[];
    ui: {
      openQuizModal: boolean;
      quiz: QuizJson | null;
      disableQuizClose: boolean;
      widgets?: Widget[];
    };
  }> {
    const next = state;
    const newMessages: ChatMessage[] = [];
    const ui = {
      openQuizModal: false,
      quiz: null as QuizJson | null,
      disableQuizClose: false,
      widgets: [] as Widget[]
    };

    for (const action of actions) {
      try {
        await this.executeTool(next, action.tool, action.args, context, ui, newMessages, options);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "알 수 없는 오류";
        appendAssistantMessage(next, newMessages, ui, {
          agent: "SYSTEM",
          contentMarkdown:
            `AI 도구 실행 실패(${action.tool}). 현재 요청은 계속 진행되며 다시 시도할 수 있습니다.\n\n` +
            `오류: \`${detail}\``
        });
      }
    }

    return { state: next, newMessages, ui };
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

  private async executeTool(
    state: SessionState,
    tool: string,
    args: Record<string, unknown>,
    context: DispatchContext,
    ui: {
      openQuizModal: boolean;
      quiz: QuizJson | null;
      disableQuizClose: boolean;
      widgets?: Widget[];
    },
    newMessages: ChatMessage[],
    options?: {
      onStreamEvent?: (event: StreamProgressEvent) => void;
    }
  ): Promise<void> {
    const page = Number(args.page ?? state.currentPage);
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
        const targetPage = Math.max(
          1,
          Math.min(context.lecture.pdf.numPages || 1, Number(args.page ?? state.currentPage))
        );
        state.currentPage = targetPage;
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
    }

    if (!fileRef) {
      appendAssistantMessage(state, newMessages, ui, {
        agent: "SYSTEM",
        contentMarkdown: "Gemini PDF 파일 참조가 없어 AI 응답을 생성할 수 없습니다."
      });
      return;
    }

    const toolContext = await this.getPageContext(context, state, page);

    switch (tool) {
      case "EXPLAIN_PAGE": {
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
            })
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
            learnerMemoryDigest
          },
          (delta) =>
            options?.onStreamEvent?.({
              type: "agent_delta",
              tool,
              agent: "QA",
              channel: delta.channel,
              text: delta.text
            })
        );
        const msg = appendMessage(state, {
          role: "assistant",
          agent: "QA",
          contentMarkdown: answer.markdown,
          thoughtSummaryMarkdown: answer.thoughtSummary || undefined
        });
        newMessages.push(msg);
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
          (delta) =>
            options?.onStreamEvent?.({
              type: "agent_delta",
              tool,
              agent: "QUIZ",
              channel: delta.channel,
              text: delta.text
            })
        );
        const quiz = generated.quiz;
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

      case "AUTO_GRADE_MCQ_OX": {
        const quizId = String(args.quizId ?? "");
        const answers = (args.userAnswers ?? {}) as Record<string, unknown>;
        const quizRecord = state.quizzes.find((q) => q.id === quizId);
        if (!quizRecord) break;

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

        pageState.status = "QUIZ_GRADED";
        pageState.quiz = {
          lastQuizId: quizId,
          bestScoreRatio: Math.max(ratio, pageState.quiz?.bestScoreRatio ?? 0)
        };

        const gradeMsg = appendMessage(state, {
          role: "assistant",
          agent: "GRADER",
          contentMarkdown: `채점 완료: **${totalScore}/${maxScore}**`
        });
        newMessages.push(gradeMsg);

        if (ratio < appConfig.passScoreRatio) {
          appendAssistantMessage(state, newMessages, ui, {
            agent: "ORCHESTRATOR",
            contentMarkdown: "점수가 기준 미달입니다. 복습을 진행할까요?",
            widget: {
              type: "BINARY_CHOICE",
              decisionType: "REVIEW_DECISION"
            }
          });
        }

        ui.disableQuizClose = false;
        break;
      }

      case "GRADE_SHORT_OR_ESSAY": {
        const quizId = String(args.quizId ?? "");
        const answers = (args.userAnswers ?? {}) as Record<string, unknown>;
        const quizRecord = state.quizzes.find((q) => q.id === quizId);
        if (!quizRecord) break;

        const graded = await this.grader.gradeStream(
          {
            fileRef,
            page,
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
            })
        );
        const grading: GradingResult = graded.grading;

        quizRecord.userAnswers = answers;
        quizRecord.grading = {
          status: "GRADED",
          score: grading.totalScore,
          maxScore: grading.maxScore,
          scoreRatio: grading.maxScore ? grading.totalScore / grading.maxScore : 0,
          items: grading.items,
          summaryMarkdown: grading.summaryMarkdown
        };

        pageState.status = "QUIZ_GRADED";
        pageState.quiz = {
          lastQuizId: quizId,
          bestScoreRatio: Math.max(
            quizRecord.grading.scoreRatio,
            pageState.quiz?.bestScoreRatio ?? 0
          )
        };

        const gradeMsg = appendMessage(state, {
          role: "assistant",
          agent: "GRADER",
          contentMarkdown: `채점 완료: **${grading.totalScore}/${grading.maxScore}**\n\n${grading.summaryMarkdown}`,
          thoughtSummaryMarkdown: graded.thoughtSummary || undefined
        });
        newMessages.push(gradeMsg);

        if (quizRecord.grading.scoreRatio < appConfig.passScoreRatio) {
          appendAssistantMessage(state, newMessages, ui, {
            agent: "ORCHESTRATOR",
            contentMarkdown: "점수가 기준 미달입니다. 복습을 진행할까요?",
            widget: {
              type: "BINARY_CHOICE",
              decisionType: "REVIEW_DECISION"
            }
          });
        }

        ui.disableQuizClose = false;
        break;
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
        break;
      }

      default:
        break;
    }
  }
}
