import crypto from "node:crypto";
import { promisify } from "node:util";
import { appConfig } from "../../config.js";
import { AuthSession, PublicUser, User, UserRole } from "../../types/domain.js";
import { JsonStore } from "../storage/JsonStore.js";
import { DevEmailSender, EmailSender, EmailSenderError } from "./EmailSender.js";

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_KEY_LENGTH = 64;
const VERIFY_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const EMAIL_ALREADY_EXISTS_MESSAGE =
  "이미 가입된 이메일입니다. 로그인하거나 이메일 인증을 진행해 주세요.";

interface AuthServiceDeps {
  emailSender: EmailSender;
  clock: () => Date;
  codeGenerator: () => string;
  tokenGenerator: (bytes?: number) => string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function timingSafeStringEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    inviteCode: user.inviteCode,
    emailVerified: Boolean(user.emailVerifiedAt),
    hasPassword: Boolean(user.passwordHash && user.passwordSalt)
  };
}

function isDuplicateEmailCreateError(error: unknown): boolean {
  return error instanceof Error && error.message === "Email already exists";
}

export class AuthService {
  private readonly deps: AuthServiceDeps;

  constructor(
    private readonly store: JsonStore,
    deps: Partial<AuthServiceDeps> = {}
  ) {
    this.deps = {
      emailSender: deps.emailSender ?? new DevEmailSender(),
      clock: deps.clock ?? (() => new Date()),
      codeGenerator:
        deps.codeGenerator ??
        (() => String(crypto.randomInt(0, 1000000)).padStart(6, "0")),
      tokenGenerator: deps.tokenGenerator ?? randomToken
    };
  }

  private now(): string {
    return this.deps.clock().toISOString();
  }

  tokenHash(token: string): string {
    return sha256(token);
  }

  async hashPassword(password: string, salt = randomToken(16)): Promise<{
    passwordHash: string;
    passwordSalt: string;
  }> {
    const derived = (await scryptAsync(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return {
      passwordHash: derived.toString("hex"),
      passwordSalt: salt
    };
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash || !user.passwordSalt) return false;
    const { passwordHash } = await this.hashPassword(password, user.passwordSalt);
    const expected = Buffer.from(user.passwordHash, "hex");
    const actual = Buffer.from(passwordHash, "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  private async generateInviteCode(displayName: string): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");
      const existing = await this.store.findStudentByInviteTag(displayName, code);
      if (!existing) return code;
    }
    return String(crypto.randomInt(0, 10000)).padStart(4, "0");
  }

  private createVerificationCode(): string {
    return this.deps.codeGenerator();
  }

  private verificationCodeSecret(): string {
    if (appConfig.authVerificationCodeSecret) {
      return appConfig.authVerificationCodeSecret;
    }
    if (appConfig.authEmailDeliveryMode === "dev" && process.env.NODE_ENV !== "production") {
      return "merge-edu-dev-verification-secret";
    }
    throw new AuthError(
      "인증 코드 보안 설정이 필요합니다.",
      500,
      "AUTH_VERIFICATION_SECRET_MISSING"
    );
  }

  private hashVerificationCode(emailNormalized: string, code: string): string {
    const digest = crypto
      .createHmac("sha256", this.verificationCodeSecret())
      .update(`${emailNormalized}:${code.trim()}`)
      .digest("hex");
    return `v2:${digest}`;
  }

  private verifyCodeHash(input: {
    emailNormalized: string;
    code: string;
    storedHash: string;
  }): boolean {
    const code = input.code.trim();
    if (input.storedHash.startsWith("v2:")) {
      const expected = input.storedHash.slice(3);
      const actual = this.hashVerificationCode(input.emailNormalized, code).slice(3);
      return timingSafeStringEqual(expected, actual);
    }

    if (
      appConfig.authAllowLegacyVerificationHash ||
      (appConfig.authEmailDeliveryMode === "dev" && process.env.NODE_ENV !== "production")
    ) {
      const actual = sha256(code);
      return timingSafeStringEqual(input.storedHash, actual);
    }

    return false;
  }

  private shouldExposeDevVerificationCode(): boolean {
    return (
      appConfig.authEmailDeliveryMode === "dev" &&
      process.env.NODE_ENV !== "production" &&
      (appConfig.authDevExposeVerificationCode ||
        process.env.AUTH_DEV_EXPOSE_VERIFICATION_CODE === "true")
    );
  }

  private async sendVerificationEmail(input: {
    email: string;
    displayName: string;
    code: string;
    expiresAt: string;
  }): Promise<void> {
    try {
      await this.deps.emailSender.sendVerificationCode({
        to: input.email,
        displayName: input.displayName,
        code: input.code,
        expiresAt: input.expiresAt
      });
    } catch (error) {
      if (error instanceof EmailSenderError) {
        throw new AuthError(
          error.code === "EMAIL_SENDER_NOT_CONFIGURED"
            ? "이메일 발송 설정이 필요합니다."
            : "인증 이메일 발송에 실패했습니다.",
          error.code === "EMAIL_SENDER_NOT_CONFIGURED" ? 500 : 502,
          error.code
        );
      }
      throw error;
    }
  }

  private async ensureEmailSenderReady(): Promise<void> {
    if (
      this.deps.emailSender.mode === "dev" &&
      !this.deps.emailSender.canDeliverToInbox &&
      !this.shouldExposeDevVerificationCode()
    ) {
      throw new AuthError(
        "현재 서버는 실제 인증 메일 발송이 꺼져 있습니다. SMTP를 설정하거나 개발용 인증 코드 표시를 켜 주세요.",
        500,
        "EMAIL_SENDER_NOT_CONFIGURED"
      );
    }
    try {
      await this.deps.emailSender.ensureReady?.();
    } catch (error) {
      if (error instanceof EmailSenderError) {
        throw new AuthError(
          error.code === "EMAIL_SENDER_NOT_CONFIGURED"
            ? "이메일 발송 설정이 필요합니다."
            : "SMTP 연결 확인에 실패했습니다. 메일 서버 설정을 확인해 주세요.",
          error.code === "EMAIL_SENDER_NOT_CONFIGURED" ? 500 : 502,
          error.code
        );
      }
      throw error;
    }
  }

  emailDeliveryStatus(): {
    mode: "dev" | "smtp";
    canDeliverToInbox: boolean;
    devVerificationCodeVisible: boolean;
  } {
    return {
      mode: this.deps.emailSender.mode,
      canDeliverToInbox: this.deps.emailSender.canDeliverToInbox,
      devVerificationCodeVisible: this.shouldExposeDevVerificationCode()
    };
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    role: UserRole;
  }): Promise<{ user: PublicUser; devVerificationCode?: string }> {
    const emailNormalized = normalizeEmail(input.email);
    const displayName = input.displayName.replace(/\s+/g, " ").trim();
    if (!emailNormalized || !emailNormalized.includes("@")) {
      throw new AuthError("올바른 이메일을 입력해 주세요.", 400, "INVALID_EMAIL");
    }
    if (input.password.length < 8) {
      throw new AuthError("비밀번호는 8자 이상이어야 합니다.", 400, "WEAK_PASSWORD");
    }
    if (!displayName) {
      throw new AuthError("이름을 입력해 주세요.", 400, "DISPLAY_NAME_REQUIRED");
    }
    if (input.role !== "teacher" && input.role !== "student") {
      throw new AuthError("역할을 선택해 주세요.", 400, "INVALID_ROLE");
    }

    const existingUser = await this.store.getUserByEmail(emailNormalized);
    if (existingUser) {
      throw new AuthError(EMAIL_ALREADY_EXISTS_MESSAGE, 409, "EMAIL_ALREADY_EXISTS");
    }

    const limited = await this.store.checkAndIncrementRateLimit(
      `register:${emailNormalized}`,
      5,
      60 * 60 * 1000
    );
    if (!limited) {
      throw new AuthError("잠시 후 다시 시도해 주세요.", 429, "RATE_LIMITED");
    }

    const verificationCode = this.createVerificationCode();
    const expiresAt = new Date(this.deps.clock().getTime() + VERIFY_CODE_TTL_MS).toISOString();
    await this.ensureEmailSenderReady();
    const { passwordHash, passwordSalt } = await this.hashPassword(input.password);
    let user: User;
    try {
      user = await this.store.createUser({
        email: input.email.trim(),
        emailNormalized,
        displayName,
        role: input.role,
        inviteCode: await this.generateInviteCode(displayName),
        passwordHash,
        passwordSalt,
        emailVerificationCodeHash: this.hashVerificationCode(emailNormalized, verificationCode),
        emailVerificationExpiresAt: expiresAt,
        emailVerificationAttempts: 0,
        emailVerificationSentAt: this.now()
      });
    } catch (error) {
      if (isDuplicateEmailCreateError(error)) {
        throw new AuthError(EMAIL_ALREADY_EXISTS_MESSAGE, 409, "EMAIL_ALREADY_EXISTS");
      }
      throw error;
    }

    await this.sendVerificationEmail({
      email: user.email,
      displayName: user.displayName,
      code: verificationCode,
      expiresAt
    });

    return {
      user: publicUser(user),
      devVerificationCode: this.shouldExposeDevVerificationCode() ? verificationCode : undefined
    };
  }

  async resendVerificationCode(input: {
    email: string;
  }): Promise<{ devVerificationCode?: string }> {
    const emailNormalized = normalizeEmail(input.email);
    if (!emailNormalized || !emailNormalized.includes("@")) {
      throw new AuthError("올바른 이메일을 입력해 주세요.", 400, "INVALID_EMAIL");
    }

    const limited = await this.store.checkAndIncrementRateLimit(
      `verify-resend:${emailNormalized}`,
      5,
      60 * 60 * 1000
    );
    if (!limited) {
      throw new AuthError("잠시 후 다시 시도해 주세요.", 429, "RATE_LIMITED");
    }

    const user = await this.store.getUserByEmail(emailNormalized);
    if (!user || user.emailVerifiedAt) {
      return {};
    }

    if (user.emailVerificationSentAt) {
      const elapsedMs = this.deps.clock().getTime() - new Date(user.emailVerificationSentAt).getTime();
      if (elapsedMs < appConfig.authEmailResendCooldownSeconds * 1000) {
        throw new AuthError(
          "인증 메일은 잠시 후 다시 요청할 수 있습니다.",
          429,
          "VERIFICATION_RESEND_COOLDOWN"
        );
      }
    }

    const verificationCode = this.createVerificationCode();
    const expiresAt = new Date(this.deps.clock().getTime() + VERIFY_CODE_TTL_MS).toISOString();
    await this.ensureEmailSenderReady();
    const updated = await this.store.updateUser(user.id, {
      emailVerificationCodeHash: this.hashVerificationCode(emailNormalized, verificationCode),
      emailVerificationExpiresAt: expiresAt,
      emailVerificationAttempts: 0,
      emailVerificationSentAt: this.now()
    });
    const target = updated ?? user;
    await this.sendVerificationEmail({
      email: target.email,
      displayName: target.displayName,
      code: verificationCode,
      expiresAt
    });

    return {
      devVerificationCode: this.shouldExposeDevVerificationCode() ? verificationCode : undefined
    };
  }

  async verifyEmail(input: { email: string; code: string }): Promise<User> {
    const emailNormalized = normalizeEmail(input.email);
    const user = await this.store.getUserByEmail(emailNormalized);
    if (!user) {
      throw new AuthError("인증 정보를 확인해 주세요.", 400, "INVALID_VERIFICATION");
    }
    if (user.emailVerifiedAt) {
      throw new AuthError("이미 인증된 계정입니다. 로그인해 주세요.", 400, "ALREADY_VERIFIED");
    }
    if (
      !user.emailVerificationCodeHash ||
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt < this.now()
    ) {
      throw new AuthError("인증 코드가 만료되었습니다.", 400, "VERIFICATION_EXPIRED");
    }
    if ((user.emailVerificationAttempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
      throw new AuthError("인증 시도 횟수를 초과했습니다.", 429, "VERIFICATION_ATTEMPTS_EXCEEDED");
    }
    if (
      !this.verifyCodeHash({
        emailNormalized,
        code: input.code,
        storedHash: user.emailVerificationCodeHash
      })
    ) {
      await this.store.updateUser(user.id, {
        emailVerificationAttempts: (user.emailVerificationAttempts ?? 0) + 1
      });
      throw new AuthError("인증 코드를 확인해 주세요.", 400, "INVALID_VERIFICATION");
    }

    const updated = await this.store.updateUser(user.id, {
      emailVerifiedAt: this.now(),
      emailVerificationCodeHash: undefined,
      emailVerificationExpiresAt: undefined,
      emailVerificationAttempts: 0,
      emailVerificationSentAt: undefined
    });
    return updated ?? user;
  }

  async updateAccount(input: {
    userId: string;
    currentSessionId?: string;
    email: string;
    currentPassword?: string;
    password?: string;
  }): Promise<{ user: PublicUser; devVerificationCode?: string }> {
    const user = await this.store.getUser(input.userId);
    if (!user) {
      throw new AuthError("Authentication required", 401, "AUTH_REQUIRED");
    }
    if (!user.emailVerifiedAt) {
      throw new AuthError("이메일 인증이 필요합니다.", 403, "EMAIL_NOT_VERIFIED");
    }

    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    if (!emailNormalized || !emailNormalized.includes("@")) {
      throw new AuthError("올바른 이메일을 입력해 주세요.", 400, "INVALID_EMAIL");
    }

    const emailChanged = emailNormalized !== user.emailNormalized;
    if (emailChanged && user.googleSub) {
      throw new AuthError(
        "Google 계정으로 연결된 이메일은 이 화면에서 변경할 수 없습니다.",
        400,
        "GOOGLE_EMAIL_CHANGE_UNSUPPORTED"
      );
    }

    const passwordChangeRequested = input.password !== undefined && input.password.length > 0;
    const hasPassword = Boolean(user.passwordHash && user.passwordSalt);
    const credentialChangeRequested = emailChanged || passwordChangeRequested;
    if (hasPassword && credentialChangeRequested) {
      if (!input.currentPassword || !(await this.verifyPassword(user, input.currentPassword))) {
        throw new AuthError("현재 비밀번호를 확인해 주세요.", 401, "INVALID_CREDENTIALS");
      }
    }
    if (!hasPassword && emailChanged) {
      throw new AuthError(
        "비밀번호가 없는 계정은 먼저 비밀번호를 설정해 주세요.",
        400,
        "PASSWORD_REQUIRED_FOR_EMAIL_CHANGE"
      );
    }
    if (passwordChangeRequested && input.password!.length < 8) {
      throw new AuthError("비밀번호는 8자 이상이어야 합니다.", 400, "WEAK_PASSWORD");
    }

    if (emailChanged) {
      const existing = await this.store.getUserByEmail(emailNormalized);
      if (existing && existing.id !== user.id) {
        throw new AuthError(EMAIL_ALREADY_EXISTS_MESSAGE, 409, "EMAIL_ALREADY_EXISTS");
      }
    }

    const patch: Partial<User> = {};
    if (email !== user.email) {
      patch.email = email;
    }
    if (emailChanged) {
      patch.emailNormalized = emailNormalized;
    }

    let devVerificationCode: string | undefined;
    if (emailChanged) {
      const verificationCode = this.createVerificationCode();
      const expiresAt = new Date(this.deps.clock().getTime() + VERIFY_CODE_TTL_MS).toISOString();
      await this.ensureEmailSenderReady();
      await this.sendVerificationEmail({
        email,
        displayName: user.displayName,
        code: verificationCode,
        expiresAt
      });
      patch.emailVerifiedAt = undefined;
      patch.emailVerificationCodeHash = this.hashVerificationCode(emailNormalized, verificationCode);
      patch.emailVerificationExpiresAt = expiresAt;
      patch.emailVerificationAttempts = 0;
      patch.emailVerificationSentAt = this.now();
      devVerificationCode = this.shouldExposeDevVerificationCode() ? verificationCode : undefined;
    }

    if (passwordChangeRequested) {
      const { passwordHash, passwordSalt } = await this.hashPassword(input.password!);
      patch.passwordHash = passwordHash;
      patch.passwordSalt = passwordSalt;
    }

    if (Object.keys(patch).length === 0) {
      return { user: publicUser(user) };
    }

    let updated: User | null;
    try {
      updated = await this.store.updateUser(user.id, patch);
    } catch (error) {
      if (isDuplicateEmailCreateError(error)) {
        throw new AuthError(EMAIL_ALREADY_EXISTS_MESSAGE, 409, "EMAIL_ALREADY_EXISTS");
      }
      throw error;
    }
    if (!updated) {
      throw new AuthError("Authentication required", 401, "AUTH_REQUIRED");
    }
    if (credentialChangeRequested) {
      await this.store.revokeAuthSessionsForUserExcept(user.id, input.currentSessionId);
    }

    return {
      user: publicUser(updated),
      devVerificationCode
    };
  }

  async loginWithGoogleProfile(input: {
    googleSub: string;
    email: string;
    emailVerified: boolean;
    displayName: string;
    role: UserRole;
    userAgent?: string;
  }): Promise<{ user: PublicUser; token: string; session: AuthSession }> {
    if (!input.emailVerified) {
      throw new AuthError("Google 이메일 인증 상태를 확인할 수 없습니다.", 403, "GOOGLE_EMAIL_NOT_VERIFIED");
    }

    const emailNormalized = normalizeEmail(input.email);
    let user = await this.store.getUserByGoogleSub(input.googleSub);
    if (!user) {
      const existing = await this.store.getUserByEmail(emailNormalized);
      if (existing?.googleSub && existing.googleSub !== input.googleSub) {
        throw new AuthError("이미 다른 Google 계정과 연결된 이메일입니다.", 409, "GOOGLE_ACCOUNT_CONFLICT");
      }
      if (existing) {
        user =
          (await this.store.updateUser(existing.id, {
            googleSub: input.googleSub,
            emailVerifiedAt: existing.emailVerifiedAt ?? this.now()
          })) ?? existing;
      } else {
        const displayName =
          input.displayName.replace(/\s+/g, " ").trim() ||
          emailNormalized.split("@")[0] ||
          "Google 사용자";
        user = await this.store.createUser({
          email: input.email.trim(),
          emailNormalized,
          displayName,
          role: input.role,
          inviteCode: await this.generateInviteCode(displayName),
          googleSub: input.googleSub,
          emailVerifiedAt: this.now()
        });
      }
    }

    const login = await this.createLoginSessionForUser({
      user,
      userAgent: input.userAgent
    });
    return {
      user: publicUser(user),
      token: login.token,
      session: login.session
    };
  }

  async login(input: {
    email: string;
    password: string;
    userAgent?: string;
  }): Promise<{ user: PublicUser; token: string; session: AuthSession }> {
    const emailNormalized = normalizeEmail(input.email);
    const limited = await this.store.checkAndIncrementRateLimit(
      `login:${emailNormalized}`,
      10,
      15 * 60 * 1000
    );
    if (!limited) {
      throw new AuthError("잠시 후 다시 시도해 주세요.", 429, "RATE_LIMITED");
    }

    const user = await this.store.getUserByEmail(emailNormalized);
    if (!user || !(await this.verifyPassword(user, input.password))) {
      throw new AuthError("이메일 또는 비밀번호를 확인해 주세요.", 401, "INVALID_CREDENTIALS");
    }
    if (!user.emailVerifiedAt) {
      throw new AuthError("이메일 인증이 필요합니다.", 403, "EMAIL_NOT_VERIFIED");
    }

    const token = this.deps.tokenGenerator(32);
    const session = await this.store.createAuthSession({
      userId: user.id,
      tokenHash: this.tokenHash(token),
      expiresAt: new Date(
        this.deps.clock().getTime() + appConfig.authSessionTtlDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      userAgent: input.userAgent
    });

    return {
      user: publicUser(user),
      token,
      session
    };
  }

  async createLoginSessionForUser(input: {
    user: User;
    userAgent?: string;
  }): Promise<{ token: string; session: AuthSession }> {
    const token = this.deps.tokenGenerator(32);
    const session = await this.store.createAuthSession({
      userId: input.user.id,
      tokenHash: this.tokenHash(token),
      expiresAt: new Date(
        this.deps.clock().getTime() + appConfig.authSessionTtlDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      userAgent: input.userAgent
    });
    return { token, session };
  }

  async resolveSessionToken(token?: string): Promise<{
    user: User;
    session: AuthSession;
  } | null> {
    if (!token) return null;
    const session = await this.store.getAuthSessionByTokenHash(this.tokenHash(token));
    if (!session || session.revokedAt || session.expiresAt < this.now()) return null;
    const user = await this.store.getUser(session.userId);
    if (!user) return null;
    return { user, session };
  }

  async logout(sessionId?: string): Promise<void> {
    if (!sessionId) return;
    await this.store.revokeAuthSession(sessionId);
  }

  googleOAuthEnabled(): boolean {
    return Boolean(
      appConfig.googleOAuthClientId &&
        appConfig.googleOAuthClientSecret &&
        appConfig.googleOAuthRedirectUri
    );
  }
}
