import { describe, expect, it } from "vitest";
import { Orchestrator } from "../services/agents/Orchestrator.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";
import { SessionState } from "../types/domain.js";
import { preparePendingAssessmentHandoff } from "../services/engine/QuizAssessmentService.js";

function makeSession(): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_prompt",
    lectureId: "lec_prompt",
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
        quizType: "ESSAY",
        version: "1.0",
        source: "DETERMINISTIC_V1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scoreRatio: 0.5,
        readiness: "REPAIR_REQUIRED",
        deliveryStatus: "PENDING",
        strengths: ["설명 구조는 유지함"],
        weaknesses: ["역수를 곱하는 이유 설명이 흔들림"],
        misconceptions: ["적용 기준을 다시 점검할 필요가 있음"],
        behaviorSignals: ["서술형에서는 설명 의지는 있으나 개념 정확도 보강이 필요함"],
        memoryHint: {
          strengths: ["설명 구조는 유지함"],
          weaknesses: ["역수를 곱하는 이유 설명이 흔들림"],
          misconceptions: ["적용 기준을 다시 점검할 필요가 있음"],
          explanationPreferences: ["단계형 설명"],
          preferredQuizTypes: [],
          targetDifficulty: "FOUNDATIONAL",
          nextCoachingGoals: ["오답 이유를 짧게 다시 설명한 뒤 바로 재확인하기"]
        },
        summaryMarkdown: "최근 퀴즈 이해도는 50% 수준입니다. 보완이 필요합니다.",
        evidence: ["WRONG · 역수를 곱하는 이유"]
      },
      {
        id: "asm_old",
        quizId: "quiz_old",
        page: 1,
        quizType: "MCQ",
        version: "1.0",
        source: "DETERMINISTIC_V1",
        createdAt: new Date(Date.now() - 10_000).toISOString(),
        updatedAt: new Date(Date.now() - 10_000).toISOString(),
        scoreRatio: 1,
        readiness: "READY_TO_ADVANCE",
        deliveryStatus: "CONSUMED",
        consumedAt: new Date().toISOString(),
        strengths: ["기초 계산은 안정적임"],
        weaknesses: [],
        misconceptions: [],
        behaviorSignals: [],
        memoryHint: {
          strengths: ["기초 계산은 안정적임"],
          weaknesses: [],
          misconceptions: [],
          explanationPreferences: [],
          preferredQuizTypes: [],
          nextCoachingGoals: ["다음 페이지 개념과 연결하기"]
        },
        summaryMarkdown: "이미 전달된 assessment",
        evidence: []
      }
    ],
    activeIntervention: null,
    qaThread: createInitialQaThreadMemory(),
    conversationSummary: "",
    updatedAt: new Date().toISOString()
  };
}

describe("Orchestrator prompt", () => {
  it("includes only pending assessment digest in prompt", () => {
    const orchestrator = new Orchestrator();
    const session = makeSession();
    const handoff = preparePendingAssessmentHandoff(session);

    const prompt = orchestrator.buildPrompt({
      schemaVersion: "1.0",
      event: {
        type: "USER_MESSAGE",
        payload: { text: "이 부분 다시 설명해 주세요." }
      },
      session,
      lectureNumPages: 10,
      pageText: "분수 나눗셈은 나누는 수의 역수를 곱하는 방식으로 계산한다.",
      neighborText: { prev: "", next: "" },
      policy: {
        passScoreRatio: 0.7,
        recentMessagesN: 12
      },
      assessmentDigest: handoff.digest
    });

    expect(prompt).toContain("최근 pending assessment handoff:");
    expect(prompt).toContain("quiz=quiz_pending");
    expect(prompt).not.toContain("quiz=quiz_old");
    expect(prompt).toContain("assessment digest는 구조화된 관찰 메모");
  });
});
