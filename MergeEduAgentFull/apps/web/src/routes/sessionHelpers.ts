import { QuizJson, QuizRecord, QuizType } from "../types";

export type PageCommandIntent = "NEXT" | "PREVIOUS" | null;

const CONDITIONAL_OR_META_RE =
  /(답변\s*중|스트리밍\s*중|누를\s*수도|클릭할\s*수도|이동할\s*수도|넘어갈\s*수도|할\s*수도|수도\s*있|누르면|클릭하면|이동하면|넘어가면|넘기면|만약|경우|어떻게|왜|무엇|뭐가|무슨|되나요|\?|\？)/i;

const NEXT_ANCHOR_RE = /(다음\s*(페이지|슬라이드|장)?|다음으로|next\s*(page)?|next\b)/i;
const PREVIOUS_ANCHOR_RE =
  /(이전\s*(페이지|슬라이드|장)?|앞\s*(페이지|슬라이드|장)?|앞으로\s*돌아가|previous\s*(page)?|prev\b)/i;

const NEXT_DIRECT_RE =
  /(다음\s*(페이지|슬라이드|장)?(?:로|를|은|는)?\s*(?:가|가자|갈게|이동|넘어|넘겨|보여|열어|진행|설명)|다음으로\s*(?:가|가자|갈게|이동|넘어|넘겨|진행)?|넘어가\s*(?:줘|주세요|자)?|넘겨\s*(?:줘|주세요)?|next\s*(?:page)?(?:\s*please)?)/i;
const PREVIOUS_DIRECT_RE =
  /((?:이전|앞)\s*(페이지|슬라이드|장)?(?:로|를|은|는)?\s*(?:가|가자|갈게|이동|돌아|넘어|넘겨|보여|열어|설명)|앞으로\s*돌아가|돌아가\s*(?:줘|주세요)?|previous\s*(?:page)?(?:\s*please)?|prev\b)/i;

function isShortPageCommand(text: string): boolean {
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length <= 6 && text.length <= 48;
}

function matchesCommandIntent(text: string, anchor: RegExp, direct: RegExp): boolean {
  const trimmed = text.trim();
  if (!trimmed || CONDITIONAL_OR_META_RE.test(trimmed)) {
    return false;
  }
  if (!anchor.test(trimmed)) {
    return false;
  }
  return isShortPageCommand(trimmed) || direct.test(trimmed);
}

export function getPageCommandIntent(text: string): PageCommandIntent {
  const next = matchesCommandIntent(text, NEXT_ANCHOR_RE, NEXT_DIRECT_RE);
  const previous = matchesCommandIntent(text, PREVIOUS_ANCHOR_RE, PREVIOUS_DIRECT_RE);
  if (next === previous) {
    return null;
  }
  return next ? "NEXT" : "PREVIOUS";
}

export function findLatestQuizRecord(
  quizzes: QuizRecord[],
  quizId: string,
  quizType?: QuizType | string
): QuizRecord | undefined {
  for (let index = quizzes.length - 1; index >= 0; index -= 1) {
    const quiz = quizzes[index];
    if (quiz.id !== quizId) continue;
    if (quizType && quiz.quizType !== quizType) continue;
    return quiz;
  }
  return undefined;
}

export function findCurrentQuizRecord(
  quizzes: QuizRecord[],
  activeQuiz: QuizJson | null
): QuizRecord | undefined {
  if (!activeQuiz) return undefined;
  return findLatestQuizRecord(quizzes, activeQuiz.quizId, activeQuiz.quizType);
}
