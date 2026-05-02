import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { appConfig } from "../config.js";
import { AuthService } from "../services/auth/AuthService.js";
import { DevEmailSender } from "../services/auth/EmailSender.js";
import { ExamLogger, ExamLogPayload } from "../services/exams/ExamLogger.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import { GeminiBridgeClient } from "../services/llm/GeminiBridgeClient.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-exam-stream-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-exam-stream-test");
const origin = "http://localhost:5173";

class MemoryExamLogger implements ExamLogger {
  readonly events: Array<{ name: string; payload: ExamLogPayload }> = [];

  event(name: string, payload: ExamLogPayload): void {
    this.events.push({ name, payload });
  }
}

beforeEach(async () => {
  process.env.PORT = "4000";
  process.env.WEB_PORT = "5173";
  process.env.APP_ORIGIN = origin;
  process.env.MODEL_NAME = "gemini-1.5-pro";
  process.env.GOOGLE_API_KEY = "test-key";
  process.env.DATA_DIR = "./apps/server/data-exam-stream-test";
  process.env.UPLOAD_DIR = "./apps/server/uploads-exam-stream-test";
  process.env.AUTH_DEV_EXPOSE_VERIFICATION_CODE = "true";
  Object.assign(appConfig, {
    appOrigin: origin,
    authDevExposeVerificationCode: true,
    authCookieName: "merge_edu_session",
    authBootstrapSecret: "test-bootstrap-secret",
    authEmailDeliveryMode: "dev",
    authEmailResendCooldownSeconds: 0,
    aiBridgeUrl: "http://127.0.0.1:8001",
      requestEncryptionMode: "optional",
      requestEncryptionRequiredPaths: [],
      examStudioAiTimeoutMs: 45_000
    });
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

async function startServer(bridge: {
  examStudioChatStream?: (...args: any[]) => Promise<any>;
  examStudioChat?: (...args: any[]) => Promise<any>;
}) {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const logger = new MemoryExamLogger();
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge: bridge as any,
    pdfIngest: {} as any,
    engine: {} as any,
    examLogger: logger
  });
  const server = app.listen(0);
  return {
    logger,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function makeClient(baseUrl: string) {
  let cookie = "";
  return {
    async request(pathname: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("content-type") && init.body) {
        headers.set("content-type", "application/json");
      }
      headers.set("origin", origin);
      if (cookie) headers.set("cookie", cookie);
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }
      return response;
    }
  };
}

async function createTeacherWeek(baseUrl: string) {
  const client = makeClient(baseUrl);
  const signup = await client.request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: "stream.teacher@example.com",
      password: "pass1234",
      displayName: "Stream Teacher",
      role: "teacher"
    })
  });
  const signupPayload = await signup.json() as { devVerificationCode: string };
  await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email: "stream.teacher@example.com",
      code: signupPayload.devVerificationCode
    })
  });
  const classroomResponse = await client.request("/classrooms", {
    method: "POST",
    body: JSON.stringify({ title: "스트림 강의실" })
  });
  const classroomPayload = await classroomResponse.json() as { data: { id: string } };
  const weekResponse = await client.request(`/classrooms/${classroomPayload.data.id}/weeks`, {
    method: "POST",
    body: JSON.stringify({ title: "1주차" })
  });
  const weekPayload = await weekResponse.json() as { data: { id: string } };
  return { client, weekId: weekPayload.data.id };
}

function parseNdjson(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

async function startBridgeStreamServer(lines: string[]) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end(lines.join(""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function startHangingBridgeStreamServer() {
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`${JSON.stringify({ type: "thought_delta", text: "slow bridge" })}\n`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      })
  };
}

describe("exam studio stream route", () => {
  it("streams stages, thought deltas, sanitized proposal, and done", async () => {
    let bridgeInput: Record<string, any> | undefined;
    const server = await startServer({
      examStudioChatStream: async (input, onDelta) => {
        bridgeInput = input;
        onDelta?.({ channel: "thought", text: "시간과 문항을 검토합니다." });
        return {
          proposal: {
            answerMarkdown: "시간을 반영했습니다.",
            operations: [
              {
                method: "patchExamSettings",
                params: { timeLimitMinutes: 45 }
              }
            ],
            source: "AI"
          },
          thoughtSummary: "RAW_INTERNAL_THOUGHT_DO_NOT_LEAK"
        };
      }
    });
    try {
      const { client, weekId } = await createTeacherWeek(server.baseUrl);
      const response = await client.request(`/weeks/${weekId}/exam-studio/chat/stream`, {
        method: "POST",
        body: JSON.stringify({
          message: "제한 시간을 45분으로 바꿔줘",
          currentDraft: {
            title: "초안",
            descriptionMarkdown: "",
            availableFrom: "2026-05-02T00:00:00.000Z",
            availableUntil: "2026-05-03T00:00:00.000Z",
            timeLimitMinutes: 30,
            passScoreRatio: 0.7,
            aiGradingEnabled: true,
            questions: []
          }
        })
      });

      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      expect(events.some((event) => event.type === "stage" && event.stage === "PREPARING")).toBe(true);
      expect(events.some((event) => event.type === "thought_delta" && event.text.includes("JSON"))).toBe(true);
      expect(bridgeInput?.currentDraft).toMatchObject({ title: "초안", timeLimitMinutes: 30 });
      expect(bridgeInput?.currentKstIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
      expect(bridgeInput?.timeZone).toBe("Asia/Seoul");
      expect(bridgeInput?.responseJsonSchema).toMatchObject({
        required: ["answerMarkdown", "operations"],
        properties: {
          answerMarkdown: { type: "string" },
          operations: {
            items: {
                  properties: {
                    method: {
                      enum: ["patchExamSettings", "appendQuestions", "replaceQuestion"]
                    },
                    params: {
                      properties: {
                        availableFrom: { type: "string" },
                        availableUntil: { type: "string" },
                        timeLimitMinutes: { type: "number" },
                        questions: {
                          items: {
                            properties: {
                              choices: {
                                items: {
                                  properties: {
                                    textMarkdown: { type: "string" }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
          }
        }
      });
      expect(JSON.stringify(bridgeInput?.responseJsonSchema)).not.toContain("settingsPatch");
      const proposalEvent = events.find((event) => event.type === "proposal");
      expect(JSON.stringify(events)).not.toContain("RAW_INTERNAL_THOUGHT_DO_NOT_LEAK");
      expect(proposalEvent?.thoughtSummary).toContain("JSON");
      const proposal = proposalEvent?.data;
      expect(proposal.operations?.[0]).toMatchObject({
        method: "patchExamSettings",
        params: { timeLimitMinutes: 45 }
      });
      expect(events.at(-1)).toMatchObject({ type: "done" });
      expect(server.logger.events.some((event) => event.name === "[exam_ai_studio_stream_start]")).toBe(true);
      expect(server.logger.events.some((event) => event.name === "[exam_ai_studio_stream_complete]")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("does not mutate the draft from teacher text when bridge operations are missing", async () => {
    const server = await startServer({
      examStudioChatStream: async () => ({
        proposal: {
          answerMarkdown: "시험 시작 시간을 내일 오후 3시로 바꿀 수 있습니다.",
          source: "AI"
        },
        thoughtSummary: "RAW_NON_STREAMING_THOUGHT_DO_NOT_LEAK"
      })
    });
    try {
      const { client, weekId } = await createTeacherWeek(server.baseUrl);
      const response = await client.request(`/weeks/${weekId}/exam-studio/chat/stream`, {
        method: "POST",
        body: JSON.stringify({
          message: "시험 시간을 내일 오후 3시로 바꿔줘",
          currentDraft: {
            title: "초안",
            descriptionMarkdown: "",
            availableFrom: "2026-05-02T00:00:00.000Z",
            availableUntil: "2026-05-09T00:00:00.000Z",
            timeLimitMinutes: 30,
            passScoreRatio: 0.7,
            aiGradingEnabled: true,
            questions: []
          }
        })
      });

      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      const proposal = events.find((event) => event.type === "proposal")?.data;
      expect(proposal.replyMarkdown).toBe("시험 시작 시간을 내일 오후 3시로 바꿀 수 있습니다.");
      expect(proposal.operations).toBeUndefined();
      expect(proposal.settingsPatch).toBeUndefined();
      expect(server.logger.events.some((event) => event.name === "[exam_studio_time_repair]")).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("applies LLM-provided relative time operations in the non-streaming route", async () => {
    let bridgeInput: Record<string, any> | undefined;
    const server = await startServer({
      examStudioChat: async (input) => {
        bridgeInput = input;
        return {
          proposal: {
            answerMarkdown: "시험 시작 시간을 내일 오후 3시로, 종료 시간을 오후 3시 30분으로 변경했습니다.",
            operations: [
              {
                method: "patchExamSettings",
                params: {
                  availableFrom: "2026-05-03T15:00:00+09:00",
                  availableUntil: "2026-05-03T15:30:00+09:00",
                  timeLimitMinutes: 30
                }
              }
            ],
            source: "AI"
          },
          thoughtSummary: ""
        };
      }
    });
    try {
      const { client, weekId } = await createTeacherWeek(server.baseUrl);
      const response = await client.request(`/weeks/${weekId}/exam-studio/chat`, {
        method: "POST",
        body: JSON.stringify({
          message: "시험 시간을 내일 오후 3시로 바꿔줘",
          currentDraft: {
            availableFrom: "2026-05-02T00:00:00.000Z",
            availableUntil: "2026-05-09T00:00:00.000Z",
            timeLimitMinutes: 30,
            questions: []
          }
        })
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as { data: any; thoughtSummary?: string };
      expect(JSON.stringify(payload)).not.toContain("RAW_NON_STREAMING_THOUGHT_DO_NOT_LEAK");
      expect(payload.thoughtSummary).toContain("JSON");
      expect(bridgeInput?.responseJsonSchema?.required).toEqual(["answerMarkdown", "operations"]);
      expect(bridgeInput?.currentKstIso).toMatch(/\+09:00$/);
      expect(payload.data.operations?.[0]).toMatchObject({
        method: "patchExamSettings",
        params: {
          availableFrom: "2026-05-03T06:00:00.000Z",
          availableUntil: "2026-05-03T06:30:00.000Z",
          timeLimitMinutes: 30
        }
      });
    } finally {
      await server.close();
    }
  });

  it("does not repair invalid Korean time context in the streaming route", async () => {
    const server = await startServer({
      examStudioChatStream: async () => ({
        proposal: {
          answerMarkdown: "시간을 바꿨습니다.",
          source: "AI"
        },
        thoughtSummary: ""
      })
    });
    try {
      const { client, weekId } = await createTeacherWeek(server.baseUrl);
      const response = await client.request(`/weeks/${weekId}/exam-studio/chat/stream`, {
        method: "POST",
        body: JSON.stringify({
          message: "2026년 2월 31일 오후 2시로 1시간 설정",
          currentDraft: {
            availableFrom: "2026-05-02T00:00:00.000Z",
            availableUntil: "2026-05-09T00:00:00.000Z",
            timeLimitMinutes: 30,
            questions: []
          }
        })
      });

      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      const proposal = events.find((event) => event.type === "proposal")?.data;
      expect(proposal.operations).toBeUndefined();
      expect(proposal.settingsPatch).toBeUndefined();
      expect(server.logger.events.some((event) => event.name === "[exam_studio_time_repair]")).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("finishes with a non-mutating fallback proposal when the bridge fails", async () => {
    const server = await startServer({
      examStudioChatStream: async () => {
        throw new Error("bridge down");
      }
    });
    try {
      const { client, weekId } = await createTeacherWeek(server.baseUrl);
      const response = await client.request(`/weeks/${weekId}/exam-studio/chat/stream`, {
        method: "POST",
        body: JSON.stringify({
          message: "문항 만들어줘",
          currentDraft: { questions: [] }
        })
      });

      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      const proposal = events.find((event) => event.type === "proposal")?.data;
      expect(proposal).toMatchObject({
        fallback: true,
        source: "AI_UNAVAILABLE"
      });
      expect(proposal.operations).toBeUndefined();
      expect(proposal.settingsPatch).toBeUndefined();
      expect(events.at(-1)).toMatchObject({ type: "done" });
      expect(server.logger.events.some((event) => event.name === "[exam_ai_studio_stream_start]")).toBe(true);
      expect(server.logger.events.some((event) => event.name === "[exam_ai_studio_stream_fallback]")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("falls back without mutations when the real bridge stream times out", async () => {
    const bridge = await startHangingBridgeStreamServer();
    Object.assign(appConfig, {
      aiBridgeUrl: bridge.baseUrl,
      examStudioAiTimeoutMs: 25
    });
    const server = await startServer(new GeminiBridgeClient() as any);
    try {
      const { client, weekId } = await createTeacherWeek(server.baseUrl);
      const response = await client.request(`/weeks/${weekId}/exam-studio/chat/stream`, {
        method: "POST",
        body: JSON.stringify({
          message: "제목과 시간을 바꿔줘",
          currentDraft: { title: "선생님 초안", questions: [] }
        })
      });

      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      const proposal = events.find((event) => event.type === "proposal")?.data;
      expect(proposal).toMatchObject({
        fallback: true,
        source: "AI_UNAVAILABLE"
      });
      expect(proposal.operations).toBeUndefined();
      expect(proposal.settingsPatch).toBeUndefined();
      expect(events.some((event) => event.type === "stage" && event.stage === "COMPLETE")).toBe(true);
      expect(server.logger.events.some((event) => event.name === "[exam_ai_studio_stream_fallback]")).toBe(true);
    } finally {
      await server.close();
      await bridge.close();
    }
  });

  it("aborts bridge work when the streaming client disconnects", async () => {
    let bridgeSignal: AbortSignal | undefined;
    const server = await startServer({
      examStudioChatStream: async (_input, _onDelta, signal) => {
        bridgeSignal = signal;
        await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
    });
    try {
      const { client, weekId } = await createTeacherWeek(server.baseUrl);
      const controller = new AbortController();
      const response = await client.request(`/weeks/${weekId}/exam-studio/chat/stream`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          message: "오래 걸리는 요청",
          currentDraft: { questions: [] }
        })
      });
      expect(response.status).toBe(200);
      controller.abort();
      await expect
        .poll(() => bridgeSignal?.aborted === true, { timeout: 1000 })
        .toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe("GeminiBridgeClient exam studio stream protocol", () => {
  const input = {
    model: "gemini-1.5-pro",
    message: "시험을 만들어줘",
    currentDraft: { questions: [] },
    currentKstIso: "2026-05-02T17:00:00+09:00",
    timeZone: "Asia/Seoul",
    sourceText: "",
    responseJsonSchema: {}
  };

  it("throws when the bridge stream ends without done", async () => {
    const bridge = await startBridgeStreamServer([
      `${JSON.stringify({ type: "thought_delta", text: "검토 중" })}\n`
    ]);
    try {
      Object.assign(appConfig, { aiBridgeUrl: bridge.baseUrl });
      const client = new GeminiBridgeClient();
      await expect(client.examStudioChatStream(input)).rejects.toThrow("did not send final done event");
    } finally {
      await bridge.close();
    }
  });

  it("throws when the bridge reports malformed final JSON", async () => {
    const bridge = await startBridgeStreamServer([
      `${JSON.stringify({ type: "error", error: "Failed to parse exam proposal JSON: broken" })}\n`
    ]);
    try {
      Object.assign(appConfig, { aiBridgeUrl: bridge.baseUrl });
      const client = new GeminiBridgeClient();
      await expect(client.examStudioChatStream(input)).rejects.toThrow("Failed to parse exam proposal JSON");
    } finally {
      await bridge.close();
    }
  });

  it("throws when the bridge sends done without proposal data", async () => {
    const bridge = await startBridgeStreamServer([
      `${JSON.stringify({ type: "done", answerText: "{}", thoughtSummary: "" })}\n`
    ]);
    try {
      Object.assign(appConfig, { aiBridgeUrl: bridge.baseUrl });
      const client = new GeminiBridgeClient();
      await expect(client.examStudioChatStream(input)).rejects.toThrow("did not return exam proposal JSON");
    } finally {
      await bridge.close();
    }
  });
});
