const RECOVERY_PREFIX = "mergeEdu.examStudio.";
const MATERIALIZED_EXAM_TTL_MS = 24 * 60 * 60 * 1000;

export type MaterializedExamSnapshot = {
  examId: string;
  originalScopeKey: string;
  savedAt: number;
};

export function examStudioRecoveryKey(input: {
  actorUserId: string;
  classroomId: string;
  weekId: string;
  examId: string;
  examVersion?: number;
}): string {
  return `${RECOVERY_PREFIX}v1.${input.actorUserId}.${input.classroomId}.${input.weekId}.${input.examId}.${input.examVersion ?? 0}`;
}

export function clearExamStudioRecovery(): void {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(RECOVERY_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}

export function clearExamStudioRecoveryKey(key: string): void {
  window.localStorage.removeItem(key);
}

export function migrateExamStudioRecoveryKey(fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  const value = window.localStorage.getItem(fromKey);
  if (value === null) return;
  window.localStorage.setItem(toKey, value);
  window.localStorage.removeItem(fromKey);
}

export function examStudioMaterializedStorageKey(input: {
  actorUserId: string;
  classroomId: string;
  weekId: string;
}): string {
  return `${RECOVERY_PREFIX}materialized.v1.${input.actorUserId}.${input.classroomId}.${input.weekId}`;
}

export function rememberMaterializedExam(input: {
  actorUserId: string;
  classroomId: string;
  weekId: string;
  examId: string;
  originalScopeKey: string;
}): void {
  window.sessionStorage.setItem(
    examStudioMaterializedStorageKey(input),
    JSON.stringify({
      examId: input.examId,
      originalScopeKey: input.originalScopeKey,
      savedAt: Date.now()
    })
  );
}

export function readMaterializedExam(input: {
  actorUserId: string;
  classroomId: string;
  weekId: string;
  originalScopeKey: string;
  now?: number;
}): MaterializedExamSnapshot | null {
  const key = examStudioMaterializedStorageKey(input);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<MaterializedExamSnapshot>;
    const { examId, originalScopeKey, savedAt } = parsed;
    const now = input.now ?? Date.now();
    const isValid =
      typeof examId === "string" &&
      examId.length > 0 &&
      originalScopeKey === input.originalScopeKey &&
      typeof savedAt === "number" &&
      Number.isFinite(savedAt) &&
      now - savedAt <= MATERIALIZED_EXAM_TTL_MS;

    if (!isValid) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return {
      examId,
      originalScopeKey,
      savedAt
    };
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

export function clearMaterializedExam(input: {
  actorUserId: string;
  classroomId: string;
  weekId: string;
}): void {
  window.sessionStorage.removeItem(examStudioMaterializedStorageKey(input));
}
