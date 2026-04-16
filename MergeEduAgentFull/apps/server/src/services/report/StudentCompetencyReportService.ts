import { appConfig } from "../../config.js";
import {
  Classroom,
  CompetencyAnalysisStatus,
  CompetencyGenerationMode,
  CompetencyOverallLevel,
  CompetencyTrend,
  LectureItem,
  SessionState,
  StudentActionRecommendation,
  StudentCompetencyKey,
  StudentCompetencyReport,
  StudentCompetencyScore,
  StudentLectureInsight,
  StudentReportSourceStats,
  Week
} from "../../types/domain.js";
import { createInitialIntegratedMemory } from "../engine/LearnerMemoryService.js";
import { parseStudentCompetencyReport } from "../llm/JsonSchemaGuards.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";
import { JsonStore } from "../storage/JsonStore.js";

const MEANINGFUL_QUESTION_REGEX =
  /(다음\s*페이지|다음으로|넘어가|다음\s*슬라이드|next\s*page|next\b)/i;

const COMPETENCY_DEFS: Array<{
  key: StudentCompetencyKey;
  label: string;
  description: string;
}> = [
  {
    key: "CONCEPT_UNDERSTANDING",
    label: "개념 이해도",
    description: "핵심 개념을 정확히 파악하고 연결해서 이해하는 힘"
  },
  {
    key: "QUESTION_QUALITY",
    label: "질문 구체성",
    description: "수업 중 질문이 구체적이고 학습 병목을 잘 드러내는 정도"
  },
  {
    key: "PROBLEM_SOLVING",
    label: "문제 해결력",
    description: "퀴즈와 문항 풀이에서 답을 구성해내는 능력"
  },
  {
    key: "APPLICATION_TRANSFER",
    label: "응용·전이력",
    description: "배운 내용을 새로운 문제나 문맥에 연결하는 능력"
  },
  {
    key: "QUIZ_ACCURACY",
    label: "퀴즈 정확도",
    description: "시험·퀴즈에서 실제 정답률로 드러난 성취도"
  },
  {
    key: "LEARNING_PERSISTENCE",
    label: "학습 지속성",
    description: "페이지 이동, 누적 세션, 반복 학습에서 보이는 꾸준함"
  },
  {
    key: "SELF_REFLECTION",
    label: "오답 성찰력",
    description: "피드백과 약점 메모를 바탕으로 스스로 보완하는 힘"
  },
  {
    key: "CLASS_PARTICIPATION",
    label: "수업 참여도",
    description: "질문, 응답, 세션 활동량으로 확인되는 참여 수준"
  },
  {
    key: "CONFIDENCE_GROWTH",
    label: "학습 자신감",
    description: "학습자 모델 confidence와 반응 흐름에서 보이는 자신감"
  },
  {
    key: "IMPROVEMENT_MOMENTUM",
    label: "성장 모멘텀",
    description: "최근 흐름이 좋아지고 있는지, 다음 상승 여지가 있는지"
  }
];

const STUDENT_REPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "classroomId",
    "classroomTitle",
    "studentLabel",
    "generatedAt",
    "analysisStatus",
    "generationMode",
    "headline",
    "summaryMarkdown",
    "overallScore",
    "overallLevel",
    "competencies",
    "strengths",
    "growthAreas",
    "coachingInsights",
    "recommendedActions",
    "lectureInsights",
    "sourceStats",
    "dataQualityNote"
  ],
  properties: {
    schemaVersion: { type: "string", enum: ["1.0"] },
    classroomId: { type: "string" },
    classroomTitle: { type: "string" },
    studentLabel: { type: "string" },
    generatedAt: { type: "string" },
    analysisStatus: { type: "string", enum: ["READY", "SPARSE_DATA"] },
    generationMode: { type: "string", enum: ["AI_ANALYZED", "HEURISTIC_FALLBACK"] },
    headline: { type: "string" },
    summaryMarkdown: { type: "string" },
    overallScore: { type: "number", minimum: 0, maximum: 100 },
    overallLevel: {
      type: "string",
      enum: ["EMERGING", "DEVELOPING", "PROFICIENT", "ADVANCED"]
    },
    competencies: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "score", "trend", "summary", "evidence"],
        properties: {
          key: {
            type: "string",
            enum: COMPETENCY_DEFS.map((item) => item.key)
          },
          label: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 100 },
          trend: { type: "string", enum: ["UP", "STEADY", "DOWN"] },
          summary: { type: "string" },
          evidence: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    },
    strengths: { type: "array", items: { type: "string" } },
    growthAreas: { type: "array", items: { type: "string" } },
    coachingInsights: { type: "array", items: { type: "string" } },
    recommendedActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: {
          title: { type: "string" },
          description: { type: "string" }
        }
      }
    },
    lectureInsights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "lectureId",
          "lectureTitle",
          "weekTitle",
          "questionCount",
          "quizCount",
          "averageQuizScore",
          "masteryLabel"
        ],
        properties: {
          lectureId: { type: "string" },
          lectureTitle: { type: "string" },
          weekTitle: { type: "string" },
          questionCount: { type: "number" },
          quizCount: { type: "number" },
          averageQuizScore: { type: "number" },
          masteryLabel: { type: "string" }
        }
      }
    },
    sourceStats: {
      type: "object",
      additionalProperties: false,
      required: [
        "lectureCount",
        "sessionCount",
        "completedPageCount",
        "pageCoverageRatio",
        "questionCount",
        "quizCount",
        "gradedQuizCount",
        "averageQuizScore",
        "feedbackCount",
        "memoryRefreshCount"
      ],
      properties: {
        lectureCount: { type: "number" },
        sessionCount: { type: "number" },
        completedPageCount: { type: "number" },
        pageCoverageRatio: { type: "number" },
        questionCount: { type: "number" },
        quizCount: { type: "number" },
        gradedQuizCount: { type: "number" },
        averageQuizScore: { type: "number" },
        feedbackCount: { type: "number" },
        memoryRefreshCount: { type: "number" }
      }
    },
    dataQualityNote: { type: "string" }
  }
} as const;

interface LectureSourceRow {
  week: Week;
  lecture: LectureItem;
  session: SessionState | null;
}

interface AggregatedClassroomSource {
  classroom: Classroom;
  analysisStatus: CompetencyAnalysisStatus;
  sourceStats: StudentReportSourceStats;
  lectureInsights: StudentLectureInsight[];
  averageConfidence: number;
  questionAverageChars: number;
  quizTrendDelta: number;
  strengths: string[];
  weaknesses: string[];
  misconceptions: string[];
  explanationPreferences: string[];
  preferredQuizTypes: string[];
  nextCoachingGoals: string[];
  recentQuestions: string[];
  recentFeedback: string[];
  recentQuizHighlights: string[];
  recentLectureSummaries: string[];
}

export type StudentReportAnalysisStage =
  | "COLLECTING_DATA"
  | "BUILDING_PROFILE"
  | "GEMINI_THINKING"
  | "SCORING"
  | "WRITING_REPORT"
  | "COMPLETE";

export interface StudentReportAnalysisStageEvent {
  stage: StudentReportAnalysisStage;
  label: string;
  progress: number;
  detail?: string;
}

interface StudentReportAnalysisCallbacks {
  onStage?: (event: StudentReportAnalysisStageEvent) => void;
  onThoughtDelta?: (text: string) => void;
  onAnswerDelta?: (text: string) => void;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function truncate(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function isMeaningfulQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (MEANINGFUL_QUESTION_REGEX.test(normalized)) return false;
  return normalized.length >= 8 || /[?？]/.test(normalized);
}

function memoryIsMeaningful(session: SessionState): boolean {
  const memory = session.integratedMemory ?? createInitialIntegratedMemory();
  return Boolean(
    memory.strengths.length ||
      memory.weaknesses.length ||
      memory.misconceptions.length ||
      memory.explanationPreferences.length ||
      memory.preferredQuizTypes.length ||
      memory.nextCoachingGoals.length ||
      memory.summaryMarkdown !== "아직 축적된 개인화 메모리가 없습니다."
  );
}

function masteryLabel(score: number, quizCount: number): string {
  if (quizCount === 0) return "관찰 데이터 축적 중";
  if (score >= 85) return "안정권";
  if (score >= 70) return "성장세";
  if (score >= 55) return "보완 필요";
  return "집중 코칭 필요";
}

function trendFromDelta(delta: number): CompetencyTrend {
  if (delta >= 6) return "UP";
  if (delta <= -6) return "DOWN";
  return "STEADY";
}

function overallLevelFromScore(score: number): CompetencyOverallLevel {
  if (score >= 85) return "ADVANCED";
  if (score >= 70) return "PROFICIENT";
  if (score >= 55) return "DEVELOPING";
  return "EMERGING";
}

function evidenceList(items: Array<string | null | undefined>, fallbacks: string[]): string[] {
  return uniqueStrings([
    ...items.filter((item): item is string => Boolean(item && item.trim())),
    ...fallbacks
  ]).slice(0, 3);
}

function safeAction(title: string, description: string): StudentActionRecommendation {
  return {
    title: truncate(title, 36),
    description: truncate(description, 120)
  };
}

export class StudentCompetencyReportService {
  constructor(
    private readonly store: JsonStore,
    private readonly bridge: GeminiBridgeClient
  ) {}

  async buildClassroomReport(classroomId: string): Promise<StudentCompetencyReport | null> {
    const classroom = (await this.store.listClassrooms()).find((item) => item.id === classroomId);
    if (!classroom) return null;

    const source = await this.aggregateClassroomSource(classroom);
    const fallbackReport = this.buildHeuristicReport(source, source.analysisStatus, "HEURISTIC_FALLBACK");

    const evidenceCount =
      source.sourceStats.questionCount +
      source.sourceStats.gradedQuizCount +
      source.sourceStats.feedbackCount +
      source.sourceStats.memoryRefreshCount;

    if (evidenceCount === 0) {
      return fallbackReport;
    }

    try {
      const analysis = await this.bridge.analyzeStudentCompetencyReport({
        model: appConfig.modelName,
        prompt: this.buildAnalysisPrompt(source, fallbackReport),
        responseJsonSchema: STUDENT_REPORT_JSON_SCHEMA
      });

      const parsed = parseStudentCompetencyReport(analysis.report);
      return this.mergeAnalyzedReport(source, fallbackReport, parsed);
    } catch {
      return fallbackReport;
    }
  }

  async analyzeAndSaveClassroomReport(
    classroomId: string
  ): Promise<StudentCompetencyReport | null> {
    const report = await this.buildClassroomReport(classroomId);
    if (!report) return null;
    await this.store.saveClassroomReport(report);
    return report;
  }

  async analyzeAndSaveClassroomReportStream(
    classroomId: string,
    callbacks?: StudentReportAnalysisCallbacks
  ): Promise<StudentCompetencyReport | null> {
    const classroom = (await this.store.listClassrooms()).find((item) => item.id === classroomId);
    if (!classroom) return null;

    callbacks?.onStage?.({
      stage: "COLLECTING_DATA",
      label: "학생 질문, 퀴즈, 피드백 데이터를 수집하는 중",
      progress: 12
    });
    const source = await this.aggregateClassroomSource(classroom);

    callbacks?.onStage?.({
      stage: "BUILDING_PROFILE",
      label: "학습 프로필과 초안 리포트를 구성하는 중",
      progress: 28
    });
    const fallbackReport = this.buildHeuristicReport(
      source,
      source.analysisStatus,
      "HEURISTIC_FALLBACK"
    );

    const evidenceCount =
      source.sourceStats.questionCount +
      source.sourceStats.gradedQuizCount +
      source.sourceStats.feedbackCount +
      source.sourceStats.memoryRefreshCount;

    if (evidenceCount === 0) {
      callbacks?.onStage?.({
        stage: "WRITING_REPORT",
        label: "데이터가 적어 임시 리포트를 저장하는 중",
        progress: 88
      });
      await this.store.saveClassroomReport(fallbackReport);
      callbacks?.onStage?.({
        stage: "COMPLETE",
        label: "임시 리포트를 저장했습니다",
        progress: 100
      });
      return fallbackReport;
    }

    callbacks?.onStage?.({
      stage: "GEMINI_THINKING",
      label: "Gemini가 학생 역량을 분석하는 중",
      progress: 52
    });

    let scoringStageEmitted = false;

    try {
      const analysis = await this.bridge.analyzeStudentCompetencyReportStream(
        {
          model: appConfig.modelName,
          prompt: this.buildAnalysisPrompt(source, fallbackReport),
          responseJsonSchema: STUDENT_REPORT_JSON_SCHEMA
        },
        (delta) => {
          if (delta.channel === "thought") {
            callbacks?.onThoughtDelta?.(delta.text);
            return;
          }
          if (!scoringStageEmitted) {
            scoringStageEmitted = true;
            callbacks?.onStage?.({
              stage: "SCORING",
              label: "체크리스트 점수와 근거를 정리하는 중",
              progress: 74
            });
          }
          callbacks?.onAnswerDelta?.(delta.text);
        }
      );

      if (!scoringStageEmitted) {
        callbacks?.onStage?.({
          stage: "SCORING",
          label: "체크리스트 점수와 근거를 정리하는 중",
          progress: 74
        });
      }

      const parsed = parseStudentCompetencyReport(analysis.report);
      const finalReport = this.mergeAnalyzedReport(source, fallbackReport, parsed);

      callbacks?.onStage?.({
        stage: "WRITING_REPORT",
        label: "리포트를 정리하고 저장하는 중",
        progress: 92
      });
      await this.store.saveClassroomReport(finalReport);
      callbacks?.onStage?.({
        stage: "COMPLETE",
        label: "Gemini 역량 리포트를 저장했습니다",
        progress: 100
      });
      return finalReport;
    } catch {
      callbacks?.onStage?.({
        stage: "WRITING_REPORT",
        label: "Gemini 응답을 정리하지 못해 fallback 리포트를 저장하는 중",
        progress: 92,
        detail: "fallback"
      });
      await this.store.saveClassroomReport(fallbackReport);
      callbacks?.onStage?.({
        stage: "COMPLETE",
        label: "fallback 리포트를 저장했습니다",
        progress: 100,
        detail: "fallback"
      });
      return fallbackReport;
    }
  }

  private mergeAnalyzedReport(
    source: AggregatedClassroomSource,
    fallbackReport: StudentCompetencyReport,
    parsed: StudentCompetencyReport
  ): StudentCompetencyReport {
    const mergedByKey = new Map(parsed.competencies.map((item) => [item.key, item]));
    return {
      ...fallbackReport,
      ...parsed,
      classroomId: source.classroom.id,
      classroomTitle: source.classroom.title,
      studentLabel: parsed.studentLabel?.trim() || fallbackReport.studentLabel,
      generatedAt: new Date().toISOString(),
      analysisStatus: source.analysisStatus,
      generationMode: "AI_ANALYZED",
      competencies: COMPETENCY_DEFS.map((definition) => {
        const fallbackItem = fallbackReport.competencies.find((item) => item.key === definition.key)!;
        const candidate = mergedByKey.get(definition.key);
        return {
          ...fallbackItem,
          ...candidate,
          key: definition.key,
          label: definition.label,
          score: clampScore(candidate?.score ?? fallbackItem.score),
          trend: candidate?.trend ?? fallbackItem.trend,
          summary: truncate(candidate?.summary ?? fallbackItem.summary, 180),
          evidence: evidenceList(candidate?.evidence ?? fallbackItem.evidence, fallbackItem.evidence)
        };
      }),
      strengths: uniqueStrings(
        parsed.strengths.length > 0 ? parsed.strengths : fallbackReport.strengths
      ).slice(0, 5),
      growthAreas: uniqueStrings(
        parsed.growthAreas.length > 0 ? parsed.growthAreas : fallbackReport.growthAreas
      ).slice(0, 5),
      coachingInsights: uniqueStrings(
        parsed.coachingInsights.length > 0
          ? parsed.coachingInsights
          : fallbackReport.coachingInsights
      ).slice(0, 5),
      recommendedActions: (parsed.recommendedActions.length > 0
        ? parsed.recommendedActions
        : fallbackReport.recommendedActions
      )
        .map((item) => safeAction(item.title, item.description))
        .slice(0, 4),
      lectureInsights: fallbackReport.lectureInsights,
      sourceStats: fallbackReport.sourceStats,
      overallScore: clampScore(parsed.overallScore),
      overallLevel: overallLevelFromScore(parsed.overallScore),
      headline: truncate(parsed.headline || fallbackReport.headline, 96),
      summaryMarkdown: parsed.summaryMarkdown?.trim() || fallbackReport.summaryMarkdown,
      dataQualityNote: truncate(parsed.dataQualityNote || fallbackReport.dataQualityNote, 160)
    };
  }

  private async aggregateClassroomSource(classroom: Classroom): Promise<AggregatedClassroomSource> {
    const weeks = await this.store.listWeeksByClassroom(classroom.id);
    const lectureRows: LectureSourceRow[] = [];

    for (const week of weeks) {
      const lectures = await this.store.listLecturesByWeek(week.id);
      const sessions = await Promise.all(lectures.map((lecture) => this.store.getSessionByLecture(lecture.id)));
      for (let index = 0; index < lectures.length; index += 1) {
        lectureRows.push({
          week,
          lecture: lectures[index],
          session: sessions[index]
        });
      }
    }

    const allQuestions: string[] = [];
    const questionLengths: number[] = [];
    const allFeedback: Array<{ createdAt: string; text: string }> = [];
    const allQuizHighlights: Array<{ createdAt: string; text: string }> = [];
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const misconceptions: string[] = [];
    const explanationPreferences: string[] = [];
    const preferredQuizTypes: string[] = [];
    const nextCoachingGoals: string[] = [];
    const confidenceValues: number[] = [];
    const quizRatios: number[] = [];
    const quizTrendSeries: Array<{ createdAt: string; ratio: number }> = [];
    const lectureSummaries: Array<{ updatedAt: string; text: string }> = [];

    let completedPageCount = 0;
    let totalPageCount = 0;
    let questionCount = 0;
    let quizCount = 0;
    let gradedQuizCount = 0;
    let feedbackCount = 0;
    let memoryRefreshCount = 0;

    const lectureInsights = lectureRows.map(({ week, lecture, session }) => {
      totalPageCount += Math.max(1, lecture.pdf.numPages || 1);
      const touchedPages = session
        ? session.pageStates.filter((pageState) => pageState.status !== "NEW").length
        : 0;
      completedPageCount += touchedPages;

      if (!session) {
        return {
          lectureId: lecture.id,
          lectureTitle: lecture.title,
          weekTitle: week.title,
          questionCount: 0,
          quizCount: 0,
          averageQuizScore: 0,
          masteryLabel: "관찰 데이터 축적 중"
        } satisfies StudentLectureInsight;
      }

      confidenceValues.push(session.learnerModel.confidence);
      if (memoryIsMeaningful(session)) {
        memoryRefreshCount += 1;
      }

      const memory = session.integratedMemory ?? createInitialIntegratedMemory();
      strengths.push(...memory.strengths);
      weaknesses.push(...memory.weaknesses);
      misconceptions.push(...memory.misconceptions);
      explanationPreferences.push(...memory.explanationPreferences);
      preferredQuizTypes.push(...memory.preferredQuizTypes);
      nextCoachingGoals.push(...memory.nextCoachingGoals);

      const meaningfulQuestions = session.messages
        .filter((message) => message.role === "user")
        .map((message) => truncate(message.contentMarkdown, 120))
        .filter(isMeaningfulQuestion);
      questionCount += meaningfulQuestions.length;
      allQuestions.push(
        ...meaningfulQuestions.map((text) => `${week.title} · ${lecture.title}: ${text}`)
      );
      questionLengths.push(...meaningfulQuestions.map((text) => text.length));

      const lectureGradedRatios = session.quizzes
        .filter((quiz) => quiz.grading?.status === "GRADED")
        .map((quiz) => {
          const ratio = clampScore((quiz.grading?.scoreRatio ?? 0) * 100);
          quizRatios.push(ratio);
          quizTrendSeries.push({
            createdAt: quiz.createdAt,
            ratio
          });
          allQuizHighlights.push({
            createdAt: quiz.createdAt,
            text: `${week.title} · ${lecture.title} p.${quiz.createdFromPage} ${quiz.quizType} ${ratio}점`
          });
          return ratio;
        });

      quizCount += session.quizzes.length;
      gradedQuizCount += lectureGradedRatios.length;

      const lectureFeedbackItems = session.feedback.map((entry) => ({
        createdAt: entry.createdAt,
        text: `${week.title} · ${lecture.title} p.${entry.page}: ${truncate(entry.notesMarkdown, 120)}`
      }));
      feedbackCount += lectureFeedbackItems.length;
      allFeedback.push(...lectureFeedbackItems);

      lectureSummaries.push({
        updatedAt: session.updatedAt,
        text: `${week.title} · ${lecture.title}: 진도 ${session.currentPage}/${Math.max(1, lecture.pdf.numPages)}페이지, 약점 ${uniqueStrings([
          ...memory.weaknesses,
          ...memory.misconceptions
        ]).slice(0, 2).join(", ") || "관찰 중"}`
      });

      return {
        lectureId: lecture.id,
        lectureTitle: lecture.title,
        weekTitle: week.title,
        questionCount: meaningfulQuestions.length,
        quizCount: session.quizzes.length,
        averageQuizScore: clampScore(average(lectureGradedRatios)),
        masteryLabel: masteryLabel(average(lectureGradedRatios), session.quizzes.length)
      } satisfies StudentLectureInsight;
    });

    const orderedQuizTrend = [...quizTrendSeries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const firstSlice = orderedQuizTrend.slice(0, 3).map((item) => item.ratio);
    const lastSlice = orderedQuizTrend.slice(-3).map((item) => item.ratio);
    const quizTrendDelta = average(lastSlice) - average(firstSlice);

    const sourceStats: StudentReportSourceStats = {
      lectureCount: lectureRows.length,
      sessionCount: lectureRows.filter((row) => row.session).length,
      completedPageCount,
      pageCoverageRatio: clampRatio(totalPageCount > 0 ? completedPageCount / totalPageCount : 0),
      questionCount,
      quizCount,
      gradedQuizCount,
      averageQuizScore: clampScore(average(quizRatios)),
      feedbackCount,
      memoryRefreshCount
    };

    const evidenceCount =
      sourceStats.questionCount +
      sourceStats.gradedQuizCount +
      sourceStats.feedbackCount +
      sourceStats.memoryRefreshCount;

    return {
      classroom,
      analysisStatus: evidenceCount >= 4 ? "READY" : "SPARSE_DATA",
      sourceStats,
      lectureInsights,
      averageConfidence: average(confidenceValues),
      questionAverageChars: average(questionLengths),
      quizTrendDelta,
      strengths: uniqueStrings(strengths).slice(0, 8),
      weaknesses: uniqueStrings(weaknesses).slice(0, 8),
      misconceptions: uniqueStrings(misconceptions).slice(0, 8),
      explanationPreferences: uniqueStrings(explanationPreferences).slice(0, 8),
      preferredQuizTypes: uniqueStrings(preferredQuizTypes).slice(0, 4),
      nextCoachingGoals: uniqueStrings(nextCoachingGoals).slice(0, 8),
      recentQuestions: allQuestions.slice(-10),
      recentFeedback: allFeedback
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-8)
        .map((item) => item.text),
      recentQuizHighlights: allQuizHighlights
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-8)
        .map((item) => item.text),
      recentLectureSummaries: lectureSummaries
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(-6)
        .map((item) => item.text)
    };
  }

  private buildHeuristicReport(
    source: AggregatedClassroomSource,
    analysisStatus: CompetencyAnalysisStatus,
    generationMode: CompetencyGenerationMode
  ): StudentCompetencyReport {
    const stats = source.sourceStats;
    const coverageScore = stats.pageCoverageRatio * 100;
    const questionSignal = Math.min(100, 38 + stats.questionCount * 8 + source.questionAverageChars * 0.2);
    const persistenceSignal = Math.min(100, 44 + stats.sessionCount * 6 + coverageScore * 0.25);
    const reflectionSignal = Math.min(
      100,
      42 +
        stats.feedbackCount * 5 +
        (source.weaknesses.length + source.misconceptions.length) * 2
    );
    const confidenceSignal = Math.min(100, 38 + source.averageConfidence * 52 + source.quizTrendDelta * 0.3);
    const momentumSignal = Math.min(
      100,
      42 + source.quizTrendDelta * 1.2 + source.nextCoachingGoals.length * 4 + stats.memoryRefreshCount * 3
    );

    const competencyScores: StudentCompetencyScore[] = [
      {
        key: "CONCEPT_UNDERSTANDING",
        label: "개념 이해도",
        score: clampScore(stats.averageQuizScore * 0.58 + source.averageConfidence * 32 + coverageScore * 0.1),
        trend: trendFromDelta(source.quizTrendDelta),
        summary:
          source.strengths.length > 0
            ? `강점 메모에 ${source.strengths.slice(0, 2).join(", ")}가 반복되어 개념 토대가 형성되고 있습니다.`
            : "개념 이해는 형성 중이며, 퀴즈와 피드백 데이터가 더 쌓일수록 정밀도가 올라갑니다.",
        evidence: evidenceList(
          source.strengths.slice(0, 2),
          [
            `평균 퀴즈 점수 ${stats.averageQuizScore}점`,
            `페이지 커버리지 ${(stats.pageCoverageRatio * 100).toFixed(0)}%`
          ]
        )
      },
      {
        key: "QUESTION_QUALITY",
        label: "질문 구체성",
        score: clampScore(questionSignal),
        trend: stats.questionCount >= 3 ? "UP" : "STEADY",
        summary:
          stats.questionCount > 0
            ? `수업 중 남긴 질문 ${stats.questionCount}건이 학습 병목을 드러내고 있어 개인화 코칭에 도움이 됩니다.`
            : "아직 질문 데이터가 많지 않아, 막히는 지점을 문장으로 남기면 분석 정확도가 높아집니다.",
        evidence: evidenceList(source.recentQuestions.slice(-2), [`질문 수 ${stats.questionCount}건`])
      },
      {
        key: "PROBLEM_SOLVING",
        label: "문제 해결력",
        score: clampScore(stats.averageQuizScore * 0.7 + stats.gradedQuizCount * 2 + source.averageConfidence * 18),
        trend: trendFromDelta(source.quizTrendDelta),
        summary:
          stats.gradedQuizCount > 0
            ? `채점된 퀴즈 ${stats.gradedQuizCount}건에서 실제 풀이 성과가 누적되고 있습니다.`
            : "문제 해결력은 퀴즈 응시가 더 늘어나면 더 선명하게 평가됩니다.",
        evidence: evidenceList(source.recentQuizHighlights.slice(-2), [`채점 퀴즈 ${stats.gradedQuizCount}건`])
      },
      {
        key: "APPLICATION_TRANSFER",
        label: "응용·전이력",
        score: clampScore(
          stats.averageQuizScore * 0.48 +
            source.strengths.length * 4 +
            source.preferredQuizTypes.length * 3 +
            source.nextCoachingGoals.length * 4
        ),
        trend: trendFromDelta(source.quizTrendDelta / 2),
        summary:
          source.nextCoachingGoals.length > 0
            ? `다음 코칭 목표가 구체적으로 잡혀 있어 배운 내용을 새로운 문항으로 옮겨갈 준비가 되어 있습니다.`
            : "현재는 기초 이해 중심 신호가 강하고, 응용 전이는 다음 코칭 목표 설계와 함께 강화할 수 있습니다.",
        evidence: evidenceList(
          [...source.nextCoachingGoals.slice(0, 2), ...source.strengths.slice(0, 1)],
          ["응용형 점검은 추가 퀴즈 데이터와 함께 더 정밀해집니다."]
        )
      },
      {
        key: "QUIZ_ACCURACY",
        label: "퀴즈 정확도",
        score: clampScore(stats.averageQuizScore),
        trend: trendFromDelta(source.quizTrendDelta),
        summary:
          stats.gradedQuizCount > 0
            ? `현재 누적 정답률 기반 평균은 ${stats.averageQuizScore}점 수준입니다.`
            : "아직 채점 데이터가 적어 정확도는 임시 추정치로 표시됩니다.",
        evidence: evidenceList(source.recentQuizHighlights.slice(-3), [`평균 퀴즈 점수 ${stats.averageQuizScore}점`])
      },
      {
        key: "LEARNING_PERSISTENCE",
        label: "학습 지속성",
        score: clampScore(persistenceSignal),
        trend: stats.sessionCount >= 2 ? "UP" : "STEADY",
        summary: `총 ${stats.sessionCount}개 세션, ${(stats.pageCoverageRatio * 100).toFixed(0)}% 페이지 커버리지로 꾸준함을 확인했습니다.`,
        evidence: evidenceList(source.recentLectureSummaries.slice(-2), [`세션 ${stats.sessionCount}개`, `완료 페이지 ${stats.completedPageCount}개`])
      },
      {
        key: "SELF_REFLECTION",
        label: "오답 성찰력",
        score: clampScore(reflectionSignal),
        trend: stats.feedbackCount >= 2 ? "UP" : "STEADY",
        summary:
          stats.feedbackCount > 0
            ? `피드백 ${stats.feedbackCount}건과 약점 메모가 누적되어 복습 포인트가 정리되고 있습니다.`
            : "오답 성찰은 피드백 기록이 더 쌓이면 더 정확히 드러납니다.",
        evidence: evidenceList(
          [...source.recentFeedback.slice(-2), ...source.weaknesses.slice(0, 1)],
          [`피드백 ${stats.feedbackCount}건`]
        )
      },
      {
        key: "CLASS_PARTICIPATION",
        label: "수업 참여도",
        score: clampScore(42 + stats.questionCount * 6 + stats.sessionCount * 5 + coverageScore * 0.18),
        trend: stats.questionCount + stats.quizCount >= 4 ? "UP" : "STEADY",
        summary:
          stats.questionCount + stats.quizCount > 0
            ? `질문과 퀴즈 응시가 함께 누적되어 수업 내 상호작용이 안정적으로 보입니다.`
            : "참여도는 아직 초기 상태이며, 질문과 퀴즈가 쌓일수록 더 정확히 보입니다.",
        evidence: evidenceList(
          [
            `질문 ${stats.questionCount}건`,
            `퀴즈 ${stats.quizCount}건`,
            ...source.recentQuestions.slice(-1)
          ],
          []
        )
      },
      {
        key: "CONFIDENCE_GROWTH",
        label: "학습 자신감",
        score: clampScore(confidenceSignal),
        trend: trendFromDelta(source.quizTrendDelta / 1.5),
        summary: `학습자 confidence 평균은 ${(source.averageConfidence * 100).toFixed(0)}점 수준으로 관찰됩니다.`,
        evidence: evidenceList(
          [
            `학습자 confidence ${(source.averageConfidence * 100).toFixed(0)}점`,
            ...source.strengths.slice(0, 1)
          ],
          ["confidence는 오답 회복 경험과 함께 더 빠르게 상승합니다."]
        )
      },
      {
        key: "IMPROVEMENT_MOMENTUM",
        label: "성장 모멘텀",
        score: clampScore(momentumSignal),
        trend: trendFromDelta(source.quizTrendDelta),
        summary:
          source.quizTrendDelta >= 0
            ? "최근 퀴즈 흐름이 유지 또는 상승 중이라 다음 학습 상승 여지가 좋습니다."
            : "최근 점수 흔들림이 있어 약점 교정 루틴을 짧게 넣으면 다시 상승 곡선을 만들 수 있습니다.",
        evidence: evidenceList(
          [
            `퀴즈 추세 변화 ${source.quizTrendDelta >= 0 ? "+" : ""}${source.quizTrendDelta.toFixed(1)}점`,
            ...source.nextCoachingGoals.slice(0, 2)
          ],
          []
        )
      }
    ];

    const overallScore = clampScore(average(competencyScores.map((item) => item.score)));
    const overallLevel = overallLevelFromScore(overallScore);

    return {
      schemaVersion: "1.0",
      classroomId: source.classroom.id,
      classroomTitle: source.classroom.title,
      studentLabel: "현재 학습자",
      generatedAt: new Date().toISOString(),
      analysisStatus,
      generationMode,
      headline:
        overallScore >= 70
          ? "기초 이해가 안정화되며 성과가 누적되는 구간입니다."
          : "기초 체력을 올리면서 약점 개념을 좁혀가야 하는 구간입니다.",
      summaryMarkdown: [
        `- 누적 강의 ${stats.lectureCount}개, 세션 ${stats.sessionCount}개를 기준으로 분석했습니다.`,
        `- 채점된 퀴즈 평균은 **${stats.averageQuizScore}점**이고, 페이지 커버리지는 **${(stats.pageCoverageRatio * 100).toFixed(0)}%**입니다.`,
        source.weaknesses.length > 0 || source.misconceptions.length > 0
          ? `- 보완 우선순위는 ${uniqueStrings([
              ...source.weaknesses,
              ...source.misconceptions
            ]).slice(0, 3).join(", ")} 입니다.`
          : "- 아직 뚜렷한 약점 메모는 많지 않으며, 더 많은 응시 데이터가 들어오면 정밀도가 올라갑니다."
      ].join("\n"),
      overallScore,
      overallLevel,
      competencies: competencyScores,
      strengths: uniqueStrings([
        ...source.strengths,
        ...source.preferredQuizTypes.map((item) => `${item} 유형 반응 안정적`)
      ]).slice(0, 5),
      growthAreas: uniqueStrings([
        ...source.weaknesses,
        ...source.misconceptions,
        ...source.nextCoachingGoals
      ]).slice(0, 5),
      coachingInsights: uniqueStrings([
        source.recentQuestions.length > 0
          ? "학생 질문을 다음 퀴즈 문항 설계에 바로 반영하면 개인화 효율이 높습니다."
          : "질문을 한 줄로라도 남기게 유도하면 병목 파악 속도가 빨라집니다.",
        stats.averageQuizScore < 70
          ? "짧은 복습 퀴즈를 자주 넣어 정답 경험을 먼저 쌓는 편이 유리합니다."
          : "강점 개념을 응용형 문항으로 연결해 전이력을 끌어올릴 시점입니다.",
        source.explanationPreferences.length > 0
          ? `설명은 ${source.explanationPreferences.slice(0, 2).join(", ")} 스타일을 우선 반영하는 것이 좋습니다.`
          : "설명 선호 데이터가 더 쌓이면 코칭 톤도 더 정밀하게 맞출 수 있습니다."
      ]).slice(0, 5),
      recommendedActions: [
        safeAction(
          "약점 개념 1개 집중 복습",
          uniqueStrings([...source.weaknesses, ...source.misconceptions]).slice(0, 2).join(", ") ||
            "최근 오답 개념"
        ),
        safeAction(
          "짧은 퀴즈 재투입",
          stats.averageQuizScore < 70
            ? "MCQ/OX 위주로 즉시 피드백을 주고 성공 경험을 늘려 주세요."
            : "SHORT/ESSAY 비중을 조금 높여 설명형 답변을 유도해 주세요."
        ),
        safeAction(
          "질문 로그 유지",
          "학생이 막힌 문장을 그대로 남기게 하면 다음 리포트의 정밀도가 크게 올라갑니다."
        )
      ],
      lectureInsights: source.lectureInsights,
      sourceStats: stats,
      dataQualityNote:
        analysisStatus === "SPARSE_DATA"
          ? "현재는 데이터가 적어 보수적으로 추정한 임시 리포트입니다. 질문/퀴즈/피드백이 더 쌓이면 정확도가 올라갑니다."
          : "세션 메모, 질문, 퀴즈, 피드백을 함께 반영한 누적 리포트입니다."
    };
  }

  private buildAnalysisPrompt(
    source: AggregatedClassroomSource,
    draftReport: StudentCompetencyReport
  ): string {
    const payload = {
      classroom: {
        id: source.classroom.id,
        title: source.classroom.title
      },
      sourceStats: source.sourceStats,
      strengths: source.strengths,
      weaknesses: source.weaknesses,
      misconceptions: source.misconceptions,
      explanationPreferences: source.explanationPreferences,
      preferredQuizTypes: source.preferredQuizTypes,
      nextCoachingGoals: source.nextCoachingGoals,
      recentQuestions: source.recentQuestions,
      recentFeedback: source.recentFeedback,
      recentQuizHighlights: source.recentQuizHighlights,
      recentLectureSummaries: source.recentLectureSummaries,
      averageConfidence: Number(source.averageConfidence.toFixed(3)),
      questionAverageChars: Number(source.questionAverageChars.toFixed(1)),
      quizTrendDelta: Number(source.quizTrendDelta.toFixed(1)),
      competencyDefinitions: COMPETENCY_DEFS
    };

    return `
너는 학습 분석용 Gemini 평가 모델이다.
아래의 누적 학습 데이터만 근거로 학생 역량 리포트를 작성하라.

규칙:
- 반드시 한국어로 작성하라.
- 출력은 오직 JSON만 허용된다.
- 점수는 0~100 정수로 작성하라.
- 근거가 약한 항목은 과신하지 말고 보수적으로 유지하라.
- competencies는 아래 10개 key를 정확히 한 번씩 모두 포함해야 한다.
- label은 각 key에 맞는 한국어 역량명으로 유지하라.
- sourceStats, lectureInsights는 입력 초안 구조를 유지해도 된다.
- summaryMarkdown은 교사가 바로 읽을 수 있는 짧은 요약이어야 한다.
- recommendedActions는 실행 가능한 행동으로 2~4개 작성하라.

10개 역량 정의:
${COMPETENCY_DEFS.map((item, index) => `${index + 1}. ${item.key} / ${item.label}: ${item.description}`).join("\n")}

실제 근거 데이터:
${JSON.stringify(payload, null, 2)}

초안 리포트(JSON):
${JSON.stringify(draftReport, null, 2)}

위 초안을 개선해서 같은 구조의 최종 JSON을 출력하라.
`.trim();
  }
}
