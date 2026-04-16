import { describe, expect, it } from "vitest";
import { buildProtectedSessionSaveState } from "../routes/session.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";
import { SessionState } from "../types/domain.js";

function makeState(): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_save",
    lectureId: "lec_save",
    currentPage: 3,
    pageStates: [{ page: 3, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() }],
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
        id: "asm_1",
        quizId: "quiz_1",
        page: 3,
        quizType: "MCQ",
        version: "1.0",
        source: "DETERMINISTIC_V1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scoreRatio: 0.6,
        readiness: "REPAIR_REQUIRED",
        deliveryStatus: "PENDING",
        strengths: [],
        weaknesses: ["개념 보강이 필요함"],
        misconceptions: [],
        behaviorSignals: [],
        memoryHint: {
          strengths: [],
          weaknesses: ["개념 보강이 필요함"],
          misconceptions: [],
          explanationPreferences: [],
          preferredQuizTypes: [],
          nextCoachingGoals: ["오답 이유를 짧게 다시 설명한 뒤 바로 재확인하기"]
        },
        summaryMarkdown: "보완이 필요합니다.",
        evidence: ["WRONG"]
      }
    ],
    activeIntervention: null,
    qaThread: createInitialQaThreadMemory(),
    conversationSummary: "",
    updatedAt: "2026-04-16T00:00:00.000Z"
  };
}

describe("buildProtectedSessionSaveState", () => {
  it("preserves server-owned assessment data and ignores client overrides", () => {
    const base = makeState();
    const next = buildProtectedSessionSaveState(base, {
      currentPage: 99,
      quizAssessments: []
    } as Partial<SessionState>);

    expect(next.currentPage).toBe(base.currentPage);
    expect(next.quizAssessments).toHaveLength(1);
    expect(next.quizAssessments?.[0]?.quizId).toBe("quiz_1");
    expect(next.updatedAt).not.toBe(base.updatedAt);
  });
});
