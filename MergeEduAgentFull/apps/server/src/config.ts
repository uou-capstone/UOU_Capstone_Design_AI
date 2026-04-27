import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), "../../.env")
];
const foundEnvPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (foundEnvPath) {
  loadDotEnv({ path: foundEnvPath });
}
const projectRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envRootDir = foundEnvPath ? path.dirname(foundEnvPath) : projectRootDir;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function boundedRatio(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function resolveEnvPath(name: string): string {
  const value = requireEnv(name);
  return path.resolve(envRootDir, value);
}

export const appConfig = {
  port: Number(requireEnv("PORT")),
  webPort: Number(process.env.WEB_PORT ?? "5173"),
  dataDir: resolveEnvPath("DATA_DIR"),
  uploadDir: resolveEnvPath("UPLOAD_DIR"),
  modelName: requireEnv("MODEL_NAME"),
  googleApiKey: requireEnv("GOOGLE_API_KEY"),
  passScoreRatio: boundedRatio(requireEnv("PASS_SCORE_RATIO"), 0.7),
  contextMaxChars: Number(requireEnv("CONTEXT_MAX_CHARS")),
  recentMessagesN: Number(requireEnv("RECENT_MESSAGES_N")),
  aiBridgeUrl: requireEnv("AI_BRIDGE_URL"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? "25"),
  orchestratorThinkTimeoutMs: Number(process.env.ORCHESTRATOR_THINK_TIMEOUT_MS ?? "1200"),
  appOrigin: process.env.APP_ORIGIN ?? `http://localhost:${process.env.WEB_PORT ?? "5173"}`,
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "merge_edu_session",
  authSessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? "14"),
  authDevExposeVerificationCode: process.env.AUTH_DEV_EXPOSE_VERIFICATION_CODE === "true",
  authBootstrapSecret: process.env.AUTH_BOOTSTRAP_SECRET,
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  googleOAuthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  authEmailDeliveryMode:
    process.env.AUTH_EMAIL_DELIVERY_MODE === "smtp" ? "smtp" : "dev",
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFrom: process.env.SMTP_FROM,
  authVerificationCodeSecret: process.env.AUTH_VERIFICATION_CODE_SECRET,
  authAllowLegacyVerificationHash: process.env.AUTH_ALLOW_LEGACY_VERIFICATION_HASH === "true",
  authEmailResendCooldownSeconds: Number(
    process.env.AUTH_EMAIL_RESEND_COOLDOWN_SECONDS ?? "60"
  ),
  requestEncryptionMode:
    process.env.REQUEST_ENCRYPTION_MODE === "off" ||
    process.env.REQUEST_ENCRYPTION_MODE === "optional" ||
    process.env.REQUEST_ENCRYPTION_MODE === "required"
      ? process.env.REQUEST_ENCRYPTION_MODE
      : "required",
  requestEncryptionRequiredPaths: (
    process.env.REQUEST_ENCRYPTION_REQUIRED_PATHS ??
    "/api/auth/signup,/api/auth/register,/api/auth/login,/api/auth/verify-email,/api/auth/resend-verification"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
} as const;

if (Number.isNaN(appConfig.port)) {
  throw new Error("PORT must be a valid number");
}

if (appConfig.smtpPort !== undefined && Number.isNaN(appConfig.smtpPort)) {
  throw new Error("SMTP_PORT must be a valid number");
}
