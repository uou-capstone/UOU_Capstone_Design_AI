import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";
import {
  TeacherExamGrading,
  TeacherExamGradingItem,
  TeacherExamQuestion,
  TeacherExamRevision
} from "../../types/domain.js";

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9가-힣]+/i)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  );
}

function verdict(score: number, maxScore: number): TeacherExamGradingItem["verdict"] {
  if (maxScore <= 0 || score <= 0) return "WRONG";
  if (score >= maxScore) return "CORRECT";
  return "PARTIAL";
}

function clampScore(score: number, maxScore: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(maxScore, score));
}

function parseBooleanAnswer(answer: unknown): boolean | null {
  if (typeof answer === "boolean") return answer;
  if (typeof answer === "string") {
    const normalized = answer.trim().toLowerCase();
    if (["true", "o", "yes", "y", "1", "맞음", "참"].includes(normalized)) return true;
    if (["false", "x", "no", "n", "0", "틀림", "거짓"].includes(normalized)) return false;
  }
  return null;
}

function shortAnswerSource(question: TeacherExamQuestion): string {
  const modelAnswer = String(question.modelAnswerMarkdown ?? "").trim();
  const referenceAnswer = String(question.referenceAnswer?.text ?? "").trim();
  return modelAnswer || referenceAnswer;
}

function canonicalizeShortAnswerQuestion(question: TeacherExamQuestion): TeacherExamQuestion {
  if (question.type !== "SHORT") return question;
  const modelAnswer = String(question.modelAnswerMarkdown ?? "").trim();
  const referenceAnswer = String(question.referenceAnswer?.text ?? "").trim();
  return {
    ...question,
    referenceAnswer: { text: "" },
    modelAnswerMarkdown: modelAnswer || referenceAnswer
  };
}

function canonicalizeShortAnswerRevision(exam: TeacherExamRevision): TeacherExamRevision {
  return {
    ...exam,
    questions: exam.questions.map(canonicalizeShortAnswerQuestion)
  };
}

function isSystemGradedQuestion(question: TeacherExamQuestion): boolean {
  return question.type === "MCQ" || question.type === "OX";
}

function isWrittenQuestion(question: TeacherExamQuestion): boolean {
  return question.type === "SHORT" || question.type === "ESSAY";
}

function pickAnswers(
  questions: TeacherExamQuestion[],
  answers: Record<string, unknown>
): Record<string, unknown> {
  return questions.reduce<Record<string, unknown>>((accumulator, question) => {
    accumulator[question.id] = answers[question.id];
    return accumulator;
  }, {});
}

export class TeacherExamGradingService {
  constructor(private readonly bridge?: GeminiBridgeClient) {}

  async grade(input: {
    model: string;
    exam: TeacherExamRevision;
    answers: Record<string, unknown>;
    aiEnabled: boolean;
  }): Promise<TeacherExamGrading> {
    const exam = canonicalizeShortAnswerRevision(input.exam);
    const systemQuestions = exam.questions.filter(isSystemGradedQuestion);
    const writtenQuestions = exam.questions.filter(isWrittenQuestion);
    const systemItems = systemQuestions.map((question) =>
      this.gradeSystemQuestion(question, input.answers[question.id])
    );
    let writtenItems: TeacherExamGradingItem[] = [];
    let summaryMarkdown = "시스템 자동 채점이 완료되었습니다.";
    let gradingSource: TeacherExamGrading["gradingSource"] = "DETERMINISTIC_FALLBACK";
    let fallback = false;

    if (writtenQuestions.length === 0) {
      summaryMarkdown = "시스템 자동 채점이 완료되었습니다.";
    } else if (!input.aiEnabled) {
      writtenItems = writtenQuestions.map((question) => this.excludeWrittenQuestion(question));
      summaryMarkdown = "서술형 AI 채점이 꺼져 있어 단답식/서술형 문항은 종합 점수에서 제외했습니다.";
    } else if (this.bridge) {
      try {
        const ai = await this.bridge.gradeTeacherExam({
          model: input.model,
          exam: {
            ...exam,
            questions: writtenQuestions
          },
          answers: pickAnswers(writtenQuestions, input.answers),
          responseJsonSchema: {}
        });
        const normalized = this.normalizeAiGradingItems(writtenQuestions, ai);
        if (normalized) {
          writtenItems = normalized;
          summaryMarkdown = String(ai.summaryMarkdown ?? "AI 서술형 채점이 완료되었습니다.");
          gradingSource = "AI";
        } else {
          fallback = true;
          writtenItems = writtenQuestions.map((question) =>
            this.gradeWrittenFallbackQuestion(question, input.answers[question.id])
          );
          summaryMarkdown = "AI 채점 응답이 올바르지 않아 단답식/서술형 문항은 규칙 기반 채점으로 대체했습니다.";
        }
      } catch {
        fallback = true;
        writtenItems = writtenQuestions.map((question) =>
          this.gradeWrittenFallbackQuestion(question, input.answers[question.id])
        );
        summaryMarkdown = "AI 채점에 실패해 단답식/서술형 문항은 규칙 기반 채점으로 대체했습니다.";
      }
    } else {
      fallback = true;
      writtenItems = writtenQuestions.map((question) =>
        this.gradeWrittenFallbackQuestion(question, input.answers[question.id])
      );
      summaryMarkdown = "AI 채점기를 사용할 수 없어 단답식/서술형 문항은 규칙 기반 채점으로 대체했습니다.";
    }

    const itemByQuestionId = new Map(
      [...systemItems, ...writtenItems].map((item) => [item.questionId, item])
    );
    const items = exam.questions.map((question) => {
      const item = itemByQuestionId.get(question.id);
      return (
        item ?? {
          questionId: question.id,
          score: 0,
          maxScore: question.points,
          verdict: "WRONG" as const,
          feedbackMarkdown: "채점 결과가 없어 0점 처리했습니다.",
          gradingMode: "FALLBACK" as const
        }
      );
    });
    return {
      ...this.buildResult(items, summaryMarkdown, gradingSource),
      fallback
    };
  }

  private normalizeAiGradingItems(
    questions: TeacherExamQuestion[],
    raw: unknown
  ): TeacherExamGradingItem[] | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.items)) return null;
    const rawItems = data.items;
    const itemById = new Map<string, TeacherExamGradingItem>();
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== "object") return null;
      const item = rawItem as Record<string, unknown>;
      const questionId = String(item.questionId ?? "");
      const question = questions.find((candidate) => candidate.id === questionId);
      if (!question || itemById.has(questionId)) return null;
      if (typeof item.score !== "number" || !Number.isFinite(item.score)) return null;
      if (typeof item.feedbackMarkdown !== "string" || !item.feedbackMarkdown.trim()) return null;
      const score = clampScore(item.score, question.points);
      itemById.set(questionId, {
        questionId,
        score,
        maxScore: question.points,
        verdict: verdict(score, question.points),
        feedbackMarkdown: item.feedbackMarkdown,
        gradingMode: "AI"
      });
    }
    if (itemById.size !== questions.length) return null;
    return questions.map(
      (question) =>
        itemById.get(question.id) ?? {
          questionId: question.id,
          score: 0,
          maxScore: question.points,
          verdict: "WRONG" as const,
          feedbackMarkdown: "AI 응답에 해당 문항 채점이 없어 0점 처리했습니다.",
          gradingMode: "AI" as const
        }
    );
  }

  gradeDeterministically(
    exam: TeacherExamRevision,
    answers: Record<string, unknown>,
    fallback: boolean,
    options: { excludeWritten?: boolean } = {}
  ): TeacherExamGrading {
    const canonicalExam = canonicalizeShortAnswerRevision(exam);
    const items = canonicalExam.questions.map((question) => {
      if (isSystemGradedQuestion(question)) return this.gradeSystemQuestion(question, answers[question.id]);
      if (options.excludeWritten) return this.excludeWrittenQuestion(question);
      return this.gradeWrittenFallbackQuestion(question, answers[question.id]);
    });
    return {
      ...this.buildResult(
        items,
        fallback
          ? "AI 채점에 실패해 규칙 기반 채점으로 대체했습니다."
          : "규칙 기반 자동 채점이 완료되었습니다.",
        "DETERMINISTIC_FALLBACK"
      ),
      fallback
    };
  }

  private gradeSystemQuestion(question: TeacherExamQuestion, answer: unknown): TeacherExamGradingItem {
    let score = 0;
    if (question.type === "MCQ") {
      const selected = typeof answer === "object" && answer ? (answer as Record<string, unknown>).choiceId : answer;
      score = String(selected ?? "") === String(question.answer?.choiceId ?? "") ? question.points : 0;
    } else if (question.type === "OX") {
      const raw = typeof answer === "object" && answer ? (answer as Record<string, unknown>).value : answer;
      const selected = parseBooleanAnswer(raw);
      score = selected !== null && selected === question.answer?.value ? question.points : 0;
    }

    const finalScore = Math.round(clampScore(score, question.points) * 10) / 10;
    return {
      questionId: question.id,
      score: finalScore,
      maxScore: question.points,
      verdict: verdict(finalScore, question.points),
      feedbackMarkdown:
        finalScore >= question.points
          ? "정답으로 채점되었습니다."
          : "정답과 일치하지 않습니다.",
      gradingMode: "SYSTEM"
    };
  }

  private gradeWrittenFallbackQuestion(question: TeacherExamQuestion, answer: unknown): TeacherExamGradingItem {
    let score = 0;
    if (question.type === "SHORT") {
      const response = normalizeText(answer);
      const canonicalAnswer = normalizeText(shortAnswerSource(question));
      if (canonicalAnswer && response === canonicalAnswer) {
        score = question.points;
      } else {
        const expected = tokenize(`${shortAnswerSource(question)} ${question.rubricMarkdown ?? ""}`);
        const actual = tokenize(response);
        const overlap = Array.from(expected).filter((token) => actual.has(token)).length;
        score = expected.size > 0 ? question.points * Math.min(0.7, overlap / expected.size) : 0;
      }
    } else {
      const expected = tokenize(`${question.modelAnswerMarkdown ?? ""} ${question.rubricMarkdown ?? ""}`);
      const actual = tokenize(String(answer ?? ""));
      const overlap = Array.from(expected).filter((token) => actual.has(token)).length;
      score = expected.size > 0 ? question.points * Math.min(0.8, overlap / expected.size) : 0;
    }

    const finalScore = Math.round(clampScore(score, question.points) * 10) / 10;
    return {
      questionId: question.id,
      score: finalScore,
      maxScore: question.points,
      verdict: verdict(finalScore, question.points),
      feedbackMarkdown:
        finalScore >= question.points
          ? "정답으로 채점되었습니다."
          : finalScore > 0
            ? "일부 기준을 충족했습니다."
            : "채점 기준을 충분히 충족하지 못했습니다.",
      gradingMode: "FALLBACK"
    };
  }

  private excludeWrittenQuestion(question: TeacherExamQuestion): TeacherExamGradingItem {
    return {
      questionId: question.id,
      score: 0,
      maxScore: 0,
      verdict: "WRONG",
      feedbackMarkdown: "서술형 AI 채점이 꺼져 있어 이 문항은 종합 점수에서 제외되었습니다.",
      gradingMode: "EXCLUDED",
      excludedFromScore: true
    };
  }

  private buildResult(
    items: TeacherExamGradingItem[],
    summaryMarkdown: string,
    gradingSource: TeacherExamGrading["gradingSource"]
  ): TeacherExamGrading {
    const scoredItems = items.filter((item) => !item.excludedFromScore);
    const totalScore = Math.round(scoredItems.reduce((sum, item) => sum + item.score, 0) * 10) / 10;
    const maxScore = scoredItems.reduce((sum, item) => sum + item.maxScore, 0);
    return {
      totalScore,
      maxScore,
      scoreRatio: maxScore > 0 ? totalScore / maxScore : 0,
      items,
      summaryMarkdown,
      gradingSource
    };
  }
}
