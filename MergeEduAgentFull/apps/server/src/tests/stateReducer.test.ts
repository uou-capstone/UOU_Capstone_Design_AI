import { describe, expect, it } from "vitest";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { StateReducer } from "../services/engine/StateReducer.js";
import { SessionState } from "../types/domain.js";

const baseState: SessionState = {
  schemaVersion: "1.0",
  sessionId: "ses_1",
  lectureId: "lec_1",
  currentPage: 1,
  pageStates: [{ page: 1, status: "NEW", lastTouchedAt: new Date().toISOString() }],
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

describe("StateReducer", () => {
  const reducer = new StateReducer();

  it("updates current page and page state on PAGE_CHANGED", () => {
    const next = reducer.reduce(baseState, {
      type: "PAGE_CHANGED",
      payload: { page: 3 }
    });
    expect(next.currentPage).toBe(3);
    expect(next.pageStates.find((p) => p.page === 3)?.status).toBe("EXPLAINING");
  });

  it("appends user message on USER_MESSAGE", () => {
    const next = reducer.reduce(baseState, {
      type: "USER_MESSAGE",
      payload: { text: "질문" }
    });
    expect(next.messages.at(-1)?.contentMarkdown).toBe("질문");
  });

  it("moves to next page on NEXT_PAGE_DECISION accept", () => {
    const next = reducer.reduce(baseState, {
      type: "NEXT_PAGE_DECISION",
      payload: { accept: true }
    });
    expect(next.currentPage).toBe(2);
    expect(next.pageStates.find((p) => p.page === 2)?.status).toBe("EXPLAINING");
  });

  it("sets current page to EXPLAINING on START_EXPLANATION_DECISION accept", () => {
    const next = reducer.reduce(baseState, {
      type: "START_EXPLANATION_DECISION",
      payload: { accept: true }
    });
    expect(next.currentPage).toBe(1);
    expect(next.pageStates.find((p) => p.page === 1)?.status).toBe("EXPLAINING");
  });
});
