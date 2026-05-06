import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { appConfig } from "../config.js";
import { AuthService } from "../services/auth/AuthService.js";
import { DevEmailSender } from "../services/auth/EmailSender.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import { PublicUser } from "../types/domain.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-materials-route-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-materials-route-test");
const origin = "http://localhost:5173";

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

async function startServer() {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge: {} as any,
    pdfIngest: {} as any,
    engine: {} as any
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    store,
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
  const signupPayload = await signup.json() as {
    data: { user: PublicUser };
    devVerificationCode: string;
  };
  const verify = await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      code: signupPayload.devVerificationCode
    })
  });
  expect(verify.status).toBe(200);
  const verifyPayload = await verify.json() as { data: { user: PublicUser } };
  return { client, user: verifyPayload.data.user };
}

async function createPdfBackedLecture(
  store: JsonStore,
  input: { weekId: string; lectureId: string; title: string; pages: number; createdAt?: string }
) {
  await fs.mkdir(uploadDir, { recursive: true });
  const pdfPath = path.join(uploadDir, `${input.lectureId}.pdf`);
  const pageIndexPath = path.join(uploadDir, `${input.lectureId}.pageIndex.json`);
  await fs.writeFile(pdfPath, `%PDF-1.4\n% ${input.title}\n`, "utf-8");
  await fs.writeFile(
    pageIndexPath,
    JSON.stringify({ lectureId: input.lectureId, numPages: input.pages, pages: [] }),
    "utf-8"
  );
  const lecture = await store.createLecture({
    id: input.lectureId,
    weekId: input.weekId,
    title: input.title,
    pdfPath,
    numPages: input.pages,
    pageIndexPath
  });
  if (input.createdAt) {
    await store.updateLecture(lecture.id, { createdAt: input.createdAt, updatedAt: input.createdAt });
  }
  return (await store.getLecture(lecture.id))!;
}

describe("classroom materials routes", () => {
  it("lists only readable classroom PDF materials with week metadata", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "materials.teacher@example.com",
        role: "teacher",
        displayName: "Materials Teacher"
      });
      const student = await signupClient(server.baseUrl, {
        email: "materials.student@example.com",
        role: "student",
        displayName: "Materials Student"
      });
      const outsider = await signupClient(server.baseUrl, {
        email: "materials.outsider@example.com",
        role: "student",
        displayName: "Outsider"
      });

      const classroom = await server.store.createClassroom("자료실 강의실", teacher.user.id);
      const firstWeek = await server.store.createWeek(classroom.id, "1주차");
      const secondWeek = await server.store.createWeek(classroom.id, "2주차");
      await server.store.enrollStudent(classroom.id, student.user.id, teacher.user.id);
      await createPdfBackedLecture(server.store, {
        weekId: firstWeek.id,
        lectureId: "lec_materials_a",
        title: "MergeAISystem 가이드 테스트 자료",
        pages: 13
      });
      await createPdfBackedLecture(server.store, {
        weekId: secondWeek.id,
        lectureId: "lec_materials_b",
        title: "Transformer 기초 정리",
        pages: 18
      });

      const teacherResponse = await teacher.client.request(`/classrooms/${classroom.id}/materials`);
      expect(teacherResponse.status).toBe(200);
      const teacherPayload = await teacherResponse.json() as {
        data: Array<{ lecture: { title: string }; week: { title: string; weekIndex: number } }>;
      };
      expect(teacherPayload.data.map((row) => row.lecture.title)).toEqual([
        "MergeAISystem 가이드 테스트 자료",
        "Transformer 기초 정리"
      ]);
      expect(teacherPayload.data.map((row) => row.week.weekIndex)).toEqual([1, 2]);

      const studentResponse = await student.client.request(`/classrooms/${classroom.id}/materials`);
      expect(studentResponse.status).toBe(200);
      const outsiderResponse = await outsider.client.request(`/classrooms/${classroom.id}/materials`);
      expect(outsiderResponse.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("lets the owner rename, download, and delete the shared lecture record", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "materials-owner@example.com",
        role: "teacher",
        displayName: "Materials Owner"
      });
      const student = await signupClient(server.baseUrl, {
        email: "materials-reader@example.com",
        role: "student",
        displayName: "Materials Reader"
      });
      const outsider = await signupClient(server.baseUrl, {
        email: "materials-foreign@example.com",
        role: "student",
        displayName: "Foreign Student"
      });
      const classroom = await server.store.createClassroom("다운로드 강의실", teacher.user.id);
      const week = await server.store.createWeek(classroom.id, "1주차");
      await server.store.enrollStudent(classroom.id, student.user.id, teacher.user.id);
      const lecture = await createPdfBackedLecture(server.store, {
        weekId: week.id,
        lectureId: "lec_materials_download",
        title: "원본 자료",
        pages: 7
      });

      const forbiddenPatch = await student.client.request(`/lectures/${lecture.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "학생 수정 시도" })
      });
      expect(forbiddenPatch.status).toBe(403);

      const patch = await teacher.client.request(`/lectures/${lecture.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "수정된 자료 이름" })
      });
      expect(patch.status).toBe(200);
      expect((await server.store.getLecture(lecture.id))?.title).toBe("수정된 자료 이름");

      const download = await student.client.request(`/lectures/${lecture.id}/download`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toContain("application/pdf");
      expect(download.headers.get("content-disposition")).toContain("filename*=");
      expect(await download.text()).toContain("%PDF-1.4");

      const foreignDownload = await outsider.client.request(`/lectures/${lecture.id}/download`);
      expect(foreignDownload.status).toBe(403);

      const deleteResponse = await teacher.client.request(`/lectures/${lecture.id}`, { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      expect(await server.store.getLecture(lecture.id)).toBeNull();
      expect((await server.store.listLecturesByWeek(week.id))).toHaveLength(0);

      const afterDeleteMaterials = await teacher.client.request(`/classrooms/${classroom.id}/materials`);
      const afterDeletePayload = await afterDeleteMaterials.json() as { data: unknown[] };
      expect(afterDeletePayload.data).toHaveLength(0);

      const deletedSessionAccess = await teacher.client.request(`/session/by-lecture/${lecture.id}`);
      expect(deletedSessionAccess.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
