import { describe, expect, it } from "vitest";
import {
  parseGrading,
  parseOrchestratorPlan,
  parseQuizJson,
  parseStudentCompetencyReport
} from "../services/llm/JsonSchemaGuards.js";

describe("schema guards", () => {
  it("parses orchestrator plan", () => {
    const plan = parseOrchestratorPlan({
      schemaVersion: "1.0",
      actions: [
        {
          type: "CALL_TOOL",
          tool: "PROMPT_BINARY_DECISION",
          args: {
            contentMarkdown: "ok",
            decisionType: "START_EXPLANATION_DECISION"
          }
        }
      ]
    });
    expect(plan.schemaVersion).toBe("1.0");
  });

  it("parses repair misconception tool plan", () => {
    const plan = parseOrchestratorPlan({
      schemaVersion: "1.0",
      actions: [
        {
          type: "CALL_TOOL",
          tool: "REPAIR_MISCONCEPTION",
          args: {
            page: 2,
            studentReply: "적용 이유가 헷갈렸어요."
          }
        }
      ]
    });
    expect(plan.actions[0]?.tool).toBe("REPAIR_MISCONCEPTION");
  });

  it("parses quiz schema", () => {
    const quiz = parseQuizJson({
      schemaVersion: "1.0",
      quizId: "quiz_1",
      quizType: "MCQ",
      page: 1,
      questions: [
        {
          id: "q1",
          promptMarkdown: "문제",
          points: 1,
          choices: [{ id: "a", textMarkdown: "A" }],
          answer: { choiceId: "a" }
        }
      ]
    });
    expect(quiz.quizType).toBe("MCQ");
  });

  it("parses grading schema", () => {
    const result = parseGrading({
      schemaVersion: "1.0",
      quizId: "quiz_1",
      type: "GRADING_RESULT",
      totalScore: 1,
      maxScore: 1,
      items: [
        {
          questionId: "q1",
          score: 1,
          maxScore: 1,
          verdict: "CORRECT",
          feedbackMarkdown: "정답"
        }
      ],
      summaryMarkdown: "완료"
    });
    expect(result.totalScore).toBe(1);
  });

  it("parses student competency report schema", () => {
    const result = parseStudentCompetencyReport({
      schemaVersion: "1.0",
      classroomId: "cls_1",
      classroomTitle: "수학",
      studentLabel: "현재 학습자",
      generatedAt: new Date().toISOString(),
      analysisStatus: "READY",
      generationMode: "AI_ANALYZED",
      headline: "성장 중입니다.",
      summaryMarkdown: "- 요약",
      overallScore: 74,
      overallLevel: "PROFICIENT",
      competencies: [
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
      ].map((key) => ({
        key,
        label: key,
        score: 70,
        trend: "STEADY",
        summary: "요약",
        evidence: ["근거"]
      })),
      strengths: ["강점"],
      growthAreas: ["보완점"],
      coachingInsights: ["인사이트"],
      recommendedActions: [
        {
          title: "복습",
          description: "짧게 반복"
        }
      ],
      lectureInsights: [
        {
          lectureId: "lec_1",
          lectureTitle: "1강",
          weekTitle: "1주차",
          questionCount: 2,
          quizCount: 1,
          averageQuizScore: 80,
          masteryLabel: "안정권"
        }
      ],
      sourceStats: {
        lectureCount: 1,
        sessionCount: 1,
        completedPageCount: 3,
        pageCoverageRatio: 0.5,
        questionCount: 2,
        quizCount: 1,
        gradedQuizCount: 1,
        averageQuizScore: 80,
        feedbackCount: 1,
        memoryRefreshCount: 1
      },
      dataQualityNote: "충분한 데이터"
    });
    expect(result.competencies).toHaveLength(10);
  });
});
