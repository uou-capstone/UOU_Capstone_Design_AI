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
    classroomNotices: path.join(dataDir, "classroom-notices.json"),
    classroomNoticeComments: path.join(dataDir, "classroom-notice-comments.json"),
    classroomDiscussions: path.join(dataDir, "classroom-discussions.json"),
    classroomDiscussionComments: path.join(dataDir, "classroom-discussion-comments.json"),
    classroomDiscussionViews: path.join(dataDir, "classroom-discussion-views.json"),
    classroomReports: path.join(dataDir, "classroom-reports.json"),
    classroomReportCriteria: path.join(dataDir, "classroom-report-criteria.json"),
    teacherExams: path.join(dataDir, "teacher-exams.json"),
    teacherExamAttempts: path.join(dataDir, "teacher-exam-attempts.json"),
    teacherExamResults: path.join(dataDir, "teacher-exam-results.json"),
    quizResults: path.join(dataDir, "quiz-results.json"),
    users: path.join(dataDir, "users.json"),
    authSessions: path.join(dataDir, "auth-sessions.json"),
    classroomInvitations: path.join(dataDir, "classroom-invitations.json"),
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
