import { AppEvent, LearnerMemoryWrite, QuizType, SessionState } from "./domain.js";

export type ToolName =
  | "APPEND_ORCHESTRATOR_MESSAGE"
  | "APPEND_SYSTEM_MESSAGE"
  | "PROMPT_BINARY_DECISION"
  | "OPEN_QUIZ_TYPE_PICKER"
  | "SET_CURRENT_PAGE"
  | "EXPLAIN_PAGE"
  | "ANSWER_QUESTION"
  | "GENERATE_QUIZ_MCQ"
  | "GENERATE_QUIZ_OX"
  | "GENERATE_QUIZ_SHORT"
  | "GENERATE_QUIZ_ESSAY"
  | "AUTO_GRADE_MCQ_OX"
  | "GRADE_SHORT_OR_ESSAY"
  | "REPAIR_MISCONCEPTION"
  | "WRITE_FEEDBACK_ENTRY";

export interface ToolAction {
  type: "CALL_TOOL";
  tool: ToolName;
  args: Record<string, unknown>;
}

export type OrchestratorAction = ToolAction;

export type PolicyMode =
  | "EXPLAIN_FIRST"
  | "DIAGNOSE"
  | "MISCONCEPTION_REPAIR"
  | "MINIMAL_HINT"
  | "CHECK_READINESS"
  | "HOLD_BACK"
  | "SRL_REFLECTION"
  | "ADVANCE";

export type HintDepth = "LOW" | "MEDIUM" | "HIGH";

export interface PedagogyPolicy {
  mode: PolicyMode;
  reason: string;
  allowDirectAnswer: boolean;
  hintDepth: HintDepth;
  interventionBudget: 0 | 1 | 2 | 3;
}

export interface OrchestratorPlan {
  schemaVersion: "1.0";
  actions: OrchestratorAction[];
  stop?: boolean;
  memoryWrite?: LearnerMemoryWrite | null;
  /** Ver3: optional at wire level; normalizePlan() guarantees presence at dispatch time. */
  pedagogyPolicy?: PedagogyPolicy;
}

export interface OrchestratorInput {
  schemaVersion: "1.0";
  event: AppEvent;
  session: SessionState;
  lectureNumPages: number;
  pageText: string;
  neighborText: {
    prev: string;
    next: string;
  };
  policy: {
    passScoreRatio: number;
    recentMessagesN: number;
  };
  assessmentDigest?: string;
  llmHint?: {
    offerQuiz?: boolean;
    detailLevel?: "NORMAL" | "DETAILED";
    reason?: string;
  };
}
