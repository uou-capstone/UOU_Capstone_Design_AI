import { describe, expect, it } from "vitest";
import { selectQuizQuestionCount } from "../services/agents/QuizQuestionCountPolicy.js";

describe("selectQuizQuestionCount", () => {
  it("keeps the default quiz at five questions", () => {
    const decision = selectQuizQuestionCount({
      quizType: "MCQ",
      pageText: "기본 개념을 짧게 설명합니다."
    });

    expect(decision.questionCount).toBe(5);
    expect(decision.minAllowed).toBe(5);
  });

  it("adds more questions when learner signals show difficulty", () => {
    const decision = selectQuizQuestionCount({
      quizType: "MCQ",
      pageText: "인증 절차와 권한 비교, 알고리즘 정의를 함께 설명하는 복잡한 페이지입니다.",
      coverageStartPage: 1,
      coverageEndPage: 3,
      learnerLevel: "BEGINNER",
      learnerConfidence: 0.2,
      targetDifficulty: "CHALLENGING",
      memory: {
        weaknesses: ["권한 구분"],
        misconceptions: ["이메일 인증 방식"],
        nextCoachingGoals: ["가입 흐름 재점검"]
      },
      qaThreadDigest: "이전 질문 1: 왜 여기서 막혔나요?"
    });

    expect(decision.questionCount).toBeGreaterThan(5);
    expect(decision.questionCount).toBeLessThanOrEqual(10);
  });

  it("increases questions from QA thread help signals alone", () => {
    const decision = selectQuizQuestionCount({
      quizType: "MCQ",
      pageText: "기본 안내입니다.",
      learnerLevel: "INTERMEDIATE",
      learnerConfidence: 0.5,
      targetDifficulty: "BALANCED",
      qaThreadDigest: "이전 질문 1: 왜 이 부분이 헷갈리나요?"
    });

    expect(decision.questionCount).toBe(6);
    expect(decision.signals).toContain("+1:qa_thread_help_signal");
  });

  it("does not reduce below five questions for a confident advanced learner", () => {
    const decision = selectQuizQuestionCount({
      quizType: "SHORT",
      pageText: "로그인 버튼을 누릅니다.",
      learnerLevel: "ADVANCED",
      learnerConfidence: 0.9,
      targetDifficulty: "FOUNDATIONAL",
      memory: {
        strengths: ["가입 흐름"]
      }
    });

    expect(decision.questionCount).toBe(5);
  });

  it("allows essay quizzes to scale up to ten questions", () => {
    const decision = selectQuizQuestionCount({
      quizType: "ESSAY",
      pageText: "인증 절차와 권한 비교, 알고리즘 정의, 계산 절차, 증명을 모두 다룹니다.",
      coverageStartPage: 1,
      coverageEndPage: 5,
      learnerLevel: "BEGINNER",
      learnerConfidence: 0.1,
      targetDifficulty: "CHALLENGING",
      memory: {
        weaknesses: ["전체 흐름"],
        misconceptions: ["권한"],
        nextCoachingGoals: ["자세한 설명"]
      },
      qaThreadDigest: "어렵고 어떻게 해야 할지 모르겠습니다."
    });

    expect(decision.questionCount).toBe(10);
    expect(decision.maxAllowed).toBe(10);
  });

  it("does not increase merely because coverage is wide", () => {
    const decision = selectQuizQuestionCount({
      quizType: "OX",
      pageText: "간단한 안내입니다.",
      coverageStartPage: 1,
      coverageEndPage: 5
    });

    expect(decision.questionCount).toBe(5);
    expect(decision.signals).not.toContain("+1:wide_coverage_with_support_signal");
  });

  it("keeps misconception cases at least five questions even for confident advanced learners", () => {
    const decision = selectQuizQuestionCount({
      quizType: "MCQ",
      pageText: "짧은 페이지입니다.",
      learnerLevel: "ADVANCED",
      learnerConfidence: 0.9,
      memory: {
        misconceptions: ["역할 권한을 반대로 이해함"]
      }
    });

    expect(decision.questionCount).toBeGreaterThanOrEqual(5);
  });

  it("normalizes malformed target difficulty at the policy boundary", () => {
    const decision = selectQuizQuestionCount({
      quizType: "OX",
      pageText: "기본 안내입니다.",
      targetDifficulty: "VERY_HARD" as never
    });

    expect(decision.questionCount).toBe(5);
    expect(decision.rationale).toContain("targetDifficulty=BALANCED");
  });
});
