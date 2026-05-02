import { afterEach, describe, expect, it, vi } from "vitest";
import { QuizAgents } from "../services/agents/QuizAgents.js";
import { QuizJson, QuizType } from "../types/domain.js";

function makeQuiz(type: QuizType, count: number, id = "quiz_generated"): QuizJson {
  return {
    schemaVersion: "1.0",
    quizId: id,
    quizType: type,
    page: 1,
    questions: Array.from({ length: count }, (_, index) => ({
      id: `q${index + 1}`,
      promptMarkdown: `문항 ${index + 1}`,
      points: 1,
      choices: type === "MCQ" ? [{ id: "c1", textMarkdown: "정답" }] : undefined,
      answer:
        type === "MCQ"
          ? { choiceId: "c1" }
          : type === "OX"
            ? { value: true }
            : undefined,
      referenceAnswer: type === "SHORT" ? { text: "정답" } : undefined,
      modelAnswerMarkdown: type === "ESSAY" ? "모범 답안" : undefined,
      rubricMarkdown: type === "SHORT" || type === "ESSAY" ? "채점 기준" : undefined
    }))
  };
}

describe("QuizAgents adaptive question count", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes adaptive count rationale and QA context to the bridge", async () => {
    const streamInputs: unknown[] = [];
    const bridge = {
      generateQuizStream: async (input: any) => {
        streamInputs.push(input);
        return {
          quiz: makeQuiz(input.quizType, input.questionCount),
          thoughtSummary: "generated"
        };
      },
      generateQuiz: async () => {
        throw new Error("retry not expected");
      }
    } as any;
    const agents = new QuizAgents(bridge);

    const result = await agents.runStream({
      fileRef: { fileName: "f", fileUri: "u", mimeType: "application/pdf" },
      page: 3,
      pageText: "인증 절차와 권한 비교, 알고리즘 정의를 함께 다룹니다.",
      quizType: "MCQ",
      coverageStartPage: 1,
      coverageEndPage: 3,
      learnerLevel: "BEGINNER",
      learnerConfidence: 0.2,
      learnerMemoryDigest: "약점: 권한 구분\n오개념: 인증 방식",
      learnerMemory: {
        weaknesses: ["권한 구분"],
        misconceptions: ["인증 방식"],
        nextCoachingGoals: ["더 자세한 점검"]
      },
      qaThreadDigest: "이전 질문 1: 왜 헷갈리나요?",
      targetDifficulty: "CHALLENGING",
      sessionId: "ses_test",
      lectureId: "lec_test"
    });

    expect(streamInputs).toHaveLength(1);
    expect((streamInputs[0] as any).questionCount).toBeGreaterThan(5);
    expect((streamInputs[0] as any).questionCountRationale).toContain("result=");
    expect((streamInputs[0] as any).qaThreadDigest).toContain("헷갈");
    expect(result.quiz.questions).toHaveLength((streamInputs[0] as any).questionCount);
  });

  it("trims over-generated quizzes and logs the mismatch", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridge = {
      generateQuizStream: async (input: any) => ({
        quiz: makeQuiz(input.quizType, input.questionCount + 2),
        thoughtSummary: "generated"
      }),
      generateQuiz: async () => {
        throw new Error("retry not expected");
      }
    } as any;
    const agents = new QuizAgents(bridge);

    const result = await agents.runStream({
      fileRef: { fileName: "f", fileUri: "u", mimeType: "application/pdf" },
      page: 1,
      pageText: "기본 개념입니다.",
      quizType: "MCQ",
      learnerLevel: "INTERMEDIATE",
      learnerMemoryDigest: "",
      targetDifficulty: "BALANCED"
    });

    expect(result.quiz.questions).toHaveLength(5);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[quiz_question_count_mismatch]"));
  });

  it("retries short generations once before accepting the repaired quiz", async () => {
    let retryCalls = 0;
    const bridge = {
      generateQuizStream: async (input: any) => ({
        quiz: makeQuiz(input.quizType, 1),
        thoughtSummary: "generated"
      }),
      generateQuiz: async (input: any) => {
        retryCalls += 1;
        return makeQuiz(input.quizType, input.questionCount, "quiz_retry");
      }
    } as any;
    const agents = new QuizAgents(bridge);

    const result = await agents.runStream({
      fileRef: { fileName: "f", fileUri: "u", mimeType: "application/pdf" },
      page: 3,
      pageText: "인증 절차와 권한 비교를 다룹니다.",
      quizType: "SHORT",
      coverageStartPage: 1,
      coverageEndPage: 3,
      learnerLevel: "BEGINNER",
      learnerConfidence: 0.2,
      learnerMemoryDigest: "약점: 권한",
      learnerMemory: { weaknesses: ["권한"] },
      targetDifficulty: "CHALLENGING"
    });

    expect(retryCalls).toBe(1);
    expect(result.quiz.quizId).toBe("quiz_retry");
    expect(result.quiz.questions.length).toBeGreaterThan(1);
  });

  it("accepts a retry result below requested count when it stays at the minimum", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let retryCalls = 0;
    const bridge = {
      generateQuizStream: async (input: any) => ({
        quiz: makeQuiz(input.quizType, 1),
        thoughtSummary: "generated"
      }),
      generateQuiz: async (input: any) => {
        retryCalls += 1;
        return makeQuiz(input.quizType, 5, "quiz_retry_partial");
      }
    } as any;
    const agents = new QuizAgents(bridge);

    const result = await agents.runStream({
      fileRef: { fileName: "f", fileUri: "u", mimeType: "application/pdf" },
      page: 1,
      pageText: "기본 개념입니다.",
      quizType: "MCQ",
      learnerLevel: "INTERMEDIATE",
      learnerMemoryDigest: "",
      targetDifficulty: "BALANCED",
      qaThreadDigest: "이전 질문 1: 왜 헷갈리나요?"
    });

    expect(retryCalls).toBe(1);
    expect(result.quiz.quizId).toBe("quiz_retry_partial");
    expect(result.quiz.questions).toHaveLength(5);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("retry_generation_count_mismatch"));
  });

  it("keeps the stream result when retry fails but the stream met the minimum", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let retryCalls = 0;
    const bridge = {
      generateQuizStream: async (input: any) => ({
        quiz: makeQuiz(input.quizType, 5, "quiz_stream_partial"),
        thoughtSummary: "generated"
      }),
      generateQuiz: async () => {
        retryCalls += 1;
        throw new Error("retry failed");
      }
    } as any;
    const agents = new QuizAgents(bridge);

    const result = await agents.runStream({
      fileRef: { fileName: "f", fileUri: "u", mimeType: "application/pdf" },
      page: 1,
      pageText: "기본 개념입니다.",
      quizType: "OX",
      learnerLevel: "INTERMEDIATE",
      learnerMemoryDigest: "",
      targetDifficulty: "BALANCED",
      qaThreadDigest: "이전 질문 1: 왜 헷갈리나요?"
    });

    expect(retryCalls).toBe(1);
    expect(result.quiz.quizId).toBe("quiz_stream_partial");
    expect(result.quiz.questions).toHaveLength(5);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("retry failed"));
  });

  it("fails when generation stays below the minimum allowed question count", async () => {
    const bridge = {
      generateQuizStream: async (input: any) => ({
        quiz: makeQuiz(input.quizType, 1),
        thoughtSummary: "generated"
      }),
      generateQuiz: async (input: any) => makeQuiz(input.quizType, 4, "quiz_retry")
    } as any;
    const agents = new QuizAgents(bridge);

    await expect(
      agents.runStream({
        fileRef: { fileName: "f", fileUri: "u", mimeType: "application/pdf" },
        page: 1,
        pageText: "기본 개념입니다.",
        quizType: "OX",
        learnerLevel: "INTERMEDIATE",
        learnerMemoryDigest: "",
        targetDifficulty: "BALANCED"
      })
    ).rejects.toThrow("too few questions");
  });
});
