export type AgentName =
  | "ORCHESTRATOR"
  | "EXPLAINER"
  | "QA"
  | "QUIZ"
  | "GRADER"
  | "SYSTEM";

export type QuizType = "MCQ" | "OX" | "SHORT" | "ESSAY";
export type CompetencyTrend = "UP" | "STEADY" | "DOWN";
export type CompetencyOverallLevel =
  | "EMERGING"
  | "DEVELOPING"
  | "PROFICIENT"
  | "ADVANCED";
export type CompetencyAnalysisStatus = "READY" | "SPARSE_DATA";
export type CompetencyGenerationMode = "AI_ANALYZED" | "HEURISTIC_FALLBACK";
export type StudentCompetencyKey =
  | "CONCEPT_UNDERSTANDING"
  | "QUESTION_QUALITY"
  | "PROBLEM_SOLVING"
  | "APPLICATION_TRANSFER"
  | "QUIZ_ACCURACY"
  | "LEARNING_PERSISTENCE"
  | "SELF_REFLECTION"
  | "CLASS_PARTICIPATION"
  | "CONFIDENCE_GROWTH"
  | "IMPROVEMENT_MOMENTUM";

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
  activeIntervention?: {
    mode: "QUIZ_REPAIR";
    page: number;
    quizId: string;
    scoreRatio: number;
    wrongQuestionIds: string[];
    focusConcepts: string[];
    suspectedMisconceptions: string[];
    diagnosticPrompt: string;
    stage: "AWAITING_DIAGNOSIS_REPLY" | "REPAIR_DELIVERED";
    createdAt: string;
    lastUpdatedAt: string;
  } | null;
}

export interface AiStatus {
  connected: boolean;
  message?: string;
}

export interface StudentCompetencyScore {
  key: StudentCompetencyKey;
  label: string;
  score: number;
  trend: CompetencyTrend;
  summary: string;
  evidence: string[];
}

export interface StudentActionRecommendation {
  title: string;
  description: string;
}

export interface StudentLectureInsight {
  lectureId: string;
  lectureTitle: string;
  weekTitle: string;
  questionCount: number;
  quizCount: number;
  averageQuizScore: number;
  masteryLabel: string;
}

export interface StudentReportSourceStats {
  lectureCount: number;
  sessionCount: number;
  completedPageCount: number;
  pageCoverageRatio: number;
  questionCount: number;
  quizCount: number;
  gradedQuizCount: number;
  averageQuizScore: number;
  feedbackCount: number;
  memoryRefreshCount: number;
}

export interface StudentCompetencyReport {
  schemaVersion: "1.0";
  classroomId: string;
  classroomTitle: string;
  studentLabel: string;
  generatedAt: string;
  analysisStatus: CompetencyAnalysisStatus;
  generationMode: CompetencyGenerationMode;
  headline: string;
  summaryMarkdown: string;
  overallScore: number;
  overallLevel: CompetencyOverallLevel;
  competencies: StudentCompetencyScore[];
  strengths: string[];
  growthAreas: string[];
  coachingInsights: string[];
  recommendedActions: StudentActionRecommendation[];
  lectureInsights: StudentLectureInsight[];
  sourceStats: StudentReportSourceStats;
  dataQualityNote: string;
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
