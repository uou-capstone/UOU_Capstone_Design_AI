import { describe, expect, it } from "vitest";
import { Orchestrator } from "../services/agents/Orchestrator.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { AppEvent, SessionState } from "../types/domain.js";

function makeSession(currentPage = 1): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_1",
    lectureId: "lec_1",
    currentPage,
    pageStates: [{ page: currentPage, status: "EXPLAINING", lastTouchedAt: new Date().toISOString() }],
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

function run(event: AppEvent, currentPage: number, lectureNumPages: number) {
  const orchestrator = new Orchestrator();
  return orchestrator.run({
    schemaVersion: "1.0",
    event,
    session: makeSession(currentPage),
    lectureNumPages,
    pageText: "핵심 정의 정리 공식",
    neighborText: { prev: "", next: "" },
    policy: {
      passScoreRatio: 0.7,
      recentMessagesN: 12
    }
  });
}

describe("Orchestrator flow", () => {
  it("builds SESSION_ENTERED greeting -> start explanation decision flow", () => {
    const plan = run({ type: "SESSION_ENTERED" }, 1, 10);
    expect(plan.actions.length).toBe(1);
    expect(plan.actions[0].type).toBe("CALL_TOOL");
    expect(plan.actions[0]).toMatchObject({
      type: "CALL_TOOL",
      tool: "PROMPT_BINARY_DECISION",
      args: {
        decisionType: "START_EXPLANATION_DECISION"
      }
    });
  });

  it("starts explanation when START_EXPLANATION_DECISION is accepted", () => {
    const plan = run(
      {
        type: "START_EXPLANATION_DECISION",
        payload: { accept: true }
      },
      1,
      10
    );

    expect(plan.actions.some((action) => action.type === "CALL_TOOL" && action.tool === "EXPLAIN_PAGE")).toBe(true);
    expect(
      plan.actions.some(
        (action) =>
          action.type === "CALL_TOOL" &&
          action.tool === "PROMPT_BINARY_DECISION" &&
          action.args.decisionType === "QUIZ_DECISION"
      )
    ).toBe(true);
    expect(plan.actions.at(0)).toMatchObject({
      type: "CALL_TOOL",
      tool: "APPEND_ORCHESTRATOR_MESSAGE",
      args: {
        contentMarkdown: "1페이지 설명을 시작합니다."
      }
    });
  });

  it("asks NEXT_PAGE_DECISION when quiz is skipped", () => {
    const plan = run(
      {
        type: "QUIZ_DECISION",
        payload: { accept: false }
      },
      1,
      10
    );

    expect(plan.actions[0]).toMatchObject({
      type: "CALL_TOOL",
      tool: "PROMPT_BINARY_DECISION",
      args: {
        decisionType: "NEXT_PAGE_DECISION"
      }
    });
  });

  it("explains moved page when NEXT_PAGE_DECISION is accepted", () => {
    const plan = run(
      {
        type: "NEXT_PAGE_DECISION",
        payload: { accept: true, fromPage: 1 }
      },
      2,
      10
    );

    expect(plan.actions.some((action) => action.type === "CALL_TOOL" && action.tool === "EXPLAIN_PAGE")).toBe(true);
    expect(
      plan.actions.some(
        (action) =>
          action.type === "CALL_TOOL" &&
          action.tool === "PROMPT_BINARY_DECISION" &&
          action.args.decisionType === "QUIZ_DECISION"
      )
    ).toBe(true);
    expect(plan.actions[0]).toMatchObject({
      type: "CALL_TOOL",
      tool: "APPEND_ORCHESTRATOR_MESSAGE",
      args: {
        contentMarkdown: "2페이지로 이동했습니다. 설명을 이어가겠습니다."
      }
    });
  });

  it("stops at last page when NEXT_PAGE_DECISION is accepted", () => {
    const plan = run(
      {
        type: "NEXT_PAGE_DECISION",
        payload: { accept: true, fromPage: 3 }
      },
      3,
      3
    );

    expect(plan.actions.some((action) => action.type === "CALL_TOOL" && action.tool === "EXPLAIN_PAGE")).toBe(false);
  });

  it("routes free-form user questions to QA agent instead of explainer", () => {
    const plan = run(
      {
        type: "USER_MESSAGE",
        payload: { text: "이 개념을 쉽게 설명해줘. 왜 이렇게 되는지 궁금해?" }
      },
      2,
      10
    );

    expect(plan.actions.some((action) => action.type === "CALL_TOOL" && action.tool === "ANSWER_QUESTION")).toBe(true);
    expect(plan.actions.some((action) => action.type === "CALL_TOOL" && action.tool === "EXPLAIN_PAGE")).toBe(false);
  });
});
