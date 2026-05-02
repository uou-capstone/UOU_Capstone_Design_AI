import { appConfig } from "../../config.js";
import { QuizJson, QuizQuestion, QuizType } from "../../types/domain.js";
import { parseQuizJson } from "../llm/JsonSchemaGuards.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";
import {
  QuizQuestionCountMemory,
  selectQuizQuestionCount
} from "./QuizQuestionCountPolicy.js";

function normalizeChoice(choice: unknown, index: number): { id: string; textMarkdown: string } {
  if (!choice || typeof choice !== "object") {
    return { id: `c${index + 1}`, textMarkdown: String(choice ?? "") };
  }
  const row = choice as Record<string, unknown>;
  const id = String(row.id ?? row.choiceId ?? `c${index + 1}`);
  const textMarkdown =
    String(
      row.textMarkdown ??
        row.text ??
        row.label ??
        row.content ??
        ""
    ) || `(선택지 ${index + 1})`;
  return { id, textMarkdown };
}

function normalizeQuestion(
  question: Record<string, unknown>,
  index: number,
  quizType: QuizType
): QuizQuestion {
  const normalized: Record<string, unknown> = {
    ...question,
    id: String(question.id ?? `q${index + 1}`),
    promptMarkdown: String(question.promptMarkdown ?? question.prompt ?? `문항 ${index + 1}`),
    points:
      typeof question.points === "number" ? question.points : Number(question.points ?? 1)
  };

  if (quizType === "MCQ") {
    const rawChoices = Array.isArray(question.choices) ? question.choices : [];
    normalized.choices = rawChoices.map((choice, choiceIndex) =>
      normalizeChoice(choice, choiceIndex)
    );

    const rawAnswer = question.answer;
    let choiceId = "";
    if (rawAnswer && typeof rawAnswer === "object") {
      choiceId = String((rawAnswer as Record<string, unknown>).choiceId ?? "");
    } else {
      choiceId = String(question.answerChoiceId ?? rawAnswer ?? "");
    }
    if (!choiceId && Array.isArray(normalized.choices) && normalized.choices.length > 0) {
      choiceId = String(
        ((normalized.choices[0] as Record<string, unknown>).id as string) || "a"
      );
    }
    normalized.answer = { choiceId };
  }

  if (quizType === "OX") {
    const rawAnswer = question.answer;
    let value = false;
    if (rawAnswer && typeof rawAnswer === "object") {
      value = Boolean((rawAnswer as Record<string, unknown>).value);
    } else if (typeof rawAnswer === "boolean") {
      value = rawAnswer;
    } else {
      const text = String(rawAnswer ?? "").toLowerCase();
      value = text === "true" || text === "o" || text === "정답";
    }
    normalized.answer = { value };
  }

  if (quizType === "SHORT") {
    const ref = question.referenceAnswer;
    if (ref && typeof ref === "object") {
      normalized.referenceAnswer = {
        text: String((ref as Record<string, unknown>).text ?? "")
      };
    } else {
      normalized.referenceAnswer = {
        text: String(ref ?? question.answer ?? "")
      };
    }
    normalized.rubricMarkdown = String(
      question.rubricMarkdown ?? question.gradingRubricMarkdown ?? ""
    );
  }

  if (quizType === "ESSAY") {
    normalized.modelAnswerMarkdown = String(
      question.modelAnswerMarkdown ?? question.modelAnswer ?? question.referenceAnswer ?? ""
    );
    normalized.rubricMarkdown = String(
      question.rubricMarkdown ?? question.gradingRubricMarkdown ?? ""
    );
  }

  return normalized as unknown as QuizQuestion;
}

function normalizeQuiz(rawQuiz: QuizJson, fallbackType: QuizType, page: number): QuizJson {
  const quizType = (String(rawQuiz.quizType || fallbackType).toUpperCase() as QuizType) || fallbackType;
  const questionsRaw = Array.isArray(rawQuiz.questions) ? rawQuiz.questions : [];
  const questions: QuizQuestion[] = questionsRaw.map((q, index) =>
    normalizeQuestion(q as unknown as Record<string, unknown>, index, quizType)
  );

  return {
    ...rawQuiz,
    schemaVersion: "1.0",
    quizId: String(rawQuiz.quizId || `quiz_${Date.now()}`),
    quizType,
    page: Number(rawQuiz.page || page),
    questions
  };
}

interface QuizGenerationInput {
  fileRef: { fileName: string; fileUri: string; mimeType: string };
  page: number;
  pageText: string;
  quizType: QuizType;
  coverageStartPage?: number;
  coverageEndPage?: number;
  learnerLevel: string;
  learnerConfidence?: number;
  learnerMemoryDigest: string;
  learnerMemory?: QuizQuestionCountMemory | null;
  qaThreadDigest?: string;
  targetDifficulty: "FOUNDATIONAL" | "BALANCED" | "CHALLENGING";
  sessionId?: string;
  lectureId?: string;
}

function trimQuizQuestions(quiz: QuizJson, count: number): QuizJson {
  if (quiz.questions.length <= count) return quiz;
  return {
    ...quiz,
    questions: quiz.questions.slice(0, count)
  };
}

function logQuestionCountDecision(payload: Record<string, unknown>): void {
  console.info("[quiz_question_count_decision] " + JSON.stringify(payload));
}

function logQuestionCountMismatch(payload: Record<string, unknown>): void {
  console.warn("[quiz_question_count_mismatch] " + JSON.stringify(payload));
}

export class QuizAgents {
  constructor(private readonly bridge: GeminiBridgeClient) {}

  async generate(input: QuizGenerationInput): Promise<QuizJson> {
    const streamed = await this.runStream(input);
    return streamed.quiz;
  }

  async runStream(
    input: QuizGenerationInput,
    onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void,
    signal?: AbortSignal
  ): Promise<{ quiz: QuizJson; thoughtSummary: string }> {
    const coverageStartPage = input.coverageStartPage ?? 1;
    const coverageEndPage = input.coverageEndPage ?? input.page;
    const countDecision = selectQuizQuestionCount({
      quizType: input.quizType,
      pageText: input.pageText,
      coverageStartPage,
      coverageEndPage,
      learnerLevel: input.learnerLevel,
      learnerConfidence: input.learnerConfidence,
      targetDifficulty: input.targetDifficulty,
      memory: input.learnerMemory,
      learnerMemoryDigest: input.learnerMemoryDigest,
      qaThreadDigest: input.qaThreadDigest
    });
    const baseLogPayload = {
      sessionId: input.sessionId ?? null,
      lectureId: input.lectureId ?? null,
      page: input.page,
      quizType: input.quizType,
      requestedQuestionCount: countDecision.questionCount,
      signals: countDecision.signals,
      rationale: countDecision.rationale,
      coverageStartPage,
      coverageEndPage
    };
    const request = {
      model: appConfig.modelName,
      fileRef: input.fileRef,
      page: input.page,
      pageText: input.pageText,
      quizType: input.quizType,
      coverageStartPage,
      coverageEndPage,
      questionCount: countDecision.questionCount,
      questionCountRationale: countDecision.rationale,
      learnerLevel: input.learnerLevel,
      learnerMemoryDigest: input.learnerMemoryDigest,
      qaThreadDigest: input.qaThreadDigest,
      targetDifficulty: input.targetDifficulty
    };
    const response = await this.bridge.generateQuizStream(
      request,
      onDelta,
      signal
    );

    const parsed = parseQuizJson(response.quiz);
    let quiz = normalizeQuiz(parsed, input.quizType, input.page);
    let retryUsed = false;
    let rawActualQuestionCount = quiz.questions.length;

    if (rawActualQuestionCount !== countDecision.questionCount) {
      logQuestionCountMismatch({
        ...baseLogPayload,
        actualQuestionCount: rawActualQuestionCount,
        retryUsed,
        message: "stream_generation_count_mismatch"
      });
    }

    if (rawActualQuestionCount < countDecision.questionCount) {
      try {
        retryUsed = true;
        const retryQuiz = await this.bridge.generateQuiz(request);
        const retryParsed = parseQuizJson(retryQuiz);
        quiz = normalizeQuiz(retryParsed, input.quizType, input.page);
        rawActualQuestionCount = quiz.questions.length;
        if (rawActualQuestionCount !== countDecision.questionCount) {
          logQuestionCountMismatch({
            ...baseLogPayload,
            actualQuestionCount: rawActualQuestionCount,
            retryUsed,
            message: "retry_generation_count_mismatch"
          });
        }
      } catch (error) {
        if (rawActualQuestionCount < countDecision.minAllowed) {
          throw error;
        }
        logQuestionCountMismatch({
          ...baseLogPayload,
          actualQuestionCount: rawActualQuestionCount,
          retryUsed,
          message: error instanceof Error ? error.message : "retry_generation_failed"
        });
      }
    }

    if (quiz.questions.length < countDecision.minAllowed) {
      throw new Error(
        `Generated quiz has too few questions: ${quiz.questions.length}/${countDecision.minAllowed}`
      );
    }

    quiz = trimQuizQuestions(quiz, countDecision.questionCount);
    logQuestionCountDecision({
      ...baseLogPayload,
      actualQuestionCount: quiz.questions.length,
      retryUsed
    });

    return {
      quiz,
      thoughtSummary: response.thoughtSummary
    };
  }
}
