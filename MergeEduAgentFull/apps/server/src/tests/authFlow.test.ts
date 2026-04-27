import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { appConfig } from "../config.js";
import { AuthService } from "../services/auth/AuthService.js";
import { DevEmailSender, EmailSender, VerificationEmailInput } from "../services/auth/EmailSender.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-auth-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-auth-test");
const origin = "http://localhost:5173";

beforeEach(async () => {
  process.env.PORT = "4000";
  process.env.WEB_PORT = "5173";
  process.env.APP_ORIGIN = origin;
  process.env.MODEL_NAME = "gemini-1.5-pro";
  process.env.GOOGLE_API_KEY = "test-key";
  process.env.PASS_SCORE_RATIO = "0.7";
  process.env.CONTEXT_MAX_CHARS = "12000";
  process.env.RECENT_MESSAGES_N = "12";
  process.env.AI_BRIDGE_URL = "http://127.0.0.1:8001";
  process.env.DATA_DIR = "./apps/server/data-auth-test";
  process.env.UPLOAD_DIR = "./apps/server/uploads-auth-test";
  process.env.AUTH_DEV_EXPOSE_VERIFICATION_CODE = "true";
  Object.assign(appConfig, {
    appOrigin: origin,
    authDevExposeVerificationCode: true,
    authCookieName: "merge_edu_session",
    authBootstrapSecret: "test-bootstrap-secret",
    authEmailDeliveryMode: "dev",
    authEmailResendCooldownSeconds: 0,
    requestEncryptionMode: "optional",
    googleOAuthClientId: undefined,
    googleOAuthClientSecret: undefined,
    googleOAuthRedirectUri: undefined
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
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge: {} as any,
    pdfIngest: {} as any,
    engine: {} as any
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return {
    store,
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

class FakeEmailSender implements EmailSender {
  readonly mode = "smtp" as const;
  readonly canDeliverToInbox = true;
  readonly sent: VerificationEmailInput[] = [];

  async ensureReady(): Promise<void> {
    // Ready by construction.
  }

  async sendVerificationCode(input: VerificationEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

async function startAuthTestServerWithDeps(input: {
  emailSender?: EmailSender;
  requestEncryption?: RequestEncryptionService;
  codeGenerator?: () => string;
} = {}) {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const app = createApp({
    store,
    auth: new AuthService(store, {
      emailSender: input.emailSender ?? new DevEmailSender(),
      codeGenerator: input.codeGenerator
    }),
    requestEncryption: input.requestEncryption ?? new RequestEncryptionService(),
    bridge: {} as any,
    pdfIngest: {} as any,
    engine: {} as any
  });
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
    get cookie() {
      return cookie;
    },
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

async function encryptedBody(baseUrl: string, pathname: string, body: unknown) {
  const keyResponse = await fetch(`${baseUrl}/crypto/request-key`);
  expect(keyResponse.status).toBe(200);
  const keyPayload = (await keyResponse.json()) as {
    data: {
      kid: string;
      publicKeyJwk: crypto.JsonWebKey;
    };
  };
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const ts = Date.now();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const originalUrl = `/api${pathname}`;
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(Buffer.from(`POST ${originalUrl} ${ts} ${nonce}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(body), "utf-8"),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  const publicKey = crypto.createPublicKey({
    format: "jwk",
    key: keyPayload.data.publicKeyJwk
  });
  const ek = crypto.publicEncrypt(
    {
      key: publicKey,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
    },
    aesKey
  );

  return {
    enc: "req-v1",
    kid: keyPayload.data.kid,
    alg: "RSA-OAEP-256+A256GCM",
    ek: ek.toString("base64url"),
    iv: iv.toString("base64url"),
    ts,
    nonce,
    ciphertext: ciphertext.toString("base64url")
  };
}

async function signupAndVerify(
  client: ReturnType<typeof makeClient>,
  input: {
    email: string;
    displayName: string;
    role: "teacher" | "student";
  }
) {
  const signup = await client.request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      password: "password123"
    })
  });
  expect(signup.status).toBe(201);
  const signupPayload = (await signup.json()) as {
    data: { user: { id: string; inviteCode: string } };
    devVerificationCode: string;
  };
  const verify = await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      code: signupPayload.devVerificationCode
    })
  });
  expect(verify.ok).toBe(true);
  return signupPayload.data.user;
}

describe("auth and role routes", () => {
  it("sends verification emails through the injected sender and invalidates old resend codes", async () => {
    const sender = new FakeEmailSender();
    const codes = ["111111", "222222"];
    const server = await startAuthTestServerWithDeps({
      emailSender: sender,
      codeGenerator: () => codes.shift() ?? "333333"
    });
    try {
      const client = makeClient(server.baseUrl);
      const signup = await client.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "mail-flow@example.com",
          password: "password123",
          displayName: "Mail Flow",
          role: "teacher"
        })
      });
      expect(signup.status).toBe(201);
      expect(sender.sent).toHaveLength(1);
      const firstCode = sender.sent[0].code;

      const resend = await client.request("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: "mail-flow@example.com" })
      });
      expect(resend.status).toBe(200);
      expect(sender.sent).toHaveLength(2);
      const secondCode = sender.sent[1].code;
      expect(secondCode).not.toBe(firstCode);

      const oldCode = await client.request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: "mail-flow@example.com", code: firstCode })
      });
      expect(oldCode.status).toBe(400);

      const verify = await client.request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: "mail-flow@example.com", code: secondCode })
      });
      expect(verify.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("returns a friendly 409 for duplicate email variants", async () => {
    const server = await startAuthTestServerWithDeps();
    try {
      const client = makeClient(server.baseUrl);
      const signup = await client.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "duplicate@example.com",
          password: "password123",
          displayName: "Duplicate One",
          role: "teacher"
        })
      });
      expect(signup.status).toBe(201);

      const duplicate = await client.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: " DUPLICATE@EXAMPLE.COM ",
          password: "password123",
          displayName: "Duplicate Two",
          role: "teacher"
        })
      });
      expect(duplicate.status).toBe(409);
      const payload = (await duplicate.json()) as { code: string; error: string };
      expect(payload.code).toBe("EMAIL_ALREADY_EXISTS");
      expect(payload.error).toContain("이미 가입된 이메일");
    } finally {
      await server.close();
    }
  });

  it("wraps createUser duplicate races as EMAIL_ALREADY_EXISTS", async () => {
    const auth = new AuthService(
      {
        getUserByEmail: async () => null,
        checkAndIncrementRateLimit: async () => true,
        findStudentByInviteTag: async () => null,
        createUser: async () => {
          throw new Error("Email already exists");
        }
      } as any,
      { emailSender: new DevEmailSender(), codeGenerator: () => "123456" }
    );

    await expect(
      auth.register({
        email: "race@example.com",
        password: "password123",
        displayName: "Race Teacher",
        role: "teacher"
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_ALREADY_EXISTS"
    });
  });

  it("does not create unverifiable dev accounts when no inbox delivery or dev code is available", async () => {
    Object.assign(appConfig, {
      authEmailDeliveryMode: "dev",
      authDevExposeVerificationCode: false
    });
    process.env.AUTH_DEV_EXPOSE_VERIFICATION_CODE = "false";
    const server = await startAuthTestServerWithDeps();
    try {
      const client = makeClient(server.baseUrl);
      const signup = await client.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "no-delivery@example.com",
          password: "password123",
          displayName: "No Delivery",
          role: "teacher"
        })
      });
      expect(signup.status).toBe(500);
      const payload = (await signup.json()) as { code: string; error: string };
      expect(payload.code).toBe("EMAIL_SENDER_NOT_CONFIGURED");
      expect(payload.error).toContain("실제 인증 메일 발송");
      expect(await server.store.getUserByEmail("no-delivery@example.com")).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("accepts encrypted auth JSON bodies and rejects plaintext on required auth paths", async () => {
    Object.assign(appConfig, { requestEncryptionMode: "required" });
    const sender = new FakeEmailSender();
    const server = await startAuthTestServerWithDeps({ emailSender: sender });
    try {
      const client = makeClient(server.baseUrl);
      const plaintext = await client.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "plain-required@example.com",
          password: "password123",
          displayName: "Plain Required",
          role: "teacher"
        })
      });
      expect(plaintext.status).toBe(400);

      const encrypted = await encryptedBody(server.baseUrl, "/auth/signup", {
        email: "encrypted-required@example.com",
        password: "password123",
        displayName: "Encrypted Required",
        role: "teacher"
      });
      const signup = await client.request("/auth/signup", {
        method: "POST",
        headers: {
          "x-request-encryption": "req-v1"
        },
        body: JSON.stringify(encrypted)
      });
      expect(signup.status).toBe(201);
      expect(sender.sent).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("rejects malformed roles, unverified login, and verify-email session minting", async () => {
    const server = await startTestServer();
    try {
      const attacker = makeClient(server.baseUrl);
      const noRole = await attacker.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "bad-role@example.com",
          password: "password123",
          displayName: "Bad Role",
          role: "admin"
        })
      });
      expect(noRole.status).toBe(400);

      const signup = await attacker.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "pending@example.com",
          password: "password123",
          displayName: "Pending Teacher",
          role: "teacher"
        })
      });
      expect(signup.status).toBe(201);

      const pendingLogin = await attacker.request("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "pending@example.com",
          password: "password123"
        })
      });
      expect(pendingLogin.status).toBe(403);

      const teacher = makeClient(server.baseUrl);
      await signupAndVerify(teacher, {
        email: "verified@example.com",
        displayName: "Verified Teacher",
        role: "teacher"
      });
      const verifyAgain = await attacker.request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({
          email: "verified@example.com",
          code: "000000"
        })
      });
      expect(verifyAgain.status).toBe(400);

      const attackerMe = await attacker.request("/auth/me");
      expect(attackerMe.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("scopes classrooms by teacher ownership and student enrollment", async () => {
    const server = await startTestServer();
    try {
      const teacher = makeClient(server.baseUrl);
      const student = makeClient(server.baseUrl);
      const teacherUser = await signupAndVerify(teacher, {
        email: "teacher@example.com",
        displayName: "Teacher Kim",
        role: "teacher"
      });
      const studentUser = await signupAndVerify(student, {
        email: "student@example.com",
        displayName: "Student Lee",
        role: "student"
      });

      const studentCreate = await student.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "학생 생성 시도" })
      });
      expect(studentCreate.status).toBe(403);

      const created = await teacher.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "선생님 강의실" })
      });
      expect(created.status).toBe(201);
      const createdPayload = (await created.json()) as { data: { id: string; teacherId: string } };
      expect(createdPayload.data.teacherId).toBe(teacherUser.id);

      const beforeInvite = await student.request("/classrooms");
      expect(beforeInvite.status).toBe(200);
      expect(((await beforeInvite.json()) as { data: unknown[] }).data).toHaveLength(0);

      const search = await teacher.request(
        `/students/search?name=${encodeURIComponent("Student Lee")}&code=${studentUser.inviteCode}&classroomId=${createdPayload.data.id}`
      );
      expect(search.status).toBe(200);

      const unprovedInvite = await teacher.request(`/classrooms/${createdPayload.data.id}/students`, {
        method: "POST",
        body: JSON.stringify({ studentUserId: studentUser.id })
      });
      expect(unprovedInvite.status).toBe(400);

      const invite = await teacher.request(`/classrooms/${createdPayload.data.id}/students`, {
        method: "POST",
        body: JSON.stringify({
          studentUserId: studentUser.id,
          name: "Student Lee",
          code: studentUser.inviteCode
        })
      });
      expect(invite.status).toBe(201);

      const afterInvite = await student.request("/classrooms");
      expect(afterInvite.status).toBe(200);
      expect(((await afterInvite.json()) as { data: unknown[] }).data).toHaveLength(1);

      const logout = await teacher.request("/auth/logout", { method: "POST" });
      expect(logout.status).toBe(200);
      const meAfterLogout = await teacher.request("/auth/me");
      expect(meAfterLogout.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("blocks invite search for classrooms owned by another teacher", async () => {
    const server = await startTestServer();
    try {
      const teacherA = makeClient(server.baseUrl);
      const teacherB = makeClient(server.baseUrl);
      const student = makeClient(server.baseUrl);
      await signupAndVerify(teacherA, {
        email: "teacher-a@example.com",
        displayName: "Teacher A",
        role: "teacher"
      });
      await signupAndVerify(teacherB, {
        email: "teacher-b@example.com",
        displayName: "Teacher B",
        role: "teacher"
      });
      const studentUser = await signupAndVerify(student, {
        email: "student-b@example.com",
        displayName: "Search Target",
        role: "student"
      });
      const classroomB = await teacherB.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "다른 선생님 강의실" })
      });
      const classroomPayload = (await classroomB.json()) as { data: { id: string } };

      const forbiddenSearch = await teacherA.request(
        `/students/search?name=${encodeURIComponent("Search Target")}&code=${studentUser.inviteCode}&classroomId=${classroomPayload.data.id}`
      );
      expect(forbiddenSearch.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("re-checks enrollment before existing session writes and keeps student reads side-effect free", async () => {
    const server = await startTestServer();
    try {
      const teacher = makeClient(server.baseUrl);
      const student = makeClient(server.baseUrl);
      await signupAndVerify(teacher, {
        email: "session-teacher@example.com",
        displayName: "Session Teacher",
        role: "teacher"
      });
      const studentUser = await signupAndVerify(student, {
        email: "session-student@example.com",
        displayName: "Session Student",
        role: "student"
      });
      const classroom = await teacher.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "세션 강의실" })
      });
      const classroomPayload = (await classroom.json()) as { data: { id: string } };
      const week = await server.store.createWeek(classroomPayload.data.id, "1주차");
      await fs.mkdir(uploadDir, { recursive: true });
      const pdfPath = path.join(uploadDir, "side-effect-test.pdf");
      const pageIndexPath = path.join(uploadDir, "side-effect-test.pageIndex.json");
      await fs.writeFile(pdfPath, "%PDF-1.4\n", "utf-8");
      await fs.writeFile(pageIndexPath, JSON.stringify({ lectureId: "x", numPages: 1, pages: [] }), "utf-8");
      const lecture = await server.store.createLecture({
        weekId: week.id,
        title: "권한 테스트 자료",
        pdfPath,
        numPages: 1,
        pageIndexPath,
        geminiFile: {
          fileName: "files/auth-flow-test",
          fileUri: "https://example.test/auth-flow-test.pdf",
          mimeType: "application/pdf"
        }
      });

      const teacherByLecture = await teacher.request(`/session/by-lecture/${lecture.id}`);
      expect(teacherByLecture.status).toBe(200);
      const teacherByLecturePayload = (await teacherByLecture.json()) as {
        data: { aiStatus: { connected: boolean; message?: string } };
      };
      expect(teacherByLecturePayload.data.aiStatus.connected).toBe(true);

      await teacher.request(`/classrooms/${classroomPayload.data.id}/students`, {
        method: "POST",
        body: JSON.stringify({
          studentUserId: studentUser.id,
          name: "Session Student",
          code: studentUser.inviteCode
        })
      });

      const byLecture = await student.request(`/session/by-lecture/${lecture.id}`);
      expect(byLecture.status).toBe(200);
      const byLecturePayload = (await byLecture.json()) as {
        data: { session: { sessionId: string }; aiStatus: { connected: boolean; message?: string } };
      };
      expect(byLecturePayload.data.aiStatus.connected).toBe(true);
      expect((await server.store.getLecture(lecture.id))?.pdf.geminiFile).toBeDefined();

      const remove = await teacher.request(
        `/classrooms/${classroomPayload.data.id}/students/${studentUser.id}`,
        { method: "DELETE" }
      );
      expect(remove.status).toBe(200);

      const eventAfterRemoval = await student.request(
        `/session/${byLecturePayload.data.session.sessionId}/event`,
        {
          method: "POST",
          body: JSON.stringify({ event: { type: "SESSION_ENTERED" } })
        }
      );
      expect(eventAfterRemoval.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("denies cross-classroom week, lecture, and PDF reads", async () => {
    const server = await startTestServer();
    try {
      const owner = makeClient(server.baseUrl);
      const otherTeacher = makeClient(server.baseUrl);
      const unrelatedStudent = makeClient(server.baseUrl);
      const ownerUser = await signupAndVerify(owner, {
        email: "read-owner@example.com",
        displayName: "Read Owner",
        role: "teacher"
      });
      await signupAndVerify(otherTeacher, {
        email: "read-other-teacher@example.com",
        displayName: "Other Teacher",
        role: "teacher"
      });
      await signupAndVerify(unrelatedStudent, {
        email: "read-student@example.com",
        displayName: "Unrelated Student",
        role: "student"
      });

      const classroom = await server.store.createClassroom("비공개 강의실", ownerUser.id);
      const week = await server.store.createWeek(classroom.id, "읽기 권한 주차");
      await fs.mkdir(uploadDir, { recursive: true });
      const pdfPath = path.join(uploadDir, "private-lecture.pdf");
      const pageIndexPath = path.join(uploadDir, "private-lecture.pageIndex.json");
      await fs.writeFile(pdfPath, "%PDF-1.4\n", "utf-8");
      await fs.writeFile(pageIndexPath, JSON.stringify({ lectureId: "x", numPages: 1, pages: [] }), "utf-8");
      await server.store.createLecture({
        weekId: week.id,
        title: "비공개 자료",
        pdfPath,
        numPages: 1,
        pageIndexPath
      });

      const ownerPdf = await owner.request("/uploads/private-lecture.pdf");
      expect(ownerPdf.status).toBe(200);

      const foreignWeeks = await otherTeacher.request(`/classrooms/${classroom.id}/weeks`);
      expect(foreignWeeks.status).toBe(403);

      const foreignLectures = await otherTeacher.request(`/weeks/${week.id}/lectures`);
      expect(foreignLectures.status).toBe(403);

      const foreignPdf = await unrelatedStudent.request("/uploads/private-lecture.pdf");
      expect(foreignPdf.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("keeps Google disabled when unconfigured and claims legacy classrooms with bootstrap secret", async () => {
    const server = await startTestServer();
    try {
      const teacher = makeClient(server.baseUrl);
      const legacy = await server.store.createClassroom("기존 강의실");
      await signupAndVerify(teacher, {
        email: "bootstrap-teacher@example.com",
        displayName: "Bootstrap Teacher",
        role: "teacher"
      });

      const googleStatus = await teacher.request("/auth/google/status");
      expect(googleStatus.status).toBe(200);
      expect(((await googleStatus.json()) as { data: { enabled: boolean } }).data.enabled).toBe(false);
      const googleStart = await teacher.request("/auth/google?role=teacher");
      expect(googleStart.status).toBe(503);

      const wrongSecret = await teacher.request("/auth/bootstrap/claim-legacy-classrooms", {
        method: "POST",
        body: JSON.stringify({ secret: "wrong" })
      });
      expect(wrongSecret.status).toBe(403);

      const correctSecret = await teacher.request("/auth/bootstrap/claim-legacy-classrooms", {
        method: "POST",
        body: JSON.stringify({ secret: "test-bootstrap-secret" })
      });
      expect(correctSecret.status).toBe(200);
      const claimed = await server.store.getClassroom(legacy.id);
      expect(claimed?.teacherId).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
