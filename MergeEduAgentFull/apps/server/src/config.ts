import path from "node:path";
import fs from "node:fs";
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const appConfig = {
  port: Number(requireEnv("PORT")),
  dataDir: path.resolve(process.cwd(), requireEnv("DATA_DIR")),
  uploadDir: path.resolve(process.cwd(), requireEnv("UPLOAD_DIR")),
  modelName: requireEnv("MODEL_NAME"),
  googleApiKey: requireEnv("GOOGLE_API_KEY"),
  passScoreRatio: Number(requireEnv("PASS_SCORE_RATIO")),
  contextMaxChars: Number(requireEnv("CONTEXT_MAX_CHARS")),
  recentMessagesN: Number(requireEnv("RECENT_MESSAGES_N")),
  aiBridgeUrl: requireEnv("AI_BRIDGE_URL"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? "25"),
  orchestratorThinkTimeoutMs: Number(process.env.ORCHESTRATOR_THINK_TIMEOUT_MS ?? "1200")
} as const;

if (Number.isNaN(appConfig.port)) {
  throw new Error("PORT must be a valid number");
}
