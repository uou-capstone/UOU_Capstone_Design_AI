import { z } from "zod";

const quizTypeSchema = z.enum(["MCQ", "OX", "SHORT", "ESSAY"]);
const competencyTrendSchema = z.enum(["UP", "STEADY", "DOWN"]);
const competencyOverallLevelSchema = z.enum([
  "EMERGING",
  "DEVELOPING",
  "PROFICIENT",
  "ADVANCED"
]);
const competencyAnalysisStatusSchema = z.enum(["READY", "SPARSE_DATA"]);
const competencyGenerationModeSchema = z.enum(["AI_ANALYZED", "HEURISTIC_FALLBACK"]);
const studentCompetencyKeySchema = z.enum([
  "CONCEPT_UNDERSTANDING",
  "QUESTION_QUALITY",
  "PROBLEM_SOLVING",
  "APPLICATION_TRANSFER",
  "QUIZ_ACCURACY",
  "LEARNING_PERSISTENCE",
  "SELF_REFLECTION",
  "CLASS_PARTICIPATION",
  "CONFIDENCE_GROWTH",
  "IMPROVEMENT_MOMENTUM"
]);
const decisionTypeSchema = z.enum([
  "START_EXPLANATION_DECISION",
  "QUIZ_DECISION",
  "NEXT_PAGE_DECISION",
  "REVIEW_DECISION",
  "RETEST_DECISION"
]);
const qaThreadModeSchema = z.enum(["START_NEW", "FOLLOW_UP"]);

const policyModeSchema = z.enum([
  "EXPLAIN_FIRST",
  "DIAGNOSE",
  "MISCONCEPTION_REPAIR",
  "MINIMAL_HINT",
  "CHECK_READINESS",
  "HOLD_BACK",
  "SRL_REFLECTION",
  "ADVANCE"
]);

const hintDepthSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

const pedagogyPolicySchema = z.object({
  mode: policyModeSchema,
  reason: z.string().min(1).max(512),
  allowDirectAnswer: z.boolean(),
  hintDepth: hintDepthSchema,
  interventionBudget: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3)
  ])
});

export const orchestratorPlanSchema = z.object({
  schemaVersion: z.literal("1.0"),
  actions: z.array(
    z.discriminatedUnion("tool", [
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("APPEND_ORCHESTRATOR_MESSAGE"),
        args: z.object({
          contentMarkdown: z.string().min(1)
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("APPEND_SYSTEM_MESSAGE"),
        args: z.object({
          contentMarkdown: z.string().min(1)
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("PROMPT_BINARY_DECISION"),
        args: z.object({
          contentMarkdown: z.string().min(1),
          decisionType: decisionTypeSchema
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("OPEN_QUIZ_TYPE_PICKER"),
        args: z.object({
          contentMarkdown: z.string().min(1),
          recommendedId: quizTypeSchema.optional()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("SET_CURRENT_PAGE"),
        args: z.object({
          page: z.number().int().positive(),
          contentMarkdown: z.string().optional()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("EXPLAIN_PAGE"),
        args: z.object({
          page: z.number().int().positive(),
          detailLevel: z.enum(["NORMAL", "DETAILED"]).optional()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("ANSWER_QUESTION"),
        args: z.object({
          questionText: z.string().min(1),
          page: z.number().int().positive(),
          threadMode: qaThreadModeSchema.optional()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("GENERATE_QUIZ_MCQ"),
        args: z.object({
          page: z.number().int().positive()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("GENERATE_QUIZ_OX"),
        args: z.object({
          page: z.number().int().positive()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("GENERATE_QUIZ_SHORT"),
        args: z.object({
          page: z.number().int().positive()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("GENERATE_QUIZ_ESSAY"),
        args: z.object({
          page: z.number().int().positive()
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("AUTO_GRADE_MCQ_OX"),
        args: z.object({
          quizId: z.string().min(1),
          userAnswers: z.record(z.string(), z.unknown())
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("GRADE_SHORT_OR_ESSAY"),
        args: z.object({
          quizId: z.string().min(1),
          userAnswers: z.record(z.string(), z.unknown())
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("REPAIR_MISCONCEPTION"),
        args: z.object({
          page: z.number().int().positive(),
          studentReply: z.string().min(1)
        })
      }),
      z.object({
        type: z.literal("CALL_TOOL"),
        tool: z.literal("WRITE_FEEDBACK_ENTRY"),
        args: z.object({
          page: z.number().int().positive(),
          notesHint: z.string().min(1)
        })
      })
    ])
  ),
  stop: z.boolean().optional()
  ,
  memoryWrite: z
    .object({
      shouldPersist: z.boolean(),
      summaryMarkdown: z.string().optional(),
      strengths: z.array(z.string()).optional(),
      weaknesses: z.array(z.string()).optional(),
      misconceptions: z.array(z.string()).optional(),
      explanationPreferences: z.array(z.string()).optional(),
      preferredQuizTypes: z.array(quizTypeSchema).optional(),
      targetDifficulty: z.enum(["FOUNDATIONAL", "BALANCED", "CHALLENGING"]).optional(),
      nextCoachingGoals: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      learnerLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional()
    })
    .nullable()
    .optional(),
  pedagogyPolicy: pedagogyPolicySchema.optional()
});

export const quizSchema = z.object({
  schemaVersion: z.literal("1.0"),
  quizId: z.string(),
  quizType: quizTypeSchema,
  page: z.number().int().positive(),
  title: z.string().optional(),
  questions: z.array(
    z.object({
      id: z.string(),
      promptMarkdown: z.string(),
      points: z.number().optional()
    }).passthrough()
  )
});

export const gradingSchema = z.object({
  schemaVersion: z.literal("1.0"),
  quizId: z.string(),
  type: z.literal("GRADING_RESULT"),
  totalScore: z.number(),
  maxScore: z.number(),
  items: z.array(
    z.object({
      questionId: z.string(),
      score: z.number(),
      maxScore: z.number(),
      verdict: z.enum(["CORRECT", "WRONG", "PARTIAL"]),
      feedbackMarkdown: z.string()
    })
  ),
  summaryMarkdown: z.string()
});

export const studentCompetencyReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  classroomId: z.string(),
  classroomTitle: z.string(),
  studentLabel: z.string(),
  generatedAt: z.string(),
  analysisStatus: competencyAnalysisStatusSchema,
  generationMode: competencyGenerationModeSchema,
  headline: z.string(),
  summaryMarkdown: z.string(),
  overallScore: z.number().min(0).max(100),
  overallLevel: competencyOverallLevelSchema,
  competencies: z.array(
    z.object({
      key: studentCompetencyKeySchema,
      label: z.string(),
      score: z.number().min(0).max(100),
      trend: competencyTrendSchema,
      summary: z.string(),
      evidence: z.array(z.string())
    })
  ).length(10),
  strengths: z.array(z.string()),
  growthAreas: z.array(z.string()),
  coachingInsights: z.array(z.string()),
  recommendedActions: z.array(
    z.object({
      title: z.string(),
      description: z.string()
    })
  ),
  lectureInsights: z.array(
    z.object({
      lectureId: z.string(),
      lectureTitle: z.string(),
      weekTitle: z.string(),
      questionCount: z.number().int().min(0),
      quizCount: z.number().int().min(0),
      averageQuizScore: z.number().min(0).max(100),
      masteryLabel: z.string()
    })
  ),
  sourceStats: z.object({
    lectureCount: z.number().int().min(0),
    sessionCount: z.number().int().min(0),
    completedPageCount: z.number().int().min(0),
    pageCoverageRatio: z.number().min(0).max(1),
    questionCount: z.number().int().min(0),
    quizCount: z.number().int().min(0),
    gradedQuizCount: z.number().int().min(0),
    averageQuizScore: z.number().min(0).max(100),
    feedbackCount: z.number().int().min(0),
    memoryRefreshCount: z.number().int().min(0)
  }),
  dataQualityNote: z.string()
});
