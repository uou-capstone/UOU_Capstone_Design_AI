export type IsoString = string;

export const SCHEMA_VERSION = "1.0" as const;

export type AgentName =
  | "ORCHESTRATOR"
  | "EXPLAINER"
  | "QA"
  | "QUIZ"
  | "GRADER"
  | "SYSTEM";

export type LearnerLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
export type QuizDifficultyTarget = "FOUNDATIONAL" | "BALANCED" | "CHALLENGING";

export interface Classroom {
  id: string;
  title: string;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface Week {
  id: string;
  classroomId: string;
  weekIndex: number;
  title: string;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface GeminiFileRef {
  fileName: string;
  fileUri: string;
  mimeType: string;
}

export interface LectureItem {
  id: string;
  weekId: string;
  title: string;
  pdf: {
    path: string;
    numPages: number;
    pageIndexPath: string;
    geminiFile?: GeminiFileRef;
  };
  createdAt: IsoString;
  updatedAt: IsoString;
}

export type PageStatus =
  | "NEW"
  | "EXPLAINING"
  | "EXPLAINED"
  | "QUIZ_TYPE_PENDING"
  | "QUIZ_IN_PROGRESS"
  | "QUIZ_GRADED"
  | "REVIEW_IN_PROGRESS"
  | "REVIEW_DONE"
  | "DONE";

export interface QuizPointer {
  lastQuizId?: string;
  bestScoreRatio?: number;
}

export interface PageState {
  page: number;
  status: PageStatus;
  explainSummary?: string;
  explainMarkdown?: string;
  lastTouchedAt: IsoString;
  quiz?: QuizPointer;
}

export type WidgetType = "QUIZ_TYPE_PICKER" | "BINARY_CHOICE";

export interface QuizTypeOption {
  id: "MCQ" | "OX" | "SHORT" | "ESSAY";
  label: string;
}

export interface Widget {
  type: WidgetType;
  options?: QuizTypeOption[];
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
  createdAt: IsoString;
  widget?: Widget;
}

export type QuizType = "MCQ" | "OX" | "SHORT" | "ESSAY";

export interface QuizQuestionBase {
  id: string;
  promptMarkdown: string;
  points?: number;
}

export interface QuizQuestion extends QuizQuestionBase {
  choices?: { id: string; textMarkdown: string }[];
  answer?: { choiceId?: string; value?: boolean };
  explanationMarkdown?: string;
  referenceAnswer?: { text: string };
  rubricMarkdown?: string;
  modelAnswerMarkdown?: string;
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

export interface GradingResult {
  schemaVersion: "1.0";
  quizId: string;
  type: "GRADING_RESULT";
  totalScore: number;
  maxScore: number;
  items: GradingItem[];
  summaryMarkdown: string;
}

export interface QuizRecord {
  id: string;
  quizType: QuizType;
  createdFromPage: number;
  createdAt: IsoString;
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

export interface FeedbackEntry {
  id: string;
  createdAt: IsoString;
  page: number;
  progressText: string;
  learnerLevel: LearnerLevel;
  notesMarkdown: string;
}

export interface LearnerModel {
  level: LearnerLevel;
  confidence: number;
  weakConcepts: string[];
  strongConcepts: string[];
}

export interface IntegratedLearnerMemory {
  summaryMarkdown: string;
  strengths: string[];
  weaknesses: string[];
  misconceptions: string[];
  explanationPreferences: string[];
  preferredQuizTypes: QuizType[];
  targetDifficulty: QuizDifficultyTarget;
  nextCoachingGoals: string[];
  lastUpdatedAt: IsoString;
}

export interface LearnerMemoryWrite {
  shouldPersist: boolean;
  summaryMarkdown?: string;
  strengths?: string[];
  weaknesses?: string[];
  misconceptions?: string[];
  explanationPreferences?: string[];
  preferredQuizTypes?: QuizType[];
  targetDifficulty?: QuizDifficultyTarget;
  nextCoachingGoals?: string[];
  confidence?: number;
  learnerLevel?: LearnerLevel;
}

export interface SessionState {
  schemaVersion: "1.0";
  sessionId: string;
  lectureId: string;
  currentPage: number;
  pageStates: PageState[];
  messages: ChatMessage[];
  quizzes: QuizRecord[];
  feedback: FeedbackEntry[];
  learnerModel: LearnerModel;
  integratedMemory: IntegratedLearnerMemory;
  conversationSummary: string;
  updatedAt: IsoString;
}

export interface AppEvent {
  type:
    | "SESSION_ENTERED"
    | "START_EXPLANATION_DECISION"
    | "USER_MESSAGE"
    | "PAGE_CHANGED"
    | "QUIZ_TYPE_SELECTED"
    | "QUIZ_DECISION"
    | "QUIZ_SUBMITTED"
    | "NEXT_PAGE_DECISION"
    | "REVIEW_DECISION"
    | "RETEST_DECISION"
    | "SAVE_AND_EXIT";
  payload?: Record<string, unknown>;
}

export interface EventApiRequest {
  event: AppEvent;
  clientContext?: {
    currentPage?: number;
  };
}

export interface EventApiResponse {
  ok: boolean;
  newMessages: ChatMessage[];
  ui: {
    openQuizModal: boolean;
    quiz: QuizJson | null;
    disableQuizClose: boolean;
    widgets?: Widget[];
  };
  patch: {
    currentPage: number;
    progressText: string;
    pageState?: PageState;
    learnerModel: LearnerModel;
  };
}
