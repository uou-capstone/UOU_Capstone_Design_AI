export type IsoString = string;

export const SCHEMA_VERSION = "1.0" as const;

export type UserRole = "teacher" | "student";

export interface User {
  id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  role: UserRole;
  inviteCode: string;
  passwordHash?: string;
  passwordSalt?: string;
  emailVerifiedAt?: IsoString;
  emailVerificationCodeHash?: string;
  emailVerificationExpiresAt?: IsoString;
  emailVerificationAttempts?: number;
  emailVerificationSentAt?: IsoString;
  googleSub?: string;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  inviteCode: string;
  emailVerified: boolean;
  hasPassword: boolean;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: IsoString;
  expiresAt: IsoString;
  revokedAt?: IsoString;
  userAgent?: string;
}

export interface ClassroomEnrollment {
  id: string;
  classroomId: string;
  studentUserId: string;
  invitedByTeacherId: string;
  createdAt: IsoString;
}

export type ClassroomInvitationStatus = "PENDING" | "ACCEPTED";

export interface ClassroomInvitation {
  id: string;
  classroomId: string;
  studentUserId: string;
  invitedByTeacherId: string;
  status: ClassroomInvitationStatus;
  createdAt: IsoString;
  updatedAt: IsoString;
  acceptedAt?: IsoString;
}

export interface InviteAuditLogEntry {
  id: string;
  classroomId: string;
  teacherId: string;
  studentUserId?: string;
  action: "SEARCH" | "INVITE" | "ENROLL" | "ACCEPT" | "REMOVE";
  result: "SUCCESS" | "NOT_FOUND" | "FORBIDDEN" | "DUPLICATE";
  createdAt: IsoString;
}

export interface OAuthState {
  id: string;
  stateHash: string;
  role: UserRole;
  codeVerifier?: string;
  nonceHash?: string;
  createdAt: IsoString;
  expiresAt: IsoString;
}

export interface RateLimitBucket {
  key: string;
  count: number;
  resetAt: IsoString;
}

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
  teacherId?: string;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export type ClassroomNoticeCategory =
  | "GENERAL"
  | "EXAM"
  | "MATERIAL"
  | "DISCUSSION"
  | "ASSIGNMENT";
export type ClassroomNoticePriority = "NORMAL" | "IMPORTANT";
export type ClassroomNoticeStatus = "DRAFT" | "PUBLISHED";
export type ClassroomNoticeTarget = "CLASS";

export interface ClassroomNoticeAttachment {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
}

export interface ClassroomNotice {
  id: string;
  classroomId: string;
  authorUserId: string;
  title: string;
  contentMarkdown: string;
  category: ClassroomNoticeCategory;
  priority: ClassroomNoticePriority;
  target: ClassroomNoticeTarget;
  pinned: boolean;
  status: ClassroomNoticeStatus;
  publishAt?: IsoString;
  publishedAt?: IsoString;
  attachments: ClassroomNoticeAttachment[];
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface ClassroomNoticeComment {
  id: string;
  classroomId: string;
  noticeId: string;
  authorUserId: string;
  parentCommentId?: string;
  contentMarkdown: string;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export type ClassroomDiscussionCategory = "NOTICE" | "QUESTION" | "FREE" | "RESOURCE";
export type ClassroomDiscussionStatus = "DRAFT" | "PUBLISHED";
export type ClassroomDiscussionVisibility = "CLASS";

export interface ClassroomDiscussionAttachment {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
}

export interface ClassroomDiscussionPost {
  id: string;
  classroomId: string;
  authorUserId: string;
  title: string;
  contentMarkdown: string;
  category: ClassroomDiscussionCategory;
  visibility: ClassroomDiscussionVisibility;
  pinned: boolean;
  anonymous: boolean;
  allowComments: boolean;
  status: ClassroomDiscussionStatus;
  attachments: ClassroomDiscussionAttachment[];
  viewCount: number;
  publishedAt?: IsoString;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface ClassroomDiscussionViewReceipt {
  classroomId: string;
  postId: string;
  viewerUserId: string;
  lastViewedAt: IsoString;
}

export interface ClassroomDiscussionComment {
  id: string;
  classroomId: string;
  postId: string;
  authorUserId: string;
  parentCommentId?: string;
  contentMarkdown: string;
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

export type ClassroomAttendanceStatus =
  | "active"
  | "completed"
  | "notStarted"
  | "needsAttention"
  | "noMaterials";

export interface ClassroomAttendanceLectureProgress {
  lectureId: string;
  lectureTitle: string;
  weekId: string;
  weekTitle: string;
  weekIndex: number;
  totalPages: number;
  maxReachedPage: number;
  completed: boolean;
  lastTouchedAt?: IsoString;
}

export interface ClassroomAttendanceStudent {
  studentUserId: string;
  displayName: string;
  inviteCode: string;
  maskedEmail: string;
  enrolledAt: IsoString;
  status: ClassroomAttendanceStatus;
  completedLectureCount: number;
  totalLectureCount: number;
  totalReachedPages: number;
  totalPages: number;
  completionRatio: number;
  pageCoverageRatio: number;
  currentWeekTitle?: string;
  lastTouchedAt?: IsoString;
  lectures: ClassroomAttendanceLectureProgress[];
}

export interface ClassroomAttendanceSummary {
  totalStudents: number;
  activeStudentCount: number;
  attentionStudentCount: number;
  totalLectureCount: number;
  totalPages: number;
  weeks: Week[];
  students: ClassroomAttendanceStudent[];
}

export type StudentClassroomAttendanceExamParticipationStatus =
  | "graded"
  | "submitted"
  | "inProgress"
  | "missed"
  | "upcoming"
  | "open";

export type StudentClassroomAttendanceExamStatusTone =
  | "complete"
  | "progress"
  | "missed"
  | "upcoming"
  | "none";

export type StudentClassroomAttendanceExamAction =
  | { kind: "result"; label: "결과 보기"; to: string }
  | { kind: "take"; label: "시험 응시"; to: string }
  | { kind: "disabled"; label: "채점 중" | "결과 준비 중" | "시험 예정" | "시험 종료" };

export interface StudentClassroomAttendanceExam {
  examId: string;
  weekId: string;
  title: string;
  availableFrom?: IsoString;
  availableUntil?: IsoString;
  timeLimitMinutes?: number;
  totalPoints: number;
  questionCount: number;
  participationStatus: StudentClassroomAttendanceExamParticipationStatus;
  statusLabel: string;
  statusTone: Exclude<StudentClassroomAttendanceExamStatusTone, "none">;
  action: StudentClassroomAttendanceExamAction;
  attempt?: {
    status: TeacherExamAttemptStatus;
    startedAt?: IsoString;
    submittedAt?: IsoString;
    gradedAt?: IsoString;
    hasGrading: boolean;
  };
}

export interface StudentClassroomAttendanceWeek {
  weekId: string;
  weekTitle: string;
  weekIndex: number;
  lectureCount: number;
  completedLectureCount: number;
  lectureAttendanceRatio: number;
  lectures: ClassroomAttendanceLectureProgress[];
  examCount: number;
  completedExamCount: number;
  inProgressExamCount: number;
  missedExamCount: number;
  examStatusLabel: string;
  examStatusTone: StudentClassroomAttendanceExamStatusTone;
  exams: StudentClassroomAttendanceExam[];
}

export interface StudentClassroomAttendanceSummary {
  classroomId: string;
  studentUserId: string;
  totalWeeks: number;
  totalLectureCount: number;
  completedLectureCount: number;
  overallAttendanceRatio: number;
  totalExamCount: number;
  completedExamCount: number;
  weeks: StudentClassroomAttendanceWeek[];
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

export type TeacherExamStatus = "DRAFT" | "PUBLISHED";
export type TeacherExamQuestionType = "MCQ" | "OX" | "SHORT" | "ESSAY";
export type TeacherExamAttemptStatus = "IN_PROGRESS" | "GRADING" | "GRADED";
export type TeacherExamGradingSource = "AI" | "DETERMINISTIC_FALLBACK";

export interface TeacherExamChoice {
  id: string;
  textMarkdown: string;
}

export interface TeacherExamQuestion {
  id: string;
  type: TeacherExamQuestionType;
  promptMarkdown: string;
  points: number;
  choices?: TeacherExamChoice[];
  answer?: {
    choiceId?: string;
    value?: boolean;
  };
  referenceAnswer?: {
    text: string;
  };
  rubricMarkdown?: string;
  modelAnswerMarkdown?: string;
  explanationMarkdown?: string;
}

export interface TeacherExamRevision {
  version: number;
  title: string;
  descriptionMarkdown: string;
  availableFrom: IsoString;
  availableUntil: IsoString;
  timeLimitMinutes: number;
  passScoreRatio: number;
  aiGradingEnabled: boolean;
  questions: TeacherExamQuestion[];
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface TeacherExam {
  id: string;
  classroomId: string;
  weekId: string;
  status: TeacherExamStatus;
  activePublishedVersion?: number;
  draftRevision: TeacherExamRevision;
  publishedRevision?: TeacherExamRevision;
  createdAt: IsoString;
  updatedAt: IsoString;
}

export interface TeacherExamSettingsSnapshot {
  title: string;
  descriptionMarkdown: string;
  availableFrom: IsoString;
  availableUntil: IsoString;
  timeLimitMinutes: number;
  passScoreRatio: number;
  aiGradingEnabled: boolean;
}

export interface TeacherExamGradingItem {
  questionId: string;
  score: number;
  maxScore: number;
  verdict: "CORRECT" | "WRONG" | "PARTIAL";
  feedbackMarkdown: string;
  gradingMode?: "SYSTEM" | "AI" | "FALLBACK" | "EXCLUDED";
  excludedFromScore?: boolean;
}

export interface TeacherExamGrading {
  totalScore: number;
  maxScore: number;
  scoreRatio: number;
  items: TeacherExamGradingItem[];
  summaryMarkdown: string;
  gradingSource: TeacherExamGradingSource;
  fallback?: boolean;
}

export interface TeacherExamAttempt {
  id: string;
  examId: string;
  studentUserId: string;
  status: TeacherExamAttemptStatus;
  examVersion: number;
  examSnapshot: TeacherExamRevision;
  settingsSnapshot: TeacherExamSettingsSnapshot;
  submissionId?: string;
  gradingStartedAt?: IsoString;
  gradingLeaseExpiresAt?: IsoString;
  startedAt: IsoString;
  deadlineAt: IsoString;
  submittedAt?: IsoString;
  gradedAt?: IsoString;
  lastSavedAt?: IsoString;
  lastAcceptedAnswerSaveAt?: IsoString;
  answers: Record<string, unknown>;
  grading?: TeacherExamGrading;
}

export interface TeacherExamResultRecord {
  id: string;
  schemaVersion: "1.0";
  examId: string;
  classroomId: string;
  weekId: string;
  attemptId: string;
  submissionId: string;
  studentUserId: string;
  examVersion: number;
  generatedAt: IsoString;
  examTitle: string;
  settingsSnapshot: TeacherExamSettingsSnapshot;
  answers: Record<string, unknown>;
  grading: TeacherExamGrading;
  questions: Array<
    Pick<
      TeacherExamQuestion,
      | "id"
      | "type"
      | "promptMarkdown"
      | "points"
      | "choices"
      | "answer"
      | "referenceAnswer"
      | "rubricMarkdown"
      | "modelAnswerMarkdown"
      | "explanationMarkdown"
    >
  >;
  submittedAt?: IsoString;
  gradedAt?: IsoString;
}

export type TeacherExamReportStudentStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "MISSED";

export interface TeacherExamReportScore {
  score: number;
  maxScore: number;
  scoreRatio: number;
}

export interface TeacherExamReportQuestionDistribution {
  key: string;
  label: string;
  count: number;
  ratio: number;
  isCorrect?: boolean;
}

export interface TeacherExamReportQuestionRespondent {
  studentUserId: string;
  displayName: string;
  answerLabel: string;
  result: "CORRECT" | "WRONG" | "PARTIAL" | "UNANSWERED" | "UNSUPPORTED";
  score: number;
  maxScore: number;
  submittedAt?: IsoString;
}

export interface TeacherExamReportQuestionStat {
  statId: string;
  questionId: string;
  questionNumber?: number;
  type?: TeacherExamQuestionType;
  promptMarkdown?: string;
  maxScore: number;
  averageScore: number;
  attempts: number;
  correctCount?: number;
  incorrectCount?: number;
  partialCount?: number;
  unansweredCount?: number;
  correctAnswerLabel?: string;
  unsupportedReason?: string;
  isArchivedQuestion?: boolean;
  versionLabel?: string;
  distribution?: TeacherExamReportQuestionDistribution[];
  respondents?: TeacherExamReportQuestionRespondent[];
}

export interface ExamStudioProposal {
  answerMarkdown?: string;
  replyMarkdown: string;
  operations?: ExamStudioOperation[];
  settingsPatch?: Partial<
    Pick<
      TeacherExamRevision,
      | "title"
      | "descriptionMarkdown"
      | "availableFrom"
      | "availableUntil"
      | "timeLimitMinutes"
      | "passScoreRatio"
      | "aiGradingEnabled"
    >
  >;
  appendQuestions?: TeacherExamQuestion[];
  replaceQuestionId?: string;
  fallback?: boolean;
  source?: "AI" | "AI_UNAVAILABLE";
}

export interface ReportCriteriaAssistantCriterion {
  name: string;
  description: string;
}

export interface ReportCriteriaAssistantSummaryCard {
  title: string;
  body: string;
}

export type ReportCriteriaAssistantMethod =
  | "messageOnly"
  | "draftCriterion"
  | "reviseCriterion"
  | "createCriterion"
  | "updateCriterion"
  | "deleteCriterion";

export interface ReportCriteriaAssistantOperation {
  method: ReportCriteriaAssistantMethod;
  params?: {
    criterion?: ReportCriteriaAssistantCriterion;
    targetCriterionId?: string;
    targetCriterionName?: string;
    targetCriterionDescription?: string;
    targetCriterionUpdatedAt?: IsoString;
    rationale?: string;
    summaryCards?: ReportCriteriaAssistantSummaryCard[];
  };
}

export interface ReportCriteriaAssistantProposal {
  replyMarkdown: string;
  operation: ReportCriteriaAssistantOperation;
  source?: "AI" | "AI_UNAVAILABLE";
  fallback?: boolean;
  downgradeReason?: string;
}

export type ExamStudioOperation =
  | {
      method: "patchExamSettings";
      params: Partial<
        Pick<
          TeacherExamRevision,
          | "title"
          | "descriptionMarkdown"
          | "availableFrom"
          | "availableUntil"
          | "timeLimitMinutes"
          | "passScoreRatio"
          | "aiGradingEnabled"
        >
      >;
    }
  | {
      method: "appendQuestions";
      params: { questions: TeacherExamQuestion[] };
    }
  | {
      method: "replaceQuestion";
      params: { replaceQuestionId: string; question: TeacherExamQuestion };
    };

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

export type QuizAssessmentSource = "DETERMINISTIC_V1";
export type QuizAssessmentDeliveryStatus = "PENDING" | "CONSUMED";
export type QuizAssessmentReadiness =
  | "READY_TO_ADVANCE"
  | "REINFORCE_BEFORE_ADVANCE"
  | "REPAIR_REQUIRED";

export interface AssessmentMemoryHint {
  strengths: string[];
  weaknesses: string[];
  misconceptions: string[];
  explanationPreferences: string[];
  preferredQuizTypes: QuizType[];
  targetDifficulty?: QuizDifficultyTarget;
  nextCoachingGoals: string[];
}

export interface QuizAssessmentRecord {
  id: string;
  quizId: string;
  page: number;
  quizType: QuizType;
  version: "1.0";
  source: QuizAssessmentSource;
  createdAt: IsoString;
  updatedAt: IsoString;
  scoreRatio: number;
  readiness: QuizAssessmentReadiness;
  deliveryStatus: QuizAssessmentDeliveryStatus;
  consumedAt?: IsoString;
  strengths: string[];
  weaknesses: string[];
  misconceptions: string[];
  behaviorSignals: string[];
  memoryHint: AssessmentMemoryHint;
  summaryMarkdown: string;
  evidence: string[];
}

export type InterventionStage = "AWAITING_DIAGNOSIS_REPLY" | "REPAIR_DELIVERED";

export interface ActiveIntervention {
  mode: "QUIZ_REPAIR";
  page: number;
  quizId: string;
  scoreRatio: number;
  wrongQuestionIds: string[];
  focusConcepts: string[];
  suspectedMisconceptions: string[];
  diagnosticPrompt: string;
  stage: InterventionStage;
  createdAt: IsoString;
  lastUpdatedAt: IsoString;
}

export type QaThreadMode = "START_NEW" | "FOLLOW_UP";

export interface QaThreadTurn {
  page: number;
  question: string;
  answerMarkdown: string;
  createdAt: IsoString;
}

export interface QaThreadMemory {
  page: number | null;
  turns: QaThreadTurn[];
  lastUpdatedAt: IsoString;
}

export type CompetencyTrend = "UP" | "STEADY" | "DOWN";
export type CompetencyOverallLevel =
  | "EMERGING"
  | "DEVELOPING"
  | "PROFICIENT"
  | "ADVANCED";
export type CompetencyAnalysisStatus = "READY" | "SPARSE_DATA";
export type CompetencyGenerationMode = "AI_ANALYZED" | "HEURISTIC_FALLBACK";
export type BuiltInStudentCompetencyKey =
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
export type StudentCompetencyKey = BuiltInStudentCompetencyKey | (string & {});

export interface StudentReportCustomCriterion {
  id: string;
  classroomId: string;
  name: string;
  description: string;
  createdAt: IsoString;
  updatedAt: IsoString;
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
  progressPageCount?: number;
  progressCoverageRatio?: number;
  questionCount: number;
  quizCount: number;
  gradedQuizCount: number;
  averageQuizScore: number;
  teacherExamResultCount?: number;
  teacherExamAverageScore?: number;
  feedbackCount: number;
  memoryRefreshCount: number;
}

export interface StudentCompetencyReport {
  schemaVersion: "1.0";
  classroomId: string;
  reportScope?: "CLASSROOM_AGGREGATE" | "STUDENT";
  studentUserId?: string;
  classroomTitle: string;
  studentLabel: string;
  generatedAt: IsoString;
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

export interface SessionState {
  schemaVersion: "1.0";
  sessionId: string;
  lectureId: string;
  ownerUserId?: string;
  currentPage: number;
  learningProgressPage?: number;
  pageStates: PageState[];
  messages: ChatMessage[];
  quizzes: QuizRecord[];
  feedback: FeedbackEntry[];
  learnerModel: LearnerModel;
  integratedMemory: IntegratedLearnerMemory;
  quizAssessments?: QuizAssessmentRecord[];
  activeIntervention?: ActiveIntervention | null;
  qaThread?: QaThreadMemory;
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
    passScoreRatio: number;
    widgets?: Widget[];
  };
  patch: {
    currentPage: number;
    learningProgressPage: number;
    progressText: string;
    pageState?: PageState;
    learnerModel: LearnerModel;
    activeIntervention?: ActiveIntervention | null;
    quizRecord?: QuizRecord | null;
  };
}
