import { describe, expect, it } from "vitest";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import {
  getPageCommandIntent,
  isNextPageCommand,
  isPreviousPageCommand
} from "../services/engine/PageCommandIntent.js";
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

  it("classifies only direct page navigation commands as page intent", () => {
    expect(isNextPageCommand("다음 페이지로 넘어가 주세요")).toBe(true);
    expect(isNextPageCommand("next page please")).toBe(true);
    expect(isPreviousPageCommand("이전 페이지 보여줘")).toBe(true);
    expect(isPreviousPageCommand("previous page please")).toBe(true);
    expect(
      getPageCommandIntent(
        "현재 페이지를 아주 자세히 설명해줘. 답변 중 내가 다음 페이지를 누를 수도 있어."
      )
    ).toBeNull();
    expect(isNextPageCommand("다음 페이지를 누르면 어떻게 돼?")).toBe(false);
  });

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

  it("moves one page on direct USER_MESSAGE page commands", () => {
    const next = reducer.reduce(
      {
        ...baseState,
        currentPage: 3,
        pageStates: [
          { page: 2, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() },
          { page: 3, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() }
        ]
      },
      {
        type: "USER_MESSAGE",
        payload: { text: "이전 페이지 보여줘" }
      }
    );
    expect(next.currentPage).toBe(2);

    const nextAgain = reducer.reduce(next, {
      type: "USER_MESSAGE",
      payload: { text: "다음 페이지로 넘어가 주세요" }
    });
    expect(nextAgain.currentPage).toBe(3);
  });

  it("does not move pages when page words are part of a meta explanation request", () => {
    const next = reducer.reduce(
      {
        ...baseState,
        currentPage: 5,
        pageStates: [{ page: 5, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() }]
      },
      {
        type: "USER_MESSAGE",
        payload: {
          text: "현재 페이지를 아주 자세히 설명해줘. 답변 중 내가 다음 페이지를 누를 수도 있어."
        }
      }
    );
    expect(next.currentPage).toBe(5);
    expect(next.messages.at(-1)?.contentMarkdown).toContain("다음 페이지");
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

  it("uses quiz created page for QUIZ_SUBMITTED instead of stale client page", () => {
    const next = reducer.reduce(
      {
        ...baseState,
        currentPage: 2,
        pageStates: [
          { page: 1, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() },
          { page: 2, status: "QUIZ_IN_PROGRESS", lastTouchedAt: new Date().toISOString() }
        ],
        quizzes: [
          {
            id: "quiz_page_2",
            quizType: "SHORT",
            createdFromPage: 2,
            createdAt: new Date().toISOString(),
            quizJson: {
              schemaVersion: "1.0",
              quizId: "quiz_page_2",
              quizType: "SHORT",
              page: 2,
              questions: [
                {
                  id: "q1",
                  promptMarkdown: "2페이지 핵심은 무엇인가요?",
                  referenceAnswer: { text: "2페이지 개념" }
                }
              ]
            }
          }
        ]
      },
      {
        type: "QUIZ_SUBMITTED",
        payload: { quizId: "quiz_page_2", answers: { q1: "답변" } }
      },
      1
    );

    expect(next.currentPage).toBe(2);
    expect(next.pageStates.find((p) => p.page === 2)?.lastTouchedAt).toBeTruthy();
  });

  it("uses the latest type-matched quiz record for duplicate quiz ids on submit", () => {
    const next = reducer.reduce(
      {
        ...baseState,
        currentPage: 1,
        quizzes: [
          {
            id: "quiz_duplicate",
            quizType: "MCQ",
            createdFromPage: 1,
            createdAt: new Date().toISOString(),
            quizJson: {
              schemaVersion: "1.0",
              quizId: "quiz_duplicate",
              quizType: "MCQ",
              page: 1,
              questions: [
                {
                  id: "q_old",
                  promptMarkdown: "예전 문항",
                  choices: [{ id: "c1", textMarkdown: "정답" }],
                  answer: { choiceId: "c1" }
                }
              ]
            }
          },
          {
            id: "quiz_duplicate",
            quizType: "SHORT",
            createdFromPage: 4,
            createdAt: new Date().toISOString(),
            quizJson: {
              schemaVersion: "1.0",
              quizId: "quiz_duplicate",
              quizType: "SHORT",
              page: 4,
              questions: [
                {
                  id: "q_new",
                  promptMarkdown: "최신 문항",
                  referenceAnswer: { text: "최신 답" }
                }
              ]
            }
          }
        ]
      },
      {
        type: "QUIZ_SUBMITTED",
        payload: { quizId: "quiz_duplicate", quizType: "SHORT", answers: { q_new: "답" } }
      },
      1
    );

    expect(next.currentPage).toBe(4);
  });
});
