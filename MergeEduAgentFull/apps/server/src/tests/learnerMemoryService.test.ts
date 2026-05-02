import { describe, expect, it } from "vitest";
import {
  applyLearnerMemoryWrite,
  buildIntegratedMemoryDigest
} from "../services/engine/LearnerMemoryService.js";
import { SessionState } from "../types/domain.js";

describe("LearnerMemoryService", () => {
  it("normalizes stale memory and missing learner model before applying writes", () => {
    const state = {
      integratedMemory: {
        summaryMarkdown: "",
        strengths: "invalid",
        weaknesses: ["기존 약점"],
        misconceptions: null,
        preferredQuizTypes: ["MCQ", "UNKNOWN"],
        targetDifficulty: "TOO_HARD"
      },
      learnerModel: undefined
    } as unknown as SessionState;

    applyLearnerMemoryWrite(state, {
      shouldPersist: true,
      strengths: ["새 강점"],
      misconceptions: ["새 오개념"],
      preferredQuizTypes: ["SHORT"],
      targetDifficulty: "CHALLENGING",
      confidence: 2,
      learnerLevel: "BEGINNER"
    });

    expect(state.integratedMemory.summaryMarkdown).toBe("아직 축적된 개인화 메모리가 없습니다.");
    expect(state.integratedMemory.strengths).toEqual(["새 강점"]);
    expect(state.integratedMemory.weaknesses).toEqual(["기존 약점"]);
    expect(state.integratedMemory.misconceptions).toEqual(["새 오개념"]);
    expect(state.integratedMemory.preferredQuizTypes).toEqual(["MCQ", "SHORT"]);
    expect(state.integratedMemory.targetDifficulty).toBe("CHALLENGING");
    expect(state.learnerModel.level).toBe("BEGINNER");
    expect(state.learnerModel.confidence).toBe(1);
    expect(state.learnerModel.strongConcepts).toEqual(["새 강점"]);
    expect(state.learnerModel.weakConcepts).toEqual(["기존 약점", "새 오개념"]);
  });

  it("builds a safe digest from malformed memory fields", () => {
    const state = {
      integratedMemory: {
        strengths: "not-array",
        weaknesses: ["권한"],
        targetDifficulty: "IMPOSSIBLE"
      }
    } as unknown as SessionState;

    const digest = buildIntegratedMemoryDigest(state);

    expect(digest).toContain("강점: (없음)");
    expect(digest).toContain("약점: 권한");
    expect(digest).toContain("목표 난이도: BALANCED");
  });
});
