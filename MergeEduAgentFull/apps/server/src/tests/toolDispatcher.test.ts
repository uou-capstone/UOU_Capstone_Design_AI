import { describe, expect, it } from "vitest";
import { ExplainerAgent } from "../services/agents/ExplainerAgent.js";
import { GraderAgent } from "../services/agents/GraderAgent.js";
import { QaAgent } from "../services/agents/QaAgent.js";
import { QuizAgents } from "../services/agents/QuizAgents.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { ToolDispatcher } from "../services/engine/ToolDispatcher.js";
import { SessionState } from "../types/domain.js";

function makeState(): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_test",
    lectureId: "lec_test",
    currentPage: 1,
    pageStates: [{ page: 1, status: "EXPLAINING", lastTouchedAt: new Date().toISOString() }],
    messages: [],
    quizzes: [],
    feedback: [],
    learnerModel: {
      level: "INTERMEDIATE",
      confidence: 0.5,
      weakConcepts: [],
      strongConcepts: []
    },
    integratedMemory: createInitialIntegratedMemory(),
    conversationSummary: "",
    updatedAt: new Date().toISOString()
  };
}

describe("ToolDispatcher soft failure", () => {
  it("keeps event flow and appends SYSTEM message when tool execution fails", async () => {
    const bridge = {
      explainPage: async () => {
        throw new Error("bridge timeout");
      },
      explainPageStream: async () => {
        throw new Error("bridge timeout");
      },
      answerQuestion: async () => ({ markdown: "ok", content: null }),
      answerQuestionStream: async () => ({ markdown: "ok", thoughtSummary: "", content: null }),
      generateQuiz: async () => {
        throw new Error("not used");
      },
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuiz: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge)
    );

    const state = makeState();

    const result = await dispatcher.dispatch(
      state,
      [
        { type: "CALL_TOOL", tool: "EXPLAIN_PAGE", args: { page: 1 } },
        {
          type: "CALL_TOOL",
          tool: "APPEND_ORCHESTRATOR_MESSAGE",
          args: { contentMarkdown: "다음 단계로 진행합니다." }
        }
      ],
      {
        lecture: {
          id: "lec_test",
          weekId: "wk_test",
          title: "테스트",
          pdf: {
            path: "uploads/lec_test.pdf",
            numPages: 1,
            pageIndexPath: "uploads/lec_test.pageIndex.json",
            geminiFile: {
              fileName: "f",
              fileUri: "u",
              mimeType: "application/pdf"
            }
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        basePage: 1,
        pageContext: {
          pageText: "content",
          prev: "",
          next: ""
        },
        eventPayload: undefined,
        resolvePageContext: async () => ({
          pageText: "content",
          prev: "",
          next: ""
        })
      }
    );

    const systemFailure = result.newMessages.find((msg) => msg.agent === "SYSTEM");
    const orchestratorMsg = result.newMessages.find((msg) => msg.agent === "ORCHESTRATOR");

    expect(systemFailure?.contentMarkdown).toContain("AI 도구 실행 실패(EXPLAIN_PAGE)");
    expect(orchestratorMsg?.contentMarkdown).toBe("다음 단계로 진행합니다.");
  });
});
