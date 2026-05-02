import { QuizDifficultyTarget, QuizType } from "../../types/domain.js";

export interface QuizQuestionCountMemory {
  strengths?: string[];
  weaknesses?: string[];
  misconceptions?: string[];
  nextCoachingGoals?: string[];
}

export interface QuizQuestionCountInput {
  quizType: QuizType;
  pageText?: string;
  coverageStartPage?: number;
  coverageEndPage?: number;
  learnerLevel?: string;
  learnerConfidence?: number;
  targetDifficulty?: QuizDifficultyTarget;
  memory?: QuizQuestionCountMemory | null;
  learnerMemoryDigest?: string;
  qaThreadDigest?: string;
}

export interface QuizQuestionCountDecision {
  questionCount: number;
  minAllowed: number;
  maxAllowed: number;
  rationale: string;
  signals: string[];
}

const HELP_SIGNAL_PATTERNS = [
  "헷갈",
  "모르",
  "어렵",
  "왜",
  "어떻게",
  "틀린",
  "막혔",
  "confus",
  "difficult",
  "why",
  "how"
];

const COMPLEXITY_KEYWORDS = [
  "공식",
  "절차",
  "비교",
  "권한",
  "인증",
  "알고리즘",
  "정의",
  "증명",
  "계산",
  "formula",
  "procedure",
  "compare",
  "permission",
  "authentication",
  "algorithm",
  "definition",
  "proof",
  "calculate"
];
const QUIZ_DIFFICULTY_TARGETS: ReadonlySet<string> = new Set([
  "FOUNDATIONAL",
  "BALANCED",
  "CHALLENGING"
]);

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, keyword) => (
    lower.includes(keyword.toLowerCase()) ? count + 1 : count
  ), 0);
}

function normalizeTargetDifficulty(value: unknown): QuizDifficultyTarget {
  const candidate = String(value ?? "BALANCED").toUpperCase();
  return QUIZ_DIFFICULTY_TARGETS.has(candidate)
    ? (candidate as QuizDifficultyTarget)
    : "BALANCED";
}

function digestHasNonEmptySection(digest: string, label: string): boolean {
  const match = digest.match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"));
  if (!match) return false;
  const value = (match[1] ?? "").trim();
  return Boolean(value && value !== "(없음)");
}

export function selectQuizQuestionCount(input: QuizQuestionCountInput): QuizQuestionCountDecision {
  const quizType = input.quizType;
  const minAllowed = 5;
  const maxAllowed = 10;
  const pageText = String(input.pageText ?? "");
  const digest = String(input.learnerMemoryDigest ?? "");
  const qaThreadDigest = String(input.qaThreadDigest ?? "");
  const learnerLevel = String(input.learnerLevel ?? "INTERMEDIATE").toUpperCase();
  const confidence =
    typeof input.learnerConfidence === "number" && Number.isFinite(input.learnerConfidence)
      ? clamp(input.learnerConfidence, 0, 1)
      : 0.5;
  const targetDifficulty = normalizeTargetDifficulty(input.targetDifficulty);
  const coverageStartPage =
    typeof input.coverageStartPage === "number" && Number.isFinite(input.coverageStartPage)
      ? Math.max(1, Math.floor(input.coverageStartPage))
      : 1;
  const coverageEndPage =
    typeof input.coverageEndPage === "number" && Number.isFinite(input.coverageEndPage)
      ? Math.max(coverageStartPage, Math.floor(input.coverageEndPage))
      : coverageStartPage;
  const coverageWidth = Math.max(1, coverageEndPage - coverageStartPage + 1);

  const memory = input.memory ?? {};
  const strengths = normalizeStringArray(memory.strengths);
  const weaknesses = normalizeStringArray(memory.weaknesses);
  const misconceptions = normalizeStringArray(memory.misconceptions);
  const nextCoachingGoals = normalizeStringArray(memory.nextCoachingGoals);

  const hasWeakness = weaknesses.length > 0 || digestHasNonEmptySection(digest, "약점");
  const hasMisconception = misconceptions.length > 0 || digestHasNonEmptySection(digest, "오개념");
  const hasNextGoal = nextCoachingGoals.length > 0 || digestHasNonEmptySection(digest, "다음 코칭 목표");
  const hasStrengthOnly =
    strengths.length > 0 &&
    !hasWeakness &&
    !hasMisconception &&
    !hasNextGoal;
  const helpSignalHits = countKeywordHits(qaThreadDigest, HELP_SIGNAL_PATTERNS);
  const complexityHits = countKeywordHits(pageText, COMPLEXITY_KEYWORDS);
  const isComplexPage = pageText.length >= 1800 || complexityHits >= 2;
  const isSimplePage = pageText.trim().length > 0 && pageText.length < 400 && complexityHits === 0;

  let score = 0;
  const signals: string[] = [];

  function add(delta: number, signal: string): void {
    score += delta;
    signals.push(`${delta > 0 ? "+" : ""}${delta}:${signal}`);
  }

  if (learnerLevel === "BEGINNER") add(1, "learner_level_beginner");
  if (learnerLevel === "ADVANCED") add(-1, "learner_level_advanced");
  if (confidence < 0.4) add(1, "low_confidence");
  if (confidence > 0.75) add(-1, "high_confidence");
  if (hasWeakness) add(1, "memory_weakness");
  if (hasMisconception) add(1, "memory_misconception");
  if (hasNextGoal) add(1, "memory_next_goal");
  if (targetDifficulty === "CHALLENGING") add(1, "target_difficulty_challenging");
  if (targetDifficulty === "FOUNDATIONAL") add(-1, "target_difficulty_foundational");
  if (helpSignalHits > 0) add(1, "qa_thread_help_signal");
  if (isComplexPage) add(1, "page_complexity");
  if (
    isSimplePage &&
    (learnerLevel === "ADVANCED" || confidence > 0.75 || targetDifficulty === "FOUNDATIONAL" || hasStrengthOnly)
  ) {
    add(-1, "simple_page");
  }
  if (hasStrengthOnly) add(-1, "strength_only_memory");
  if (coverageWidth >= 3 && (isComplexPage || hasWeakness || hasMisconception || hasNextGoal)) {
    add(1, "wide_coverage_with_support_signal");
  }

  const questionCount = clamp(5 + score, minAllowed, maxAllowed);

  return {
    questionCount,
    minAllowed,
    maxAllowed,
    signals,
    rationale: [
      `base=5`,
      `score=${score}`,
      `level=${learnerLevel}`,
      `confidence=${confidence.toFixed(2)}`,
      `targetDifficulty=${targetDifficulty}`,
      `coverage=${coverageStartPage}-${coverageEndPage}`,
      `complexityHits=${complexityHits}`,
      `helpSignals=${helpSignalHits}`,
      `result=${questionCount}`
    ].join("; ")
  };
}
