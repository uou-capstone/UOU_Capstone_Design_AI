import { appConfig } from "../../config.js";
import { QuizJson, QuizQuestion, QuizType } from "../../types/domain.js";
import { parseQuizJson } from "../llm/JsonSchemaGuards.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";

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

export class QuizAgents {
  constructor(private readonly bridge: GeminiBridgeClient) {}

  async generate(input: {
    fileRef: { fileName: string; fileUri: string; mimeType: string };
    page: number;
    pageText: string;
    quizType: QuizType;
    coverageStartPage?: number;
    coverageEndPage?: number;
    learnerLevel: string;
    learnerMemoryDigest: string;
    targetDifficulty: "FOUNDATIONAL" | "BALANCED" | "CHALLENGING";
  }): Promise<QuizJson> {
    const streamed = await this.runStream(input);
    return streamed.quiz;
  }

  async runStream(
    input: {
      fileRef: { fileName: string; fileUri: string; mimeType: string };
      page: number;
      pageText: string;
      quizType: QuizType;
      coverageStartPage?: number;
      coverageEndPage?: number;
      learnerLevel: string;
      learnerMemoryDigest: string;
      targetDifficulty: "FOUNDATIONAL" | "BALANCED" | "CHALLENGING";
    },
    onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void
  ): Promise<{ quiz: QuizJson; thoughtSummary: string }> {
    const response = await this.bridge.generateQuizStream(
      {
        model: appConfig.modelName,
        fileRef: input.fileRef,
        page: input.page,
        pageText: input.pageText,
        quizType: input.quizType,
        coverageStartPage: input.coverageStartPage ?? 1,
        coverageEndPage: input.coverageEndPage ?? input.page,
        questionCount: 3,
        learnerLevel: input.learnerLevel,
        learnerMemoryDigest: input.learnerMemoryDigest,
        targetDifficulty: input.targetDifficulty
      },
      onDelta
    );

    const parsed = parseQuizJson(response.quiz);
    return {
      quiz: normalizeQuiz(parsed, input.quizType, input.page),
      thoughtSummary: response.thoughtSummary
    };
  }
}
