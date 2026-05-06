import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { appConfig } from "../config.js";
import { AuthService } from "../services/auth/AuthService.js";
import { DevEmailSender } from "../services/auth/EmailSender.js";
import { SystemExamClock } from "../services/exams/ExamClock.js";
import { ConsoleExamLogger } from "../services/exams/ExamLogger.js";
import { TeacherExamGradingService } from "../services/exams/TeacherExamGradingService.js";
import { TeacherExamService } from "../services/exams/TeacherExamService.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import { PublicUser } from "../types/domain.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-exam-settings-route-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-exam-settings-route-test");
const origin = "http://localhost:5173";

const draft = {
  title: "1주차 개념 확인 시험",
  descriptionMarkdown: "",
  availableFrom: "2026-05-02T00:00:00.000Z",
  availableUntil: "2026-05-03T00:00:00.000Z",
  timeLimitMinutes: 30,
  passScoreRatio: 0.7,
  aiGradingEnabled: true,
  questions: [
    {
      id: "q1",
      type: "MCQ",
      promptMarkdown: "정답은?",
      points: 5,
      choices: [
        { id: "a", textMarkdown: "A" },
        { id: "b", textMarkdown: "B" }
      ],
      answer: { choiceId: "b" }
    }
  ]
} as const;

class MutableClock extends SystemExamClock {
  constructor(private current: string) {
    super();
  }

  set(value: string) {
    this.current = value;
  }

  now(): Date {
    return new Date(this.current);
  }
}

beforeEach(async () => {
  Object.assign(appConfig, {
    appOrigin: origin,
    authDevExposeVerificationCode: true,
    authCookieName: "merge_edu_session",
    authEmailDeliveryMode: "dev",
    authEmailResendCooldownSeconds: 0,
    requestEncryptionMode: "optional",
    requestEncryptionRequiredPaths: []
  });
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

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
      const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    }
  };
}

async function startServer(clock = new MutableClock("2026-05-02T00:10:00.000Z")) {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge: {} as any,
    pdfIngest: {} as any,
    engine: {} as any,
    examClock: clock
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    store,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function signupClient(
  baseUrl: string,
  input: { email: string; role: "teacher" | "student"; displayName: string }
): Promise<{ client: ReturnType<typeof makeClient>; user: PublicUser }> {
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
  expect(signup.status).toBe(201);
  const signupPayload = await signup.json() as { data: { user: PublicUser }; devVerificationCode: string };
  const verify = await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email: input.email, code: signupPayload.devVerificationCode })
  });
  expect(verify.status).toBe(200);
  const verifyPayload = await verify.json() as { data: { user: PublicUser } };
  return { client, user: verifyPayload.data.user };
}

describe("exam settings route", () => {
  it("allows only the classroom teacher to patch settings and preserves questions", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "settings.teacher@example.com",
        role: "teacher",
        displayName: "설정 선생님"
      });
      const otherTeacher = await signupClient(server.baseUrl, {
        email: "settings.other@example.com",
        role: "teacher",
        displayName: "다른 선생님"
      });
      const student = await signupClient(server.baseUrl, {
        email: "settings.student@example.com",
        role: "student",
        displayName: "설정 학생"
      });
      const classroom = await server.store.createClassroom("설정 강의실", teacher.user.id);
      const week = await server.store.createWeek(classroom.id, "1주차");
      const service = new TeacherExamService(
        server.store,
        new TeacherExamGradingService(),
        new SystemExamClock(),
        new ConsoleExamLogger()
      );
      const exam = await service.createExam(week.id, classroom.id, draft);

      const studentResponse = await student.client.request(`/exams/${exam.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "학생 수정",
          availableFrom: "2026-05-02T01:00:00.000Z",
          availableUntil: "2026-05-03T01:00:00.000Z",
          timeLimitMinutes: 45
        })
      });
      expect(studentResponse.status).toBe(403);

      const otherTeacherResponse = await otherTeacher.client.request(`/exams/${exam.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "타교사 수정",
          availableFrom: "2026-05-02T01:00:00.000Z",
          availableUntil: "2026-05-03T01:00:00.000Z",
          timeLimitMinutes: 45
        })
      });
      expect(otherTeacherResponse.status).toBe(403);

      const invalidResponse = await teacher.client.request(`/exams/${exam.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "",
          availableFrom: "2026-05-03T01:00:00.000Z",
          availableUntil: "2026-05-02T01:00:00.000Z",
          timeLimitMinutes: 999
        })
      });
      expect(invalidResponse.status).toBe(400);

      const response = await teacher.client.request(`/exams/${exam.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "1주차 개념 확인 시험 수정",
          availableFrom: "2026-05-02T01:00:00.000Z",
          availableUntil: "2026-05-03T01:00:00.000Z",
          timeLimitMinutes: 45,
          questions: [{ id: "malicious" }]
        })
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as { data: Awaited<ReturnType<TeacherExamService["teacherDto"]>> };
      expect(payload.data.draftRevision.title).toBe("1주차 개념 확인 시험 수정");
      expect(payload.data.draftRevision.timeLimitMinutes).toBe(45);
      expect(payload.data.draftRevision.questions[0].id).toBe("q1");
    } finally {
      await server.close();
    }
  });

  it("rejects malformed teacher exam creation schedules", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "settings.create.invalid.teacher@example.com",
        role: "teacher",
        displayName: "생성 검증 선생님"
      });
      const classroom = await server.store.createClassroom("생성 검증 강의실", teacher.user.id);
      const week = await server.store.createWeek(classroom.id, "1주차");
      const invalidDrafts = [
        { ...draft, availableFrom: "not-a-date" },
        { ...draft, availableUntil: "2026-02-31T14:00:00+09:00" },
        { ...draft, availableFrom: "2026-05-02T15:30:00" },
        { ...draft, availableFrom: "2026-05-03T00:00:00.000Z", availableUntil: "2026-05-02T00:00:00.000Z" },
        { ...draft, timeLimitMinutes: 45.5 }
      ];

      for (const invalidDraft of invalidDrafts) {
        const response = await teacher.client.request(`/weeks/${week.id}/exams`, {
          method: "POST",
          body: JSON.stringify(invalidDraft)
        });
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
      }

      const listResponse = await teacher.client.request(`/weeks/${week.id}/exams`);
      expect(listResponse.status).toBe(200);
      const listPayload = await listResponse.json() as { data: unknown[] };
      expect(listPayload.data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("keeps ended exams readable/deletable but blocks teacher mutation routes", async () => {
    const clock = new MutableClock("2026-05-02T00:10:00.000Z");
    const server = await startServer(clock);
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "settings.ended.teacher@example.com",
        role: "teacher",
        displayName: "종료 선생님"
      });
      const classroom = await server.store.createClassroom("종료 강의실", teacher.user.id);
      const week = await server.store.createWeek(classroom.id, "1주차");
      const service = new TeacherExamService(
        server.store,
        new TeacherExamGradingService(),
        clock,
        new ConsoleExamLogger()
      );
      const exam = await service.createExam(week.id, classroom.id, draft);
      const published = await service.publish(exam.id, draft);

      clock.set("2026-05-03T00:00:01.000Z");

      const listResponse = await teacher.client.request(`/weeks/${week.id}/exams`);
      expect(listResponse.status).toBe(200);

      const getResponse = await teacher.client.request(`/exams/${published.id}`);
      expect(getResponse.status).toBe(200);

      const reportResponse = await teacher.client.request(`/exams/${published.id}/report`);
      expect(reportResponse.status).toBe(200);

      const settingsResponse = await teacher.client.request(`/exams/${published.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "종료 설정 수정",
          availableFrom: "2026-05-04T00:00:00.000Z",
          availableUntil: "2026-05-05T00:00:00.000Z",
          timeLimitMinutes: 45
        })
      });
      expect(settingsResponse.status).toBe(409);
      await expect(settingsResponse.json()).resolves.toMatchObject({ code: "EXAM_ENDED" });

      const draftResponse = await teacher.client.request(`/exams/${published.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...draft,
          title: "종료 드래프트 수정",
          availableFrom: "2026-05-04T00:00:00.000Z",
          availableUntil: "2026-05-05T00:00:00.000Z"
        })
      });
      expect(draftResponse.status).toBe(409);
      await expect(draftResponse.json()).resolves.toMatchObject({ code: "EXAM_ENDED" });

      const publishResponse = await teacher.client.request(`/exams/${published.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          title: "종료 재게시",
          availableFrom: "2026-05-04T00:00:00.000Z",
          availableUntil: "2026-05-05T00:00:00.000Z"
        })
      });
      expect(publishResponse.status).toBe(409);
      await expect(publishResponse.json()).resolves.toMatchObject({ code: "EXAM_ENDED" });

      const deleteResponse = await teacher.client.request(`/exams/${published.id}`, {
        method: "DELETE"
      });
      expect(deleteResponse.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
