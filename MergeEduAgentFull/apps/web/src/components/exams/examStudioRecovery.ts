const RECOVERY_PREFIX = "mergeEdu.examStudio.";

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
