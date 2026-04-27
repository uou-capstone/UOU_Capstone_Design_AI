import { describe, expect, it } from "vitest";
import {
  OrchestrationEngine,
  sanitizePlanForUserPageIntent
} from "../services/engine/OrchestrationEngine.js";
import { StateReducer } from "../services/engine/StateReducer.js";
import { SummaryService } from "../services/engine/SummaryService.js";
import { Orchestrator } from "../services/agents/Orchestrator.js";
import { ExplainerAgent } from "../services/agents/ExplainerAgent.js";
import { GraderAgent } from "../services/agents/GraderAgent.js";
import { MisconceptionRepairAgent } from "../services/agents/MisconceptionRepairAgent.js";
import { QaAgent } from "../services/agents/QaAgent.js";
import { QuizAgents } from "../services/agents/QuizAgents.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";
import { ToolDispatcher } from "../services/engine/ToolDispatcher.js";
import { FileLock } from "../services/storage/FileLock.js";
import { SessionState } from "../types/domain.js";

function makeSession(): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_engine",
    lectureId: "lec_engine",
    currentPage: 2,
    pageStates: [{ page: 2, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() }],
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
    quizAssessments: [
      {
        id: "asm_pending",
        quizId: "quiz_pending",
        page: 2,
        quizType: "MCQ",
        version: "1.0",
        source: "DETERMINISTIC_V1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scoreRatio: 0.4,
        readiness: "REPAIR_REQUIRED",
        deliveryStatus: "PENDING",
        strengths: [],
        weaknesses: ["역수를 곱하는 이유 설명이 흔들림"],
        misconceptions: ["적용 기준을 다시 점검할 필요가 있음"],
        behaviorSignals: [],
        memoryHint: {
          strengths: [],
          weaknesses: ["역수를 곱하는 이유 설명이 흔들림"],
          misconceptions: ["적용 기준을 다시 점검할 필요가 있음"],
          explanationPreferences: [],
          preferredQuizTypes: [],
          targetDifficulty: "FOUNDATIONAL",
          nextCoachingGoals: ["오답 이유를 짧게 다시 설명한 뒤 바로 재확인하기"]
        },
        summaryMarkdown: "최근 퀴즈 이해도는 40% 수준입니다.",
        evidence: ["WRONG · 역수를 곱하는 이유"]
      }
    ],
    activeIntervention: null,
    qaThread: createInitialQaThreadMemory(),
    conversationSummary: "",
    updatedAt: new Date().toISOString()
  };
}

describe("OrchestrationEngine", () => {
  it("removes LLM page moves when a user message only mentions page navigation as meta context", () => {
    const plan = sanitizePlanForUserPageIntent(
      {
        schemaVersion: "1.0",
        actions: [
          {
            type: "CALL_TOOL",
            tool: "SET_CURRENT_PAGE",
            args: { page: 6, contentMarkdown: "6페이지로 이동합니다." }
          },
          {
            type: "CALL_TOOL",
            tool: "EXPLAIN_PAGE",
            args: { page: 6, detailLevel: "DETAILED" }
          },
          {
            type: "CALL_TOOL",
            tool: "ANSWER_QUESTION",
            args: { questionText: "질문", page: 6, threadMode: "START_NEW" }
          }
        ],
        memoryWrite: null
      } as any,
      {
        type: "USER_MESSAGE",
        payload: {
          text: "현재 페이지를 아주 자세히 설명해줘. 답변 중 내가 다음 페이지를 누를 수도 있어."
        }
      },
      5
    );

    expect(plan.actions.some((action) => action.type === "CALL_TOOL" && action.tool === "SET_CURRENT_PAGE")).toBe(false);
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        tool: "EXPLAIN_PAGE",
        args: expect.objectContaining({ page: 5 })
      })
    );
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        tool: "ANSWER_QUESTION",
        args: expect.objectContaining({ page: 5 })
      })
    );
  });

  it("pins LLM page-scoped actions to the reducer page for direct page commands", () => {
    const plan = sanitizePlanForUserPageIntent(
      {
        schemaVersion: "1.0",
        actions: [
          {
            type: "CALL_TOOL",
            tool: "SET_CURRENT_PAGE",
            args: { page: 7, contentMarkdown: "7페이지로 이동합니다." }
          },
          {
            type: "CALL_TOOL",
            tool: "EXPLAIN_PAGE",
            args: { page: 7 }
          }
        ],
        memoryWrite: null
      } as any,
      {
        type: "USER_MESSAGE",
        payload: { text: "다음 페이지로 넘어가 주세요" }
      },
      6
    );

    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        tool: "SET_CURRENT_PAGE",
        args: expect.objectContaining({ page: 6 })
      })
    );
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        tool: "EXPLAIN_PAGE",
        args: expect.objectContaining({ page: 6 })
      })
    );
  });

  it("consumes pending assessments after next-turn orchestration", async () => {
    const session = makeSession();
    const savedRef: { state: SessionState | null } = { state: null };
    let capturedPrompt = "";

    const store = {
      getSession: async () => session,
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json",
          geminiFile: {
            fileName: "file_1",
            fileUri: "uri_1",
            mimeType: "application/pdf"
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        savedRef.state = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;

    const dispatcher = {
      dispatch: async (state: SessionState) => ({
        state,
        newMessages: [],
        ui: {
          openQuizModal: false,
          quiz: null,
          disableQuizClose: false,
          passScoreRatio: 0.7,
          widgets: []
        }
      })
    } as any;

    const bridge = {
      orchestrateSessionStream: async ({ prompt }: { prompt: string }) => {
        capturedPrompt = prompt;
        return {
          thoughtSummary: "ok",
          plan: {
            schemaVersion: "1.0",
            actions: [],
            memoryWrite: null
          }
        };
      }
    } as any;

    const pdfIngest = {
      readPageContext: async () => ({
        pageText: "분수 나눗셈은 나누는 수의 역수를 곱한다.",
        prev: "",
        next: ""
      }),
      readCumulativeContext: async () => "context"
    } as any;

    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    await engine.handleEvent("ses_engine", {
      event: {
        type: "USER_MESSAGE",
        payload: { text: "이 부분 다시 설명해 주세요." }
      }
    });

    expect(capturedPrompt).toContain("quiz=quiz_pending");
    const persistedSession = savedRef.state;
    if (!persistedSession) {
      throw new Error("expected session to be saved");
    }
    expect(persistedSession.quizAssessments?.[0]?.deliveryStatus).toBe("CONSUMED");
  });

  it("still hands off pending assessments on a subsequent QUIZ_SUBMITTED turn", async () => {
    const session = makeSession();
    let capturedPrompt = "";

    const store = {
      getSession: async () => session,
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json",
          geminiFile: {
            fileName: "file_1",
            fileUri: "uri_1",
            mimeType: "application/pdf"
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async () => {},
      appendQuizResultEntries: async () => {}
    } as any;

    const dispatcher = {
      dispatch: async (state: SessionState) => ({
        state,
        newMessages: [],
        ui: {
          openQuizModal: false,
          quiz: null,
          disableQuizClose: false,
          passScoreRatio: 0.7,
          widgets: []
        }
      })
    } as any;

    const bridge = {
      orchestrateSessionStream: async ({ prompt }: { prompt: string }) => {
        capturedPrompt = prompt;
        return {
          thoughtSummary: "ok",
          plan: {
            schemaVersion: "1.0",
            actions: [],
            memoryWrite: null
          }
        };
      }
    } as any;

    const pdfIngest = {
      readPageContext: async () => ({
        pageText: "분수 나눗셈은 나누는 수의 역수를 곱한다.",
        prev: "",
        next: ""
      }),
      readCumulativeContext: async () => "context"
    } as any;

    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    await engine.handleEvent("ses_engine", {
      event: {
        type: "QUIZ_SUBMITTED",
        payload: { quizId: "quiz_new", userAnswers: { q1: "c1" } }
      }
    });

    expect(capturedPrompt).toContain("quiz=quiz_pending");
  });

  it("uses submitted quiz page when client context points at a stale page", async () => {
    const session = makeSession();
    session.quizAssessments = [];
    session.currentPage = 2;
    session.pageStates = [
      { page: 1, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() },
      { page: 2, status: "QUIZ_IN_PROGRESS", lastTouchedAt: new Date().toISOString() }
    ];
    session.quizzes.push({
      id: "quiz_short_page_2",
      quizType: "SHORT",
      createdFromPage: 2,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_short_page_2",
        quizType: "SHORT",
        page: 2,
        questions: [
          {
            id: "q1",
            promptMarkdown: "2페이지 핵심을 짧게 설명하세요.",
            referenceAnswer: { text: "2페이지 개념" }
          }
        ]
      }
    });
    const savedRef: { state: SessionState | null } = { state: null };
    const readPages: number[] = [];
    let dispatchedCurrentPage = 0;

    const store = {
      getSession: async () => session,
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json",
          geminiFile: {
            fileName: "file_1",
            fileUri: "uri_1",
            mimeType: "application/pdf"
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        savedRef.state = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;

    const dispatcher = {
      dispatch: async (state: SessionState) => {
        dispatchedCurrentPage = state.currentPage;
        return {
          state,
          newMessages: [],
          ui: {
            openQuizModal: false,
            quiz: null,
            disableQuizClose: false,
            passScoreRatio: 0.7,
            widgets: []
          }
        };
      }
    } as any;

    const bridge = {
      orchestrateSessionStream: async () => ({
        thoughtSummary: "ok",
        plan: {
          schemaVersion: "1.0",
          actions: [],
          memoryWrite: null
        }
      })
    } as any;

    const pdfIngest = {
      readPageContext: async (_path: string, page: number) => {
        readPages.push(page);
        return {
          pageText: `page ${page} context`,
          prev: "",
          next: ""
        };
      },
      readCumulativeContext: async () => "context"
    } as any;

    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    await engine.handleEvent("ses_engine", {
      event: {
        type: "QUIZ_SUBMITTED",
        payload: {
          quizId: "quiz_short_page_2",
          quizType: "SHORT",
          answers: { q1: "답변" }
        }
      },
      clientContext: { currentPage: 1 }
    });

    expect(readPages).toEqual([2]);
    expect(dispatchedCurrentPage).toBe(2);
    expect(savedRef.state?.currentPage).toBe(2);
  });

  it("uses deterministic MCQ/OX submit fast path without planner or page context", async () => {
    const session = makeSession();
    session.quizAssessments = [];
    session.quizzes.push({
      id: "quiz_fast",
      quizType: "MCQ",
      createdFromPage: 2,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_fast",
        quizType: "MCQ",
        page: 2,
        questions: [
          {
            id: "q1",
            promptMarkdown: "정답을 고르세요.",
            points: 1,
            choices: [
              { id: "c1", textMarkdown: "정답" },
              { id: "c2", textMarkdown: "오답" }
            ],
            answer: { choiceId: "c1" }
          }
        ]
      }
    });
    const savedRef: { state: SessionState | null } = { state: null };

    const store = {
      getSession: async () => session,
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json"
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        savedRef.state = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;

    const bridge = {
      orchestrateSessionStream: async () => {
        throw new Error("planner should not be called");
      },
      explainPageStream: async () => {
        throw new Error("not used");
      },
      answerQuestionStream: async () => {
        throw new Error("not used");
      },
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const pdfIngest = {
      readPageContext: async () => {
        throw new Error("page context should not be read");
      },
      readCumulativeContext: async () => "context"
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    await engine.handleEvent("ses_engine", {
      event: {
        type: "QUIZ_SUBMITTED",
        payload: {
          quizId: "quiz_fast",
          quizType: "MCQ",
          answers: { q1: "c1" }
        }
      }
    });

    const fastPathState = savedRef.state;
    if (!fastPathState) {
      throw new Error("expected fast path state to be saved");
    }
    expect(fastPathState.quizzes[0]?.grading?.status).toBe("GRADED");
    expect(fastPathState.quizzes[0]?.grading?.scoreRatio).toBe(1);
  });

  it("does not use the deterministic submit fast path when only payload quizType is present", async () => {
    const session = makeSession();
    session.quizAssessments = [];
    session.quizzes = [];
    let readPageContextCalls = 0;
    let plannerCalls = 0;

    const store = {
      getSession: async () => session,
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json",
          geminiFile: {
            fileName: "file_1",
            fileUri: "uri_1",
            mimeType: "application/pdf"
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async () => {},
      appendQuizResultEntries: async () => {}
    } as any;

    const dispatcher = {
      dispatch: async (state: SessionState) => ({
        state,
        newMessages: [],
        ui: {
          openQuizModal: false,
          quiz: null,
          disableQuizClose: false,
          passScoreRatio: 0.7,
          widgets: []
        }
      })
    } as any;

    const bridge = {
      orchestrateSessionStream: async () => {
        plannerCalls += 1;
        return {
          thoughtSummary: "ok",
          plan: {
            schemaVersion: "1.0",
            actions: [],
            memoryWrite: null
          }
        };
      }
    } as any;

    const pdfIngest = {
      readPageContext: async () => {
        readPageContextCalls += 1;
        return {
          pageText: "context",
          prev: "",
          next: ""
        };
      },
      readCumulativeContext: async () => "context"
    } as any;

    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    await engine.handleEvent("ses_engine", {
      event: {
        type: "QUIZ_SUBMITTED",
        payload: {
          quizId: "missing_quiz",
          quizType: "MCQ",
          answers: { q1: "c1" }
        }
      }
    });

    expect(readPageContextCalls).toBe(1);
    expect(plannerCalls).toBe(1);
  });

  it("does not fake explanation through the real engine when Gemini file is missing", async () => {
    const session = makeSession();
    session.quizAssessments = [];
    session.pageStates = [{ page: 2, status: "NEW", lastTouchedAt: new Date().toISOString() }];
    const savedRef: { state: SessionState | null } = { state: null };
    const store = {
      getSession: async () => session,
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json"
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        savedRef.state = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;
    const bridge = {
      orchestrateSessionStream: async () => {
        throw new Error("planner should not be called without fileRef");
      },
      explainPageStream: async () => {
        throw new Error("explainer bridge should not be called without fileRef");
      },
      answerQuestionStream: async () => {
        throw new Error("qa bridge should not be called without fileRef");
      },
      generateQuizStream: async () => {
        throw new Error("quiz bridge should not be called without fileRef");
      },
      gradeQuizStream: async () => {
        throw new Error("grader bridge should not be called without fileRef");
      }
    } as any;
    const pdfIngest = {
      readPageContext: async () => ({
        pageText: "IoT 센서 데이터는 산업 현장 상태를 모니터링하는 데 활용된다.",
        prev: "",
        next: ""
      }),
      readCumulativeContext: async () => "IoT 센서 데이터 누적 문맥"
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    const response = await engine.handleEvent("ses_engine", {
      event: {
        type: "START_EXPLANATION_DECISION",
        payload: { accept: true }
      }
    });

    expect(response.newMessages.some((message) => message.agent === "EXPLAINER")).toBe(false);
    expect(
      response.newMessages.some((message) =>
        message.agent === "SYSTEM" && message.contentMarkdown.includes("Gemini PDF 파일 연결")
      )
    ).toBe(true);
    expect(savedRef.state?.pageStates.find((page) => page.page === 2)?.status).not.toBe("EXPLAINED");
  });

  it("does not fake a quiz through the real engine when Gemini file is missing", async () => {
    const session = makeSession();
    session.quizAssessments = [];
    const savedRef: { state: SessionState | null } = { state: null };
    const store = {
      getSession: async () => session,
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json"
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        savedRef.state = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;
    const bridge = {
      orchestrateSessionStream: async () => {
        throw new Error("planner should not be called without fileRef");
      },
      explainPageStream: async () => {
        throw new Error("explainer bridge should not be called without fileRef");
      },
      answerQuestionStream: async () => {
        throw new Error("qa bridge should not be called without fileRef");
      },
      generateQuizStream: async () => {
        throw new Error("quiz bridge should not be called without fileRef");
      },
      gradeQuizStream: async () => {
        throw new Error("grader bridge should not be called without fileRef");
      }
    } as any;
    const pdfIngest = {
      readPageContext: async () => ({
        pageText: "IoT 센서 데이터는 산업 현장 상태를 모니터링하는 데 활용된다.",
        prev: "",
        next: ""
      }),
      readCumulativeContext: async () => "IoT 센서 데이터는 산업 현장 상태를 모니터링하는 데 활용된다."
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    const response = await engine.handleEvent("ses_engine", {
      event: {
        type: "QUIZ_TYPE_SELECTED",
        payload: { quizType: "MCQ" }
      }
    });

    expect(response.ui.openQuizModal).toBe(false);
    expect(response.ui.quiz).toBeNull();
    expect(response.ui.passScoreRatio).toBe(0.7);
    expect(savedRef.state?.quizzes).toHaveLength(0);
    expect(
      response.newMessages.some((message) =>
        message.agent === "SYSTEM" && message.contentMarkdown.includes("Gemini PDF 파일 연결")
      )
    ).toBe(true);
  });

  it("serializes same-session event processing so persisted updates are not lost", async () => {
    let persisted = makeSession();
    persisted.quizAssessments = [];
    const lock = new FileLock();

    const store = {
      withSessionLock: async <T>(sessionId: string, fn: () => Promise<T>) =>
        lock.withLock(`test:${sessionId}`, fn),
      getSession: async () => structuredClone(persisted),
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json"
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        persisted = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;

    const dispatcher = {
      dispatch: async (state: SessionState) => ({
        state,
        newMessages: [],
        ui: {
          openQuizModal: false,
          quiz: null,
          disableQuizClose: false,
          passScoreRatio: 0.7,
          widgets: []
        }
      })
    } as any;

    const bridge = {
      orchestrateSessionStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const pdfIngest = {
      readPageContext: async () => ({
        pageText: "context",
        prev: "",
        next: ""
      }),
      readCumulativeContext: async () => "context"
    } as any;

    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    await Promise.all([
      engine.handleEvent("ses_engine", {
        event: { type: "USER_MESSAGE", payload: { text: "첫 질문입니다?" } }
      }),
      engine.handleEvent("ses_engine", {
        event: { type: "USER_MESSAGE", payload: { text: "두 번째 질문입니다?" } }
      })
    ]);

    const userMessages = persisted.messages.filter((message) => message.role === "user");
    expect(userMessages.map((message) => message.contentMarkdown).sort()).toEqual([
      "두 번째 질문입니다?",
      "첫 질문입니다?"
    ]);
  });

  it("does not persist a superseded streaming page change", async () => {
    let persisted = makeSession();
    persisted.currentPage = 1;
    persisted.pageStates = [
      { page: 1, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() }
    ];
    persisted.messages = [];
    persisted.quizAssessments = [];
    const lock = new FileLock();
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });

    const store = {
      withSessionLock: async <T>(sessionId: string, fn: () => Promise<T>) =>
        lock.withLock(`test:${sessionId}`, fn),
      getSession: async () => structuredClone(persisted),
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json"
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        persisted = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;

    const dispatcher = {
      dispatch: async (state: SessionState) => {
        if (state.currentPage === 2) {
          markFirstEntered();
          await releaseFirstPromise;
        }
        const msg = {
          id: `msg_page_${state.currentPage}`,
          role: "assistant" as const,
          agent: "EXPLAINER" as const,
          contentMarkdown: `${state.currentPage}페이지 설명`,
          createdAt: new Date().toISOString()
        };
        state.messages.push(msg);
        return {
          state,
          newMessages: [msg],
          ui: {
            openQuizModal: false,
            quiz: null,
            disableQuizClose: false,
            passScoreRatio: 0.7,
            widgets: []
          }
        };
      }
    } as any;

    const bridge = {
      orchestrateSessionStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const pdfIngest = {
      readPageContext: async () => ({
        pageText: "context",
        prev: "",
        next: ""
      }),
      readCumulativeContext: async () => "context"
    } as any;

    const engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    const firstFinals: any[] = [];
    const secondFinals: any[] = [];
    const first = engine.handleEventStream(
      "ses_engine",
      {
        event: { type: "PAGE_CHANGED", payload: { page: 2 } }
      },
      (chunk) => firstFinals.push(chunk)
    );

    await firstEntered;

    const second = engine.handleEventStream(
      "ses_engine",
      {
        event: { type: "PAGE_CHANGED", payload: { page: 3 } }
      },
      (chunk) => secondFinals.push(chunk)
    );

    releaseFirst();
    await Promise.all([first, second]);

    expect(persisted.currentPage).toBe(3);
    expect(persisted.messages.map((message) => message.contentMarkdown)).toEqual([
      "3페이지 설명"
    ]);
    expect(firstFinals.at(-1)?.type).toBe("final");
    expect(firstFinals.at(-1)?.data.newMessages).toEqual([]);
    expect(secondFinals.at(-1)?.data.patch.currentPage).toBe(3);
  });

  it("rolls back a page change superseded during the final save window", async () => {
    let persisted = makeSession();
    persisted.currentPage = 1;
    persisted.pageStates = [
      { page: 1, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() }
    ];
    persisted.messages = [];
    persisted.quizAssessments = [];
    const lock = new FileLock();
    let engine: OrchestrationEngine;
    let second: Promise<void> | null = null;
    const secondFinals: any[] = [];

    const store = {
      withSessionLock: async <T>(sessionId: string, fn: () => Promise<T>) =>
        lock.withLock(`test:${sessionId}`, fn),
      getSession: async () => structuredClone(persisted),
      getLecture: async () => ({
        id: "lec_engine",
        weekId: "wk_engine",
        title: "테스트",
        pdf: {
          path: "/tmp/test.pdf",
          numPages: 5,
          pageIndexPath: "/tmp/test.pageIndex.json"
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      saveSession: async (state: SessionState) => {
        if (state.currentPage === 2 && !second) {
          second = engine.handleEventStream(
            "ses_engine",
            {
              event: { type: "PAGE_CHANGED", payload: { page: 3 } }
            },
            (chunk) => secondFinals.push(chunk)
          );
        }
        persisted = structuredClone(state);
      },
      appendQuizResultEntries: async () => {}
    } as any;

    const dispatcher = {
      dispatch: async (state: SessionState) => {
        const msg = {
          id: `msg_page_${state.currentPage}`,
          role: "assistant" as const,
          agent: "EXPLAINER" as const,
          contentMarkdown: `${state.currentPage}페이지 설명`,
          createdAt: new Date().toISOString()
        };
        state.messages.push(msg);
        return {
          state,
          newMessages: [msg],
          ui: {
            openQuizModal: false,
            quiz: null,
            disableQuizClose: false,
            passScoreRatio: 0.7,
            widgets: []
          }
        };
      }
    } as any;

    const bridge = {
      orchestrateSessionStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const pdfIngest = {
      readPageContext: async () => ({
        pageText: "context",
        prev: "",
        next: ""
      }),
      readCumulativeContext: async () => "context"
    } as any;

    engine = new OrchestrationEngine(
      store,
      new StateReducer(),
      new Orchestrator(),
      dispatcher,
      bridge,
      pdfIngest,
      new SummaryService()
    );

    const firstFinals: any[] = [];
    await engine.handleEventStream(
      "ses_engine",
      {
        event: { type: "PAGE_CHANGED", payload: { page: 2 } }
      },
      (chunk) => firstFinals.push(chunk)
    );
    await second;

    expect(firstFinals.at(-1)?.type).toBe("final");
    expect(firstFinals.at(-1)?.data.newMessages).toEqual([]);
    expect(persisted.currentPage).toBe(3);
    expect(persisted.messages.map((message) => message.contentMarkdown)).toEqual([
      "3페이지 설명"
    ]);
    expect(secondFinals.at(-1)?.data.patch.currentPage).toBe(3);
  });
});
