import { describe, expect, it } from "vitest";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";
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
  qaThread: createInitialQaThreadMemory(),
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
    const next = reducer.reduce(
      {
        ...baseState,
        qaThread: {
          page: 1,
          turns: [
            {
              page: 1,
              question: "첫 질문",
              answerMarkdown: "첫 답변",
              createdAt: new Date().toISOString()
            }
          ],
          lastUpdatedAt: new Date().toISOString()
        }
      },
      {
        type: "NEXT_PAGE_DECISION",
        payload: { accept: true }
      }
    );
    expect(next.currentPage).toBe(2);
    expect(next.pageStates.find((p) => p.page === 2)?.status).toBe("EXPLAINING");
    expect(next.qaThread?.turns).toHaveLength(0);
  });

  it("sets current page to EXPLAINING on START_EXPLANATION_DECISION accept", () => {
    const next = reducer.reduce(baseState, {
      type: "START_EXPLANATION_DECISION",
      payload: { accept: true }
    });
    expect(next.currentPage).toBe(1);
    expect(next.pageStates.find((p) => p.page === 1)?.status).toBe("EXPLAINING");
  });

  it("clears active intervention when moving to another page", () => {
    const next = reducer.reduce(
      {
        ...baseState,
        activeIntervention: {
          mode: "QUIZ_REPAIR",
          page: 1,
          quizId: "quiz_1",
          scoreRatio: 0.2,
          wrongQuestionIds: ["q1"],
          focusConcepts: ["분수 나눗셈"],
          suspectedMisconceptions: ["분수 나눗셈 적용 이유를 혼동함"],
          diagnosticPrompt: "어디가 헷갈렸는지 말해 주세요.",
          stage: "AWAITING_DIAGNOSIS_REPLY",
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString()
        }
      },
      {
        type: "PAGE_CHANGED",
        payload: { page: 2 }
      }
    );

    expect(next.currentPage).toBe(2);
    expect(next.activeIntervention).toBeNull();
  });
});
