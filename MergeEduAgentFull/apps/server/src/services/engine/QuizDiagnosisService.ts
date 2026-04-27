import {
  ActiveIntervention,
  GradingItem,
  IntegratedLearnerMemory,
  LearnerMemoryWrite,
  QuizRecord
} from "../../types/domain.js";

const GENERIC_STOPWORDS = new Set([
  "다음",
  "가장",
  "옳은",
  "틀린",
  "설명",
  "문항",
  "선택",
  "고르",
  "것",
  "수",
  "중",
  "대한",
  "위한",
  "하는",
  "이다",
  "이며",
  "또는",
  "에서",
  "으로",
  "이유",
  "정답",
  "오답",
  "문제",
  "quiz",
  "page"
]);

function uniqueStrings(values: string[]): string[] {
  const merged: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    if (!merged.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      merged.push(normalized);
    }
  }
  return merged;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/[`*_>#-]/g, " ")
    .replace(/\$\$?[^$]+\$\$?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return stripMarkdown(text)
    .toLowerCase()
    .replace(/[^0-9a-zA-Z가-힣\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !GENERIC_STOPWORDS.has(token));
}

function topPromptTokens(prompts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    for (const token of tokenize(prompt)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([token]) => token);
}

function focusConceptsFromPrompts(
  prompts: string[],
  memory: IntegratedLearnerMemory
): string[] {
  const tokenHits = topPromptTokens(prompts);
  const matchingWeaknesses = memory.weaknesses.filter((concept) => {
    const normalized = concept.toLowerCase();
    return prompts.some((prompt) => stripMarkdown(prompt).toLowerCase().includes(normalized));
  });

  const combined =
    tokenHits.length >= 2 ? `${tokenHits[0]} ${tokenHits[1]}`.trim() : tokenHits[0] ?? "";

  return uniqueStrings([
    ...matchingWeaknesses,
    combined,
    ...tokenHits
  ]).slice(0, 3);
}

function buildSuspectedMisconceptions(
  focusConcepts: string[],
  scoreRatio: number,
  wrongCount: number,
  repeatedMissCount: number
): string[] {
  const primary = focusConcepts[0] ?? "현재 개념";
  const messages: string[] = [];
  if (scoreRatio < 0.4 || wrongCount >= 2) {
    messages.push(`${primary} 개념과 적용 기준을 함께 혼동하는 경향`);
  } else {
    messages.push(`${primary} 적용 이유를 헷갈릴 가능성`);
  }
  if (repeatedMissCount > 0) {
    messages.push(`${primary} 관련 반복 오답이 이어지는 상태`);
  }
  return uniqueStrings(messages).slice(0, 2);
}

function buildDiagnosticPrompt(
  focusConcepts: string[],
  scoreRatio: number,
  wrongCount: number,
  repeatedMissCount: number
): string {
  const primary = focusConcepts[0];
  if (!primary) {
    return "이번에는 바로 전체 복습으로 가지 않고, 어디가 막혔는지 먼저 짚어볼게요.\n\n개념 자체가 헷갈렸는지, 적용 이유가 헷갈렸는지, 계산 과정이 헷갈렸는지 한 줄로 말해 주세요.";
  }

  if (repeatedMissCount > 0) {
    return `최근에도 **${primary}** 쪽에서 비슷하게 흔들린 기록이 보여요.\n\n이번에는 개념 자체가 헷갈렸는지, 적용 이유가 헷갈렸는지, 계산 과정이 헷갈렸는지 한 줄로 말해 주세요.`;
  }

  if (scoreRatio < 0.4 || wrongCount >= 2) {
    return `이번에는 바로 전체 복습으로 가지 않고, **${primary}** 쪽에서 어디가 막혔는지 먼저 짚어볼게요.\n\n개념 자체가 헷갈렸는지, 적용 이유가 헷갈렸는지, 계산 과정이 헷갈렸는지 한 줄로 말해 주세요.`;
  }

  return `방금 틀린 문제를 보면 **${primary}** 부분이 가장 헷갈린 것 같아요.\n\n어느 지점이 막혔는지 한 줄로 말해 주세요.`;
}

function learnerReplySignals(reply: string, focus: string): {
  weaknesses: string[];
  misconceptions: string[];
  coachingGoals: string[];
} {
  const normalized = reply.toLowerCase();
  const weaknesses: string[] = [];
  const misconceptions: string[] = [];
  const coachingGoals: string[] = [];

  if (/(개념|정의|공식\s*자체|처음부터|기초)/.test(normalized)) {
    weaknesses.push(`${focus} 기본 개념`);
    coachingGoals.push(`${focus} 기본 개념 다시 확인`);
  }

  if (/(적용|왜|이유|바꾸|전환|헷갈)/.test(normalized)) {
    misconceptions.push(`${focus} 적용 이유를 자주 혼동함`);
    coachingGoals.push(`${focus} 적용 이유를 예시로 재확인`);
  }

  if (/(계산|순서|부호|실수|전개)/.test(normalized)) {
    weaknesses.push(`${focus} 계산 순서`);
    coachingGoals.push(`${focus} 계산 순서를 짧게 재점검`);
  }

  if (weaknesses.length === 0 && misconceptions.length === 0) {
    weaknesses.push(focus);
    coachingGoals.push(`${focus} 핵심 포인트 재확인`);
  }

  return {
    weaknesses: uniqueStrings(weaknesses).slice(0, 2),
    misconceptions: uniqueStrings(misconceptions).slice(0, 2),
    coachingGoals: uniqueStrings(coachingGoals).slice(0, 2)
  };
}

function wrongItemsOf(record: QuizRecord): GradingItem[] {
  if (record.grading?.status !== "GRADED") {
    return [];
  }
  return record.grading.items.filter(
    (item) => item.verdict !== "CORRECT" || item.score < item.maxScore
  );
}

function recentRepeatCount(record: QuizRecord, history: QuizRecord[]): number {
  return history.filter((quiz) => {
    if (quiz.id === record.id) return false;
    if (quiz.createdFromPage !== record.createdFromPage) return false;
    if (quiz.grading?.status !== "GRADED") return false;
    return (quiz.grading.scoreRatio ?? 0) < 0.6;
  }).length;
}

export function createQuizRepairIntervention(
  record: QuizRecord,
  memory: IntegratedLearnerMemory,
  nowIso: string,
  history: QuizRecord[] = []
): ActiveIntervention | null {
  const wrongItems = wrongItemsOf(record);
  if (wrongItems.length === 0 || !record.grading) {
    return null;
  }

  const wrongPrompts = wrongItems.map((item) => {
    const question = record.quizJson.questions.find((candidate) => candidate.id === item.questionId);
    return question?.promptMarkdown ?? item.feedbackMarkdown ?? item.questionId;
  });
  const focusConcepts = focusConceptsFromPrompts(wrongPrompts, memory);
  const repeatedMissCount = recentRepeatCount(record, history);
  const suspectedMisconceptions = buildSuspectedMisconceptions(
    focusConcepts,
    record.grading.scoreRatio,
    wrongItems.length,
    repeatedMissCount
  );

  return {
    mode: "QUIZ_REPAIR",
    page: record.createdFromPage,
    quizId: record.id,
    scoreRatio: record.grading.scoreRatio,
    wrongQuestionIds: wrongItems.map((item) => item.questionId),
    focusConcepts,
    suspectedMisconceptions,
    diagnosticPrompt: buildDiagnosticPrompt(
      focusConcepts,
      record.grading.scoreRatio,
      wrongItems.length,
      repeatedMissCount
    ),
    stage: "AWAITING_DIAGNOSIS_REPLY",
    createdAt: nowIso,
    lastUpdatedAt: nowIso
  };
}

export function buildActiveInterventionDigest(intervention: ActiveIntervention | null | undefined): string {
  if (!intervention) {
    return "(진행 중인 교정 개입 없음)";
  }

  return [
    `개입 종류: ${intervention.mode}`,
    `페이지: ${intervention.page}`,
    `퀴즈 ID: ${intervention.quizId}`,
    `점수 비율: ${Math.round(intervention.scoreRatio * 100)}%`,
    `집중 개념: ${intervention.focusConcepts.join(", ") || "(없음)"}`,
    `의심 오개념: ${intervention.suspectedMisconceptions.join(", ") || "(없음)"}`,
    `진단 질문: ${intervention.diagnosticPrompt}`,
    `현재 단계: ${intervention.stage}`
  ].join("\n");
}

export function buildRepairQuestion(
  intervention: ActiveIntervention,
  studentReply: string
): string {
  return [
    "오답 교정 모드입니다.",
    `집중 개념: ${intervention.focusConcepts.join(", ") || "현재 오답 개념"}`,
    `의심 오개념: ${intervention.suspectedMisconceptions.join(", ") || "(없음)"}`,
    `학생 진단 답변: ${studentReply}`,
    "요청:",
    "- 전체 페이지를 처음부터 다시 설명하지 마세요.",
    "- 지금 헷갈린 지점을 먼저 한 문장으로 짚어 주세요.",
    "- 핵심 설명은 짧고 정확하게 4~6문장으로 써 주세요.",
    "- 마지막에는 `다시 확인:`으로 시작하는 한 문장 점검 질문을 붙여 주세요."
  ].join("\n");
}

export function buildRepairMemoryWrite(
  intervention: ActiveIntervention,
  studentReply: string
): LearnerMemoryWrite {
  const focus = intervention.focusConcepts[0] ?? "현재 개념";
  const replySignals = learnerReplySignals(studentReply, focus);
  return {
    shouldPersist: true,
    weaknesses: uniqueStrings([
      ...replySignals.weaknesses,
      ...intervention.focusConcepts.slice(0, 1)
    ]).slice(0, 2),
    misconceptions: uniqueStrings([
      ...intervention.suspectedMisconceptions,
      ...replySignals.misconceptions
    ]).slice(0, 2),
    nextCoachingGoals: replySignals.coachingGoals
  };
}
