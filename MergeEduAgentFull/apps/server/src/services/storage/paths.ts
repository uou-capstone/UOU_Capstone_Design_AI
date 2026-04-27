import path from "node:path";
import { appConfig } from "../../config.js";

export interface StoragePathOptions {
  dataDir?: string;
  uploadDir?: string;
}

export function createStoragePaths(options: StoragePathOptions = {}) {
  const dataDir = options.dataDir ?? appConfig.dataDir;
  const uploadDir = options.uploadDir ?? appConfig.uploadDir;
  return {
    dataDir,
    classrooms: path.join(dataDir, "classrooms.json"),
    weeks: path.join(dataDir, "weeks.json"),
    lectures: path.join(dataDir, "lectures.json"),
    classroomReports: path.join(dataDir, "classroom-reports.json"),
    quizResults: path.join(dataDir, "quiz-results.json"),
    users: path.join(dataDir, "users.json"),
    authSessions: path.join(dataDir, "auth-sessions.json"),
    classroomEnrollments: path.join(dataDir, "classroom-enrollments.json"),
    oauthStates: path.join(dataDir, "oauth-states.json"),
    inviteAuditLog: path.join(dataDir, "invite-audit-log.json"),
    rateLimits: path.join(dataDir, "rate-limits.json"),
    sessionsDir: path.join(dataDir, "sessions"),
    uploadsDir: uploadDir
  } as const;
}

export type StoragePaths = ReturnType<typeof createStoragePaths>;

export const paths = createStoragePaths();
