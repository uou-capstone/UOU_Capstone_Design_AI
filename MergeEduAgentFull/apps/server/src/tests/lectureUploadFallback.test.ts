import fs from "node:fs/promises";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { appConfig } from "../config.js";
import { AuthService } from "../services/auth/AuthService.js";
import { DevEmailSender } from "../services/auth/EmailSender.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-upload-fallback-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-upload-fallback-test");
const origin = "http://localhost:5173";

beforeEach(async () => {
  Object.assign(appConfig, {
    appOrigin: origin,
    authDevExposeVerificationCode: true,
    authCookieName: "merge_edu_session",
    requestEncryptionMode: "optional"
  });
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

async function startTestServer() {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const pdfIngest = {
    ensurePdfMagic: async (buffer: Buffer) => {
      if (buffer.subarray(0, 4).toString("utf-8") !== "%PDF") {
        throw new Error("Invalid PDF signature");
      }
    },
    savePdf: async (lectureId: string, buffer: Buffer) => {
      await fs.mkdir(uploadDir, { recursive: true });
      const pdfPath = path.join(uploadDir, `${lectureId}.pdf`);
      await fs.writeFile(pdfPath, buffer);
      return pdfPath;
    },
    buildPageIndex: async (lectureId: string) => {
      await fs.mkdir(uploadDir, { recursive: true });
      const indexPath = path.join(uploadDir, `${lectureId}.pageIndex.json`);
      await fs.writeFile(
        indexPath,
        JSON.stringify({
          lectureId,
          numPages: 1,
          pages: [{ page: 1, text: "로컬 fallback 테스트 페이지입니다." }]
        }),
        "utf-8"
      );
      return { numPages: 1, indexPath };
    }
  };
  const bridge = {
    uploadPdf: async () => {
      throw new Error("Gemini upload failed: API Key not found");
    }
  };
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge,
    pdfIngest,
    engine: {}
  } as any);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return {
    store,
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function makeClient(baseUrl: string) {
  let cookie = "";
  return {
    async request(pathname: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      const isForm = init.body instanceof FormData;
      if (!headers.has("content-type") && init.body && !isForm) {
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

async function signupAndVerifyTeacher(client: ReturnType<typeof makeClient>) {
  const signup = await client.request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: "upload-teacher@example.com",
      password: "password123",
      displayName: "Upload Teacher",
      role: "teacher"
    })
  });
  expect(signup.status).toBe(201);
  const signupPayload = (await signup.json()) as { devVerificationCode: string };
  const verify = await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email: "upload-teacher@example.com",
      code: signupPayload.devVerificationCode
    })
  });
  expect(verify.ok).toBe(true);
}

describe("lecture upload Gemini failure", () => {
  it("does not create a lecture when Gemini upload fails", async () => {
    const server = await startTestServer();
    try {
      const teacher = makeClient(server.baseUrl);
      await signupAndVerifyTeacher(teacher);
      const classroom = await teacher.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "Fallback 강의실" })
      });
      const classroomPayload = (await classroom.json()) as { data: { id: string } };
      const week = await teacher.request(`/classrooms/${classroomPayload.data.id}/weeks`, {
        method: "POST",
        body: JSON.stringify({})
      });
      const weekPayload = (await week.json()) as { data: { id: string } };

      const form = new FormData();
      form.append("title", "Fallback 자료");
      form.append("pdf", new Blob(["%PDF-1.4\n"], { type: "application/pdf" }), "fallback.pdf");
      const upload = await teacher.request(`/weeks/${weekPayload.data.id}/lectures`, {
        method: "POST",
        body: form
      });

      expect(upload.status).toBe(502);
      const payload = (await upload.json()) as {
        error: string;
      };
      expect(payload.error).toContain("Gemini PDF 업로드");
      expect(payload.error).not.toContain("API Key not found");
      expect(await server.store.listLecturesByWeek(weekPayload.data.id)).toHaveLength(0);
      const remainingFiles = await fs.readdir(uploadDir).catch(() => []);
      expect(remainingFiles.filter((fileName) => fileName.endsWith(".pdf"))).toHaveLength(0);
      expect(remainingFiles.filter((fileName) => fileName.endsWith(".pageIndex.json"))).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("returns a controlled 400 for invalid PDF content", async () => {
    const server = await startTestServer();
    try {
      const teacher = makeClient(server.baseUrl);
      await signupAndVerifyTeacher(teacher);
      const classroom = await teacher.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "Invalid PDF 강의실" })
      });
      const classroomPayload = (await classroom.json()) as { data: { id: string } };
      const week = await teacher.request(`/classrooms/${classroomPayload.data.id}/weeks`, {
        method: "POST",
        body: JSON.stringify({})
      });
      const weekPayload = (await week.json()) as { data: { id: string } };

      const form = new FormData();
      form.append("title", "Invalid 자료");
      form.append("pdf", new Blob(["not a pdf"], { type: "application/pdf" }), "invalid.pdf");
      const upload = await teacher.request(`/weeks/${weekPayload.data.id}/lectures`, {
        method: "POST",
        body: form
      });
      const payload = (await upload.json()) as { error: string };

      expect(upload.status).toBe(400);
      expect(payload.error).toBe("유효한 PDF 파일을 업로드해 주세요.");
    } finally {
      await server.close();
    }
  });
});
