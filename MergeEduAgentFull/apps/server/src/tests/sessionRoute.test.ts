import { EventEmitter } from "node:events";
import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachSessionStreamAbortHandlers,
  buildProtectedSessionSaveState,
  sessionRouter
} from "../routes/session.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";
import { EventStreamChunk } from "../services/engine/OrchestrationEngine.js";
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

class MockMessage extends EventEmitter {
  writableEnded = false;
  destroyed = false;
}

describe("attachSessionStreamAbortHandlers", () => {
  it("does not abort on request close after a POST body is consumed", () => {
    const req = new MockMessage();
    const res = new MockMessage();
    const controller = new AbortController();
    const cleanup = attachSessionStreamAbortHandlers(req as any, res as any, controller);

    req.emit("close");

    expect(controller.signal.aborted).toBe(false);
    cleanup();
  });

  it("aborts when the request body is aborted", () => {
    const req = new MockMessage();
    const res = new MockMessage();
    const controller = new AbortController();
    const cleanup = attachSessionStreamAbortHandlers(req as any, res as any, controller);

    req.emit("aborted");

    expect(controller.signal.aborted).toBe(true);
    cleanup();
  });

  it("aborts when the response closes before res.end()", () => {
    const req = new MockMessage();
    const res = new MockMessage();
    const controller = new AbortController();
    const cleanup = attachSessionStreamAbortHandlers(req as any, res as any, controller);

    res.emit("close");

    expect(controller.signal.aborted).toBe(true);
    cleanup();
  });

  it("does not abort when the response closes after res.end()", () => {
    const req = new MockMessage();
    const res = new MockMessage();
    const controller = new AbortController();
    const cleanup = attachSessionStreamAbortHandlers(req as any, res as any, controller);

    res.writableEnded = true;
    res.emit("close");

    expect(controller.signal.aborted).toBe(false);
    cleanup();
  });

  it("removes listeners during cleanup", () => {
    const req = new MockMessage();
    const res = new MockMessage();
    const controller = new AbortController();
    const cleanup = attachSessionStreamAbortHandlers(req as any, res as any, controller);

    cleanup();
    req.emit("aborted");
    res.emit("close");

    expect(controller.signal.aborted).toBe(false);
  });
});

describe("sessionRouter event stream", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns a final NDJSON chunk for a normal stream request", async () => {
    let signalWasAborted = false;
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      sessionRouter({
        engine: {
          handleEventStream: async (
            _sessionId: string,
            _payload: unknown,
            write: (chunk: EventStreamChunk) => void,
            signal?: AbortSignal
          ) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            signalWasAborted = Boolean(signal?.aborted);
            if (signal?.aborted) return;
            write({
              type: "final",
              data: {
                ok: true,
                newMessages: [],
                ui: {
                  openQuizModal: false,
                  quiz: null,
                  disableQuizClose: false,
                  passScoreRatio: 0.7
                },
                patch: {
                  currentPage: 1,
                  progressText: "~1페이지까지 진행",
                  learnerModel: {
                    level: "INTERMEDIATE",
                    confidence: 0.5,
                    weakConcepts: [],
                    strongConcepts: []
                  },
                  activeIntervention: null
                }
              }
            } as EventStreamChunk);
          }
        }
      } as any)
    );

    const server = app.listen(0);
    servers.push({
      close: () => new Promise((resolve) => server.close(() => resolve()))
    });
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/session/ses_test/event/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        event: { type: "SESSION_ENTERED" },
        clientContext: { currentPage: 1 }
      })
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(signalWasAborted).toBe(false);
    expect(text).toContain("\"type\":\"final\"");
    expect(text).toContain("\"passScoreRatio\":0.7");
  });

  it("sanitizes stream errors after headers are sent", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      sessionRouter({
        engine: {
          handleEventStream: async () => {
            throw new Error("API Key not found");
          }
        }
      } as any)
    );

    const server = app.listen(0);
    servers.push({
      close: () => new Promise((resolve) => server.close(() => resolve()))
    });
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/session/ses_test/event/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        event: { type: "SESSION_ENTERED" },
        clientContext: { currentPage: 1 }
      })
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toContain("\"type\":\"error\"");
    expect(text).toContain("세션 처리 중 문제가 발생했습니다");
    expect(text).not.toContain("API Key not found");
  });
});
