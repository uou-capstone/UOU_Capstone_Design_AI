export type ExamLogReason =
  | "UNAUTHORIZED"
  | "UNAVAILABLE"
  | "AI_UNAVAILABLE"
  | "PDF_EMPTY"
  | "PDF_UNREADABLE"
  | "LATE_AFTER_GRACE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_IN_PROGRESS"
  | "VALIDATION_ERROR"
  | "DEADLINE_EXPIRED";

export interface ExamLogPayload {
  examId?: string;
  weekId?: string;
  classroomId?: string;
  actorUserId?: string;
  attemptId?: string;
  submissionId?: string;
  examVersion?: number;
  gradingSource?: string;
  accepted?: boolean;
  action?: string;
  role?: string;
  operationMethods?: string[];
  operationCount?: number;
  droppedOperationCount?: number;
  fallback?: boolean;
  stage?: string;
  elapsedMs?: number;
  reason?: ExamLogReason;
}

export interface ExamLogger {
  event(name: string, payload: ExamLogPayload): void;
}

export class ConsoleExamLogger implements ExamLogger {
  event(name: string, payload: ExamLogPayload): void {
    console.log(`${name} ${JSON.stringify(payload)}`);
  }
}
