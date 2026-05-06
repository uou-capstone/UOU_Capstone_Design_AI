import type { PageStatus, SessionState } from "../types/domain.js";

const LEARNING_EVIDENCE_STATUSES = new Set<PageStatus>([
  "EXPLAINED",
  "QUIZ_TYPE_PENDING",
  "QUIZ_IN_PROGRESS",
  "QUIZ_GRADED",
  "REVIEW_IN_PROGRESS",
  "REVIEW_DONE",
  "DONE"
]);

export function normalizeExplicitLearningProgressPage(
  value: unknown,
  maxPage?: number
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const floored = Math.floor(value);
  const upperBound = Number.isFinite(maxPage) && Number(maxPage) > 0
    ? Math.floor(Number(maxPage))
    : null;
  return upperBound === null ? floored : Math.min(floored, upperBound);
}

export function inferLegacyExplainedProgressPage(
  session: Pick<SessionState, "pageStates">,
  maxPage?: number
): number {
  if (!Array.isArray(session.pageStates)) {
    return 0;
  }
  const evidencePages = new Set<number>();
  for (const pageState of session.pageStates) {
    const page = Number(pageState?.page);
    if (!Number.isFinite(page) || page <= 0) continue;
    if (!LEARNING_EVIDENCE_STATUSES.has(pageState.status)) continue;
    evidencePages.add(Math.floor(page));
  }

  const upperBound = Number.isFinite(maxPage) && Number(maxPage) > 0
    ? Math.floor(Number(maxPage))
    : Number.MAX_SAFE_INTEGER;
  let progress = 0;
  while (progress < upperBound && evidencePages.has(progress + 1)) {
    progress += 1;
  }
  return progress;
}

export function resolveLearningProgressPage(
  session: Pick<SessionState, "learningProgressPage" | "pageStates">,
  maxPage?: number
): number {
  const explicit = normalizeExplicitLearningProgressPage(session.learningProgressPage, maxPage);
  if (explicit !== null) {
    return explicit;
  }
  return inferLegacyExplainedProgressPage(session as Pick<SessionState, "pageStates">, maxPage);
}

export function normalizeStoredSessionLearningProgress<T extends Partial<SessionState>>(
  session: T
): T {
  if (!Object.prototype.hasOwnProperty.call(session, "learningProgressPage")) {
    return session;
  }
  const normalized = normalizeExplicitLearningProgressPage(session.learningProgressPage);
  if (normalized === null) {
    delete session.learningProgressPage;
  } else {
    session.learningProgressPage = normalized;
  }
  return session;
}

export function advanceLearningProgressAfterExplanation(
  session: SessionState,
  explainedPage: number,
  maxPage?: number
): number {
  const page = normalizeExplicitLearningProgressPage(explainedPage, maxPage);
  if (page === null || page <= 0) {
    return resolveLearningProgressPage(session, maxPage);
  }
  const current = resolveLearningProgressPage(session, maxPage);
  if (page === current + 1) {
    session.learningProgressPage = page;
    return page;
  }
  return current;
}
