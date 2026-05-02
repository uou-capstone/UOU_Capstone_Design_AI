import {
  IntegratedLearnerMemory,
  LearnerLevel,
  LearnerMemoryWrite,
  QuizDifficultyTarget,
  QuizType,
  SessionState
} from "../../types/domain.js";

const MAX_MEMORY_ITEMS = 8;
const QUIZ_TYPES: ReadonlySet<string> = new Set(["MCQ", "OX", "SHORT", "ESSAY"]);
const LEARNER_LEVELS: ReadonlySet<string> = new Set(["BEGINNER", "INTERMEDIATE", "ADVANCED"]);
const QUIZ_DIFFICULTY_TARGETS: ReadonlySet<string> = new Set([
  "FOUNDATIONAL",
  "BALANCED",
  "CHALLENGING"
]);

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function mergeUnique(base: string[], incoming?: string[]): string[] {
  const merged = [...base];
  for (const item of incoming ?? []) {
    const normalized = item.trim();
    if (!normalized) continue;
    if (!merged.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      merged.push(normalized);
    }
  }
  return merged.slice(0, MAX_MEMORY_ITEMS);
}

function mergeQuizTypes(base: QuizType[], incoming?: QuizType[]): QuizType[] {
  const merged = [...base];
  for (const item of incoming ?? []) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged.slice(0, 4);
}

function safeQuizTypes(value: unknown): QuizType[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").toUpperCase())
    .filter((item): item is QuizType => QUIZ_TYPES.has(item));
}

function normalizeTargetDifficulty(value: unknown): QuizDifficultyTarget {
  const candidate = String(value ?? "BALANCED").toUpperCase();
  return QUIZ_DIFFICULTY_TARGETS.has(candidate)
    ? (candidate as QuizDifficultyTarget)
    : "BALANCED";
}

function normalizeLearnerLevel(value: unknown): LearnerLevel {
  const candidate = String(value ?? "INTERMEDIATE").toUpperCase();
  return LEARNER_LEVELS.has(candidate) ? (candidate as LearnerLevel) : "INTERMEDIATE";
}

function normalizeConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5;
}

function normalizeIntegratedMemory(value: unknown): IntegratedLearnerMemory {
  const fallback = createInitialIntegratedMemory();
  const row = value && typeof value === "object" ? (value as Partial<IntegratedLearnerMemory>) : {};
  return {
    summaryMarkdown:
      typeof row.summaryMarkdown === "string" && row.summaryMarkdown.trim()
        ? row.summaryMarkdown
        : fallback.summaryMarkdown,
    strengths: safeStringArray(row.strengths),
    weaknesses: safeStringArray(row.weaknesses),
    misconceptions: safeStringArray(row.misconceptions),
    explanationPreferences: safeStringArray(row.explanationPreferences),
    preferredQuizTypes: safeQuizTypes(row.preferredQuizTypes),
    targetDifficulty: normalizeTargetDifficulty(row.targetDifficulty),
    nextCoachingGoals: safeStringArray(row.nextCoachingGoals),
    lastUpdatedAt:
      typeof row.lastUpdatedAt === "string" && row.lastUpdatedAt.trim()
        ? row.lastUpdatedAt
        : fallback.lastUpdatedAt
  };
}

function ensureLearnerModel(state: SessionState): void {
  const current = state.learnerModel;
  state.learnerModel = {
    level: normalizeLearnerLevel(current?.level),
    confidence: normalizeConfidence(current?.confidence),
    weakConcepts: safeStringArray(current?.weakConcepts),
    strongConcepts: safeStringArray(current?.strongConcepts)
  };
}

export function createInitialIntegratedMemory(): IntegratedLearnerMemory {
  return {
    summaryMarkdown: "아직 축적된 개인화 메모리가 없습니다.",
    strengths: [],
    weaknesses: [],
    misconceptions: [],
    explanationPreferences: [],
    preferredQuizTypes: [],
    targetDifficulty: "BALANCED",
    nextCoachingGoals: [],
    lastUpdatedAt: new Date().toISOString()
  };
}

export function applyLearnerMemoryWrite(
  state: SessionState,
  write?: LearnerMemoryWrite | null
): void {
  if (!write?.shouldPersist) {
    return;
  }

  const current = normalizeIntegratedMemory(state.integratedMemory);
  ensureLearnerModel(state);
  state.integratedMemory = {
    summaryMarkdown:
      write.summaryMarkdown?.trim() || current.summaryMarkdown,
    strengths: mergeUnique(current.strengths, safeStringArray(write.strengths)),
    weaknesses: mergeUnique(current.weaknesses, safeStringArray(write.weaknesses)),
    misconceptions: mergeUnique(current.misconceptions, safeStringArray(write.misconceptions)),
    explanationPreferences: mergeUnique(
      current.explanationPreferences,
      safeStringArray(write.explanationPreferences)
    ),
    preferredQuizTypes: mergeQuizTypes(
      current.preferredQuizTypes,
      safeQuizTypes(write.preferredQuizTypes)
    ),
    targetDifficulty: normalizeTargetDifficulty(write.targetDifficulty ?? current.targetDifficulty),
    nextCoachingGoals: mergeUnique(
      current.nextCoachingGoals,
      safeStringArray(write.nextCoachingGoals)
    ),
    lastUpdatedAt: new Date().toISOString()
  };

  if (write.learnerLevel) {
    state.learnerModel.level = write.learnerLevel;
  }
  if (typeof write.confidence === "number") {
    state.learnerModel.confidence = Math.max(0, Math.min(1, write.confidence));
  }

  state.learnerModel.strongConcepts = state.integratedMemory.strengths.slice(0, MAX_MEMORY_ITEMS);
  state.learnerModel.weakConcepts = [
    ...state.integratedMemory.weaknesses,
    ...state.integratedMemory.misconceptions
  ].slice(0, MAX_MEMORY_ITEMS);
}

export function buildIntegratedMemoryDigest(state: SessionState): string {
  const memory = normalizeIntegratedMemory(state.integratedMemory);
  return [
    `요약: ${memory.summaryMarkdown}`,
    `강점: ${memory.strengths.join(", ") || "(없음)"}`,
    `약점: ${memory.weaknesses.join(", ") || "(없음)"}`,
    `오개념: ${memory.misconceptions.join(", ") || "(없음)"}`,
    `설명 선호: ${memory.explanationPreferences.join(", ") || "(없음)"}`,
    `선호 퀴즈 유형: ${memory.preferredQuizTypes.join(", ") || "(없음)"}`,
    `목표 난이도: ${memory.targetDifficulty}`,
    `다음 코칭 목표: ${memory.nextCoachingGoals.join(", ") || "(없음)"}`
  ].join("\n");
}

export function buildPageHistoryDigest(state: SessionState, uptoPage: number): string {
  const relevant = state.pageStates
    .filter((item) => item.page >= 1 && item.page <= uptoPage)
    .sort((a, b) => a.page - b.page)
    .map((item) => {
      const summary = (item.explainSummary || "").replace(/\s+/g, " ").trim();
      return `[p.${item.page}] status=${item.status}; summary=${summary.slice(0, 220) || "(없음)"}`;
    });

  return relevant.slice(Math.max(0, relevant.length - 8)).join("\n");
}
