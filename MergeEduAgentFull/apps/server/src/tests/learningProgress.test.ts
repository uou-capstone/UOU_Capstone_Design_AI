import { describe, expect, it } from "vitest";
import { resolveLearningProgressPage } from "../services/learningProgress.js";

describe("learning progress helpers", () => {
  it("falls back to contiguous explained legacy evidence for invalid explicit values", () => {
    const legacySession = {
      learningProgressPage: null,
      pageStates: [
        { page: 1, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() },
        { page: 2, status: "DONE", lastTouchedAt: new Date().toISOString() },
        { page: 4, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() }
      ]
    };

    expect(resolveLearningProgressPage(legacySession as any, 10)).toBe(2);
    expect(resolveLearningProgressPage({ ...legacySession, learningProgressPage: false } as any, 10)).toBe(2);
    expect(resolveLearningProgressPage({ ...legacySession, learningProgressPage: "" } as any, 10)).toBe(2);
  });
});
