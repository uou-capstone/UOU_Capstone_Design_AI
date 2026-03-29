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
  | "WRITE_FEEDBACK_ENTRY";

export interface ToolAction {
  type: "CALL_TOOL";
  tool: ToolName;
  args: Record<string, unknown>;
}

export type OrchestratorAction = ToolAction;

export interface OrchestratorPlan {
  schemaVersion: "1.0";
  actions: OrchestratorAction[];
  stop?: boolean;
  memoryWrite?: LearnerMemoryWrite | null;
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
  llmHint?: {
    offerQuiz?: boolean;
    detailLevel?: "NORMAL" | "DETAILED";
    reason?: string;
  };
}
