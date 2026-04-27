import { ExplainerAgent } from "./services/agents/ExplainerAgent.js";
import { GraderAgent } from "./services/agents/GraderAgent.js";
import { MisconceptionRepairAgent } from "./services/agents/MisconceptionRepairAgent.js";
import { Orchestrator } from "./services/agents/Orchestrator.js";
import { QaAgent } from "./services/agents/QaAgent.js";
import { QuizAgents } from "./services/agents/QuizAgents.js";
import { OrchestrationEngine } from "./services/engine/OrchestrationEngine.js";
import { StateReducer } from "./services/engine/StateReducer.js";
import { SummaryService } from "./services/engine/SummaryService.js";
import { ToolDispatcher } from "./services/engine/ToolDispatcher.js";
import { AuthService } from "./services/auth/AuthService.js";
import { createEmailSender } from "./services/auth/EmailSender.js";
import { GeminiBridgeClient } from "./services/llm/GeminiBridgeClient.js";
import { PdfIngestService } from "./services/pdf/PdfIngestService.js";
import { RequestEncryptionService } from "./services/security/RequestEncryptionService.js";
import { JsonStore } from "./services/storage/JsonStore.js";
import { appConfig } from "./config.js";

export interface ServerDeps {
  store: JsonStore;
  auth: AuthService;
  requestEncryption: RequestEncryptionService;
  bridge: GeminiBridgeClient;
  pdfIngest: PdfIngestService;
  engine: OrchestrationEngine;
}

export async function createServerDeps(): Promise<ServerDeps> {
  validateAuthRuntimeConfig();
  const store = new JsonStore();
  await store.init();
  const auth = new AuthService(store, {
    emailSender: createEmailSender()
  });
  const requestEncryption = new RequestEncryptionService();

  const bridge = new GeminiBridgeClient();
  const pdfIngest = new PdfIngestService(store.getUploadDir());
  const explainer = new ExplainerAgent(bridge);
  const qa = new QaAgent(bridge);
  const quizAgents = new QuizAgents(bridge);
  const grader = new GraderAgent(bridge);
  const repair = new MisconceptionRepairAgent(bridge);

  const reducer = new StateReducer();
  const orchestrator = new Orchestrator();
  const summary = new SummaryService();
  const dispatcher = new ToolDispatcher(explainer, qa, quizAgents, grader, repair);
  const engine = new OrchestrationEngine(
    store,
    reducer,
    orchestrator,
    dispatcher,
    bridge,
    pdfIngest,
    summary
  );

  return {
    store,
    auth,
    requestEncryption,
    bridge,
    pdfIngest,
    engine
  };
}

function validateAuthRuntimeConfig(): void {
  if (process.env.NODE_ENV === "production" && appConfig.requestEncryptionMode !== "required") {
    throw new Error("REQUEST_ENCRYPTION_MODE=required is required in production");
  }

  if (process.env.NODE_ENV === "production" && appConfig.authEmailDeliveryMode !== "smtp") {
    throw new Error("AUTH_EMAIL_DELIVERY_MODE=smtp is required in production");
  }

  if (
    (process.env.NODE_ENV === "production" || appConfig.authEmailDeliveryMode === "smtp") &&
    !appConfig.authVerificationCodeSecret
  ) {
    throw new Error(
      "AUTH_VERIFICATION_CODE_SECRET is required in production or smtp email mode"
    );
  }

  if (appConfig.authEmailDeliveryMode === "smtp") {
    const missing = [
      ["SMTP_HOST", appConfig.smtpHost],
      ["SMTP_PORT", appConfig.smtpPort],
      ["SMTP_USER", appConfig.smtpUser],
      ["SMTP_PASS", appConfig.smtpPass],
      ["SMTP_FROM", appConfig.smtpFrom]
    ].filter(([, value]) => value === undefined || value === "");
    if (missing.length > 0) {
      throw new Error(`SMTP settings are required in smtp mode: ${missing.map(([name]) => name).join(", ")}`);
    }
  }
}
