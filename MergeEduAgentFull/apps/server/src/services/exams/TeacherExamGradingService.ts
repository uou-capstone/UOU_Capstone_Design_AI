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

export class TeacherExamGradingService {
  constructor(private readonly bridge?: GeminiBridgeClient) {}

  async grade(input: {
    model: string;
    exam: TeacherExamRevision;
    answers: Record<string, unknown>;
    aiEnabled: boolean;
  }): Promise<TeacherExamGrading> {
    if (input.aiEnabled && this.bridge) {
      try {
        const ai = await this.bridge.gradeTeacherExam({
          model: input.model,
          exam: input.exam,
          answers: input.answers,
          responseJsonSchema: {}
        });
        const normalized = this.normalizeAiGrading(input.exam, ai);
        if (normalized) return normalized;
      } catch {
        // fall through to deterministic fallback
      }
      return this.gradeDeterministically(input.exam, input.answers, true);
    }
    return this.gradeDeterministically(input.exam, input.answers, false);
  }

  private normalizeAiGrading(exam: TeacherExamRevision, raw: unknown): TeacherExamGrading | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.items)) return null;
    const rawItems = data.items;
    const itemById = new Map<string, TeacherExamGradingItem>();
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      const questionId = String(item.questionId ?? "");
      const question = exam.questions.find((candidate) => candidate.id === questionId);
      if (!question) continue;
      const score = clampScore(Number(item.score), question.points);
      itemById.set(questionId, {
        questionId,
        score,
        maxScore: question.points,
        verdict: verdict(score, question.points),
        feedbackMarkdown: String(item.feedbackMarkdown ?? "AI 채점 결과입니다.")
      });
    }
    if (itemById.size !== exam.questions.length) return null;
    const items = exam.questions.map(
      (question) =>
        itemById.get(question.id) ?? {
          questionId: question.id,
          score: 0,
          maxScore: question.points,
          verdict: "WRONG" as const,
          feedbackMarkdown: "AI 응답에 해당 문항 채점이 없어 0점 처리했습니다."
        }
    );
    return this.buildResult(items, String(data.summaryMarkdown ?? "AI 채점이 완료되었습니다."), "AI");
  }

  gradeDeterministically(
    exam: TeacherExamRevision,
    answers: Record<string, unknown>,
    fallback: boolean
  ): TeacherExamGrading {
    const items = exam.questions.map((question) => this.gradeQuestion(question, answers[question.id]));
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

  private gradeQuestion(question: TeacherExamQuestion, answer: unknown): TeacherExamGradingItem {
    let score = 0;
    if (question.type === "MCQ") {
      const selected = typeof answer === "object" && answer ? (answer as Record<string, unknown>).choiceId : answer;
      score = String(selected ?? "") === String(question.answer?.choiceId ?? "") ? question.points : 0;
    } else if (question.type === "OX") {
      const raw = typeof answer === "object" && answer ? (answer as Record<string, unknown>).value : answer;
      const selected = parseBooleanAnswer(raw);
      score = selected !== null && selected === question.answer?.value ? question.points : 0;
    } else if (question.type === "SHORT") {
      const response = normalizeText(answer);
      const reference = normalizeText(question.referenceAnswer?.text);
      if (reference && response === reference) {
        score = question.points;
      } else {
        const expected = tokenize(`${question.referenceAnswer?.text ?? ""} ${question.rubricMarkdown ?? ""}`);
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
            : "채점 기준을 충분히 충족하지 못했습니다."
    };
  }

  private buildResult(
    items: TeacherExamGradingItem[],
    summaryMarkdown: string,
    gradingSource: TeacherExamGrading["gradingSource"]
  ): TeacherExamGrading {
    const totalScore = Math.round(items.reduce((sum, item) => sum + item.score, 0) * 10) / 10;
    const maxScore = items.reduce((sum, item) => sum + item.maxScore, 0);
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
