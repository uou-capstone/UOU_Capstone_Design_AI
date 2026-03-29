import { describe, expect, it } from "vitest";
import { parseGrading, parseOrchestratorPlan, parseQuizJson } from "../services/llm/JsonSchemaGuards.js";

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
});
