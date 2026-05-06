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
import { GeminiBridgeClient } from "../services/llm/GeminiBridgeClient.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-criteria-assistant-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-criteria-assistant-test");
const origin = "http://localhost:5173";

class MemoryExamLogger implements ExamLogger {
  readonly events: Array<{ name: string; payload: ExamLogPayload }> = [];

  event(name: string, payload: ExamLogPayload): void {
    this.events.push({ name, payload });
  }
}

beforeEach(async () => {
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
    modelName: "gemini-1.5-pro",
    reportCriteriaAssistantAiTimeoutMs: 1_000
  });
  process.env.DATA_DIR = "./apps/server/data-criteria-assistant-test";
  process.env.UPLOAD_DIR = "./apps/server/uploads-criteria-assistant-test";
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

async function startServer(bridge: Partial<GeminiBridgeClient>) {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const logger = new MemoryExamLogger();
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge: bridge as GeminiBridgeClient,
    pdfIngest: {} as any,
    engine: {} as any,
    examLogger: logger
  });
  const server = app.listen(0);
  return {
    store,
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
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    }
  };
}

async function signupClient(
  baseUrl: string,
  input: { email: string; role: "teacher" | "student"; displayName: string }
) {
  const client = makeClient(baseUrl);
  const signup = await client.request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: "pass1234",
      displayName: input.displayName,
      role: input.role
    })
  });
  const signupPayload = await signup.json() as { devVerificationCode: string };
  await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      code: signupPayload.devVerificationCode
    })
  });
  return client;
}

async function createTeacherClassroom(baseUrl: string, email = "criteria.teacher@example.com") {
  const client = await signupClient(baseUrl, {
    email,
    role: "teacher",
    displayName: "Criteria Teacher"
  });
  const classroomResponse = await client.request("/classrooms", {
    method: "POST",
    body: JSON.stringify({ title: "기준 강의실" })
  });
  const classroomPayload = await classroomResponse.json() as { data: { id: string } };
  return { client, classroomId: classroomPayload.data.id };
}

async function createCustomReportCriterion(
  client: ReturnType<typeof makeClient>,
  classroomId: string,
  input: { name: string; description: string }
) {
  const response = await client.request(`/classrooms/${classroomId}/report/criteria`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  expect(response.status).toBe(201);
  const payload = await response.json() as {
    data: {
      id: string;
      classroomId: string;
      name: string;
      description: string;
      createdAt: string;
      updatedAt: string;
    };
  };
  return payload.data;
}

function parseNdjson(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

async function startBridgeStreamServer(lines: string[], options: { hang?: boolean } = {}) {
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const line of lines) {
      res.write(line);
    }
    if (!options.hang) res.end();
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

describe("report criteria assistant stream route", () => {
  it("streams sanitized owner proposal, logs lifecycle, and does not mutate criteria", async () => {
    let bridgeInput: Record<string, any> | undefined;
    const server = await startServer({
      reportCriteriaAssistantChatStream: async (
        input: unknown,
        onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void
      ) => {
        bridgeInput = input as Record<string, any>;
        onDelta?.({ channel: "thought", text: "RAW_INTERNAL_THOUGHT_DO_NOT_LEAK" });
        return {
          proposal: {
            replyMarkdown: "발표 논리력 항목을 제안합니다.",
            operation: {
              method: "draftCriterion",
              params: {
                criterion: {
                  name: "발표 논리력",
                  description: "발표에서 주장, 근거, 예시를 연결해 설명하는 정도를 평가합니다."
                },
                summaryCards: [
                  { title: "중복 항목 확인", body: "기본 항목과 직접 겹치지 않습니다." }
                ]
              }
            },
            source: "AI"
          },
          thoughtSummary: "RAW_INTERNAL_THOUGHT_DO_NOT_LEAK"
        };
      }
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const response = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({
            message: "발표 태도를 볼 수 있는 항목을 써줘",
            history: [{ role: "user", contentMarkdown: "이전 요청" }],
            currentProposal: null
          })
        }
      );

      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      expect(events.some((event) => event.type === "stage" && event.stage === "UNDERSTANDING_REQUEST")).toBe(true);
      expect(events.some((event) => event.type === "proposal")).toBe(true);
      expect(events.at(-1)).toMatchObject({ type: "done" });
      expect(JSON.stringify(events)).not.toContain("RAW_INTERNAL_THOUGHT_DO_NOT_LEAK");
      expect(bridgeInput?.builtInCriteria).toHaveLength(10);
      expect(bridgeInput?.history).toHaveLength(1);
      expect(JSON.stringify(bridgeInput?.responseJsonSchema)).toContain("draftCriterion");
      expect(JSON.stringify(bridgeInput?.responseJsonSchema)).toContain("updateCriterion");
      expect(JSON.stringify(bridgeInput?.responseJsonSchema)).toContain("deleteCriterion");
      expect(JSON.stringify(bridgeInput?.responseJsonSchema)).toContain("targetCriterionUpdatedAt");
      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(0);
      expect(server.logger.events.some((event) => event.name === "[report_criteria_assistant_stream_start]")).toBe(true);
      expect(server.logger.events.some((event) => event.name === "[report_criteria_assistant_stream_complete]")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("rejects students and foreign teachers before streaming", async () => {
    const server = await startServer({} as any);
    try {
      const { classroomId } = await createTeacherClassroom(server.baseUrl);
      const student = await signupClient(server.baseUrl, {
        email: "criteria.student@example.com",
        role: "student",
        displayName: "Criteria Student"
      });
      const foreign = await signupClient(server.baseUrl, {
        email: "criteria.foreign@example.com",
        role: "teacher",
        displayName: "Foreign Teacher"
      });
      const body = JSON.stringify({ message: "항목 추천해줘" });
      const studentResponse = await student.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        { method: "POST", body }
      );
      const foreignResponse = await foreign.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        { method: "POST", body }
      );
      expect(studentResponse.status).toBe(403);
      expect(foreignResponse.status).toBe(403);
      expect(studentResponse.headers.get("content-type")).toContain("application/json");
    } finally {
      await server.close();
    }
  });

  it("downgrades create without explicit intent", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async () => ({
        proposal: {
          replyMarkdown: "바로 추가하겠습니다.",
          operation: {
            method: "createCriterion",
            params: {
              criterion: {
                name: "탐구 확장성",
                description: "새 질문을 만들고 자료를 확장해 이해하는 정도를 평가합니다."
              }
            }
          },
          source: "AI"
        },
        thoughtSummary: ""
      })
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const response = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "탐구 관련 항목을 써줘" })
        }
      );
      const events = parseNdjson(await response.text());
      const proposal = events.find((event) => event.type === "proposal")?.data;
      expect(proposal.operation.method).toBe("draftCriterion");
      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("does not create from missing criterion and only allows create for explicit valid proposal", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async () => ({
        proposal: {
          replyMarkdown: "반영하겠습니다.",
          operation: {
            method: "createCriterion"
          },
          source: "AI"
        },
        thoughtSummary: ""
      })
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const missingCriterionResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "반영해줘", currentProposal: null })
        }
      );
      const missingEvents = parseNdjson(await missingCriterionResponse.text());
      const missingProposal = missingEvents.find((event) => event.type === "proposal")?.data;
      expect(missingProposal.operation.method).not.toBe("createCriterion");
      expect(missingProposal.operation.params?.criterion).toBeUndefined();

      const currentProposalResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({
            message: "이 항목에 반영해줘",
            currentProposal: {
              name: "자료 연결력",
              description: "학습 자료와 수업 내용을 연결해 답변에 활용하는 정도를 평가합니다."
            }
          })
        }
      );
      const currentEvents = parseNdjson(await currentProposalResponse.text());
      const currentProposal = currentEvents.find((event) => event.type === "proposal")?.data;
      expect(currentProposal.operation.method).toBe("createCriterion");
      expect(currentProposal.operation.params.criterion.name).toBe("자료 연결력");
      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("sanitizes update and delete proposals with target snapshots without mutating criteria", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async (input: unknown) => {
        const bridgeInput = input as {
          message: string;
          customCriteria: Array<{
            id: string;
            name: string;
            description: string;
            updatedAt: string;
          }>;
        };
        const isDeleteRequest = /삭제|제거/.test(bridgeInput.message);
        const target = isDeleteRequest
          ? bridgeInput.customCriteria.find((criterion) => criterion.name === "협업 태도")!
          : bridgeInput.customCriteria.find((criterion) => criterion.name === "발표 논리력")!;
        return {
          proposal: isDeleteRequest
            ? {
                replyMarkdown: "협업 태도 항목을 제거할지 확인해 주세요.",
                operation: {
                  method: "deleteCriterion",
                  params: {
                    targetCriterionId: target.id,
                    targetCriterionName: target.name,
                    targetCriterionDescription: target.description,
                    targetCriterionUpdatedAt: target.updatedAt,
                    rationale: "교사가 해당 추가 항목 제거를 요청했습니다."
                  }
                },
                source: "AI"
              }
            : {
                replyMarkdown: "발표 논리력 항목을 수정한 초안을 준비했습니다.",
                operation: {
                  method: "updateCriterion",
                  params: {
                    targetCriterionId: target.id,
                    targetCriterionName: target.name,
                    targetCriterionDescription: target.description,
                    targetCriterionUpdatedAt: target.updatedAt,
                    criterion: {
                      name: "발표 구조화",
                      description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
                    },
                    rationale: "기존 추가 항목을 새 관점으로 다듬었습니다."
                  }
                },
                source: "AI"
              },
          thoughtSummary: ""
        };
      }
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const presentation = await createCustomReportCriterion(client, classroomId, {
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다."
      });
      const collaboration = await createCustomReportCriterion(client, classroomId, {
        name: "협업 태도",
        description: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다."
      });

      const updateResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "발표 논리력 내용을 발표 구조화 중심으로 고쳐줘" })
        }
      );
      const updateEvents = parseNdjson(await updateResponse.text());
      const updateProposal = updateEvents.find((event) => event.type === "proposal")?.data;
      expect(updateProposal.operation.method).toBe("updateCriterion");
      expect(updateProposal.operation.params).toMatchObject({
        targetCriterionId: presentation.id,
        targetCriterionName: presentation.name,
        targetCriterionDescription: presentation.description,
        targetCriterionUpdatedAt: presentation.updatedAt,
        criterion: {
          name: "발표 구조화",
          description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
        }
      });

      const deleteResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "협업 태도 제거해줘" })
        }
      );
      const deleteEvents = parseNdjson(await deleteResponse.text());
      const deleteProposal = deleteEvents.find((event) => event.type === "proposal")?.data;
      expect(deleteProposal.operation.method).toBe("deleteCriterion");
      expect(deleteProposal.operation.params).toMatchObject({
        targetCriterionId: collaboration.id,
        targetCriterionName: collaboration.name,
        targetCriterionDescription: collaboration.description,
        targetCriterionUpdatedAt: collaboration.updatedAt
      });
      expect(deleteProposal.operation.params.criterion).toBeUndefined();

      const storedCriteria = await server.store.listClassroomReportCriteria(classroomId);
      expect(storedCriteria.map((criterion) => criterion.name)).toEqual([
        "발표 논리력",
        "협업 태도"
      ]);
      expect(
        server.logger.events.some(
          (event) =>
            event.name === "[report_criteria_assistant_stream_complete]" &&
            event.payload.targetCriterionId === presentation.id &&
            event.payload.operationMethods?.[0] === "updateCriterion"
        )
      ).toBe(true);
      expect(
        server.logger.events.some(
          (event) =>
            event.name === "[report_criteria_assistant_stream_complete]" &&
            event.payload.targetCriterionId === collaboration.id &&
            event.payload.operationMethods?.[0] === "deleteCriterion"
        )
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("downgrades unsafe destructive assistant proposals before they can be applied", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async (input: unknown) => {
        const bridgeInput = input as {
          message: string;
          customCriteria: Array<{
            id: string;
            name: string;
            description: string;
            updatedAt: string;
          }>;
        };
        const presentation = bridgeInput.customCriteria.find(
          (criterion) => criterion.name === "발표 논리력"
        )!;
        if (bridgeInput.message.includes("기본")) {
          return {
            proposal: {
              replyMarkdown: "개념 이해도 항목 수정 확인을 준비했습니다.",
              operation: {
                method: "updateCriterion",
                params: {
                  targetCriterionName: "개념 이해도",
                  criterion: {
                    name: "개념 이해도 수정안",
                    description: "기본 항목을 바꾸려는 잘못된 수정안입니다."
                  },
                  rationale: "LLM이 기본 항목 수정을 잘못 제안했습니다.",
                  summaryCards: [
                    { title: "잘못된 카드", body: "downgrade 후에는 params에 남으면 안 됩니다." }
                  ]
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        if (bridgeInput.message.includes("아이디만")) {
          return {
            proposal: {
              replyMarkdown: "삭제 대상을 확인했습니다.",
              operation: {
                method: "deleteCriterion",
                params: {
                  targetCriterionId: presentation.id
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        if (bridgeInput.message.includes("협업")) {
          return {
            proposal: {
              replyMarkdown: "발표 논리력 항목을 제거할지 확인해 주세요.",
              operation: {
                method: "deleteCriterion",
                params: {
                  targetCriterionId: presentation.id,
                  targetCriterionName: presentation.name,
                  targetCriterionDescription: presentation.description,
                  targetCriterionUpdatedAt: presentation.updatedAt
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        return {
          proposal: {
            replyMarkdown: "발표 항목을 제거할지 확인해 주세요.",
            operation: {
              method: "deleteCriterion",
              params: {
                targetCriterionName: "발표"
              }
            },
            source: "AI"
          },
          thoughtSummary: ""
        };
      }
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      await createCustomReportCriterion(client, classroomId, {
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다."
      });
      await createCustomReportCriterion(client, classroomId, {
        name: "협업 태도",
        description: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다."
      });

      const cases = [
        {
          message: "기본 개념 이해도 항목 제거해줘",
          reason: "built_in_target",
          reply: "기본 평가 항목은 수정하거나 삭제할 수 없습니다."
        },
        {
          message: "그 항목 아이디만 보고 삭제해줘",
          reason: "target_name_required"
        },
        {
          message: "협업 태도 삭제해줘",
          reason: "target_message_mismatch"
        },
        {
          message: "발표 삭제해줘",
          reason: "unknown_target"
        }
      ];
      for (const unsafeCase of cases) {
        const response = await client.request(
          `/classrooms/${classroomId}/report/criteria/assistant/stream`,
          {
            method: "POST",
            body: JSON.stringify({ message: unsafeCase.message })
          }
        );
        const events = parseNdjson(await response.text());
        const proposal = events.find((event) => event.type === "proposal")?.data;
        expect(proposal.operation.method).toBe("messageOnly");
        expect(proposal.downgradeReason).toBe(unsafeCase.reason);
        expect(proposal.operation.params).toBeUndefined();
        if (unsafeCase.reply) {
          expect(proposal.replyMarkdown).toContain(unsafeCase.reply);
        }
        expect(
          server.logger.events.some(
            (event) =>
              event.name === "[report_criteria_assistant_stream_complete]" &&
              event.payload.downgradeReason === unsafeCase.reason &&
              event.payload.targetCriterionId === undefined
          )
        ).toBe(true);
      }
      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("resolves only exact destructive targets and rejects invalid update/delete shapes", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async (input: unknown) => {
        const bridgeInput = input as {
          message: string;
          customCriteria: Array<{
            id: string;
            name: string;
            description: string;
            updatedAt: string;
          }>;
        };
        const presentation = bridgeInput.customCriteria.find(
          (criterion) => criterion.name === "발표 논리력"
        )!;
        const collaboration = bridgeInput.customCriteria.find(
          (criterion) => criterion.name === "협업 태도"
        )!;
        const nextCriterion = {
          name: "발표 구조화",
          description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
        };

        if (bridgeInput.message.includes("unknown id")) {
          return {
            proposal: {
              replyMarkdown: "대상을 찾았습니다.",
              operation: {
                method: "updateCriterion",
                params: {
                  targetCriterionId: "crit_missing",
                  targetCriterionName: presentation.name,
                  criterion: nextCriterion
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        if (bridgeInput.message.includes("id name mismatch")) {
          return {
            proposal: {
              replyMarkdown: "대상을 찾았습니다.",
              operation: {
                method: "deleteCriterion",
                params: {
                  targetCriterionId: presentation.id,
                  targetCriterionName: collaboration.name,
                  targetCriterionDescription: collaboration.description,
                  targetCriterionUpdatedAt: collaboration.updatedAt
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        if (bridgeInput.message.includes("target 없이")) {
          return {
            proposal: {
              replyMarkdown: "수정안을 준비했습니다.",
              operation: {
                method: "updateCriterion",
                params: {
                  criterion: nextCriterion
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        if (bridgeInput.message.includes("criterion 없이")) {
          return {
            proposal: {
              replyMarkdown: "수정 대상을 찾았습니다.",
              operation: {
                method: "updateCriterion",
                params: {
                  targetCriterionName: presentation.name
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        if (bridgeInput.message.includes("설명만")) {
          return {
            proposal: {
              replyMarkdown: "수정 대상을 찾았습니다.",
              operation: {
                method: "updateCriterion",
                params: {
                  targetCriterionId: presentation.id,
                  criterion: nextCriterion
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        if (bridgeInput.message.includes("name only delete")) {
          return {
            proposal: {
              replyMarkdown: "발표 논리력 항목 제거 확인을 준비했습니다.",
              operation: {
                method: "deleteCriterion",
                params: {
                  targetCriterionName: presentation.name
                }
              },
              source: "AI"
            },
            thoughtSummary: ""
          };
        }
        return {
          proposal: {
            replyMarkdown: "발표 논리력 항목 수정 초안을 만들었습니다.",
            operation: {
              method: "updateCriterion",
              params: {
                criterion: nextCriterion
              }
            },
            source: "AI"
          },
          thoughtSummary: ""
        };
      }
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const presentation = await createCustomReportCriterion(client, classroomId, {
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다."
      });
      await createCustomReportCriterion(client, classroomId, {
        name: "협업 태도",
        description: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다."
      });

      const unsafeCases = [
        { message: "unknown id 발표 논리력 수정", reason: "unknown_target" },
        { message: "id name mismatch 삭제", reason: "target_id_name_mismatch" },
        { message: "target 없이 수정", reason: "target_name_required" },
        { message: "발표 논리력 criterion 없이 수정", reason: "missing_update_criterion" },
        { message: "설명만 보고 주장과 근거를 연결하는 설명 수정", reason: "target_name_required" }
      ];
      for (const unsafeCase of unsafeCases) {
        const response = await client.request(
          `/classrooms/${classroomId}/report/criteria/assistant/stream`,
          {
            method: "POST",
            body: JSON.stringify({ message: unsafeCase.message })
          }
        );
        const proposal = parseNdjson(await response.text()).find(
          (event) => event.type === "proposal"
        )?.data;
        expect(proposal.operation.method).toBe("messageOnly");
        expect(proposal.downgradeReason).toBe(unsafeCase.reason);
        expect(proposal.operation.params).toBeUndefined();
        expect(proposal.replyMarkdown).toContain("어떤 추가 평가 항목을 수정하거나 삭제할지");
      }

      const deleteResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "name only delete" })
        }
      );
      const deleteProposal = parseNdjson(await deleteResponse.text()).find(
        (event) => event.type === "proposal"
      )?.data;
      expect(deleteProposal.operation.method).toBe("deleteCriterion");
      expect(deleteProposal.operation.params).toMatchObject({
        targetCriterionId: presentation.id,
        targetCriterionName: presentation.name,
        targetCriterionDescription: presentation.description,
        targetCriterionUpdatedAt: presentation.updatedAt
      });
      expect(deleteProposal.operation.params.criterion).toBeUndefined();

      const updateResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "발표 논리력 내용을 발표 구조화로 고쳐줘" })
        }
      );
      const updateProposal = parseNdjson(await updateResponse.text()).find(
        (event) => event.type === "proposal"
      )?.data;
      expect(updateProposal.operation.method).toBe("updateCriterion");
      expect(updateProposal.operation.params.targetCriterionId).toBe(presentation.id);
      expect(updateProposal.operation.params.criterion.name).toBe("발표 구조화");

      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("handles assistant update duplicate names while excluding the target itself", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async (input: unknown) => {
        const bridgeInput = input as {
          message: string;
          customCriteria: Array<{
            id: string;
            name: string;
            description: string;
            updatedAt: string;
          }>;
        };
        const presentation = bridgeInput.customCriteria.find(
          (criterion) => criterion.name === "발표 논리력"
        )!;
        const nextName = bridgeInput.message.includes("other duplicate")
          ? "협업 태도"
          : bridgeInput.message.includes("built duplicate")
            ? "개념 이해도"
            : "발표 논리력";
        return {
          proposal: {
            replyMarkdown: "발표 논리력 항목 수정 초안을 만들었습니다.",
            operation: {
              method: "updateCriterion",
              params: {
                targetCriterionId: presentation.id,
                targetCriterionName: presentation.name,
                targetCriterionDescription: presentation.description,
                targetCriterionUpdatedAt: presentation.updatedAt,
                criterion: {
                  name: nextName,
                  description: "기존 발표 기준 설명을 더 구체적으로 조정합니다."
                }
              }
            },
            source: "AI"
          },
          thoughtSummary: ""
        };
      }
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const presentation = await createCustomReportCriterion(client, classroomId, {
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다."
      });
      await createCustomReportCriterion(client, classroomId, {
        name: "협업 태도",
        description: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다."
      });

      const selfResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "발표 논리력 same self update" })
        }
      );
      const selfProposal = parseNdjson(await selfResponse.text()).find(
        (event) => event.type === "proposal"
      )?.data;
      expect(selfProposal.operation.method).toBe("updateCriterion");
      expect(selfProposal.operation.params.targetCriterionId).toBe(presentation.id);
      expect(selfProposal.operation.params.criterion.name).toBe("발표 논리력");
      expect(selfProposal.replyMarkdown).not.toContain("이름이 겹칠 수");

      const duplicateResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "발표 논리력 other duplicate update" })
        }
      );
      const duplicateProposal = parseNdjson(await duplicateResponse.text()).find(
        (event) => event.type === "proposal"
      )?.data;
      expect(duplicateProposal.operation.method).toBe("updateCriterion");
      expect(duplicateProposal.operation.params.criterion.name).toBe("협업 태도");
      expect(duplicateProposal.replyMarkdown).toContain("이름이 겹칠 수");

      const builtInDuplicateResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "발표 논리력 built duplicate update" })
        }
      );
      const builtInDuplicateProposal = parseNdjson(await builtInDuplicateResponse.text()).find(
        (event) => event.type === "proposal"
      )?.data;
      expect(builtInDuplicateProposal.operation.method).toBe("updateCriterion");
      expect(builtInDuplicateProposal.operation.params.criterion.name).toBe("개념 이해도");
      expect(builtInDuplicateProposal.replyMarkdown).toContain("이름이 겹칠 수");
      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("downgrades create when the teacher explicitly negates apply intent", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async () => ({
        proposal: {
          replyMarkdown: "초안을 보여드리겠습니다.",
          operation: {
            method: "createCriterion",
            params: {
              criterion: {
                name: "토론 근거력",
                description: "토론 중 주장과 근거를 연결해 말하는 정도를 평가합니다."
              }
            }
          },
          source: "AI"
        },
        thoughtSummary: ""
      })
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      for (const message of [
        "토론 근거력 항목은 반영하지 말고 초안만 보여줘",
        "이 항목을 추가하지는 말고 초안만 보여줘",
        "이 항목은 적용은 하지 말고 보기만 해줘",
        "이 제안을 저장하지는 마",
        "이 항목을 추가하지는",
        "이 항목은 적용은 하지",
        "이 제안을 저장하지는"
      ]) {
        const koreanResponse = await client.request(
          `/classrooms/${classroomId}/report/criteria/assistant/stream`,
          {
            method: "POST",
            body: JSON.stringify({ message })
          }
        );
        const koreanEvents = parseNdjson(await koreanResponse.text());
        const koreanProposal = koreanEvents.find((event) => event.type === "proposal")?.data;
        expect(koreanProposal.operation.method).toBe("draftCriterion");
      }

      const englishResponse = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "do not apply this, just draft it" })
        }
      );
      const englishEvents = parseNdjson(await englishResponse.text());
      const englishProposal = englishEvents.find((event) => event.type === "proposal")?.data;
      expect(englishProposal.operation.method).toBe("draftCriterion");
      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("returns duplicate-aware fallback proposal on bridge failure without mutating criteria", async () => {
    const server = await startServer({
      reportCriteriaAssistantChatStream: async () => {
        throw new Error("bridge unavailable");
      }
    } as any);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const createResponse = await client.request(`/classrooms/${classroomId}/report/criteria`, {
        method: "POST",
        body: JSON.stringify({
          name: "협업 태도",
          description: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다."
        })
      });
      expect(createResponse.status).toBe(201);

      const response = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "협업 태도 항목 추천해줘" })
        }
      );
      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      const proposal = events.find((event) => event.type === "proposal")?.data;
      expect(proposal.fallback).toBe(true);
      expect(proposal.operation.method).toBe("draftCriterion");
      expect(proposal.operation.params.criterion.name).toBe("협업 태도");
      expect(proposal.replyMarkdown).toContain("이름이 겹칠 수");
      expect(await server.store.listClassroomReportCriteria(classroomId)).toHaveLength(1);
      expect(server.logger.events.some((event) => event.name === "[report_criteria_assistant_stream_fallback]")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("returns fallback proposal on bridge timeout", async () => {
    const bridge = await startBridgeStreamServer(
      [`${JSON.stringify({ type: "thought_delta", text: "slow bridge" })}\n`],
      { hang: true }
    );
    const previousUrl = appConfig.aiBridgeUrl;
    Object.assign(appConfig, {
      aiBridgeUrl: bridge.baseUrl,
      reportCriteriaAssistantAiTimeoutMs: 1_000
    });
    const realBridge = new GeminiBridgeClient();
    const server = await startServer(realBridge);
    try {
      const { client, classroomId } = await createTeacherClassroom(server.baseUrl);
      const response = await client.request(
        `/classrooms/${classroomId}/report/criteria/assistant/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "협업 태도 항목을 추천해줘" })
        }
      );
      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      const proposal = events.find((event) => event.type === "proposal")?.data;
      expect(proposal.fallback).toBe(true);
      expect(events.at(-1)).toMatchObject({ type: "done" });
      expect(server.logger.events.some((event) => event.name === "[report_criteria_assistant_stream_fallback]")).toBe(true);
    } finally {
      Object.assign(appConfig, { aiBridgeUrl: previousUrl });
      await server.close();
      await bridge.close();
    }
  });

  it("GeminiBridgeClient report criteria stream validates protocol", async () => {
    const bridge = await startBridgeStreamServer([
      `${JSON.stringify({ type: "thought_delta", text: "working" })}\n`,
      `${JSON.stringify({ type: "done", data: null })}\n`
    ]);
    const previousUrl = appConfig.aiBridgeUrl;
    Object.assign(appConfig, { aiBridgeUrl: bridge.baseUrl });
    const client = new GeminiBridgeClient();
    try {
      await expect(
        client.reportCriteriaAssistantChatStream({
          model: "gemini-test",
          message: "항목",
          history: [],
          currentProposal: null,
          builtInCriteria: [],
          customCriteria: [],
          responseJsonSchema: {}
        })
      ).rejects.toThrow("did not return report criteria assistant JSON");
    } finally {
      Object.assign(appConfig, { aiBridgeUrl: previousUrl });
      await bridge.close();
    }
  });
});
