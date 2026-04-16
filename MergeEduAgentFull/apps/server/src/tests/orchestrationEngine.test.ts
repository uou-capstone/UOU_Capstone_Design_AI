import { describe, expect, it } from "vitest";
import { OrchestrationEngine } from "../services/engine/OrchestrationEngine.js";
import { StateReducer } from "../services/engine/StateReducer.js";
import { SummaryService } from "../services/engine/SummaryService.js";
import { Orchestrator } from "../services/agents/Orchestrator.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";
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
  it("consumes pending assessments after next-turn orchestration", async () => {
    const session = makeSession();
    let savedState: SessionState | null = null;
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
        savedState = structuredClone(state);
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
    expect(savedState).not.toBeNull();
    const persistedSession = savedState!;
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
});
