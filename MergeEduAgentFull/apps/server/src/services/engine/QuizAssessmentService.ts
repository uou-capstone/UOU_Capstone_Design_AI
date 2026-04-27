import {
  GradingItem,
  IntegratedLearnerMemory,
  QuizAssessmentRecord,
  QuizDifficultyTarget,
  QuizRecord,
  QuizType,
  SessionState
} from "../../types/domain.js";
import { makeId, nowIso } from "./utils.js";

const MAX_SESSION_ASSESSMENTS = 24;
const MAX_PENDING_HANDOFF = 2;
const MAX_DIGEST_CHARS = 600;
const MAX_SIGNAL_ITEMS = 3;
const MAX_EVIDENCE_ITEMS = 3;

function uniqueTrimmed(items: string[], limit = MAX_SIGNAL_ITEMS): string[] {
  const merged: string[] = [];
  for (const item of items) {
    const normalized = sanitizeAssessmentText(item);
    if (!normalized) continue;
    if (merged.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      continue;
    }
    merged.push(normalized);
    if (merged.length >= limit) break;
  }
  return merged;
}

function questionPrompt(quiz: QuizRecord, questionId: string): string {
  const question = quiz.quizJson.questions.find((item) => item.id === questionId);
  return sanitizeAssessmentText(question?.promptMarkdown ?? questionId);
}

function stringifyAnswer(answer: unknown): string {
  if (typeof answer === "string") return answer;
  if (typeof answer === "number" || typeof answer === "boolean") return String(answer);
  if (Array.isArray(answer)) return answer.map((item) => stringifyAnswer(item)).join(", ");
  if (answer && typeof answer === "object") {
    try {
      return JSON.stringify(answer);
    } catch {
      return "[object]";
    }
  }
  return "";
}

function hasRepeatedLowScore(
  quizzes: QuizRecord[],
  quizId: string,
  page: number,
  passScoreRatio: number
): boolean {
  return quizzes.some(
    (quiz) =>
      quiz.id !== quizId &&
      quiz.createdFromPage === page &&
      quiz.grading?.status === "GRADED" &&
      (quiz.grading.scoreRatio ?? 0) < passScoreRatio
  );
}

function inferReadiness(scoreRatio: number, passScoreRatio: number) {
  if (scoreRatio < passScoreRatio) return "REPAIR_REQUIRED" as const;
  if (scoreRatio < Math.max(passScoreRatio, 0.85)) {
    return "REINFORCE_BEFORE_ADVANCE" as const;
  }
  return "READY_TO_ADVANCE" as const;
}

function inferEssayBehavior(
  quizType: QuizType,
  answers: Record<string, unknown>,
  scoreRatio: number
): string[] {
  if (quizType !== "SHORT" && quizType !== "ESSAY") return [];

  const totalChars = Object.values(answers)
    .map((value) => stringifyAnswer(value).trim().length)
    .reduce((sum, length) => sum + length, 0);

  if (totalChars >= 60 && scoreRatio < 0.7) {
    return ["서술형에서는 설명 의지는 있으나 개념 정확도 보강이 필요함"];
  }
  if (totalChars >= 60) {
    return ["서술형에서 근거를 문장으로 정리하는 편임"];
  }
  if (totalChars > 0 && totalChars < 25) {
    return ["답을 매우 짧게 적는 경향이 있어 핵심 이유를 먼저 정리할 필요가 있음"];
  }
  return [];
}

function buildEvidence(
  quiz: QuizRecord,
  answers: Record<string, unknown>,
  items: GradingItem[]
): string[] {
  return items
    .filter((item) => item.verdict !== "CORRECT")
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((item) => {
      const prompt = questionPrompt(quiz, item.questionId);
      const answer = sanitizeAssessmentText(stringifyAnswer(answers[item.questionId]));
      return sanitizeAssessmentText(
        `${item.verdict} · ${prompt} · 학생답안: ${answer || "(없음)"}`
      );
    });
}

function summaryLine(
  scoreRatio: number,
  strengths: string[],
  weaknesses: string[],
  behaviorSignals: string[],
  repeatedLowScore: boolean
): string {
  const scoreLabel = `${Math.round(scoreRatio * 100)}%`;
  const repeated = repeatedLowScore ? " 반복 흔들림이 관찰됩니다." : "";
  const strong = strengths[0] ? ` 강점: ${strengths[0]}.` : "";
  const weak = weaknesses[0] ? ` 보완: ${weaknesses[0]}.` : "";
  const behavior = behaviorSignals[0] ? ` 관찰: ${behaviorSignals[0]}.` : "";
  return sanitizeAssessmentText(`최근 퀴즈 이해도는 ${scoreLabel} 수준입니다.${strong}${weak}${behavior}${repeated}`);
}

function capRecords(records: QuizAssessmentRecord[]): QuizAssessmentRecord[] {
  if (records.length <= MAX_SESSION_ASSESSMENTS) return records;
  return records.slice(records.length - MAX_SESSION_ASSESSMENTS);
}

export function sanitizeAssessmentText(text: string): string {
  return text
    .replace(/[`*#>|\[\]{}]/g, " ")
    .replace(/\b(ignore|instruction|system|assistant|developer|tool)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function buildQuizAssessment(input: {
  quiz: QuizRecord;
  grading: NonNullable<QuizRecord["grading"]>;
  recentQuizzes: QuizRecord[];
  passScoreRatio: number;
  integratedMemory?: IntegratedLearnerMemory;
  activeIntervention?: SessionState["activeIntervention"];
}): QuizAssessmentRecord {
  const wrongItems = input.grading.items.filter((item) => item.verdict !== "CORRECT");
  const correctItems = input.grading.items.filter((item) => item.verdict === "CORRECT");
  const repeatedLowScore = hasRepeatedLowScore(
    input.recentQuizzes,
    input.quiz.id,
    input.quiz.createdFromPage,
    input.passScoreRatio
  );
  const readiness = inferReadiness(input.grading.scoreRatio, input.passScoreRatio);

  const strengths = uniqueTrimmed(
    correctItems.map((item) => `${questionPrompt(input.quiz, item.questionId)} 개념은 안정적으로 맞춤`)
  );
  const weaknesses = uniqueTrimmed(
    wrongItems.map((item) => `${questionPrompt(input.quiz, item.questionId)} 개념 보강이 필요함`)
  );
  const misconceptions = uniqueTrimmed(
    wrongItems
      .filter((item) => item.verdict === "WRONG")
      .map((item) => `${questionPrompt(input.quiz, item.questionId)} 적용 기준을 다시 점검할 필요가 있음`)
  );
  const memoryLinkedSignal =
    (input.integratedMemory?.weaknesses.length ?? 0) > 0 && weaknesses.length > 0
      ? ["기존 누적 약점과 이어지는 오답 신호가 다시 관찰됨"]
      : [];
  const interventionLinkedSignal =
    input.activeIntervention?.mode === "QUIZ_REPAIR"
      ? ["직전 교정 흐름과 연결해 다시 확인할 필요가 있음"]
      : [];
  const behaviorSignals = uniqueTrimmed([
    ...inferEssayBehavior(
      input.quiz.quizType,
      input.quiz.userAnswers ?? {},
      input.grading.scoreRatio
    ),
    ...memoryLinkedSignal,
    ...interventionLinkedSignal,
    ...(repeatedLowScore ? ["같은 페이지 개념에서 반복적으로 흔들리는 패턴이 보임"] : [])
  ]);
  const evidence = buildEvidence(input.quiz, input.quiz.userAnswers ?? {}, input.grading.items);

  let targetDifficulty: QuizDifficultyTarget | undefined;
  if (input.grading.scoreRatio < input.passScoreRatio) {
    targetDifficulty = "FOUNDATIONAL";
  }

  const explanationPreferences =
    input.quiz.quizType === "SHORT" || input.quiz.quizType === "ESSAY"
      ? uniqueTrimmed(
          [
            ...inferEssayBehavior(
              input.quiz.quizType,
              input.quiz.userAnswers ?? {},
              input.grading.scoreRatio
            ),
            ...(input.integratedMemory?.explanationPreferences ?? [])
          ],
          1
        )
      : [];

  const nextCoachingGoals = uniqueTrimmed([
    readiness === "REPAIR_REQUIRED"
      ? "오답 이유를 짧게 다시 설명한 뒤 바로 재확인하기"
      : readiness === "REINFORCE_BEFORE_ADVANCE"
        ? "핵심 개념을 한 번 더 연결해 확인하기"
        : "현재 강점을 다음 페이지 개념과 연결하기",
    repeatedLowScore ? "같은 페이지의 핵심 개념을 누적 약점으로 추적하기" : "",
    input.integratedMemory?.nextCoachingGoals[0] ?? ""
  ], 2);

  const preferredQuizTypes: QuizType[] =
    input.quiz.quizType === "ESSAY" && strengths.length > 0 ? ["ESSAY"] : [];

  return {
    id: makeId("asm"),
    quizId: input.quiz.id,
    page: input.quiz.createdFromPage,
    quizType: input.quiz.quizType,
    version: "1.0",
    source: "DETERMINISTIC_V1",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    scoreRatio: input.grading.scoreRatio,
    readiness,
    deliveryStatus: "PENDING",
    strengths,
    weaknesses,
    misconceptions,
    behaviorSignals,
    memoryHint: {
      strengths,
      weaknesses,
      misconceptions,
      explanationPreferences,
      preferredQuizTypes,
      targetDifficulty,
      nextCoachingGoals
    },
    summaryMarkdown: summaryLine(
      input.grading.scoreRatio,
      strengths,
      weaknesses,
      behaviorSignals,
      repeatedLowScore
    ),
    evidence
  };
}

export function upsertQuizAssessment(
  state: SessionState,
  assessment: QuizAssessmentRecord
): void {
  const existing = state.quizAssessments ?? [];
  const index = existing.findIndex(
    (item) => item.quizId === assessment.quizId && item.version === assessment.version
  );
  const next = [...existing];
  if (index >= 0) {
    const current = next[index];
    next[index] =
      current.deliveryStatus === "CONSUMED"
        ? {
            ...assessment,
            id: current.id,
            deliveryStatus: "CONSUMED",
            consumedAt: current.consumedAt
          }
        : assessment;
  } else {
    next.push(assessment);
  }
  state.quizAssessments = capRecords(next);
}

export function selectPendingAssessments(
  state: SessionState,
  maxItems = MAX_PENDING_HANDOFF
): QuizAssessmentRecord[] {
  return (state.quizAssessments ?? [])
    .filter((item) => item.deliveryStatus === "PENDING")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, maxItems);
}

function memoryHintSummary(memoryHint: QuizAssessmentRecord["memoryHint"]): string {
  const parts = [
    memoryHint.weaknesses[0] ? `weak=${memoryHint.weaknesses[0]}` : "",
    memoryHint.strengths[0] ? `strong=${memoryHint.strengths[0]}` : "",
    memoryHint.nextCoachingGoals[0] ? `next=${memoryHint.nextCoachingGoals[0]}` : ""
  ].filter(Boolean);
  return parts.join("; ");
}

export function preparePendingAssessmentHandoff(state: SessionState): {
  assessmentIds: string[];
  digest: string;
} {
  const selected = selectPendingAssessments(state);
  if (selected.length === 0) {
    return {
      assessmentIds: [],
      digest: ""
    };
  }

  const lines = selected.map((item) =>
    sanitizeAssessmentText(
      `quiz=${item.quizId}; page=${item.page}; type=${item.quizType}; score=${Math.round(
        item.scoreRatio * 100
      )}%; readiness=${item.readiness}; summary=${item.summaryMarkdown}; hint=${memoryHintSummary(
        item.memoryHint
      )}`
    )
  );

  const digest = lines.join("\n").slice(0, MAX_DIGEST_CHARS).trim();
  return {
    assessmentIds: selected.map((item) => item.id),
    digest
  };
}

export function markAssessmentsConsumed(
  state: SessionState,
  assessmentIds: string[],
  consumedAt = nowIso()
): void {
  if (assessmentIds.length === 0 || !state.quizAssessments?.length) return;

  const idSet = new Set(assessmentIds);
  state.quizAssessments = state.quizAssessments.map((item) =>
    idSet.has(item.id)
      ? {
          ...item,
          deliveryStatus: "CONSUMED",
          consumedAt,
          updatedAt: consumedAt
        }
      : item
  );
}

export function buildAssessmentLogPayload(input: {
  state: SessionState;
  assessment: QuizAssessmentRecord;
  repairTriggered: boolean;
}): Record<string, unknown> {
  return {
    sessionId: input.state.sessionId,
    lectureId: input.state.lectureId,
    quizId: input.assessment.quizId,
    assessmentId: input.assessment.id,
    quizType: input.assessment.quizType,
    scoreRatio: input.assessment.scoreRatio,
    source: input.assessment.source,
    deliveryStatus: input.assessment.deliveryStatus,
    evidenceCount: input.assessment.evidence.length,
    digestChars: input.assessment.summaryMarkdown.length,
    repairTriggered: input.repairTriggered
  };
}
