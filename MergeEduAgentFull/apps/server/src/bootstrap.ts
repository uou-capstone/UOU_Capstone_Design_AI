import { ExplainerAgent } from "./services/agents/ExplainerAgent.js";
import { GraderAgent } from "./services/agents/GraderAgent.js";
import { Orchestrator } from "./services/agents/Orchestrator.js";
import { QaAgent } from "./services/agents/QaAgent.js";
import { QuizAgents } from "./services/agents/QuizAgents.js";
import { OrchestrationEngine } from "./services/engine/OrchestrationEngine.js";
import { StateReducer } from "./services/engine/StateReducer.js";
import { SummaryService } from "./services/engine/SummaryService.js";
import { ToolDispatcher } from "./services/engine/ToolDispatcher.js";
import { GeminiBridgeClient } from "./services/llm/GeminiBridgeClient.js";
import { PdfIngestService } from "./services/pdf/PdfIngestService.js";
import { JsonStore } from "./services/storage/JsonStore.js";

export async function createServerDeps() {
  const store = new JsonStore();
  await store.init();

  const bridge = new GeminiBridgeClient();
  const pdfIngest = new PdfIngestService();
  const explainer = new ExplainerAgent(bridge);
  const qa = new QaAgent(bridge);
  const quizAgents = new QuizAgents(bridge);
  const grader = new GraderAgent(bridge);

  const reducer = new StateReducer();
  const orchestrator = new Orchestrator();
  const summary = new SummaryService();
  const dispatcher = new ToolDispatcher(explainer, qa, quizAgents, grader);
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
    bridge,
    pdfIngest,
    engine
  };
}

export type ServerDeps = Awaited<ReturnType<typeof createServerDeps>>;
