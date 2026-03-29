export type AgentName =
  | "ORCHESTRATOR"
  | "EXPLAINER"
  | "QA"
  | "QUIZ"
  | "GRADER"
  | "SYSTEM";

export type QuizType = "MCQ" | "OX" | "SHORT" | "ESSAY";

export interface Widget {
  type: "QUIZ_TYPE_PICKER" | "BINARY_CHOICE";
  options?: { id: QuizType; label: string }[];
  recommendedId?: string;
  badgeText?: string;
  decisionType?:
    | "START_EXPLANATION_DECISION"
    | "QUIZ_DECISION"
    | "NEXT_PAGE_DECISION"
    | "REVIEW_DECISION"
    | "RETEST_DECISION";
}

export interface ChatMessage {
  id: string;
  role: "assistant" | "user" | "system";
  agent: AgentName;
  contentMarkdown: string;
  thoughtSummaryMarkdown?: string;
  createdAt: string;
  widget?: Widget;
}

export interface QuizQuestion {
  id: string;
  promptMarkdown: string;
  points?: number;
  choices?: { id: string; textMarkdown: string }[];
  answer?: { choiceId?: string; value?: boolean };
  referenceAnswer?: { text: string };
  modelAnswerMarkdown?: string;
  rubricMarkdown?: string;
  explanationMarkdown?: string;
}

export interface QuizJson {
  schemaVersion: "1.0";
  quizId: string;
  quizType: QuizType;
  page: number;
  title?: string;
  questions: QuizQuestion[];
}

export interface GradingItem {
  questionId: string;
  score: number;
  maxScore: number;
  verdict: "CORRECT" | "WRONG" | "PARTIAL";
  feedbackMarkdown: string;
}

export interface QuizRecord {
  id: string;
  quizType: QuizType;
  createdFromPage: number;
  createdAt: string;
  quizJson: QuizJson;
  userAnswers?: Record<string, unknown>;
  grading?: {
    status: "PENDING" | "GRADED";
    score: number;
    maxScore: number;
    scoreRatio: number;
    items: GradingItem[];
    summaryMarkdown: string;
  };
}

export interface SessionState {
  schemaVersion: "1.0";
  sessionId: string;
  lectureId: string;
  currentPage: number;
  pageStates?: Array<{
    page: number;
    status: string;
    explainSummary?: string;
    explainMarkdown?: string;
  }>;
  messages: ChatMessage[];
  quizzes: QuizRecord[];
  learnerModel: {
    level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
    confidence: number;
    weakConcepts: string[];
    strongConcepts: string[];
  };
}

export interface AiStatus {
  connected: boolean;
  message?: string;
}

export interface LectureItem {
  id: string;
  weekId: string;
  title: string;
  pdf: {
    path: string;
    numPages: number;
    pageIndexPath: string;
    geminiFile?: {
      fileName: string;
      fileUri: string;
      mimeType: string;
    };
  };
}

export interface Week {
  id: string;
  classroomId: string;
  weekIndex: number;
  title: string;
}

export interface Classroom {
  id: string;
  title: string;
}
