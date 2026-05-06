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

const dataDirPrefix = path.resolve(process.cwd(), "apps/server/data-auth-test-");
const uploadDirPrefix = path.resolve(process.cwd(), "apps/server/uploads-auth-test-");
let testDir = "";
let uploadDir = "";
const origin = "http://localhost:5173";

beforeEach(async () => {
  testDir = await fs.mkdtemp(dataDirPrefix);
  uploadDir = await fs.mkdtemp(uploadDirPrefix);
  process.env.PORT = "4000";
  process.env.WEB_PORT = "5173";
  process.env.APP_ORIGIN = origin;
  process.env.MODEL_NAME = "gemini-1.5-pro";
  process.env.GOOGLE_API_KEY = "test-key";
  process.env.PASS_SCORE_RATIO = "0.7";
  process.env.CONTEXT_MAX_CHARS = "12000";
  process.env.RECENT_MESSAGES_N = "12";
  process.env.AI_BRIDGE_URL = "http://127.0.0.1:8001";
  process.env.DATA_DIR = testDir;
  process.env.UPLOAD_DIR = uploadDir;
  process.env.AUTH_DEV_EXPOSE_VERIFICATION_CODE = "true";
  Object.assign(appConfig, {
    appOrigin: origin,
    authDevExposeVerificationCode: true,
    authCookieName: "merge_edu_session",
    authBootstrapSecret: "test-bootstrap-secret",
    authEmailDeliveryMode: "dev",
    authEmailResendCooldownSeconds: 0,
    requestEncryptionMode: "optional",
    requestEncryptionRequiredPaths: [
      "/api/auth/signup",
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/verify-email",
      "/api/auth/resend-verification",
      "/api/auth/me"
    ],
    googleOAuthClientId: undefined,
    googleOAuthClientSecret: undefined,
    googleOAuthRedirectUri: undefined
  });
});

afterEach(async () => {
  if (testDir) await fs.rm(testDir, { recursive: true, force: true });
  if (uploadDir) await fs.rm(uploadDir, { recursive: true, force: true });
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

async function encryptedBody(
  baseUrl: string,
  pathname: string,
  body: unknown,
  method = "POST"
) {
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
  cipher.setAAD(Buffer.from(`${method.toUpperCase()} ${originalUrl} ${ts} ${nonce}`));
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

async function acceptFirstPendingInvitation(client: ReturnType<typeof makeClient>) {
  const inbox = await client.request("/students/invitations");
  expect(inbox.status).toBe(200);
  const inboxPayload = (await inbox.json()) as {
    data: Array<{ id: string; status: string; classroomId: string }>;
  };
  expect(inboxPayload.data.length).toBeGreaterThan(0);
  const invitation = inboxPayload.data[0];
  expect(invitation.status).toBe("PENDING");
  const accepted = await client.request(`/students/invitations/${invitation.id}/accept`, {
    method: "POST"
  });
  expect(accepted.status).toBe(200);
  return invitation;
}

describe.sequential("auth and role routes", () => {
  it("updates account email and password, then requires new email verification", async () => {
    const server = await startTestServer();
    try {
      const client = makeClient(server.baseUrl);
      const oldEmail = "account-update@example.com";
      const newEmail = "account-updated@example.com";
      const oldPassword = "password123";
      const newPassword = "newpassword123";
      await signupAndVerify(client, {
        email: oldEmail,
        displayName: "Account Update",
        role: "teacher"
      });

      const update = await client.request("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          email: newEmail,
          currentPassword: oldPassword,
          password: newPassword
        })
      });
      expect(update.status).toBe(200);
      const updatePayload = (await update.json()) as {
        data: { user: { email: string; emailVerified: boolean; hasPassword: boolean } };
        devVerificationCode: string;
      };
      expect(updatePayload.data.user.email).toBe(newEmail);
      expect(updatePayload.data.user.emailVerified).toBe(false);
      expect(updatePayload.data.user.hasPassword).toBe(true);
      expect(updatePayload.devVerificationCode).toMatch(/^\d{6}$/);

      const verify = await client.request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({
          email: newEmail,
          code: updatePayload.devVerificationCode
        })
      });
      expect(verify.status).toBe(200);

      const logout = await client.request("/auth/logout", { method: "POST" });
      expect(logout.status).toBe(200);

      const oldLogin = await client.request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: oldEmail, password: oldPassword })
      });
      expect(oldLogin.status).toBe(401);

      const wrongPassword = await client.request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: newEmail, password: oldPassword })
      });
      expect(wrongPassword.status).toBe(401);

      const newLogin = await client.request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: newEmail, password: newPassword })
      });
      expect(newLogin.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects duplicate account email, weak password, and wrong current password", async () => {
    const server = await startTestServer();
    try {
      const first = makeClient(server.baseUrl);
      const second = makeClient(server.baseUrl);
      await signupAndVerify(first, {
        email: "first-account@example.com",
        displayName: "First Account",
        role: "teacher"
      });
      await signupAndVerify(second, {
        email: "second-account@example.com",
        displayName: "Second Account",
        role: "teacher"
      });

      const duplicate = await first.request("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          email: "second-account@example.com",
          currentPassword: "password123"
        })
      });
      expect(duplicate.status).toBe(409);
      expect(((await duplicate.json()) as { code: string }).code).toBe("EMAIL_ALREADY_EXISTS");

      const wrongCurrent = await first.request("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          email: "first-new@example.com",
          currentPassword: "wrong-password"
        })
      });
      expect(wrongCurrent.status).toBe(401);
      expect(((await wrongCurrent.json()) as { code: string }).code).toBe("INVALID_CREDENTIALS");

      const weakPassword = await first.request("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          email: "first-account@example.com",
          currentPassword: "password123",
          password: "short"
        })
      });
      expect(weakPassword.status).toBe(400);
      expect(((await weakPassword.json()) as { code: string }).code).toBe("WEAK_PASSWORD");
    } finally {
      await server.close();
    }
  });

  it("wraps account update duplicate races as EMAIL_ALREADY_EXISTS", async () => {
    const now = new Date().toISOString();
    const { passwordHash, passwordSalt } = await new AuthService({} as any).hashPassword("password123");
    const auth = new AuthService(
      {
        getUser: async () => {
          return {
            id: "usr_race",
            email: "race-account@example.com",
            emailNormalized: "race-account@example.com",
            displayName: "Race Account",
            role: "teacher",
            inviteCode: "1234",
            passwordHash,
            passwordSalt,
            emailVerifiedAt: now,
            createdAt: now,
            updatedAt: now
          };
        },
        getUserByEmail: async () => null,
        updateUser: async () => {
          throw new Error("Email already exists");
        }
      } as any,
      { emailSender: new DevEmailSender(), codeGenerator: () => "123456" }
    );

    await expect(
      auth.updateAccount({
        userId: "usr_race",
        email: "race-new@example.com",
        currentPassword: "password123"
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_ALREADY_EXISTS"
    });
  });

  it("requires encrypted account update bodies when request encryption is required", async () => {
    const server = await startTestServer();
    try {
      const client = makeClient(server.baseUrl);
      await signupAndVerify(client, {
        email: "encrypted-account@example.com",
        displayName: "Encrypted Account",
        role: "teacher"
      });
      Object.assign(appConfig, {
        requestEncryptionMode: "required",
        requestEncryptionRequiredPaths: [
          "/api/auth/signup",
          "/api/auth/register",
          "/api/auth/login",
          "/api/auth/verify-email",
          "/api/auth/resend-verification",
          "/api/auth/me"
        ]
      });

      const plaintext = await client.request("/auth/me/", {
        method: "PATCH",
        body: JSON.stringify({
          email: "encrypted-account@example.com",
          currentPassword: "password123",
          password: "newpassword123"
        })
      });
      expect(plaintext.status).toBe(400);
      expect(((await plaintext.json()) as { code: string }).code).toBe("REQUEST_ENCRYPTION_REQUIRED");

      const encrypted = await encryptedBody(
        server.baseUrl,
        "/auth/me",
        {
          email: "encrypted-account@example.com",
          currentPassword: "password123",
          password: "newpassword123"
        },
        "PATCH"
      );
      const update = await client.request("/auth/me", {
        method: "PATCH",
        headers: {
          "x-request-encryption": "req-v1"
        },
        body: JSON.stringify(encrypted)
      });
      expect(update.status).toBe(200);
    } finally {
      await server.close();
    }
  });

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

      const duplicateInvite = await teacher.request(`/classrooms/${createdPayload.data.id}/students`, {
        method: "POST",
        body: JSON.stringify({
          studentUserId: studentUser.id,
          name: "Student Lee",
          code: studentUser.inviteCode
        })
      });
      expect(duplicateInvite.status).toBe(200);

      const teacherInvitations = await teacher.request(
        `/classrooms/${createdPayload.data.id}/invitations`
      );
      expect(teacherInvitations.status).toBe(200);
      const teacherInvitationPayload = (await teacherInvitations.json()) as {
        data: Array<{ status: string }>;
      };
      expect(teacherInvitationPayload.data).toHaveLength(1);
      expect(teacherInvitationPayload.data[0].status).toBe("PENDING");

      const afterPendingInvite = await student.request("/classrooms");
      expect(afterPendingInvite.status).toBe(200);
      expect(((await afterPendingInvite.json()) as { data: unknown[] }).data).toHaveLength(0);

      const pendingWeeks = await student.request(`/classrooms/${createdPayload.data.id}/weeks`);
      expect(pendingWeeks.status).toBe(403);

      const pendingStudents = await teacher.request(`/classrooms/${createdPayload.data.id}/students`);
      expect(pendingStudents.status).toBe(200);
      expect(((await pendingStudents.json()) as { data: unknown[] }).data).toHaveLength(0);

      await acceptFirstPendingInvitation(student);

      const afterAccept = await student.request("/classrooms");
      expect(afterAccept.status).toBe(200);
      expect(((await afterAccept.json()) as { data: unknown[] }).data).toHaveLength(1);

      const acceptedStudents = await teacher.request(`/classrooms/${createdPayload.data.id}/students`);
      expect(acceptedStudents.status).toBe(200);
      expect(((await acceptedStudents.json()) as { data: unknown[] }).data).toHaveLength(1);

      const removeAccepted = await teacher.request(
        `/classrooms/${createdPayload.data.id}/students/${studentUser.id}`,
        { method: "DELETE" }
      );
      expect(removeAccepted.status).toBe(200);
      const afterRemoveStudents = await teacher.request(`/classrooms/${createdPayload.data.id}/students`);
      expect(afterRemoveStudents.status).toBe(200);
      expect(((await afterRemoveStudents.json()) as { data: unknown[] }).data).toHaveLength(0);
      const afterRemoveInvitations = await teacher.request(
        `/classrooms/${createdPayload.data.id}/invitations`
      );
      expect(afterRemoveInvitations.status).toBe(200);
      expect(((await afterRemoveInvitations.json()) as { data: unknown[] }).data).toHaveLength(0);
      const afterRemoveClassrooms = await student.request("/classrooms");
      expect(afterRemoveClassrooms.status).toBe(200);
      expect(((await afterRemoveClassrooms.json()) as { data: unknown[] }).data).toHaveLength(0);

      const logout = await teacher.request("/auth/logout", { method: "POST" });
      expect(logout.status).toBe(200);
      const meAfterLogout = await teacher.request("/auth/me");
      expect(meAfterLogout.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("prevents students from accepting invitations sent to another account", async () => {
    const server = await startTestServer();
    try {
      const teacher = makeClient(server.baseUrl);
      const studentA = makeClient(server.baseUrl);
      const studentB = makeClient(server.baseUrl);
      await signupAndVerify(teacher, {
        email: "invite-owner-teacher@example.com",
        displayName: "Invite Owner Teacher",
        role: "teacher"
      });
      const studentUserA = await signupAndVerify(studentA, {
        email: "invite-owner-a@example.com",
        displayName: "Invite Owner A",
        role: "student"
      });
      await signupAndVerify(studentB, {
        email: "invite-owner-b@example.com",
        displayName: "Invite Owner B",
        role: "student"
      });
      const classroom = await teacher.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "초대 소유권 강의실" })
      });
      const classroomPayload = (await classroom.json()) as { data: { id: string } };
      const invite = await teacher.request(`/classrooms/${classroomPayload.data.id}/students`, {
        method: "POST",
        body: JSON.stringify({
          studentUserId: studentUserA.id,
          name: "Invite Owner A",
          code: studentUserA.inviteCode
        })
      });
      expect(invite.status).toBe(201);
      const inbox = await studentA.request("/students/invitations");
      const inboxPayload = (await inbox.json()) as { data: Array<{ id: string }> };
      const forbiddenAccept = await studentB.request(
        `/students/invitations/${inboxPayload.data[0].id}/accept`,
        { method: "POST" }
      );
      expect(forbiddenAccept.status).toBe(403);

      const cancelPending = await teacher.request(
        `/classrooms/${classroomPayload.data.id}/students/${studentUserA.id}`,
        { method: "DELETE" }
      );
      expect(cancelPending.status).toBe(200);
      const inboxAfterCancel = await studentA.request("/students/invitations");
      expect(inboxAfterCancel.status).toBe(200);
      expect(((await inboxAfterCancel.json()) as { data: unknown[] }).data).toHaveLength(0);
      const classroomsAfterCancel = await studentA.request("/classrooms");
      expect(classroomsAfterCancel.status).toBe(200);
      expect(((await classroomsAfterCancel.json()) as { data: unknown[] }).data).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("recovers legacy enrollments as accepted invitations on store init", async () => {
    const server = await startTestServer();
    try {
      const teacher = makeClient(server.baseUrl);
      const student = makeClient(server.baseUrl);
      const teacherUser = await signupAndVerify(teacher, {
        email: "legacy-invite-teacher@example.com",
        displayName: "Legacy Invite Teacher",
        role: "teacher"
      });
      const studentUser = await signupAndVerify(student, {
        email: "legacy-invite-student@example.com",
        displayName: "Legacy Invite Student",
        role: "student"
      });
      const classroom = await teacher.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "레거시 초대 복구 강의실" })
      });
      const classroomPayload = (await classroom.json()) as { data: { id: string } };
      await server.store.enrollStudent(classroomPayload.data.id, studentUser.id, teacherUser.id);

      const recoveredStore = new JsonStore({ dataDir: testDir, uploadDir });
      await recoveredStore.init();
      const invitations = await recoveredStore.listClassroomInvitations(classroomPayload.data.id);
      expect(invitations).toHaveLength(1);
      expect(invitations[0].studentUserId).toBe(studentUser.id);
      expect(invitations[0].status).toBe("ACCEPTED");
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

      const forbiddenList = await teacherA.request(
        `/classrooms/${classroomPayload.data.id}/invitations`
      );
      expect(forbiddenList.status).toBe(403);

      const forbiddenInvite = await teacherA.request(
        `/classrooms/${classroomPayload.data.id}/students`,
        {
          method: "POST",
          body: JSON.stringify({
            studentUserId: studentUser.id,
            name: "Search Target",
            code: studentUser.inviteCode
          })
        }
      );
      expect(forbiddenInvite.status).toBe(403);

      const forbiddenRemove = await teacherA.request(
        `/classrooms/${classroomPayload.data.id}/students/${studentUser.id}`,
        { method: "DELETE" }
      );
      expect(forbiddenRemove.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("protects classroom report criteria CRUD by teacher ownership", async () => {
    const server = await startTestServer();
    try {
      const teacherA = makeClient(server.baseUrl);
      const teacherB = makeClient(server.baseUrl);
      const student = makeClient(server.baseUrl);
      await signupAndVerify(teacherA, {
        email: "criteria-teacher-a@example.com",
        displayName: "Criteria Teacher A",
        role: "teacher"
      });
      await signupAndVerify(teacherB, {
        email: "criteria-teacher-b@example.com",
        displayName: "Criteria Teacher B",
        role: "teacher"
      });
      await signupAndVerify(student, {
        email: "criteria-student@example.com",
        displayName: "Criteria Student",
        role: "student"
      });

      const classroomAResponse = await teacherA.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "A 평가 항목반" })
      });
      const classroomBResponse = await teacherB.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "B 평가 항목반" })
      });
      const classroomA = (await classroomAResponse.json()) as { data: { id: string } };
      const classroomB = (await classroomBResponse.json()) as { data: { id: string } };

      const studentList = await student.request(`/classrooms/${classroomA.data.id}/report/criteria`);
      expect(studentList.status).toBe(403);

      const studentPost = await student.request(`/classrooms/${classroomA.data.id}/report/criteria`, {
        method: "POST",
        body: JSON.stringify({
          name: "학생 추가 시도",
          description: "학생은 평가 항목을 추가할 수 없어야 합니다."
        })
      });
      expect(studentPost.status).toBe(403);

      const invalid = await teacherA.request(`/classrooms/${classroomA.data.id}/report/criteria`, {
        method: "POST",
        body: JSON.stringify({ name: "", description: "" })
      });
      expect(invalid.status).toBe(400);

      const overlong = await teacherA.request(`/classrooms/${classroomA.data.id}/report/criteria`, {
        method: "POST",
        body: JSON.stringify({
          name: "x".repeat(61),
          description: "길이 제한 테스트"
        })
      });
      expect(overlong.status).toBe(400);

      const overlongDescription = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "길이 제한",
            description: "x".repeat(601)
          })
        }
      );
      expect(overlongDescription.status).toBe(400);

      const forbiddenPost = await teacherB.request(
        `/classrooms/${classroomA.data.id}/report/criteria`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "다른 선생님 항목",
            description: "소유하지 않은 강의실에는 추가할 수 없어야 합니다."
          })
        }
      );
      expect(forbiddenPost.status).toBe(403);

      const created = await teacherA.request(`/classrooms/${classroomA.data.id}/report/criteria`, {
        method: "POST",
        body: JSON.stringify({
          name: "  발표 논리력  ",
          description: "  주장과 근거가 연결되는지 평가  "
        })
      });
      expect(created.status).toBe(201);
      const createdPayload = (await created.json()) as {
        data: { id: string; classroomId: string; name: string; description: string };
      };
      expect(createdPayload.data.classroomId).toBe(classroomA.data.id);
      expect(createdPayload.data.name).toBe("발표 논리력");
      expect(createdPayload.data.description).toBe("주장과 근거가 연결되는지 평가");

      const duplicateCreate = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria`,
        {
          method: "POST",
          body: JSON.stringify({
            name: " 발표   논리력 ",
            description: "같은 강의실의 중복 이름"
          })
        }
      );
      expect(duplicateCreate.status).toBe(409);
      expect((await duplicateCreate.json()) as { error: string }).toMatchObject({
        error: "이미 사용 중인 평가 항목 이름입니다."
      });

      const builtInDuplicateCreate = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "개념 이해도",
            description: "기본 항목 이름과 중복"
          })
        }
      );
      expect(builtInDuplicateCreate.status).toBe(409);

      const crossClassDuplicateCreate = await teacherB.request(
        `/classrooms/${classroomB.data.id}/report/criteria`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "발표 논리력",
            description: "다른 강의실에서는 같은 커스텀 이름 허용"
          })
        }
      );
      expect(crossClassDuplicateCreate.status).toBe(201);

      const listA = await teacherA.request(`/classrooms/${classroomA.data.id}/report/criteria`);
      expect(listA.status).toBe(200);
      expect(((await listA.json()) as { data: unknown[] }).data).toHaveLength(1);

      const forbiddenForeignClassroom = await teacherB.request(
        `/classrooms/${classroomA.data.id}/report/criteria`
      );
      expect(forbiddenForeignClassroom.status).toBe(403);

      const studentPatch = await student.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "학생 수정 시도" })
        }
      );
      expect(studentPatch.status).toBe(403);

      const studentDelete = await student.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(studentDelete.status).toBe(403);

      const forbiddenPatch = await teacherB.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "권한 없는 수정" })
        }
      );
      expect(forbiddenPatch.status).toBe(403);

      const forbiddenDelete = await teacherB.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(forbiddenDelete.status).toBe(403);

      const crossClassUpdate = await teacherB.request(
        `/classrooms/${classroomB.data.id}/report/criteria/${createdPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "다른 반 수정" })
        }
      );
      expect(crossClassUpdate.status).toBe(404);

      const emptyPatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({})
        }
      );
      expect(emptyPatch.status).toBe(400);

      const missingPatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/crit_missing`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "없는 항목" })
        }
      );
      expect(missingPatch.status).toBe(404);

      const overlongPatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ description: "x".repeat(601) })
        }
      );
      expect(overlongPatch.status).toBe(400);

      const overlongNamePatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "x".repeat(61) })
        }
      );
      expect(overlongNamePatch.status).toBe(400);

      const updated = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: "  발표 구조화  ",
            description: "  주장, 근거, 예시가 순서대로 이어지는지 평가  "
          })
        }
      );
      expect(updated.status).toBe(200);
      const updatedPayload = (await updated.json()) as {
        data: { name: string; description: string };
      };
      expect(updatedPayload.data.name).toBe("발표 구조화");
      expect(updatedPayload.data.description).toBe("주장, 근거, 예시가 순서대로 이어지는지 평가");

      const secondCreated = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "학습 계획성",
            description: "복습과 과제 흐름을 계획하는 정도"
          })
        }
      );
      expect(secondCreated.status).toBe(201);
      const secondPayload = (await secondCreated.json()) as {
        data: { id: string };
      };

      const duplicatePatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${secondPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "발표 구조화" })
        }
      );
      expect(duplicatePatch.status).toBe(409);
      expect((await duplicatePatch.json()) as { error: string }).toMatchObject({
        error: "이미 사용 중인 평가 항목 이름입니다."
      });

      const builtInDuplicatePatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${secondPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "질문 구체성" })
        }
      );
      expect(builtInDuplicatePatch.status).toBe(409);

      const missingDelete = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/crit_missing`,
        { method: "DELETE" }
      );
      expect(missingDelete.status).toBe(404);

      const deleted = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${createdPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(deleted.status).toBe(200);

      const secondDeleted = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria/${secondPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(secondDeleted.status).toBe(200);

      const listAfterDelete = await teacherA.request(
        `/classrooms/${classroomA.data.id}/report/criteria`
      );
      expect(((await listAfterDelete.json()) as { data: unknown[] }).data).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("protects classroom notices by role, visibility, and classroom ownership", async () => {
    const server = await startTestServer();
    try {
      const teacherA = makeClient(server.baseUrl);
      const teacherB = makeClient(server.baseUrl);
      const student = makeClient(server.baseUrl);
      const studentB = makeClient(server.baseUrl);
      await signupAndVerify(teacherA, {
        email: "notice-teacher-a@example.com",
        displayName: "Notice Teacher A",
        role: "teacher"
      });
      await signupAndVerify(teacherB, {
        email: "notice-teacher-b@example.com",
        displayName: "Notice Teacher B",
        role: "teacher"
      });
      const studentUser = await signupAndVerify(student, {
        email: "notice-student@example.com",
        displayName: "Notice Student",
        role: "student"
      });
      const studentBUser = await signupAndVerify(studentB, {
        email: "notice-student-b@example.com",
        displayName: "Notice Student B",
        role: "student"
      });

      const classroomAResponse = await teacherA.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "A 공지반" })
      });
      const classroomBResponse = await teacherB.request("/classrooms", {
        method: "POST",
        body: JSON.stringify({ title: "B 공지반" })
      });
      const classroomA = (await classroomAResponse.json()) as { data: { id: string } };
      const classroomB = (await classroomBResponse.json()) as { data: { id: string } };

      const invite = await teacherA.request(`/classrooms/${classroomA.data.id}/students`, {
        method: "POST",
        body: JSON.stringify({
          studentUserId: studentUser.id,
          name: "Notice Student",
          code: studentUser.inviteCode
        })
      });
      expect(invite.status).toBe(201);
      await acceptFirstPendingInvitation(student);
      const inviteStudentB = await teacherA.request(`/classrooms/${classroomA.data.id}/students`, {
        method: "POST",
        body: JSON.stringify({
          studentUserId: studentBUser.id,
          name: "Notice Student B",
          code: studentBUser.inviteCode
        })
      });
      expect(inviteStudentB.status).toBe(201);
      await acceptFirstPendingInvitation(studentB);

      const studentCreate = await student.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "학생 생성 시도",
          contentMarkdown: "학생은 공지를 만들 수 없습니다.",
          status: "PUBLISHED"
        })
      });
      expect(studentCreate.status).toBe(403);

      const forbiddenCreate = await teacherB.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "다른 선생님 생성 시도",
          contentMarkdown: "소유하지 않은 강의실입니다.",
          status: "PUBLISHED"
        })
      });
      expect(forbiddenCreate.status).toBe(403);

      const invalidEnum = await teacherA.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "잘못된 공지",
          contentMarkdown: "enum 검증",
          category: "EVERYTHING",
          priority: "NORMAL",
          target: "CLASS",
          status: "PUBLISHED"
        })
      });
      expect(invalidEnum.status).toBe(400);

      const invalidPublishAt = await teacherA.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "잘못된 예약 시간",
          contentMarkdown: "ISO datetime만 허용해야 합니다.",
          category: "GENERAL",
          priority: "NORMAL",
          target: "CLASS",
          status: "PUBLISHED",
          publishAt: "May 25, 2026 09:00"
        })
      });
      expect(invalidPublishAt.status).toBe(400);

      const nonArrayAttachments = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices`,
        {
          method: "POST",
          body: JSON.stringify({
            title: "첨부 검증",
            contentMarkdown: "첨부 배열만 허용해야 합니다.",
            category: "GENERAL",
            priority: "NORMAL",
            target: "CLASS",
            status: "DRAFT",
            attachments: { name: "bad.pdf", size: 1 }
          })
        }
      );
      expect(nonArrayAttachments.status).toBe(400);

      const tooManyAttachments = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices`,
        {
          method: "POST",
          body: JSON.stringify({
            title: "첨부 9개",
            contentMarkdown: "첨부는 8개까지만 허용해야 합니다.",
            category: "GENERAL",
            priority: "NORMAL",
            target: "CLASS",
            status: "DRAFT",
            attachments: Array.from({ length: 9 }, (_, index) => ({
              name: `file-${index}.pdf`,
              size: 1
            }))
          })
        }
      );
      expect(tooManyAttachments.status).toBe(400);

      const overlongAttachmentName = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices`,
        {
          method: "POST",
          body: JSON.stringify({
            title: "첨부 이름 길이",
            contentMarkdown: "첨부 이름 길이를 제한해야 합니다.",
            category: "GENERAL",
            priority: "NORMAL",
            target: "CLASS",
            status: "DRAFT",
            attachments: [{ name: `${"x".repeat(121)}.pdf`, size: 1 }]
          })
        }
      );
      expect(overlongAttachmentName.status).toBe(400);

      const negativeAttachmentSize = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices`,
        {
          method: "POST",
          body: JSON.stringify({
            title: "첨부 크기",
            contentMarkdown: "첨부 크기는 음수일 수 없습니다.",
            category: "GENERAL",
            priority: "NORMAL",
            target: "CLASS",
            status: "DRAFT",
            attachments: [{ name: "bad-size.pdf", size: -1 }]
          })
        }
      );
      expect(negativeAttachmentSize.status).toBe(400);

      const nonNumberAttachmentSize = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices`,
        {
          method: "POST",
          body: JSON.stringify({
            title: "첨부 크기 타입",
            contentMarkdown: "첨부 크기는 숫자여야 합니다.",
            category: "GENERAL",
            priority: "NORMAL",
            target: "CLASS",
            status: "DRAFT",
            attachments: [{ name: "bad-size.pdf", size: "1KB" }]
          })
        }
      );
      expect(nonNumberAttachmentSize.status).toBe(400);

      const draft = await teacherA.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "초안 공지",
          contentMarkdown: "학생에게 보이면 안 됩니다.",
          category: "GENERAL",
          priority: "NORMAL",
          target: "CLASS",
          status: "DRAFT",
          pinned: false,
          attachments: []
        })
      });
      expect(draft.status).toBe(201);
      const draftPayload = (await draft.json()) as { data: { id: string } };

      const future = await teacherA.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "예약 공지",
          contentMarkdown: "아직 공개 전입니다.",
          category: "GENERAL",
          priority: "NORMAL",
          target: "CLASS",
          status: "PUBLISHED",
          publishAt: "2999-01-01T00:00:00.000Z",
          attachments: []
        })
      });
      expect(future.status).toBe(201);
      const futurePayload = (await future.json()) as { data: { id: string } };

      const published = await teacherA.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "기말고사 일정 및 범위 안내",
          contentMarkdown: "시험 일정과 범위를 확인해 주세요.",
          category: "EXAM",
          priority: "IMPORTANT",
          target: "CLASS",
          status: "PUBLISHED",
          pinned: true,
          attachments: [{ name: "기말고사 범위.pdf", size: 1234, mimeType: "application/pdf" }]
        })
      });
      expect(published.status).toBe(201);
      const publishedPayload = (await published.json()) as {
        data: { id: string; title: string; publishedAt?: string; commentCount: number };
      };
      expect(publishedPayload.data.publishedAt).toBeTruthy();
      expect(publishedPayload.data.commentCount).toBe(0);

      const teacherList = await teacherA.request(`/classrooms/${classroomA.data.id}/notices`);
      expect(teacherList.status).toBe(200);
      expect(((await teacherList.json()) as { data: unknown[] }).data).toHaveLength(3);

      const studentList = await student.request(`/classrooms/${classroomA.data.id}/notices`);
      expect(studentList.status).toBe(200);
      const studentListPayload = (await studentList.json()) as { data: Array<{ id: string }> };
      expect(studentListPayload.data.map((notice) => notice.id)).toEqual([publishedPayload.data.id]);

      const studentDraft = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${draftPayload.data.id}`
      );
      expect(studentDraft.status).toBe(404);
      const studentFuture = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${futurePayload.data.id}`
      );
      expect(studentFuture.status).toBe(404);
      const futureComment = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${futurePayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ contentMarkdown: "예약 공지에는 댓글을 달 수 없어야 합니다." })
        }
      );
      expect(futureComment.status).toBe(404);

      const teacherDraftComment = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${draftPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ contentMarkdown: "교사는 초안 공지 댓글 관리 가능" })
        }
      );
      expect(teacherDraftComment.status).toBe(201);
      const teacherDraftCommentPayload = (await teacherDraftComment.json()) as {
        data: { id: string };
      };
      const teacherDraftCommentPatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${draftPayload.data.id}/comments/${teacherDraftCommentPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "초안 공지 댓글 수정" })
        }
      );
      expect(teacherDraftCommentPatch.status).toBe(200);
      const teacherDraftCommentDelete = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${draftPayload.data.id}/comments/${teacherDraftCommentPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(teacherDraftCommentDelete.status).toBe(200);

      const studentPatch = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "학생 수정 시도" })
        }
      );
      expect(studentPatch.status).toBe(403);
      const studentDelete = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(studentDelete.status).toBe(403);

      const teacherBPatch = await teacherB.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "권한 없는 수정" })
        }
      );
      expect(teacherBPatch.status).toBe(403);
      const crossClassPatch = await teacherB.request(
        `/classrooms/${classroomB.data.id}/notices/${publishedPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "다른 반 수정" })
        }
      );
      expect(crossClassPatch.status).toBe(404);

      const emptyPatch = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({})
        }
      );
      expect(emptyPatch.status).toBe(400);

      const updated = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "기말고사 범위 최종 안내" })
        }
      );
      expect(updated.status).toBe(200);
      expect(((await updated.json()) as { data: { title: string } }).data.title).toBe(
        "기말고사 범위 최종 안내"
      );

      const studentComment = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ contentMarkdown: "확인했습니다." })
        }
      );
      expect(studentComment.status).toBe(201);
      const studentCommentPayload = (await studentComment.json()) as {
        data: {
          id: string;
          authorRole: string;
          canEdit: boolean;
          canDelete: boolean;
          createdAt: string;
          updatedAt: string;
          parentCommentId?: string;
          authorUserId: string;
          noticeId: string;
        };
      };
      expect(studentCommentPayload.data.authorRole).toBe("student");
      expect(studentCommentPayload.data.canEdit).toBe(true);
      expect(studentCommentPayload.data.canDelete).toBe(true);

      const teacherReply = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            contentMarkdown: "좋습니다.",
            parentCommentId: studentCommentPayload.data.id
          })
        }
      );
      expect(teacherReply.status).toBe(201);
      const teacherReplyPayload = (await teacherReply.json()) as {
        data: { id: string; authorRole: string; canEdit: boolean; canDelete: boolean };
      };
      expect(teacherReplyPayload.data.authorRole).toBe("teacher");
      expect(teacherReplyPayload.data.canEdit).toBe(true);
      expect(teacherReplyPayload.data.canDelete).toBe(true);

      const otherStudentComment = await studentB.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ contentMarkdown: "다른 학생 댓글입니다." })
        }
      );
      expect(otherStudentComment.status).toBe(201);
      const otherStudentCommentPayload = (await otherStudentComment.json()) as {
        data: { id: string; canEdit: boolean; canDelete: boolean };
      };
      expect(otherStudentCommentPayload.data.canEdit).toBe(true);
      expect(otherStudentCommentPayload.data.canDelete).toBe(true);

      const studentComments = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`
      );
      expect(studentComments.status).toBe(200);
      const studentCommentsPayload = (await studentComments.json()) as {
        data: Array<{
          id: string;
          authorUserId: string;
          canEdit: boolean;
          canDelete: boolean;
        }>;
      };
      expect(studentCommentsPayload.data).toHaveLength(3);
      expect(studentCommentsPayload.data.find((comment) => comment.id === studentCommentPayload.data.id))
        .toMatchObject({ canEdit: true, canDelete: true });
      expect(studentCommentsPayload.data.find((comment) => comment.id === teacherReplyPayload.data.id))
        .toMatchObject({ canEdit: false, canDelete: false });
      expect(studentCommentsPayload.data.find((comment) => comment.id === otherStudentCommentPayload.data.id))
        .toMatchObject({ canEdit: false, canDelete: false });

      const teacherComments = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`
      );
      expect(teacherComments.status).toBe(200);
      const teacherCommentsPayload = (await teacherComments.json()) as {
        data: Array<{ canEdit: boolean; canDelete: boolean }>;
      };
      expect(teacherCommentsPayload.data.every((comment) => comment.canEdit && comment.canDelete))
        .toBe(true);

      const patchedOwnComment = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${studentCommentPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            contentMarkdown: "확인했고 수정했습니다.",
            parentCommentId: teacherReplyPayload.data.id
          })
        }
      );
      expect(patchedOwnComment.status).toBe(200);
      const patchedOwnPayload = (await patchedOwnComment.json()) as {
        data: {
          contentMarkdown: string;
          createdAt: string;
          updatedAt: string;
          parentCommentId?: string;
          authorUserId: string;
          noticeId: string;
        };
      };
      expect(patchedOwnPayload.data.contentMarkdown).toBe("확인했고 수정했습니다.");
      expect(patchedOwnPayload.data.createdAt).toBe(studentCommentPayload.data.createdAt);
      expect(patchedOwnPayload.data.updatedAt).not.toBe(studentCommentPayload.data.updatedAt);
      expect(patchedOwnPayload.data.parentCommentId).toBeUndefined();
      expect(patchedOwnPayload.data.authorUserId).toBe(studentCommentPayload.data.authorUserId);
      expect(patchedOwnPayload.data.noticeId).toBe(studentCommentPayload.data.noticeId);

      const studentPatchTeacherReply = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${teacherReplyPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "학생이 선생님 답글 수정" })
        }
      );
      expect(studentPatchTeacherReply.status).toBe(403);
      const studentDeleteTeacherReply = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${teacherReplyPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(studentDeleteTeacherReply.status).toBe(403);
      const studentPatchOtherStudent = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${otherStudentCommentPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "다른 학생 댓글 수정 시도" })
        }
      );
      expect(studentPatchOtherStudent.status).toBe(403);
      const studentDeleteOtherStudent = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${otherStudentCommentPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(studentDeleteOtherStudent.status).toBe(403);

      const teacherPatchStudent = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${studentCommentPayload.data.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "교사가 학생 댓글을 조정했습니다." })
        }
      );
      expect(teacherPatchStudent.status).toBe(200);

      const studentOwnDeleteTarget = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ contentMarkdown: "학생이 직접 삭제할 댓글" })
        }
      );
      expect(studentOwnDeleteTarget.status).toBe(201);
      const studentOwnDeleteTargetPayload = (await studentOwnDeleteTarget.json()) as {
        data: { id: string };
      };
      const studentOwnDelete = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${studentOwnDeleteTargetPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(studentOwnDelete.status).toBe(200);

      const nestedReply = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            contentMarkdown: "답글의 답글은 막혀야 합니다.",
            parentCommentId: teacherReplyPayload.data.id
          })
        }
      );
      expect(nestedReply.status).toBe(400);

      const invalidReply = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            contentMarkdown: "없는 댓글 답글",
            parentCommentId: "ntcc_missing"
          })
        }
      );
      expect(invalidReply.status).toBe(400);

      const cascadeParent = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ contentMarkdown: "삭제 cascade 부모" })
        }
      );
      expect(cascadeParent.status).toBe(201);
      const cascadeParentPayload = (await cascadeParent.json()) as { data: { id: string } };
      const cascadeChild = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            contentMarkdown: "삭제 cascade 자식",
            parentCommentId: cascadeParentPayload.data.id
          })
        }
      );
      expect(cascadeChild.status).toBe(201);
      const cascadeChildPayload = (await cascadeChild.json()) as { data: { id: string } };
      const deleteCascadeParent = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments/${cascadeParentPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(deleteCascadeParent.status).toBe(200);

      const comments = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`
      );
      expect(comments.status).toBe(200);
      const commentsPayload = (await comments.json()) as { data: Array<{ id: string }> };
      expect(commentsPayload.data.map((comment) => comment.id)).not.toContain(
        cascadeParentPayload.data.id
      );
      expect(commentsPayload.data.map((comment) => comment.id)).not.toContain(
        cascadeChildPayload.data.id
      );

      const deleted = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}`,
        { method: "DELETE" }
      );
      expect(deleted.status).toBe(200);
      const commentsAfterDelete = await teacherA.request(
        `/classrooms/${classroomA.data.id}/notices/${publishedPayload.data.id}/comments`
      );
      expect(commentsAfterDelete.status).toBe(404);

      const cascadeNotice = await teacherA.request(`/classrooms/${classroomA.data.id}/notices`, {
        method: "POST",
        body: JSON.stringify({
          title: "강의실 삭제 cascade 공지",
          contentMarkdown: "강의실 삭제 시 같이 없어져야 합니다.",
          category: "GENERAL",
          priority: "NORMAL",
          target: "CLASS",
          status: "PUBLISHED"
        })
      });
      expect(cascadeNotice.status).toBe(201);
      const cascadePayload = (await cascadeNotice.json()) as { data: { id: string } };
      const cascadeComment = await student.request(
        `/classrooms/${classroomA.data.id}/notices/${cascadePayload.data.id}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ contentMarkdown: "cascade 댓글" })
        }
      );
      expect(cascadeComment.status).toBe(201);

      const deleteClassroom = await teacherA.request(`/classrooms/${classroomA.data.id}`, {
        method: "DELETE"
      });
      expect(deleteClassroom.status).toBe(200);
      expect(
        await server.store.listClassroomNotices(classroomA.data.id, { includeHidden: true })
      ).toHaveLength(0);
      expect(
        await server.store.listClassroomNoticeComments(classroomA.data.id, cascadePayload.data.id)
      ).toHaveLength(0);
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
      await acceptFirstPendingInvitation(student);

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
