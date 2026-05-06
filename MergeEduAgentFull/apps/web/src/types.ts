export type AgentName =
  | "ORCHESTRATOR"
  | "EXPLAINER"
  | "QA"
  | "QUIZ"
  | "GRADER"
  | "SYSTEM";

export type QuizType = "MCQ" | "OX" | "SHORT" | "ESSAY";
export type UserRole = "teacher" | "student";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  inviteCode: string;
  emailVerified: boolean;
  hasPassword: boolean;
}

export interface StudentInviteCandidate {
  id: string;
  displayName: string;
  inviteCode: string;
  maskedEmail: string;
}

export interface ClassroomStudent extends StudentInviteCandidate {
  enrolledAt: string;
}

export type ClassroomInvitationStatus = "PENDING" | "ACCEPTED";

export interface ClassroomInvitation {
  id: string;
  classroomId: string;
  classroomTitle: string;
  teacherDisplayName: string;
  student: StudentInviteCandidate;
  status: ClassroomInvitationStatus;
  invitedAt: string;
  updatedAt: string;
  acceptedAt?: string;
}

export type StudentReportScope = "CLASSROOM_AGGREGATE" | "STUDENT";
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

export type TeacherExamStatus = "DRAFT" | "PUBLISHED";
export type TeacherExamQuestionType = "MCQ" | "OX" | "SHORT" | "ESSAY";
export type TeacherExamAttemptStatus = "IN_PROGRESS" | "GRADING" | "GRADED";

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
  answer?: { choiceId?: string; value?: boolean };
  referenceAnswer?: { text: string };
  rubricMarkdown?: string;
  modelAnswerMarkdown?: string;
  explanationMarkdown?: string;
}

export interface TeacherExamRevision {
  version: number;
  title: string;
  descriptionMarkdown: string;
  availableFrom: string;
  availableUntil: string;
  timeLimitMinutes: number;
  passScoreRatio: number;
  aiGradingEnabled: boolean;
  questions: TeacherExamQuestion[];
  createdAt: string;
  updatedAt: string;
}

export interface TeacherExam {
  id: string;
  classroomId: string;
  weekId: string;
  status: TeacherExamStatus;
  activePublishedVersion?: number;
  draftRevision: TeacherExamRevision;
  publishedRevision?: TeacherExamRevision;
  createdAt: string;
  updatedAt: string;
  totalPoints?: number;
  publishedTotalPoints?: number;
}

export interface TeacherExamGrading {
  totalScore: number;
  maxScore: number;
  scoreRatio: number;
  items: GradingItem[];
  summaryMarkdown: string;
  gradingSource: "AI" | "DETERMINISTIC_FALLBACK";
  fallback?: boolean;
}

export interface TeacherExamAttemptSummary {
  id: string;
  examId: string;
  status: TeacherExamAttemptStatus;
  examVersion: number;
  startedAt: string;
  deadlineAt: string;
  submittedAt?: string;
  gradedAt?: string;
  lastSavedAt?: string;
  answers: Record<string, unknown>;
  grading?: TeacherExamGrading;
  questions?: Array<Pick<TeacherExamQuestion, "id" | "type" | "promptMarkdown" | "points" | "choices" | "explanationMarkdown">>;
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
  submittedAt?: string;
}

export interface TeacherExamReportQuestionStat {
  statId?: string;
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

export interface StudentExamMetadata {
  id: string;
  classroomId: string;
  weekId: string;
  status: TeacherExamStatus;
  activePublishedVersion?: number;
  title: string;
  descriptionMarkdown: string;
  availableFrom?: string;
  availableUntil?: string;
  timeLimitMinutes?: number;
  passScoreRatio?: number;
  totalPoints: number;
  questionCount: number;
  attempt: TeacherExamAttemptSummary | null;
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

export interface ReportCriteriaAssistantProposal {
  replyMarkdown: string;
  operation: {
    method: ReportCriteriaAssistantMethod;
    params?: {
      criterion?: ReportCriteriaAssistantCriterion;
      targetCriterionId?: string;
      targetCriterionName?: string;
      targetCriterionDescription?: string;
      targetCriterionUpdatedAt?: string;
      rationale?: string;
      summaryCards?: ReportCriteriaAssistantSummaryCard[];
    };
  };
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

export interface TeacherExamReport {
  exam: TeacherExam;
  summary: {
    enrolledCount: number;
    attemptCount: number;
    submittedCount?: number;
    gradedCount: number;
    averageScore: number;
    maxScore: number;
    completionRatio: number;
  };
  students: Array<{
    studentUserId: string;
    displayName: string;
    status: TeacherExamReportStudentStatus | TeacherExamAttemptStatus | "NOT_STARTED";
    reportScore?: TeacherExamReportScore;
    attempt: TeacherExamAttemptSummary | null;
  }>;
  questionStats: TeacherExamReportQuestionStat[];
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
  learningProgressPage?: number;
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

export interface StudentReportCustomCriterion {
  id: string;
  classroomId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
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
  reportScope?: StudentReportScope;
  studentUserId?: string;
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

export interface StudentReportSummary {
  generatedAt: string;
  overallScore: number;
  overallLevel: CompetencyOverallLevel;
  generationMode: CompetencyGenerationMode;
  analysisStatus: CompetencyAnalysisStatus;
  sourceStats: StudentReportSourceStats;
}

export interface StudentReportListItem extends ClassroomStudent {
  reportSummary: StudentReportSummary | null;
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
  createdAt: string;
  updatedAt: string;
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
  lastTouchedAt?: string;
}

export interface ClassroomAttendanceStudent {
  studentUserId: string;
  displayName: string;
  inviteCode: string;
  maskedEmail: string;
  enrolledAt: string;
  status: ClassroomAttendanceStatus;
  completedLectureCount: number;
  totalLectureCount: number;
  totalReachedPages: number;
  totalPages: number;
  completionRatio: number;
  pageCoverageRatio: number;
  currentWeekTitle?: string;
  lastTouchedAt?: string;
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
  availableFrom?: string;
  availableUntil?: string;
  timeLimitMinutes?: number;
  totalPoints: number;
  questionCount: number;
  participationStatus: StudentClassroomAttendanceExamParticipationStatus;
  statusLabel: string;
  statusTone: Exclude<StudentClassroomAttendanceExamStatusTone, "none">;
  action: StudentClassroomAttendanceExamAction;
  attempt?: {
    status: TeacherExamAttemptStatus;
    startedAt?: string;
    submittedAt?: string;
    gradedAt?: string;
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

export interface Week {
  id: string;
  classroomId: string;
  weekIndex: number;
  title: string;
}

export interface ClassroomMaterialItem {
  lecture: LectureItem;
  week: Week;
}

export interface Classroom {
  id: string;
  title: string;
  teacherId?: string;
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
  authorDisplayName: string;
  authorRole: UserRole;
  title: string;
  contentMarkdown: string;
  category: ClassroomNoticeCategory;
  priority: ClassroomNoticePriority;
  target: ClassroomNoticeTarget;
  pinned: boolean;
  status: ClassroomNoticeStatus;
  publishAt?: string;
  publishedAt?: string;
  attachments: ClassroomNoticeAttachment[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomNoticeComment {
  id: string;
  classroomId: string;
  noticeId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: UserRole;
  parentCommentId?: string;
  contentMarkdown: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export type ClassroomNoticeCommentPayload = {
  contentMarkdown: string;
  parentCommentId?: string;
};

export type ClassroomNoticeCommentPatchPayload = {
  contentMarkdown: string;
};

export type ClassroomDiscussionCategory = "NOTICE" | "QUESTION" | "FREE" | "RESOURCE";
export type ClassroomDiscussionStatus = "DRAFT" | "PUBLISHED";
export type ClassroomDiscussionVisibility = "CLASS";

export interface ClassroomDiscussionAttachment {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
}

export interface ClassroomDiscussionPayload {
  title: string;
  contentMarkdown: string;
  category: ClassroomDiscussionCategory;
  visibility: ClassroomDiscussionVisibility;
  pinned: boolean;
  anonymous: boolean;
  allowComments: boolean;
  status: ClassroomDiscussionStatus;
  attachments: ClassroomDiscussionAttachment[];
}

export type ClassroomDiscussionPatchPayload = Partial<ClassroomDiscussionPayload>;

export interface ClassroomDiscussionPost {
  id: string;
  classroomId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: UserRole;
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
  commentCount: number;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomDiscussionComment {
  id: string;
  classroomId: string;
  postId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: UserRole;
  parentCommentId?: string;
  contentMarkdown: string;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ClassroomDiscussionCommentPayload = {
  contentMarkdown: string;
  parentCommentId?: string;
};

export type ClassroomDiscussionCommentPatchPayload = {
  contentMarkdown: string;
};

export interface DiscussionAssistantDraft {
  title: string;
  contentMarkdown: string;
  category: ClassroomDiscussionCategory;
  visibility: ClassroomDiscussionVisibility;
  pinned: boolean;
  anonymous: boolean;
  allowComments: boolean;
  status: ClassroomDiscussionStatus;
  attachments: ClassroomDiscussionAttachment[];
}

export interface DiscussionAssistantRequest {
  prompt: string;
  draft: DiscussionAssistantDraft;
}

export interface DiscussionAssistantResponse {
  messageMarkdown: string;
  suggestedTitle?: string;
  suggestedContentMarkdown?: string;
  suggestionLabel?: string;
}
