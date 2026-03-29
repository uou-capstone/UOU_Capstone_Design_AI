import { z } from "zod";

const quizTypeSchema = z.enum(["MCQ", "OX", "SHORT", "ESSAY"]);
const decisionTypeSchema = z.enum([
  "START_EXPLANATION_DECISION",
  "QUIZ_DECISION",
  "NEXT_PAGE_DECISION",
  "REVIEW_DECISION",
  "RETEST_DECISION"
]);

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
          page: z.number().int().positive()
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
    .optional()
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
