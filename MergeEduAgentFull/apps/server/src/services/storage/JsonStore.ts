import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import {
  AuthSession,
  Classroom,
  ClassroomDiscussionAttachment,
  ClassroomDiscussionCategory,
  ClassroomDiscussionComment,
  ClassroomDiscussionPost,
  ClassroomDiscussionStatus,
  ClassroomDiscussionViewReceipt,
  ClassroomDiscussionVisibility,
  ClassroomEnrollment,
  ClassroomInvitation,
  ClassroomNotice,
  ClassroomNoticeAttachment,
  ClassroomNoticeCategory,
  ClassroomNoticeComment,
  ClassroomNoticePriority,
  ClassroomNoticeStatus,
  ClassroomNoticeTarget,
  InviteAuditLogEntry,
  LectureItem,
  OAuthState,
  RateLimitBucket,
  SCHEMA_VERSION,
  SessionState,
  StudentCompetencyReport,
  StudentReportCustomCriterion,
  TeacherExam,
  TeacherExamAttempt,
  TeacherExamGrading,
  TeacherExamResultRecord,
  TeacherExamRevision,
  User,
  Week
} from "../../types/domain.js";
import { createInitialIntegratedMemory } from "../engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../engine/QaThreadService.js";
import { normalizeStoredSessionLearningProgress } from "../learningProgress.js";
import {
  isBuiltInReportCriterionName,
  normalizeReportCriterionName
} from "../report/reportCriteriaCatalog.js";
import { FileLock } from "./FileLock.js";
import { createStoragePaths, StoragePathOptions, StoragePaths } from "./paths.js";

function now(): string {
  return new Date().toISOString();
}

const DISCUSSION_VIEW_THROTTLE_MS = 10_000;

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const REPORT_CRITERION_DUPLICATE_MESSAGE = "이미 사용 중인 평가 항목 이름입니다.";

export class ReportCriterionDuplicateError extends Error {
  constructor() {
    super(REPORT_CRITERION_DUPLICATE_MESSAGE);
    this.name = "ReportCriterionDuplicateError";
  }
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function addMinutes(dateIso: string, minutes: number): string {
  return new Date(new Date(dateIso).getTime() + minutes * 60_000).toISOString();
}

function addSeconds(dateIso: string, seconds: number): string {
  return new Date(new Date(dateIso).getTime() + seconds * 1000).toISOString();
}

function minIso(a: string, b: string): string {
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

async function ensureFile(filePath: string, fallback: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fallback, "utf-8");
  }
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  await ensureFile(filePath, JSON.stringify(fallback, null, 2));
  const raw = await fs.readFile(filePath, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    const backupPath = `${filePath}.bak-${Date.now()}`;
    await fs.copyFile(filePath, backupPath);
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

async function readExistingJsonStrict<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await fs.writeFile(tmpPath, payload, "utf-8");
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

export interface QuizResultLogEntry {
  id: string;
  sessionId: string;
  lectureId: string;
  quizId: string;
  quizType: string;
  page: number;
  score: number;
  maxScore: number;
  scoreRatio: number;
  summaryMarkdown: string;
  createdAt: string;
}

export type ExamAttemptStartResult =
  | {
      ok: true;
      attempt: TeacherExamAttempt;
      exam: TeacherExam;
      created: boolean;
    }
  | {
      ok: false;
      reason: "NOT_FOUND" | "NOT_PUBLISHED" | "UNAVAILABLE";
    };

export type ExamAttemptSaveResult =
  | {
      ok: true;
      attempt: TeacherExamAttempt;
      accepted: boolean;
      reason?: "LATE_AFTER_GRACE" | "NOT_IN_PROGRESS";
    }
  | {
      ok: false;
      reason: "NOT_FOUND" | "FORBIDDEN";
    };

export type ExamAttemptClaimResult =
  | {
      ok: true;
      attempt: TeacherExamAttempt;
      shouldGrade: boolean;
      submissionId?: string;
      accepted: boolean;
    }
  | {
      ok: false;
      reason: "NOT_FOUND" | "FORBIDDEN" | "LATE_AFTER_GRACE";
    };

export class TeacherExamMutationBlockedError extends Error {
  constructor(readonly reason: "ENDED") {
    super(reason);
    this.name = "TeacherExamMutationBlockedError";
  }
}

export interface TeacherExamMutationGuardOptions {
  rejectEnded?: boolean;
  nowMs?: number;
}

export type DiscussionCommentCreateResult =
  | {
      ok: true;
      comment: ClassroomDiscussionComment;
    }
  | {
      ok: false;
      reason:
        | "POST_NOT_FOUND"
        | "DRAFT_POST"
        | "COMMENTS_DISABLED"
        | "PARENT_NOT_FOUND"
        | "REPLY_DEPTH";
    };

export type NoticeCommentCreateResult =
  | {
      ok: true;
      comment: ClassroomNoticeComment;
    }
  | {
      ok: false;
      reason: "NOTICE_NOT_FOUND_OR_HIDDEN" | "PARENT_NOT_FOUND" | "REPLY_DEPTH";
    };

export class JsonStore {
  private readonly lock = new FileLock();
  private readonly paths: StoragePaths;

  constructor(options: StoragePathOptions = {}) {
    this.paths = createStoragePaths(options);
  }

  withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.withLock(`session:${sessionId}`, fn);
  }

  private withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.withLock(`file:${path.resolve(filePath)}`, fn);
  }

  getUploadDir(): string {
    return this.paths.uploadsDir;
  }

  private isInsideUploadDir(filePath: string): boolean {
    const uploadRoot = path.resolve(this.paths.uploadsDir);
    const resolved = path.resolve(filePath);
    const relative = path.relative(uploadRoot, resolved);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  private async normalizeStoredUploadPath(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath);
    if (this.isInsideUploadDir(resolved)) {
      return resolved;
    }
    const migrated = path.join(this.paths.uploadsDir, path.basename(filePath));
    try {
      await fs.access(migrated);
      return migrated;
    } catch {
      return filePath;
    }
  }

  private reportKey(report: StudentCompetencyReport): string {
    const scope = report.reportScope ?? "CLASSROOM_AGGREGATE";
    return `${report.classroomId}:${scope}:${report.studentUserId ?? ""}`;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.paths.sessionsDir, { recursive: true });
    await fs.mkdir(this.paths.uploadsDir, { recursive: true });
    await ensureFile(this.paths.classrooms, "[]");
    await ensureFile(this.paths.weeks, "[]");
    await ensureFile(this.paths.lectures, "[]");
    await ensureFile(this.paths.classroomNotices, "[]");
    await ensureFile(this.paths.classroomNoticeComments, "[]");
    await ensureFile(this.paths.classroomDiscussions, "[]");
    await ensureFile(this.paths.classroomDiscussionComments, "[]");
    await ensureFile(this.paths.classroomDiscussionViews, "[]");
    await ensureFile(this.paths.classroomReports, "[]");
    await ensureFile(this.paths.classroomReportCriteria, "[]");
    await ensureFile(this.paths.teacherExams, "[]");
    await ensureFile(this.paths.teacherExamAttempts, "[]");
    await ensureFile(this.paths.teacherExamResults, "[]");
    await ensureFile(this.paths.quizResults, "[]");
    await ensureFile(this.paths.users, "[]");
    await ensureFile(this.paths.authSessions, "[]");
    await ensureFile(this.paths.classroomInvitations, "[]");
    await ensureFile(this.paths.classroomEnrollments, "[]");
    await ensureFile(this.paths.oauthStates, "[]");
    await ensureFile(this.paths.inviteAuditLog, "[]");
    await ensureFile(this.paths.rateLimits, "[]");
    await this.migrateLectureUploadPaths();
    await this.recoverInvitationsFromEnrollments();
    await this.recoverOrphanTeacherExamAttempts();
  }

  private async migrateLectureUploadPaths(): Promise<void> {
    await this.withFileLock(this.paths.lectures, async () => {
      const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
      let changed = false;
      const next = await Promise.all(
        lectures.map(async (lecture) => {
          const pdfPath = await this.normalizeStoredUploadPath(lecture.pdf.path);
          const pageIndexPath = await this.normalizeStoredUploadPath(lecture.pdf.pageIndexPath);
          if (pdfPath === lecture.pdf.path && pageIndexPath === lecture.pdf.pageIndexPath) {
            return lecture;
          }
          changed = true;
          return {
            ...lecture,
            pdf: {
              ...lecture.pdf,
              path: pdfPath,
              pageIndexPath
            },
            updatedAt: now()
          };
        })
      );
      if (changed) {
        await atomicWrite(this.paths.lectures, next);
      }
    });
  }

  async listClassrooms(): Promise<Classroom[]> {
    return readJson<Classroom[]>(this.paths.classrooms, []);
  }

  async getClassroom(classroomId: string): Promise<Classroom | null> {
    const classrooms = await this.listClassrooms();
    return classrooms.find((item) => item.id === classroomId) ?? null;
  }

  async createClassroom(title: string, teacherId?: string): Promise<Classroom> {
    return this.withFileLock(this.paths.classrooms, async () => {
      const classrooms = await this.listClassrooms();
      const item: Classroom = {
        id: id("cls"),
        title,
        teacherId,
        createdAt: now(),
        updatedAt: now()
      };
      classrooms.push(item);
      await atomicWrite(this.paths.classrooms, classrooms);
      return item;
    });
  }

  async deleteClassroom(classroomId: string): Promise<void> {
    const weeks = await this.listWeeksByClassroom(classroomId);
    const weekIds = weeks.map((w) => w.id);
    await this.deleteTeacherExamsByWeekIds(weekIds);

    await this.withFileLock(this.paths.classrooms, async () => {
      const classrooms = await this.listClassrooms();
      await atomicWrite(
        this.paths.classrooms,
        classrooms.filter((c) => c.id !== classroomId)
      );
    });
    await this.deleteClassroomReport(classroomId);
    await this.deleteClassroomReportCriteria(classroomId);
    await this.deleteClassroomNoticesByClassroom(classroomId);
    await this.deleteClassroomDiscussionsByClassroom(classroomId);
    await this.deleteClassroomMembershipsByClassroom(classroomId);

    await this.deleteWeeksBulk(weekIds);
  }

  private isNoticeVisibleToStudents(notice: ClassroomNotice, atIso = now()): boolean {
    return notice.status === "PUBLISHED" && (!notice.publishAt || notice.publishAt <= atIso);
  }

  private isNoticeVisibleToViewer(
    notice: ClassroomNotice,
    options: { includeHidden?: boolean; atIso?: string } = {}
  ): boolean {
    return options.includeHidden ? true : this.isNoticeVisibleToStudents(notice, options.atIso);
  }

  private normalizeNoticePublishState(
    notice: Omit<ClassroomNotice, "publishedAt"> & { publishedAt?: string },
    atIso = now()
  ): ClassroomNotice {
    if (notice.status !== "PUBLISHED") {
      const { publishedAt: _publishedAt, ...rest } = notice;
      return rest;
    }
    if (notice.publishAt && notice.publishAt > atIso) {
      const { publishedAt: _publishedAt, ...rest } = notice;
      return rest;
    }
    return {
      ...notice,
      publishedAt: notice.publishedAt ?? atIso
    };
  }

  private withNoticeLocks<T>(fn: () => Promise<T>): Promise<T> {
    return this.withFileLock(this.paths.classroomNotices, () =>
      this.withFileLock(this.paths.classroomNoticeComments, fn)
    );
  }

  private reconcileNoticeCommentsUnsafe(
    notices: ClassroomNotice[],
    comments: ClassroomNoticeComment[]
  ): { comments: ClassroomNoticeComment[]; changed: boolean } {
    const noticeKeys = new Set(
      notices.map((notice) => `${notice.classroomId}:${notice.id}`)
    );
    let next = comments.filter((comment) =>
      noticeKeys.has(`${comment.classroomId}:${comment.noticeId}`)
    );
    let changed = next.length !== comments.length;

    while (true) {
      const scopedCommentIds = new Set(
        next.map((comment) => `${comment.classroomId}:${comment.noticeId}:${comment.id}`)
      );
      const filtered = next.filter(
        (comment) =>
          !comment.parentCommentId ||
          scopedCommentIds.has(
            `${comment.classroomId}:${comment.noticeId}:${comment.parentCommentId}`
          )
      );
      if (filtered.length === next.length) break;
      next = filtered;
      changed = true;
    }

    return { comments: next, changed };
  }

  private collectNoticeCommentDescendantIds(
    comments: ClassroomNoticeComment[],
    targetId: string
  ): Set<string> {
    const removed = new Set<string>([targetId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const comment of comments) {
        if (comment.parentCommentId && removed.has(comment.parentCommentId) && !removed.has(comment.id)) {
          removed.add(comment.id);
          changed = true;
        }
      }
    }
    return removed;
  }

  async listClassroomNotices(
    classroomId: string,
    options: { includeHidden?: boolean; atIso?: string } = {}
  ): Promise<ClassroomNotice[]> {
    const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
    return notices
      .filter((notice) => notice.classroomId === classroomId)
      .filter((notice) =>
        options.includeHidden ? true : this.isNoticeVisibleToStudents(notice, options.atIso)
      )
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  async getClassroomNotice(
    classroomId: string,
    noticeId: string,
    options: { includeHidden?: boolean; atIso?: string } = {}
  ): Promise<ClassroomNotice | null> {
    const notices = await this.listClassroomNotices(classroomId, options);
    return notices.find((notice) => notice.id === noticeId) ?? null;
  }

  async createClassroomNotice(input: {
    classroomId: string;
    authorUserId: string;
    title: string;
    contentMarkdown: string;
    category: ClassroomNoticeCategory;
    priority: ClassroomNoticePriority;
    target: ClassroomNoticeTarget;
    pinned: boolean;
    status: ClassroomNoticeStatus;
    publishAt?: string;
    attachments: ClassroomNoticeAttachment[];
  }): Promise<ClassroomNotice> {
    return this.withFileLock(this.paths.classroomNotices, async () => {
      const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
      const currentTime = now();
      const item = this.normalizeNoticePublishState(
        {
          id: id("ntc"),
          classroomId: input.classroomId,
          authorUserId: input.authorUserId,
          title: input.title,
          contentMarkdown: input.contentMarkdown,
          category: input.category,
          priority: input.priority,
          target: input.target,
          pinned: input.pinned,
          status: input.status,
          publishAt: input.publishAt,
          attachments: copy(input.attachments),
          createdAt: currentTime,
          updatedAt: currentTime
        },
        currentTime
      );
      notices.push(item);
      await atomicWrite(this.paths.classroomNotices, notices);
      return item;
    });
  }

  async updateClassroomNotice(
    classroomId: string,
    noticeId: string,
    patch: {
      title?: string;
      contentMarkdown?: string;
      category?: ClassroomNoticeCategory;
      priority?: ClassroomNoticePriority;
      target?: ClassroomNoticeTarget;
      pinned?: boolean;
      status?: ClassroomNoticeStatus;
      publishAt?: string | null;
      attachments?: ClassroomNoticeAttachment[];
    }
  ): Promise<ClassroomNotice | null> {
    return this.withFileLock(this.paths.classroomNotices, async () => {
      const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
      const index = notices.findIndex(
        (notice) => notice.classroomId === classroomId && notice.id === noticeId
      );
      if (index === -1) return null;
      const current = notices[index];
      const currentTime = now();
      const nextPublishAt = Object.prototype.hasOwnProperty.call(patch, "publishAt")
        ? patch.publishAt ?? undefined
        : current.publishAt;
      const updated = this.normalizeNoticePublishState(
        {
          ...current,
          ...patch,
          target: patch.target ?? current.target,
          publishAt: nextPublishAt,
          attachments: patch.attachments ? copy(patch.attachments) : current.attachments,
          updatedAt: currentTime
        },
        currentTime
      );
      notices[index] = updated;
      await atomicWrite(this.paths.classroomNotices, notices);
      return updated;
    });
  }

  async deleteClassroomNotice(classroomId: string, noticeId: string): Promise<boolean> {
    return this.withNoticeLocks(async () => {
      const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
      const nextNotices = notices.filter(
        (notice) => !(notice.classroomId === classroomId && notice.id === noticeId)
      );
      if (nextNotices.length === notices.length) return false;
      const comments = await readJson<ClassroomNoticeComment[]>(
        this.paths.classroomNoticeComments,
        []
      );
      await atomicWrite(this.paths.classroomNotices, nextNotices);
      await atomicWrite(
        this.paths.classroomNoticeComments,
        comments.filter(
          (comment) => !(comment.classroomId === classroomId && comment.noticeId === noticeId)
        )
      );
      return true;
    });
  }

  async deleteClassroomNoticesByClassroom(classroomId: string): Promise<void> {
    await this.withNoticeLocks(async () => {
      const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
      const removedIds = new Set(
        notices.filter((notice) => notice.classroomId === classroomId).map((notice) => notice.id)
      );
      await atomicWrite(
        this.paths.classroomNotices,
        notices.filter((notice) => notice.classroomId !== classroomId)
      );
      if (removedIds.size === 0) return;
      const comments = await readJson<ClassroomNoticeComment[]>(
        this.paths.classroomNoticeComments,
        []
      );
      await atomicWrite(
        this.paths.classroomNoticeComments,
        comments.filter(
          (comment) => !(comment.classroomId === classroomId && removedIds.has(comment.noticeId))
        )
      );
    });
  }

  async listClassroomNoticeComments(
    classroomId: string,
    noticeId: string
  ): Promise<ClassroomNoticeComment[]> {
    return this.withNoticeLocks(async () => {
      const [notices, storedComments] = await Promise.all([
        readJson<ClassroomNotice[]>(this.paths.classroomNotices, []),
        readJson<ClassroomNoticeComment[]>(this.paths.classroomNoticeComments, [])
      ]);
      const reconciled = this.reconcileNoticeCommentsUnsafe(notices, storedComments);
      if (reconciled.changed) {
        await atomicWrite(this.paths.classroomNoticeComments, reconciled.comments);
      }
      return reconciled.comments
        .filter((comment) => comment.classroomId === classroomId && comment.noticeId === noticeId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }

  async getClassroomNoticeComment(
    classroomId: string,
    noticeId: string,
    commentId: string
  ): Promise<ClassroomNoticeComment | null> {
    const comments = await this.listClassroomNoticeComments(classroomId, noticeId);
    return comments.find((comment) => comment.id === commentId) ?? null;
  }

  async createClassroomNoticeComment(input: {
    classroomId: string;
    noticeId: string;
    authorUserId: string;
    parentCommentId?: string;
    contentMarkdown: string;
    visibility?: { includeHidden?: boolean; atIso?: string };
  }): Promise<NoticeCommentCreateResult> {
    return this.withNoticeLocks(async () => {
      const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
      const notice = notices.find(
        (item) => item.classroomId === input.classroomId && item.id === input.noticeId
      );
      if (!notice || !this.isNoticeVisibleToViewer(notice, input.visibility)) {
        return { ok: false, reason: "NOTICE_NOT_FOUND_OR_HIDDEN" };
      }

      const storedComments = await readJson<ClassroomNoticeComment[]>(
        this.paths.classroomNoticeComments,
        []
      );
      const reconciled = this.reconcileNoticeCommentsUnsafe(notices, storedComments);
      let comments = reconciled.comments;
      if (input.parentCommentId) {
        const parent = comments.find(
          (comment) =>
            comment.classroomId === input.classroomId &&
            comment.noticeId === input.noticeId &&
            comment.id === input.parentCommentId
        );
        if (!parent) return { ok: false, reason: "PARENT_NOT_FOUND" };
        if (parent.parentCommentId) return { ok: false, reason: "REPLY_DEPTH" };
      }
      const currentTime = now();
      const item: ClassroomNoticeComment = {
        id: id("ntcc"),
        classroomId: input.classroomId,
        noticeId: input.noticeId,
        authorUserId: input.authorUserId,
        parentCommentId: input.parentCommentId,
        contentMarkdown: input.contentMarkdown,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      comments.push(item);
      await atomicWrite(this.paths.classroomNoticeComments, comments);
      return { ok: true, comment: item };
    });
  }

  async updateClassroomNoticeComment(
    classroomId: string,
    noticeId: string,
    commentId: string,
    patch: { contentMarkdown: string },
    visibility: { includeHidden?: boolean; atIso?: string } = {}
  ): Promise<ClassroomNoticeComment | null> {
    return this.withNoticeLocks(async () => {
      const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
      const notice = notices.find((item) => item.classroomId === classroomId && item.id === noticeId);
      if (!notice || !this.isNoticeVisibleToViewer(notice, visibility)) return null;

      const storedComments = await readJson<ClassroomNoticeComment[]>(
        this.paths.classroomNoticeComments,
        []
      );
      const reconciled = this.reconcileNoticeCommentsUnsafe(notices, storedComments);
      const comments = reconciled.comments;
      const index = comments.findIndex(
        (comment) =>
          comment.classroomId === classroomId &&
          comment.noticeId === noticeId &&
          comment.id === commentId
      );
      if (index === -1) {
        if (reconciled.changed) {
          await atomicWrite(this.paths.classroomNoticeComments, comments);
        }
        return null;
      }
      const updated: ClassroomNoticeComment = {
        ...comments[index],
        contentMarkdown: patch.contentMarkdown,
        updatedAt: now()
      };
      comments[index] = updated;
      await atomicWrite(this.paths.classroomNoticeComments, comments);
      return updated;
    });
  }

  async deleteClassroomNoticeComment(
    classroomId: string,
    noticeId: string,
    commentId: string,
    visibility: { includeHidden?: boolean; atIso?: string } = {}
  ): Promise<boolean> {
    return this.withNoticeLocks(async () => {
      const notices = await readJson<ClassroomNotice[]>(this.paths.classroomNotices, []);
      const notice = notices.find((item) => item.classroomId === classroomId && item.id === noticeId);
      if (!notice || !this.isNoticeVisibleToViewer(notice, visibility)) return false;

      const storedComments = await readJson<ClassroomNoticeComment[]>(
        this.paths.classroomNoticeComments,
        []
      );
      const reconciled = this.reconcileNoticeCommentsUnsafe(notices, storedComments);
      const comments = reconciled.comments;
      const target = comments.find(
        (comment) =>
          comment.classroomId === classroomId &&
          comment.noticeId === noticeId &&
          comment.id === commentId
      );
      if (!target) {
        if (reconciled.changed) {
          await atomicWrite(this.paths.classroomNoticeComments, comments);
        }
        return false;
      }
      const removedIds = this.collectNoticeCommentDescendantIds(
        comments.filter(
          (comment) => comment.classroomId === classroomId && comment.noticeId === noticeId
        ),
        target.id
      );
      await atomicWrite(
        this.paths.classroomNoticeComments,
        comments.filter(
          (comment) =>
            !(
              comment.classroomId === classroomId &&
              comment.noticeId === noticeId &&
              removedIds.has(comment.id)
            )
        )
      );
      return true;
    });
  }

  private isDiscussionVisibleToViewer(
    post: ClassroomDiscussionPost,
    options: { includeAllForTeacher?: boolean; viewerUserId?: string } = {}
  ): boolean {
    if (options.includeAllForTeacher) return true;
    return post.status === "PUBLISHED" || post.authorUserId === options.viewerUserId;
  }

  private normalizeDiscussionPublishState(
    post: Omit<ClassroomDiscussionPost, "publishedAt"> & { publishedAt?: string },
    atIso = now()
  ): ClassroomDiscussionPost {
    if (post.status !== "PUBLISHED") {
      const { publishedAt: _publishedAt, ...rest } = post;
      return rest;
    }
    return {
      ...post,
      publishedAt: post.publishedAt ?? atIso
    };
  }

  private withDiscussionLocks<T>(fn: () => Promise<T>): Promise<T> {
    return this.withFileLock(this.paths.classroomDiscussions, () =>
      this.withFileLock(this.paths.classroomDiscussionComments, fn)
    );
  }

  private withDiscussionViewLocks<T>(fn: () => Promise<T>): Promise<T> {
    return this.withFileLock(this.paths.classroomDiscussions, () =>
      this.withFileLock(this.paths.classroomDiscussionViews, fn)
    );
  }

  private withDiscussionDeletionLocks<T>(fn: () => Promise<T>): Promise<T> {
    return this.withFileLock(this.paths.classroomDiscussions, () =>
      this.withFileLock(this.paths.classroomDiscussionComments, () =>
        this.withFileLock(this.paths.classroomDiscussionViews, fn)
      )
    );
  }

  private collapseDiscussionViewReceipts(
    receipts: ClassroomDiscussionViewReceipt[],
    key: { classroomId: string; postId: string; viewerUserId: string },
    replacement: ClassroomDiscussionViewReceipt
  ): ClassroomDiscussionViewReceipt[] {
    return [
      ...receipts.filter(
        (receipt) =>
          !(
            receipt.classroomId === key.classroomId &&
            receipt.postId === key.postId &&
            receipt.viewerUserId === key.viewerUserId
          )
      ),
      replacement
    ];
  }

  async listClassroomDiscussions(
    classroomId: string,
    options: { includeAllForTeacher?: boolean; viewerUserId?: string } = {}
  ): Promise<ClassroomDiscussionPost[]> {
    const posts = await readJson<ClassroomDiscussionPost[]>(this.paths.classroomDiscussions, []);
    return posts
      .filter((post) => post.classroomId === classroomId)
      .filter((post) => this.isDiscussionVisibleToViewer(post, options))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  async getClassroomDiscussion(
    classroomId: string,
    postId: string,
    options: { includeAllForTeacher?: boolean; viewerUserId?: string } = {}
  ): Promise<ClassroomDiscussionPost | null> {
    const posts = await this.listClassroomDiscussions(classroomId, options);
    return posts.find((post) => post.id === postId) ?? null;
  }

  async getAndTouchClassroomDiscussion(
    classroomId: string,
    postId: string,
    options: { includeAllForTeacher?: boolean; viewerUserId: string }
  ): Promise<ClassroomDiscussionPost | null> {
    if (!options.viewerUserId) {
      throw new Error("viewerUserId is required to touch a discussion view");
    }

    return this.withDiscussionViewLocks(async () => {
      const posts = await readJson<ClassroomDiscussionPost[]>(
        this.paths.classroomDiscussions,
        []
      );
      const index = posts.findIndex((post) => post.classroomId === classroomId && post.id === postId);
      if (index === -1) return null;
      const current = posts[index];
      if (!this.isDiscussionVisibleToViewer(current, options)) return null;
      if (current.status !== "PUBLISHED") return current;

      const currentTime = now();
      const currentMs = new Date(currentTime).getTime();
      const receipts = await readExistingJsonStrict<ClassroomDiscussionViewReceipt[]>(
        this.paths.classroomDiscussionViews
      );
      const key = { classroomId, postId, viewerUserId: options.viewerUserId };
      const matching = receipts.filter(
        (receipt) =>
          receipt.classroomId === classroomId &&
          receipt.postId === postId &&
          receipt.viewerUserId === options.viewerUserId
      );
      const parsed = matching.map((receipt) => {
        const viewedMs =
          typeof receipt.lastViewedAt === "string"
            ? new Date(receipt.lastViewedAt).getTime()
            : Number.NaN;
        return { receipt, viewedMs };
      });
      const hasInvalid = parsed.some(({ viewedMs }) => !Number.isFinite(viewedMs));
      const hasFuture = parsed.some(({ viewedMs }) => Number.isFinite(viewedMs) && viewedMs > currentMs);

      if (hasInvalid || hasFuture) {
        await atomicWrite(
          this.paths.classroomDiscussionViews,
          this.collapseDiscussionViewReceipts(receipts, key, {
            ...key,
            lastViewedAt: currentTime
          })
        );
        return current;
      }

      const fresh = parsed.filter(
        ({ viewedMs }) => currentMs - viewedMs <= DISCUSSION_VIEW_THROTTLE_MS
      );
      if (fresh.length > 0) {
        if (matching.length > 1) {
          const latest = fresh.reduce((best, item) =>
            item.viewedMs > best.viewedMs ? item : best
          );
          await atomicWrite(
            this.paths.classroomDiscussionViews,
            this.collapseDiscussionViewReceipts(receipts, key, {
              ...key,
              lastViewedAt: latest.receipt.lastViewedAt
            })
          );
        }
        return current;
      }

      const previousReceipts = copy(receipts);
      const nextReceipts = this.collapseDiscussionViewReceipts(receipts, key, {
        ...key,
        lastViewedAt: currentTime
      });
      const touched: ClassroomDiscussionPost = {
        ...current,
        viewCount: Math.max(0, current.viewCount ?? 0) + 1
      };
      posts[index] = touched;
      await atomicWrite(this.paths.classroomDiscussionViews, nextReceipts);
      try {
        await atomicWrite(this.paths.classroomDiscussions, posts);
      } catch (error) {
        await atomicWrite(this.paths.classroomDiscussionViews, previousReceipts).catch(
          () => undefined
        );
        throw error;
      }
      return touched;
    });
  }

  async createClassroomDiscussion(input: {
    classroomId: string;
    authorUserId: string;
    title: string;
    contentMarkdown: string;
    category: ClassroomDiscussionCategory;
    visibility: ClassroomDiscussionVisibility;
    pinned: boolean;
    anonymous: boolean;
    allowComments: boolean;
    status: ClassroomDiscussionStatus;
    attachments: ClassroomDiscussionAttachment[];
  }): Promise<ClassroomDiscussionPost> {
    return this.withFileLock(this.paths.classroomDiscussions, async () => {
      const posts = await readJson<ClassroomDiscussionPost[]>(this.paths.classroomDiscussions, []);
      const currentTime = now();
      const item = this.normalizeDiscussionPublishState(
        {
          id: id("dsc"),
          classroomId: input.classroomId,
          authorUserId: input.authorUserId,
          title: input.title,
          contentMarkdown: input.contentMarkdown,
          category: input.category,
          visibility: input.visibility,
          pinned: input.pinned,
          anonymous: input.anonymous,
          allowComments: input.allowComments,
          status: input.status,
          attachments: copy(input.attachments),
          viewCount: 0,
          createdAt: currentTime,
          updatedAt: currentTime
        },
        currentTime
      );
      posts.push(item);
      await atomicWrite(this.paths.classroomDiscussions, posts);
      return item;
    });
  }

  async updateClassroomDiscussion(
    classroomId: string,
    postId: string,
    patch: {
      title?: string;
      contentMarkdown?: string;
      category?: ClassroomDiscussionCategory;
      visibility?: ClassroomDiscussionVisibility;
      pinned?: boolean;
      anonymous?: boolean;
      allowComments?: boolean;
      status?: ClassroomDiscussionStatus;
      attachments?: ClassroomDiscussionAttachment[];
    }
  ): Promise<ClassroomDiscussionPost | null> {
    return this.withFileLock(this.paths.classroomDiscussions, async () => {
      const posts = await readJson<ClassroomDiscussionPost[]>(this.paths.classroomDiscussions, []);
      const index = posts.findIndex((post) => post.classroomId === classroomId && post.id === postId);
      if (index === -1) return null;
      const current = posts[index];
      const updated = this.normalizeDiscussionPublishState(
        {
          ...current,
          ...patch,
          attachments: patch.attachments ? copy(patch.attachments) : current.attachments,
          updatedAt: now()
        },
        now()
      );
      posts[index] = updated;
      await atomicWrite(this.paths.classroomDiscussions, posts);
      return updated;
    });
  }

  async deleteClassroomDiscussion(classroomId: string, postId: string): Promise<boolean> {
    return this.withDiscussionDeletionLocks(async () => {
      const posts = await readJson<ClassroomDiscussionPost[]>(this.paths.classroomDiscussions, []);
      const nextPosts = posts.filter((post) => !(post.classroomId === classroomId && post.id === postId));
      if (nextPosts.length === posts.length) return false;
      const comments = await readJson<ClassroomDiscussionComment[]>(
        this.paths.classroomDiscussionComments,
        []
      );
      const receipts = await readJson<ClassroomDiscussionViewReceipt[]>(
        this.paths.classroomDiscussionViews,
        []
      );
      await atomicWrite(this.paths.classroomDiscussions, nextPosts);
      await atomicWrite(
        this.paths.classroomDiscussionComments,
        comments.filter(
          (comment) => !(comment.classroomId === classroomId && comment.postId === postId)
        )
      );
      await atomicWrite(
        this.paths.classroomDiscussionViews,
        receipts.filter(
          (receipt) => !(receipt.classroomId === classroomId && receipt.postId === postId)
        )
      );
      return true;
    });
  }

  async deleteClassroomDiscussionsByClassroom(classroomId: string): Promise<void> {
    await this.withDiscussionDeletionLocks(async () => {
      const posts = await readJson<ClassroomDiscussionPost[]>(this.paths.classroomDiscussions, []);
      const removedPostIds = new Set(
        posts.filter((post) => post.classroomId === classroomId).map((post) => post.id)
      );
      const comments = await readJson<ClassroomDiscussionComment[]>(
        this.paths.classroomDiscussionComments,
        []
      );
      const receipts = await readJson<ClassroomDiscussionViewReceipt[]>(
        this.paths.classroomDiscussionViews,
        []
      );
      await atomicWrite(
        this.paths.classroomDiscussions,
        posts.filter((post) => post.classroomId !== classroomId)
      );
      await atomicWrite(
        this.paths.classroomDiscussionComments,
        comments.filter(
          (comment) => !(comment.classroomId === classroomId && removedPostIds.has(comment.postId))
        )
      );
      await atomicWrite(
        this.paths.classroomDiscussionViews,
        receipts.filter((receipt) => receipt.classroomId !== classroomId)
      );
    });
  }

  async listClassroomDiscussionComments(
    classroomId: string,
    postId: string
  ): Promise<ClassroomDiscussionComment[]> {
    const comments = await readJson<ClassroomDiscussionComment[]>(
      this.paths.classroomDiscussionComments,
      []
    );
    return comments
      .filter((comment) => comment.classroomId === classroomId && comment.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getClassroomDiscussionComment(
    classroomId: string,
    postId: string,
    commentId: string
  ): Promise<ClassroomDiscussionComment | null> {
    const comments = await this.listClassroomDiscussionComments(classroomId, postId);
    return comments.find((comment) => comment.id === commentId) ?? null;
  }

  async createClassroomDiscussionComment(input: {
    classroomId: string;
    postId: string;
    authorUserId: string;
    parentCommentId?: string;
    contentMarkdown: string;
    viewerOptions: { includeAllForTeacher?: boolean; viewerUserId?: string };
  }): Promise<DiscussionCommentCreateResult> {
    return this.withDiscussionLocks(async () => {
      const posts = await readJson<ClassroomDiscussionPost[]>(this.paths.classroomDiscussions, []);
      const post = posts.find(
        (item) => item.classroomId === input.classroomId && item.id === input.postId
      );
      if (!post || !this.isDiscussionVisibleToViewer(post, input.viewerOptions)) {
        return { ok: false, reason: "POST_NOT_FOUND" };
      }
      if (post.status !== "PUBLISHED") return { ok: false, reason: "DRAFT_POST" };
      if (!post.allowComments) return { ok: false, reason: "COMMENTS_DISABLED" };

      const comments = await readJson<ClassroomDiscussionComment[]>(
        this.paths.classroomDiscussionComments,
        []
      );
      if (input.parentCommentId) {
        const parent = comments.find(
          (comment) =>
            comment.classroomId === input.classroomId &&
            comment.postId === input.postId &&
            comment.id === input.parentCommentId
        );
        if (!parent) return { ok: false, reason: "PARENT_NOT_FOUND" };
        if (parent.parentCommentId) return { ok: false, reason: "REPLY_DEPTH" };
      }

      const currentTime = now();
      const comment: ClassroomDiscussionComment = {
        id: id("dscc"),
        classroomId: input.classroomId,
        postId: input.postId,
        authorUserId: input.authorUserId,
        parentCommentId: input.parentCommentId,
        contentMarkdown: input.contentMarkdown,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      comments.push(comment);
      await atomicWrite(this.paths.classroomDiscussionComments, comments);
      return { ok: true, comment };
    });
  }

  async updateClassroomDiscussionComment(
    classroomId: string,
    postId: string,
    commentId: string,
    patch: { contentMarkdown: string }
  ): Promise<ClassroomDiscussionComment | null> {
    return this.withFileLock(this.paths.classroomDiscussionComments, async () => {
      const comments = await readJson<ClassroomDiscussionComment[]>(
        this.paths.classroomDiscussionComments,
        []
      );
      const index = comments.findIndex(
        (comment) =>
          comment.classroomId === classroomId &&
          comment.postId === postId &&
          comment.id === commentId
      );
      if (index === -1) return null;
      const updated: ClassroomDiscussionComment = {
        ...comments[index],
        contentMarkdown: patch.contentMarkdown,
        updatedAt: now()
      };
      comments[index] = updated;
      await atomicWrite(this.paths.classroomDiscussionComments, comments);
      return updated;
    });
  }

  async deleteClassroomDiscussionComment(
    classroomId: string,
    postId: string,
    commentId: string
  ): Promise<boolean> {
    return this.withDiscussionLocks(async () => {
      const comments = await readJson<ClassroomDiscussionComment[]>(
        this.paths.classroomDiscussionComments,
        []
      );
      const target = comments.find(
        (comment) =>
          comment.classroomId === classroomId &&
          comment.postId === postId &&
          comment.id === commentId
      );
      if (!target) return false;
      const next = comments.filter(
        (comment) =>
          !(
            comment.classroomId === classroomId &&
            comment.postId === postId &&
            (comment.id === commentId || comment.parentCommentId === commentId)
          )
      );
      await atomicWrite(this.paths.classroomDiscussionComments, next);
      return true;
    });
  }

  async listClassroomsForUser(user: User): Promise<Classroom[]> {
    const classrooms = await this.listClassrooms();
    if (user.role === "teacher") {
      return classrooms.filter((classroom) => classroom.teacherId === user.id);
    }

    const enrollments = await this.listEnrollmentsByStudent(user.id);
    const classroomIds = new Set(enrollments.map((item) => item.classroomId));
    return classrooms.filter((classroom) => classroomIds.has(classroom.id));
  }

  async claimLegacyClassroomsForTeacher(
    teacherId: string,
    bootstrapSecret: string | undefined,
    providedSecret: string | undefined
  ): Promise<number> {
    if (!bootstrapSecret || providedSecret !== bootstrapSecret) {
      throw new Error("Bootstrap secret is required");
    }
    return this.withFileLock(this.paths.classrooms, async () => {
      const classrooms = await this.listClassrooms();
      let claimed = 0;
      const updated = classrooms.map((classroom) => {
        if (classroom.teacherId) return classroom;
        claimed += 1;
        return {
          ...classroom,
          teacherId,
          updatedAt: now()
        };
      });
      await atomicWrite(this.paths.classrooms, updated);
      return claimed;
    });
  }

  async listClassroomReports(): Promise<StudentCompetencyReport[]> {
    return readJson<StudentCompetencyReport[]>(this.paths.classroomReports, []);
  }

  async getClassroomReport(classroomId: string): Promise<StudentCompetencyReport | null> {
    const reports = await this.listClassroomReports();
    return (
      reports.find(
        (report) =>
          report.classroomId === classroomId &&
          (report.reportScope ?? "CLASSROOM_AGGREGATE") === "CLASSROOM_AGGREGATE"
      ) ?? null
    );
  }

  async getStudentClassroomReport(
    classroomId: string,
    studentUserId: string
  ): Promise<StudentCompetencyReport | null> {
    const reports = await this.listClassroomReports();
    return (
      reports.find(
        (report) =>
          report.classroomId === classroomId &&
          (report.reportScope ?? "CLASSROOM_AGGREGATE") === "STUDENT" &&
          report.studentUserId === studentUserId
      ) ?? null
    );
  }

  async listStudentClassroomReports(classroomId: string): Promise<StudentCompetencyReport[]> {
    const reports = await this.listClassroomReports();
    return reports.filter(
      (report) =>
        report.classroomId === classroomId &&
        (report.reportScope ?? "CLASSROOM_AGGREGATE") === "STUDENT" &&
        Boolean(report.studentUserId)
    );
  }

  async saveClassroomReport(report: StudentCompetencyReport): Promise<void> {
    await this.withFileLock(this.paths.classroomReports, async () => {
      const reports = await this.listClassroomReports();
      const scope = report.reportScope ?? "CLASSROOM_AGGREGATE";
      if (scope === "STUDENT" && !report.studentUserId) {
        throw new Error("studentUserId is required for STUDENT reports");
      }
      const normalized: StudentCompetencyReport = {
        ...report,
        reportScope: scope,
        studentUserId: scope === "STUDENT" ? report.studentUserId : undefined
      };
      const key = this.reportKey(normalized);
      const next = reports.filter((item) => this.reportKey(item) !== key);
      next.push(normalized);
      await atomicWrite(this.paths.classroomReports, next);
    });
  }

  async deleteClassroomReport(classroomId: string): Promise<void> {
    await this.withFileLock(this.paths.classroomReports, async () => {
      const reports = await this.listClassroomReports();
      await atomicWrite(
        this.paths.classroomReports,
        reports.filter((item) => item.classroomId !== classroomId)
      );
    });
  }

  async listClassroomReportCriteria(
    classroomId: string
  ): Promise<StudentReportCustomCriterion[]> {
    const criteria = await readJson<StudentReportCustomCriterion[]>(
      this.paths.classroomReportCriteria,
      []
    );
    return criteria
      .filter((item) => item.classroomId === classroomId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private ensureClassroomReportCriterionNameAvailable(
    criteria: StudentReportCustomCriterion[],
    classroomId: string,
    name: string,
    excludingCriterionId = ""
  ): void {
    const normalizedName = normalizeReportCriterionName(name);
    if (isBuiltInReportCriterionName(name)) {
      throw new ReportCriterionDuplicateError();
    }
    const duplicate = criteria.some(
      (item) =>
        item.classroomId === classroomId &&
        item.id !== excludingCriterionId &&
        normalizeReportCriterionName(item.name) === normalizedName
    );
    if (duplicate) {
      throw new ReportCriterionDuplicateError();
    }
  }

  async createClassroomReportCriterion(
    classroomId: string,
    input: { name: string; description: string }
  ): Promise<StudentReportCustomCriterion> {
    return this.withFileLock(this.paths.classroomReportCriteria, async () => {
      const criteria = await readJson<StudentReportCustomCriterion[]>(
        this.paths.classroomReportCriteria,
        []
      );
      this.ensureClassroomReportCriterionNameAvailable(criteria, classroomId, input.name);
      const currentTime = now();
      const item: StudentReportCustomCriterion = {
        id: id("crit"),
        classroomId,
        name: input.name,
        description: input.description,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      criteria.push(item);
      await atomicWrite(this.paths.classroomReportCriteria, criteria);
      return item;
    });
  }

  async updateClassroomReportCriterion(
    classroomId: string,
    criterionId: string,
    patch: { name?: string; description?: string }
  ): Promise<StudentReportCustomCriterion | null> {
    return this.withFileLock(this.paths.classroomReportCriteria, async () => {
      const criteria = await readJson<StudentReportCustomCriterion[]>(
        this.paths.classroomReportCriteria,
        []
      );
      const index = criteria.findIndex(
        (item) => item.classroomId === classroomId && item.id === criterionId
      );
      if (index === -1) return null;
      const current = criteria[index];
      const updated: StudentReportCustomCriterion = {
        ...current,
        name: patch.name ?? current.name,
        description: patch.description ?? current.description,
        updatedAt: now()
      };
      this.ensureClassroomReportCriterionNameAvailable(
        criteria,
        classroomId,
        updated.name,
        criterionId
      );
      criteria[index] = updated;
      await atomicWrite(this.paths.classroomReportCriteria, criteria);
      return updated;
    });
  }

  async deleteClassroomReportCriterion(
    classroomId: string,
    criterionId: string
  ): Promise<boolean> {
    return this.withFileLock(this.paths.classroomReportCriteria, async () => {
      const criteria = await readJson<StudentReportCustomCriterion[]>(
        this.paths.classroomReportCriteria,
        []
      );
      const next = criteria.filter(
        (item) => !(item.classroomId === classroomId && item.id === criterionId)
      );
      if (next.length === criteria.length) return false;
      await atomicWrite(this.paths.classroomReportCriteria, next);
      return true;
    });
  }

  async deleteClassroomReportCriteria(classroomId: string): Promise<void> {
    await this.withFileLock(this.paths.classroomReportCriteria, async () => {
      const criteria = await readJson<StudentReportCustomCriterion[]>(
        this.paths.classroomReportCriteria,
        []
      );
      await atomicWrite(
        this.paths.classroomReportCriteria,
        criteria.filter((item) => item.classroomId !== classroomId)
      );
    });
  }

  async listUsers(): Promise<User[]> {
    return readJson<User[]>(this.paths.users, []);
  }

  async getUser(userId: string): Promise<User | null> {
    const users = await this.listUsers();
    return users.find((user) => user.id === userId) ?? null;
  }

  async getUserByEmail(emailNormalized: string): Promise<User | null> {
    const users = await this.listUsers();
    return users.find((user) => user.emailNormalized === emailNormalized) ?? null;
  }

  async getUserByGoogleSub(googleSub: string): Promise<User | null> {
    const users = await this.listUsers();
    return users.find((user) => user.googleSub === googleSub) ?? null;
  }

  async createUser(input: Omit<User, "id" | "createdAt" | "updatedAt">): Promise<User> {
    return this.withFileLock(this.paths.users, async () => {
      const users = await this.listUsers();
      if (users.some((user) => user.emailNormalized === input.emailNormalized)) {
        throw new Error("Email already exists");
      }
      const user: User = {
        ...input,
        id: id("usr"),
        createdAt: now(),
        updatedAt: now()
      };
      users.push(user);
      await atomicWrite(this.paths.users, users);
      return user;
    });
  }

  async updateUser(userId: string, patch: Partial<User>): Promise<User | null> {
    return this.withFileLock(this.paths.users, async () => {
      const users = await this.listUsers();
      const index = users.findIndex((user) => user.id === userId);
      if (index === -1) return null;
      if (
        patch.emailNormalized &&
        users.some((user) => user.id !== userId && user.emailNormalized === patch.emailNormalized)
      ) {
        throw new Error("Email already exists");
      }
      const updated = {
        ...users[index],
        ...patch,
        id: users[index].id,
        updatedAt: now()
      } satisfies User;
      users[index] = updated;
      await atomicWrite(this.paths.users, users);
      return updated;
    });
  }

  async findStudentByInviteTag(
    displayName: string,
    inviteCode: string
  ): Promise<User | null> {
    const normalizedName = displayName.replace(/\s+/g, " ").trim().toLowerCase();
    const users = await this.listUsers();
    return (
      users.find(
        (user) =>
          user.role === "student" &&
          Boolean(user.emailVerifiedAt) &&
          user.displayName.replace(/\s+/g, " ").trim().toLowerCase() === normalizedName &&
          user.inviteCode === inviteCode
      ) ?? null
    );
  }

  async createAuthSession(input: Omit<AuthSession, "id" | "createdAt">): Promise<AuthSession> {
    return this.withFileLock(this.paths.authSessions, async () => {
      const sessions = await readJson<AuthSession[]>(this.paths.authSessions, []);
      const session: AuthSession = {
        ...input,
        id: id("auth"),
        createdAt: now()
      };
      sessions.push(session);
      await atomicWrite(this.paths.authSessions, sessions);
      return session;
    });
  }

  async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    const sessions = await readJson<AuthSession[]>(this.paths.authSessions, []);
    return sessions.find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async revokeAuthSession(sessionId: string): Promise<void> {
    await this.withFileLock(this.paths.authSessions, async () => {
      const sessions = await readJson<AuthSession[]>(this.paths.authSessions, []);
      const next = sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              revokedAt: now()
            }
          : session
      );
      await atomicWrite(this.paths.authSessions, next);
    });
  }

  async revokeAuthSessionsForUserExcept(userId: string, keepSessionId?: string): Promise<void> {
    await this.withFileLock(this.paths.authSessions, async () => {
      const sessions = await readJson<AuthSession[]>(this.paths.authSessions, []);
      const currentTime = now();
      const next = sessions.map((session) =>
        session.userId === userId && session.id !== keepSessionId && !session.revokedAt
          ? {
              ...session,
              revokedAt: currentTime
            }
          : session
      );
      await atomicWrite(this.paths.authSessions, next);
    });
  }

  async deleteExpiredAuthSessions(currentTime = now()): Promise<void> {
    await this.withFileLock(this.paths.authSessions, async () => {
      const sessions = await readJson<AuthSession[]>(this.paths.authSessions, []);
      await atomicWrite(
        this.paths.authSessions,
        sessions.filter(
          (session) => !session.revokedAt && session.expiresAt > currentTime
        )
      );
    });
  }

  async createOAuthState(input: Omit<OAuthState, "id" | "createdAt">): Promise<OAuthState> {
    return this.withFileLock(this.paths.oauthStates, async () => {
      const states = await readJson<OAuthState[]>(this.paths.oauthStates, []);
      const state: OAuthState = {
        ...input,
        id: id("oauth"),
        createdAt: now()
      };
      states.push(state);
      await atomicWrite(this.paths.oauthStates, states);
      return state;
    });
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthState | null> {
    return this.withFileLock(this.paths.oauthStates, async () => {
      const states = await readJson<OAuthState[]>(this.paths.oauthStates, []);
      const matched = states.find(
        (state) => state.stateHash === stateHash && state.expiresAt > now()
      );
      await atomicWrite(
        this.paths.oauthStates,
        states.filter((state) => state.stateHash !== stateHash)
      );
      return matched ?? null;
    });
  }

  async checkAndIncrementRateLimit(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<boolean> {
    return this.withFileLock(this.paths.rateLimits, async () => {
      const buckets = await readJson<RateLimitBucket[]>(this.paths.rateLimits, []);
      const current = now();
      const active = buckets.filter((bucket) => bucket.resetAt > current);
      const index = active.findIndex((bucket) => bucket.key === key);
      if (index === -1) {
        active.push({
          key,
          count: 1,
          resetAt: new Date(Date.now() + windowMs).toISOString()
        });
        await atomicWrite(this.paths.rateLimits, active);
        return true;
      }
      if (active[index].count >= limit) {
        await atomicWrite(this.paths.rateLimits, active);
        return false;
      }
      active[index] = {
        ...active[index],
        count: active[index].count + 1
      };
      await atomicWrite(this.paths.rateLimits, active);
      return true;
    });
  }

  private withClassroomMembershipLocks<T>(fn: () => Promise<T>): Promise<T> {
    return this.withFileLock(this.paths.classroomInvitations, () =>
      this.withFileLock(this.paths.classroomEnrollments, fn)
    );
  }

  private async recoverInvitationsFromEnrollments(): Promise<void> {
    await this.withClassroomMembershipLocks(async () => {
      const [invitations, enrollments] = await Promise.all([
        readJson<ClassroomInvitation[]>(this.paths.classroomInvitations, []),
        readJson<ClassroomEnrollment[]>(this.paths.classroomEnrollments, [])
      ]);
      const byKey = new Map<string, ClassroomInvitation>();
      const nextInvitations: ClassroomInvitation[] = [];
      let changed = false;

      for (const invitation of invitations.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const key = `${invitation.classroomId}:${invitation.studentUserId}`;
        if (byKey.has(key)) {
          changed = true;
          continue;
        }
        byKey.set(key, invitation);
        nextInvitations.push(invitation);
      }

      const earliestEnrollments = new Map<string, ClassroomEnrollment>();
      for (const enrollment of enrollments) {
        const key = `${enrollment.classroomId}:${enrollment.studentUserId}`;
        const existing = earliestEnrollments.get(key);
        if (!existing || enrollment.createdAt < existing.createdAt) {
          earliestEnrollments.set(key, enrollment);
        }
      }

      for (const enrollment of Array.from(earliestEnrollments.values())) {
        const key = `${enrollment.classroomId}:${enrollment.studentUserId}`;
        const existingInvitation = byKey.get(key);
        if (!existingInvitation) {
          const recovered: ClassroomInvitation = {
            id: id("inv"),
            classroomId: enrollment.classroomId,
            studentUserId: enrollment.studentUserId,
            invitedByTeacherId: enrollment.invitedByTeacherId,
            status: "ACCEPTED",
            createdAt: enrollment.createdAt,
            updatedAt: enrollment.createdAt,
            acceptedAt: enrollment.createdAt
          };
          byKey.set(key, recovered);
          nextInvitations.push(recovered);
          changed = true;
          continue;
        }
        if (existingInvitation.status !== "ACCEPTED" || !existingInvitation.acceptedAt) {
          const index = nextInvitations.findIndex((item) => item.id === existingInvitation.id);
          nextInvitations[index] = {
            ...existingInvitation,
            status: "ACCEPTED",
            updatedAt: existingInvitation.updatedAt ?? enrollment.createdAt,
            acceptedAt: existingInvitation.acceptedAt ?? enrollment.createdAt
          };
          changed = true;
        }
      }

      if (changed) {
        await atomicWrite(this.paths.classroomInvitations, nextInvitations);
      }
    });
  }

  async listClassroomInvitations(classroomId: string): Promise<ClassroomInvitation[]> {
    const invitations = await readJson<ClassroomInvitation[]>(
      this.paths.classroomInvitations,
      []
    );
    return invitations
      .filter((item) => item.classroomId === classroomId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listStudentClassroomInvitations(studentUserId: string): Promise<ClassroomInvitation[]> {
    const invitations = await readJson<ClassroomInvitation[]>(
      this.paths.classroomInvitations,
      []
    );
    return invitations
      .filter((item) => item.studentUserId === studentUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createClassroomInvitation(
    classroomId: string,
    studentUserId: string,
    invitedByTeacherId: string
  ): Promise<{ invitation: ClassroomInvitation; created: boolean }> {
    return this.withClassroomMembershipLocks(async () => {
      const currentTime = now();
      const [invitations, enrollments] = await Promise.all([
        readJson<ClassroomInvitation[]>(this.paths.classroomInvitations, []),
        readJson<ClassroomEnrollment[]>(this.paths.classroomEnrollments, [])
      ]);
      const index = invitations.findIndex(
        (item) => item.classroomId === classroomId && item.studentUserId === studentUserId
      );
      const enrollment = enrollments.find(
        (item) => item.classroomId === classroomId && item.studentUserId === studentUserId
      );

      if (index !== -1) {
        const existing = invitations[index];
        if (enrollment && existing.status !== "ACCEPTED") {
          const updated: ClassroomInvitation = {
            ...existing,
            status: "ACCEPTED",
            updatedAt: currentTime,
            acceptedAt: existing.acceptedAt ?? enrollment.createdAt
          };
          invitations[index] = updated;
          await atomicWrite(this.paths.classroomInvitations, invitations);
          return { invitation: updated, created: false };
        }
        return { invitation: existing, created: false };
      }

      const invitation: ClassroomInvitation = {
        id: id("inv"),
        classroomId,
        studentUserId,
        invitedByTeacherId: enrollment?.invitedByTeacherId ?? invitedByTeacherId,
        status: enrollment ? "ACCEPTED" : "PENDING",
        createdAt: enrollment?.createdAt ?? currentTime,
        updatedAt: currentTime,
        acceptedAt: enrollment?.createdAt
      };
      invitations.push(invitation);
      await atomicWrite(this.paths.classroomInvitations, invitations);
      return { invitation, created: !enrollment };
    });
  }

  async acceptClassroomInvitation(
    invitationId: string,
    studentUserId: string
  ): Promise<
    | {
        ok: true;
        invitation: ClassroomInvitation;
        enrollment: ClassroomEnrollment;
        acceptedNow: boolean;
      }
    | { ok: false; reason: "NOT_FOUND" | "FORBIDDEN" }
  > {
    return this.withClassroomMembershipLocks(async () => {
      const currentTime = now();
      const invitations = await readJson<ClassroomInvitation[]>(
        this.paths.classroomInvitations,
        []
      );
      const index = invitations.findIndex((item) => item.id === invitationId);
      if (index === -1) return { ok: false, reason: "NOT_FOUND" as const };

      const invitation = invitations[index];
      if (invitation.studentUserId !== studentUserId) {
        return { ok: false, reason: "FORBIDDEN" as const };
      }

      const classrooms = await readJson<Classroom[]>(this.paths.classrooms, []);
      if (!classrooms.some((classroom) => classroom.id === invitation.classroomId)) {
        return { ok: false, reason: "NOT_FOUND" as const };
      }

      const enrollments = await readJson<ClassroomEnrollment[]>(
        this.paths.classroomEnrollments,
        []
      );
      let enrollment = enrollments.find(
        (item) =>
          item.classroomId === invitation.classroomId &&
          item.studentUserId === invitation.studentUserId
      );
      const acceptedNow = invitation.status !== "ACCEPTED";
      const updatedInvitation: ClassroomInvitation = acceptedNow || !invitation.acceptedAt
        ? {
            ...invitation,
            status: "ACCEPTED",
            updatedAt: currentTime,
            acceptedAt: invitation.acceptedAt ?? currentTime
          }
        : invitation;
      if (!enrollment) {
        enrollment = {
          id: id("enr"),
          classroomId: invitation.classroomId,
          studentUserId: invitation.studentUserId,
          invitedByTeacherId: invitation.invitedByTeacherId,
          createdAt: updatedInvitation.acceptedAt ?? currentTime
        };
        enrollments.push(enrollment);
      }
      invitations[index] = updatedInvitation;
      await atomicWrite(this.paths.classroomInvitations, invitations);
      await atomicWrite(this.paths.classroomEnrollments, enrollments);
      return {
        ok: true as const,
        invitation: updatedInvitation,
        enrollment,
        acceptedNow
      };
    });
  }

  async deleteClassroomInvitationForStudent(
    classroomId: string,
    studentUserId: string
  ): Promise<{ deletedInvitation: boolean; deletedEnrollment: boolean }> {
    return this.withClassroomMembershipLocks(async () => {
      const [invitations, enrollments] = await Promise.all([
        readJson<ClassroomInvitation[]>(this.paths.classroomInvitations, []),
        readJson<ClassroomEnrollment[]>(this.paths.classroomEnrollments, [])
      ]);
      const nextInvitations = invitations.filter(
        (item) => !(item.classroomId === classroomId && item.studentUserId === studentUserId)
      );
      const nextEnrollments = enrollments.filter(
        (item) => !(item.classroomId === classroomId && item.studentUserId === studentUserId)
      );
      await atomicWrite(this.paths.classroomInvitations, nextInvitations);
      await atomicWrite(this.paths.classroomEnrollments, nextEnrollments);
      return {
        deletedInvitation: nextInvitations.length !== invitations.length,
        deletedEnrollment: nextEnrollments.length !== enrollments.length
      };
    });
  }

  async deleteClassroomMembershipsByClassroom(classroomId: string): Promise<void> {
    await this.withClassroomMembershipLocks(async () => {
      const [invitations, enrollments] = await Promise.all([
        readJson<ClassroomInvitation[]>(this.paths.classroomInvitations, []),
        readJson<ClassroomEnrollment[]>(this.paths.classroomEnrollments, [])
      ]);
      await atomicWrite(
        this.paths.classroomInvitations,
        invitations.filter((item) => item.classroomId !== classroomId)
      );
      await atomicWrite(
        this.paths.classroomEnrollments,
        enrollments.filter((item) => item.classroomId !== classroomId)
      );
    });
  }

  async deleteClassroomInvitationsByClassroom(classroomId: string): Promise<void> {
    await this.withFileLock(this.paths.classroomInvitations, async () => {
      const invitations = await readJson<ClassroomInvitation[]>(
        this.paths.classroomInvitations,
        []
      );
      await atomicWrite(
        this.paths.classroomInvitations,
        invitations.filter((item) => item.classroomId !== classroomId)
      );
    });
  }

  async listEnrollmentsByClassroom(classroomId: string): Promise<ClassroomEnrollment[]> {
    const enrollments = await readJson<ClassroomEnrollment[]>(
      this.paths.classroomEnrollments,
      []
    );
    return enrollments.filter((item) => item.classroomId === classroomId);
  }

  async listEnrollmentsByStudent(studentUserId: string): Promise<ClassroomEnrollment[]> {
    const enrollments = await readJson<ClassroomEnrollment[]>(
      this.paths.classroomEnrollments,
      []
    );
    return enrollments.filter((item) => item.studentUserId === studentUserId);
  }

  async isStudentEnrolled(classroomId: string, studentUserId: string): Promise<boolean> {
    const enrollments = await this.listEnrollmentsByClassroom(classroomId);
    return enrollments.some((item) => item.studentUserId === studentUserId);
  }

  async enrollStudent(
    classroomId: string,
    studentUserId: string,
    invitedByTeacherId: string
  ): Promise<ClassroomEnrollment> {
    return this.withFileLock(this.paths.classroomEnrollments, async () => {
      const enrollments = await readJson<ClassroomEnrollment[]>(
        this.paths.classroomEnrollments,
        []
      );
      const existing = enrollments.find(
        (item) => item.classroomId === classroomId && item.studentUserId === studentUserId
      );
      if (existing) return existing;
      const enrollment: ClassroomEnrollment = {
        id: id("enr"),
        classroomId,
        studentUserId,
        invitedByTeacherId,
        createdAt: now()
      };
      enrollments.push(enrollment);
      await atomicWrite(this.paths.classroomEnrollments, enrollments);
      return enrollment;
    });
  }

  async removeEnrollment(classroomId: string, studentUserId: string): Promise<void> {
    await this.withFileLock(this.paths.classroomEnrollments, async () => {
      const enrollments = await readJson<ClassroomEnrollment[]>(
        this.paths.classroomEnrollments,
        []
      );
      await atomicWrite(
        this.paths.classroomEnrollments,
        enrollments.filter(
          (item) =>
            !(item.classroomId === classroomId && item.studentUserId === studentUserId)
        )
      );
    });
  }

  async deleteEnrollmentsByClassroom(classroomId: string): Promise<void> {
    await this.withFileLock(this.paths.classroomEnrollments, async () => {
      const enrollments = await readJson<ClassroomEnrollment[]>(
        this.paths.classroomEnrollments,
        []
      );
      await atomicWrite(
        this.paths.classroomEnrollments,
        enrollments.filter((item) => item.classroomId !== classroomId)
      );
    });
  }

  private withTeacherExamLocks<T>(fn: () => Promise<T>): Promise<T> {
    return this.withFileLock(this.paths.teacherExams, () =>
      this.withFileLock(this.paths.teacherExamAttempts, () =>
        this.withFileLock(this.paths.teacherExamResults, fn)
      )
    );
  }

  private withWeekAndTeacherExamLocks<T>(fn: () => Promise<T>): Promise<T> {
    return this.withFileLock(this.paths.weeks, () => this.withTeacherExamLocks(fn));
  }

  private async readTeacherExamsUnsafe(): Promise<TeacherExam[]> {
    return readJson<TeacherExam[]>(this.paths.teacherExams, []);
  }

  private effectiveTeacherExamRevision(exam: TeacherExam): TeacherExamRevision {
    return exam.publishedRevision ?? exam.draftRevision;
  }

  private assertTeacherExamMutationAllowed(
    exam: TeacherExam,
    guard?: TeacherExamMutationGuardOptions
  ): void {
    if (!guard?.rejectEnded) return;
    const nowMs = guard.nowMs;
    if (!Number.isFinite(nowMs)) return;
    const endMs = Date.parse(this.effectiveTeacherExamRevision(exam).availableUntil);
    if (Number.isFinite(endMs) && nowMs! > endMs) {
      throw new TeacherExamMutationBlockedError("ENDED");
    }
  }

  private async readTeacherExamAttemptsUnsafe(): Promise<TeacherExamAttempt[]> {
    return readJson<TeacherExamAttempt[]>(this.paths.teacherExamAttempts, []);
  }

  private async readTeacherExamResultsUnsafe(): Promise<TeacherExamResultRecord[]> {
    return readJson<TeacherExamResultRecord[]>(this.paths.teacherExamResults, []);
  }

  private teacherExamResultId(attemptId: string, submissionId: string): string {
    return `ter_${attemptId}_${submissionId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private buildTeacherExamResultRecordUnsafe(input: {
    exam: TeacherExam;
    attempt: TeacherExamAttempt;
    generatedAt: string;
  }): TeacherExamResultRecord | null {
    if (input.attempt.status !== "GRADED" || !input.attempt.submissionId || !input.attempt.grading) {
      return null;
    }
    return {
      id: this.teacherExamResultId(input.attempt.id, input.attempt.submissionId),
      schemaVersion: "1.0",
      examId: input.attempt.examId,
      classroomId: input.exam.classroomId,
      weekId: input.exam.weekId,
      attemptId: input.attempt.id,
      submissionId: input.attempt.submissionId,
      studentUserId: input.attempt.studentUserId,
      examVersion: input.attempt.examVersion,
      generatedAt: input.generatedAt,
      examTitle: input.attempt.settingsSnapshot.title,
      settingsSnapshot: copy(input.attempt.settingsSnapshot),
      answers: copy(input.attempt.answers),
      grading: copy(input.attempt.grading),
      questions: copy(input.attempt.examSnapshot.questions),
      submittedAt: input.attempt.submittedAt,
      gradedAt: input.attempt.gradedAt
    };
  }

  private upsertTeacherExamResultRecordUnsafe(
    records: TeacherExamResultRecord[],
    record: TeacherExamResultRecord
  ): TeacherExamResultRecord[] {
    const next = records.filter(
      (candidate) =>
        candidate.id !== record.id &&
        !(candidate.attemptId === record.attemptId && candidate.submissionId === record.submissionId)
    );
    next.push(record);
    return next;
  }

  private async reconcileTeacherExamResultsUnsafe(filter: {
    classroomId?: string;
    studentUserId?: string;
    attemptId?: string;
  } = {}): Promise<TeacherExamResultRecord[]> {
    const exams = await this.readTeacherExamsUnsafe();
    const examById = new Map(exams.map((exam) => [exam.id, exam]));
    const attempts = await this.readTeacherExamAttemptsUnsafe();
    let records = await this.readTeacherExamResultsUnsafe();
    let changed = false;

    for (const attempt of attempts) {
      if (attempt.status !== "GRADED" || !attempt.submissionId || !attempt.grading) continue;
      if (filter.attemptId && attempt.id !== filter.attemptId) continue;
      if (filter.studentUserId && attempt.studentUserId !== filter.studentUserId) continue;
      const exam = examById.get(attempt.examId);
      if (!exam) continue;
      if (filter.classroomId && exam.classroomId !== filter.classroomId) continue;
      const resultId = this.teacherExamResultId(attempt.id, attempt.submissionId);
      const hasRecord = records.some(
        (record) =>
          record.id === resultId ||
          (record.attemptId === attempt.id && record.submissionId === attempt.submissionId)
      );
      if (hasRecord) continue;
      const record = this.buildTeacherExamResultRecordUnsafe({
        exam,
        attempt,
        generatedAt: now()
      });
      if (!record) continue;
      records = this.upsertTeacherExamResultRecordUnsafe(records, record);
      changed = true;
    }

    const validExamIds = new Set(exams.map((exam) => exam.id));
    const deduped: TeacherExamResultRecord[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      if (!validExamIds.has(record.examId)) {
        changed = true;
        continue;
      }
      const key = `${record.attemptId}:${record.submissionId}`;
      if (seen.has(key)) {
        changed = true;
        continue;
      }
      seen.add(key);
      deduped.push(record);
    }

    if (changed || deduped.length !== records.length) {
      await atomicWrite(this.paths.teacherExamResults, deduped);
    }
    return deduped;
  }

  async listTeacherExamsByWeek(weekId: string): Promise<TeacherExam[]> {
    const exams = await this.readTeacherExamsUnsafe();
    return exams
      .filter((exam) => exam.weekId === weekId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getTeacherExam(examId: string): Promise<TeacherExam | null> {
    const exams = await this.readTeacherExamsUnsafe();
    return exams.find((exam) => exam.id === examId) ?? null;
  }

  async createTeacherExam(input: {
    classroomId: string;
    weekId: string;
    draftRevision: Omit<TeacherExamRevision, "version" | "createdAt" | "updatedAt">;
  }): Promise<TeacherExam | null> {
    return this.withWeekAndTeacherExamLocks(async () => {
      const weeks = await readJson<Week[]>(this.paths.weeks, []);
      const classrooms = await readJson<Classroom[]>(this.paths.classrooms, []);
      const week = weeks.find((item) => item.id === input.weekId);
      const classroom = classrooms.find((item) => item.id === input.classroomId);
      if (!week || !classroom || week.classroomId !== classroom.id) return null;

      const currentTime = now();
      const draftRevision: TeacherExamRevision = {
        ...copy(input.draftRevision),
        version: 0,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      const exam: TeacherExam = {
        id: id("exam"),
        classroomId: input.classroomId,
        weekId: input.weekId,
        status: "DRAFT",
        draftRevision,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      const exams = await this.readTeacherExamsUnsafe();
      exams.push(exam);
      await atomicWrite(this.paths.teacherExams, exams);
      return exam;
    });
  }

  async updateTeacherExamDraft(
    examId: string,
    draftRevision: Omit<TeacherExamRevision, "version" | "createdAt" | "updatedAt">,
    guard?: TeacherExamMutationGuardOptions
  ): Promise<TeacherExam | null> {
    return this.withTeacherExamLocks(async () => {
      const exams = await this.readTeacherExamsUnsafe();
      const index = exams.findIndex((exam) => exam.id === examId);
      if (index === -1) return null;
      const current = exams[index];
      this.assertTeacherExamMutationAllowed(current, guard);
      const currentTime = now();
      const existingDraft = current.draftRevision;
      const updatedDraft: TeacherExamRevision = {
        ...copy(draftRevision),
        version: existingDraft.version,
        createdAt: existingDraft.createdAt,
        updatedAt: currentTime
      };
      const updated: TeacherExam = {
        ...current,
        draftRevision: updatedDraft,
        updatedAt: currentTime
      };
      exams[index] = updated;
      await atomicWrite(this.paths.teacherExams, exams);
      return updated;
    });
  }

  async updateTeacherExamSettings(
    examId: string,
    settings: Pick<TeacherExamRevision, "title" | "availableFrom" | "availableUntil" | "timeLimitMinutes">,
    guard?: TeacherExamMutationGuardOptions
  ): Promise<TeacherExam | null> {
    return this.withTeacherExamLocks(async () => {
      const exams = await this.readTeacherExamsUnsafe();
      const index = exams.findIndex((exam) => exam.id === examId);
      if (index === -1) return null;
      const current = exams[index];
      this.assertTeacherExamMutationAllowed(current, guard);
      const currentTime = now();
      const patchRevision = (
        revision: TeacherExamRevision,
        version: number,
        createdAt = revision.createdAt
      ): TeacherExamRevision => ({
        ...revision,
        title: settings.title,
        availableFrom: settings.availableFrom,
        availableUntil: settings.availableUntil,
        timeLimitMinutes: settings.timeLimitMinutes,
        version,
        createdAt,
        updatedAt: currentTime
      });

      const next: TeacherExam = {
        ...current,
        draftRevision: patchRevision(current.draftRevision, current.draftRevision.version),
        updatedAt: currentTime
      };

      if (current.status === "PUBLISHED" && current.publishedRevision) {
        const nextPublishedVersion = (current.activePublishedVersion ?? current.publishedRevision.version) + 1;
        next.activePublishedVersion = nextPublishedVersion;
        next.publishedRevision = patchRevision(
          current.publishedRevision,
          nextPublishedVersion,
          currentTime
        );
      }

      exams[index] = next;
      await atomicWrite(this.paths.teacherExams, exams);
      return next;
    });
  }

  async publishTeacherExam(
    examId: string,
    draftRevision: Omit<TeacherExamRevision, "version" | "createdAt" | "updatedAt">,
    guard?: TeacherExamMutationGuardOptions
  ): Promise<TeacherExam | null> {
    return this.withTeacherExamLocks(async () => {
      const exams = await this.readTeacherExamsUnsafe();
      const index = exams.findIndex((exam) => exam.id === examId);
      if (index === -1) return null;
      const current = exams[index];
      this.assertTeacherExamMutationAllowed(current, guard);
      const currentTime = now();
      const nextVersion = (current.activePublishedVersion ?? 0) + 1;
      const publishedRevision: TeacherExamRevision = {
        ...copy(draftRevision),
        version: nextVersion,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      const updated: TeacherExam = {
        ...current,
        status: "PUBLISHED",
        activePublishedVersion: nextVersion,
        draftRevision: {
          ...publishedRevision,
          version: nextVersion
        },
        publishedRevision,
        updatedAt: currentTime
      };
      exams[index] = updated;
      await atomicWrite(this.paths.teacherExams, exams);
      return updated;
    });
  }

  async deleteTeacherExam(examId: string): Promise<boolean> {
    return this.withTeacherExamLocks(async () => {
      const exams = await this.readTeacherExamsUnsafe();
      const attempts = await this.readTeacherExamAttemptsUnsafe();
      const results = await this.readTeacherExamResultsUnsafe();
      const nextExams = exams.filter((exam) => exam.id !== examId);
      const changed = nextExams.length !== exams.length;
      await atomicWrite(
        this.paths.teacherExamAttempts,
        attempts.filter((attempt) => attempt.examId !== examId)
      );
      await atomicWrite(
        this.paths.teacherExamResults,
        results.filter((result) => result.examId !== examId)
      );
      if (changed) {
        await atomicWrite(this.paths.teacherExams, nextExams);
      }
      return changed;
    });
  }

  async deleteTeacherExamsByWeekIds(weekIds: string[]): Promise<void> {
    if (weekIds.length === 0) return;
    await this.withTeacherExamLocks(async () => {
      await this.deleteTeacherExamsByWeekIdsUnsafe(weekIds);
    });
  }

  private async deleteTeacherExamsByWeekIdsUnsafe(weekIds: string[]): Promise<void> {
    const weekSet = new Set(weekIds);
    const exams = await this.readTeacherExamsUnsafe();
    const removedExamIds = new Set(
      exams.filter((exam) => weekSet.has(exam.weekId)).map((exam) => exam.id)
    );
    if (removedExamIds.size === 0) {
      await this.recoverOrphanTeacherExamAttemptsUnsafe(exams);
      return;
    }
    const attempts = await this.readTeacherExamAttemptsUnsafe();
    const results = await this.readTeacherExamResultsUnsafe();
    await atomicWrite(
      this.paths.teacherExamAttempts,
      attempts.filter((attempt) => !removedExamIds.has(attempt.examId))
    );
    await atomicWrite(
      this.paths.teacherExamResults,
      results.filter((result) => !removedExamIds.has(result.examId))
    );
    await atomicWrite(
      this.paths.teacherExams,
      exams.filter((exam) => !removedExamIds.has(exam.id))
    );
  }

  private async recoverOrphanTeacherExamAttemptsUnsafe(exams: TeacherExam[]): Promise<void> {
    const examIds = new Set(exams.map((exam) => exam.id));
    const attempts = await this.readTeacherExamAttemptsUnsafe();
    const next = attempts.filter((attempt) => examIds.has(attempt.examId));
    if (next.length !== attempts.length) {
      await atomicWrite(this.paths.teacherExamAttempts, next);
    }
    const results = await this.readTeacherExamResultsUnsafe();
    const nextResults = results.filter((result) => examIds.has(result.examId));
    if (nextResults.length !== results.length) {
      await atomicWrite(this.paths.teacherExamResults, nextResults);
    }
  }

  async recoverOrphanTeacherExamAttempts(): Promise<void> {
    await this.withTeacherExamLocks(async () => {
      const exams = await this.readTeacherExamsUnsafe();
      await this.recoverOrphanTeacherExamAttemptsUnsafe(exams);
    });
  }

  async listTeacherExamAttemptsByExam(examId: string): Promise<TeacherExamAttempt[]> {
    const attempts = await this.readTeacherExamAttemptsUnsafe();
    return attempts.filter((attempt) => attempt.examId === examId);
  }

  async getTeacherExamAttempt(attemptId: string): Promise<TeacherExamAttempt | null> {
    const attempts = await this.readTeacherExamAttemptsUnsafe();
    return attempts.find((attempt) => attempt.id === attemptId) ?? null;
  }

  async getTeacherExamAttemptForStudent(
    examId: string,
    studentUserId: string
  ): Promise<TeacherExamAttempt | null> {
    const attempts = await this.readTeacherExamAttemptsUnsafe();
    return (
      attempts.find(
        (attempt) => attempt.examId === examId && attempt.studentUserId === studentUserId
      ) ?? null
    );
  }

  async hasTeacherExamAttempts(examId: string): Promise<boolean> {
    const attempts = await this.readTeacherExamAttemptsUnsafe();
    return attempts.some((attempt) => attempt.examId === examId);
  }

  async getOrCreateExamAttemptForStudent(
    examId: string,
    studentUserId: string,
    atIso: string
  ): Promise<ExamAttemptStartResult> {
    return this.withTeacherExamLocks(async () => {
      const exams = await this.readTeacherExamsUnsafe();
      const exam = exams.find((item) => item.id === examId);
      if (!exam) return { ok: false, reason: "NOT_FOUND" };

      let attempts = await this.readTeacherExamAttemptsUnsafe();
      const owned = attempts
        .filter((attempt) => attempt.examId === examId && attempt.studentUserId === studentUserId)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      if (owned.length > 0) {
        const keeper = owned[0];
        if (owned.length > 1) {
          const keepId = keeper.id;
          attempts = attempts.filter(
            (attempt) =>
              attempt.id === keepId ||
              !(attempt.examId === examId && attempt.studentUserId === studentUserId)
          );
          await atomicWrite(this.paths.teacherExamAttempts, attempts);
        }
        return { ok: true, attempt: keeper, exam, created: false };
      }

      const revision =
        exam.status === "PUBLISHED" &&
        exam.publishedRevision &&
        exam.activePublishedVersion === exam.publishedRevision.version
          ? exam.publishedRevision
          : null;
      if (!revision) return { ok: false, reason: "NOT_PUBLISHED" };
      if (atIso < revision.availableFrom || atIso > revision.availableUntil) {
        return { ok: false, reason: "UNAVAILABLE" };
      }

      const deadlineAt = minIso(
        addMinutes(atIso, revision.timeLimitMinutes),
        revision.availableUntil
      );
      const attempt: TeacherExamAttempt = {
        id: id("att"),
        examId,
        studentUserId,
        status: "IN_PROGRESS",
        examVersion: revision.version,
        examSnapshot: copy(revision),
        settingsSnapshot: {
          title: revision.title,
          descriptionMarkdown: revision.descriptionMarkdown,
          availableFrom: revision.availableFrom,
          availableUntil: revision.availableUntil,
          timeLimitMinutes: revision.timeLimitMinutes,
          passScoreRatio: revision.passScoreRatio,
          aiGradingEnabled: revision.aiGradingEnabled
        },
        startedAt: atIso,
        deadlineAt,
        answers: {}
      };
      attempts.push(attempt);
      await atomicWrite(this.paths.teacherExamAttempts, attempts);
      return { ok: true, attempt, exam, created: true };
    });
  }

  async saveExamAttemptAnswers(
    attemptId: string,
    studentUserId: string,
    answers: Record<string, unknown>,
    atIso: string
  ): Promise<ExamAttemptSaveResult> {
    return this.withFileLock(this.paths.teacherExamAttempts, async () => {
      const attempts = await this.readTeacherExamAttemptsUnsafe();
      const index = attempts.findIndex((attempt) => attempt.id === attemptId);
      if (index === -1) return { ok: false, reason: "NOT_FOUND" };
      const current = attempts[index];
      if (current.studentUserId !== studentUserId) return { ok: false, reason: "FORBIDDEN" };
      if (current.status !== "IN_PROGRESS") {
        return { ok: true, attempt: current, accepted: false, reason: "NOT_IN_PROGRESS" };
      }
      const cutoff = addSeconds(current.deadlineAt, 5);
      if (atIso > cutoff) {
        return { ok: true, attempt: current, accepted: false, reason: "LATE_AFTER_GRACE" };
      }
      const updated: TeacherExamAttempt = {
        ...current,
        answers: copy(answers),
        lastSavedAt: atIso,
        lastAcceptedAnswerSaveAt: atIso
      };
      attempts[index] = updated;
      await atomicWrite(this.paths.teacherExamAttempts, attempts);
      return { ok: true, attempt: updated, accepted: true };
    });
  }

  async claimExamAttemptSubmission(
    attemptId: string,
    studentUserId: string,
    answers: Record<string, unknown> | undefined,
    atIso: string
  ): Promise<ExamAttemptClaimResult> {
    return this.withFileLock(this.paths.teacherExamAttempts, async () => {
      const attempts = await this.readTeacherExamAttemptsUnsafe();
      const index = attempts.findIndex((attempt) => attempt.id === attemptId);
      if (index === -1) return { ok: false, reason: "NOT_FOUND" };
      const current = attempts[index];
      if (current.studentUserId !== studentUserId) return { ok: false, reason: "FORBIDDEN" };
      if (current.status === "GRADING" || current.status === "GRADED") {
        return {
          ok: true,
          attempt: current,
          shouldGrade: false,
          submissionId: current.submissionId,
          accepted: false
        };
      }
      const cutoff = addSeconds(current.deadlineAt, 5);
      const accepted = atIso <= cutoff;
      if (!accepted && answers !== undefined && !current.lastAcceptedAnswerSaveAt) {
        return { ok: false, reason: "LATE_AFTER_GRACE" };
      }
      const acceptedAnswers = accepted && answers ? copy(answers) : current.answers;
      const submissionId = id("sub");
      const updated: TeacherExamAttempt = {
        ...current,
        status: "GRADING",
        answers: acceptedAnswers,
        submissionId,
        submittedAt: atIso,
        gradingStartedAt: atIso,
        gradingLeaseExpiresAt: addSeconds(atIso, 90),
        ...(accepted
          ? {
              lastSavedAt: atIso,
              lastAcceptedAnswerSaveAt: atIso
            }
          : {})
      };
      attempts[index] = updated;
      await atomicWrite(this.paths.teacherExamAttempts, attempts);
      return { ok: true, attempt: updated, shouldGrade: true, submissionId, accepted };
    });
  }

  async commitExamAttemptGradingAndUpsertResult(input: {
    attemptId: string;
    submissionId: string;
    grading: TeacherExamGrading;
    atIso: string;
  }): Promise<{ attempt: TeacherExamAttempt; resultRecord?: TeacherExamResultRecord; committed: boolean } | null> {
    return this.withTeacherExamLocks(async () => {
      const exams = await this.readTeacherExamsUnsafe();
      const examById = new Map(exams.map((exam) => [exam.id, exam]));
      const attempts = await this.readTeacherExamAttemptsUnsafe();
      const index = attempts.findIndex((attempt) => attempt.id === input.attemptId);
      if (index === -1) return null;
      const current = attempts[index];
      if (current.submissionId !== input.submissionId) {
        return { attempt: current, committed: false };
      }

      const committed =
        current.status === "GRADING"
          ? {
              ...current,
              status: "GRADED" as const,
              gradedAt: input.atIso,
              grading: copy(input.grading)
            }
          : current;

      if (current.status !== "GRADING" && current.status !== "GRADED") {
        return { attempt: current, committed: false };
      }

      const exam = examById.get(committed.examId);
      const resultRecord = exam
        ? this.buildTeacherExamResultRecordUnsafe({
            exam,
            attempt: committed,
            generatedAt: input.atIso
          }) ?? undefined
        : undefined;

      if (current.status === "GRADING") {
        attempts[index] = committed;
        await atomicWrite(this.paths.teacherExamAttempts, attempts);
      }
      if (resultRecord) {
        const records = await this.readTeacherExamResultsUnsafe();
        await atomicWrite(
          this.paths.teacherExamResults,
          this.upsertTeacherExamResultRecordUnsafe(records, resultRecord)
        );
      }

      return {
        attempt: committed,
        resultRecord,
        committed: current.status === "GRADING"
      };
    });
  }

  async commitExamAttemptGrading(
    attemptId: string,
    submissionId: string,
    grading: TeacherExamGrading,
    atIso: string
  ): Promise<TeacherExamAttempt | null> {
    const result = await this.commitExamAttemptGradingAndUpsertResult({
      attemptId,
      submissionId,
      grading,
      atIso
    });
    return result?.attempt ?? null;
  }

  async ensureTeacherExamResultRecord(
    attemptId: string
  ): Promise<TeacherExamResultRecord | null> {
    const result = await this.ensureTeacherExamResultRecordWithStatus(attemptId);
    return result.record;
  }

  async ensureTeacherExamResultRecordWithStatus(
    attemptId: string
  ): Promise<{ record: TeacherExamResultRecord | null; created: boolean }> {
    return this.withTeacherExamLocks(async () => {
      const existingRecords = await this.readTeacherExamResultsUnsafe();
      const existed = existingRecords.some((record) => record.attemptId === attemptId);
      const records = await this.reconcileTeacherExamResultsUnsafe({ attemptId });
      const record = records.find((item) => item.attemptId === attemptId) ?? null;
      return { record: record ? copy(record) : null, created: !existed && Boolean(record) };
    });
  }

  async listTeacherExamResultRecordsByClassroom(
    classroomId: string
  ): Promise<TeacherExamResultRecord[]> {
    return this.withTeacherExamLocks(async () => {
      const records = await this.reconcileTeacherExamResultsUnsafe({ classroomId });
      return records
        .filter((record) => record.classroomId === classroomId)
        .sort((a, b) => (a.gradedAt ?? a.generatedAt).localeCompare(b.gradedAt ?? b.generatedAt))
        .map((record) => copy(record));
    });
  }

  async listTeacherExamResultRecordsForStudent(
    classroomId: string,
    studentUserId: string
  ): Promise<TeacherExamResultRecord[]> {
    return this.withTeacherExamLocks(async () => {
      const records = await this.reconcileTeacherExamResultsUnsafe({
        classroomId,
        studentUserId
      });
      return records
        .filter((record) => record.classroomId === classroomId && record.studentUserId === studentUserId)
        .sort((a, b) => (a.gradedAt ?? a.generatedAt).localeCompare(b.gradedAt ?? b.generatedAt))
        .map((record) => copy(record));
    });
  }

  async appendInviteAuditLog(entry: Omit<InviteAuditLogEntry, "id" | "createdAt">): Promise<void> {
    await this.withFileLock(this.paths.inviteAuditLog, async () => {
      const entries = await readJson<InviteAuditLogEntry[]>(this.paths.inviteAuditLog, []);
      entries.push({
        ...entry,
        id: id("ia"),
        createdAt: now()
      });
      await atomicWrite(this.paths.inviteAuditLog, entries);
    });
  }

  async listWeeksByClassroom(classroomId: string): Promise<Week[]> {
    const weeks = await readJson<Week[]>(this.paths.weeks, []);
    return weeks
      .filter((w) => w.classroomId === classroomId)
      .sort((a, b) => a.weekIndex - b.weekIndex);
  }

  async getWeek(weekId: string): Promise<Week | null> {
    const weeks = await readJson<Week[]>(this.paths.weeks, []);
    return weeks.find((week) => week.id === weekId) ?? null;
  }

  async getClassroomByWeek(weekId: string): Promise<Classroom | null> {
    const week = await this.getWeek(weekId);
    if (!week) return null;
    return this.getClassroom(week.classroomId);
  }

  async createWeek(classroomId: string, title?: string): Promise<Week> {
    return this.withFileLock(this.paths.weeks, async () => {
      const weeks = await readJson<Week[]>(this.paths.weeks, []);
      const nextIndex =
        Math.max(
          0,
          ...weeks.filter((w) => w.classroomId === classroomId).map((w) => w.weekIndex)
        ) + 1;
      const item: Week = {
        id: id("wk"),
        classroomId,
        weekIndex: nextIndex,
        title: title ?? `${nextIndex}주차`,
        createdAt: now(),
        updatedAt: now()
      };
      weeks.push(item);
      await atomicWrite(this.paths.weeks, weeks);
      return item;
    });
  }

  async deleteWeek(weekId: string): Promise<void> {
    await this.deleteWeeksBulk([weekId]);
  }

  async deleteWeeksBulk(weekIds: string[]): Promise<void> {
    if (weekIds.length === 0) return;
    const weekSet = new Set(weekIds);
    await this.withWeekAndTeacherExamLocks(async () => {
      await this.deleteTeacherExamsByWeekIdsUnsafe(weekIds);
      const weeks = await readJson<Week[]>(this.paths.weeks, []);
      await atomicWrite(
        this.paths.weeks,
        weeks.filter((w) => !weekSet.has(w.id))
      );
    });

    const toDelete = await this.withFileLock(this.paths.lectures, async () => {
      const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
      const matched = lectures.filter((l) => weekSet.has(l.weekId));
      await atomicWrite(
        this.paths.lectures,
        lectures.filter((l) => !weekSet.has(l.weekId))
      );
      return matched;
    });

    await Promise.all(
      toDelete.map(async (lecture) => {
        await this.deleteLectureFiles(lecture);
        await this.deleteSessionsByLecture(lecture.id);
      })
    );
  }

  async listLecturesByWeek(weekId: string): Promise<LectureItem[]> {
    const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
    return lectures.filter((l) => l.weekId === weekId);
  }

  async getClassroomByLecture(lectureId: string): Promise<Classroom | null> {
    const lecture = await this.getLecture(lectureId);
    if (!lecture) return null;
    return this.getClassroomByWeek(lecture.weekId);
  }

  async findLectureByPdfFileName(fileName: string): Promise<LectureItem | null> {
    const safeName = path.basename(fileName);
    if (safeName !== fileName || path.extname(safeName).toLowerCase() !== ".pdf") {
      return null;
    }
    const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
    return lectures.find((lecture) => path.basename(lecture.pdf.path) === safeName) ?? null;
  }

  async listLecturesByWeekIds(weekIds: string[]): Promise<Map<string, LectureItem[]>> {
    const requested = new Set(weekIds);
    const grouped = new Map<string, LectureItem[]>();
    for (const weekId of weekIds) {
      grouped.set(weekId, []);
    }
    if (requested.size === 0) {
      return grouped;
    }

    const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
    for (const lecture of lectures) {
      if (!requested.has(lecture.weekId)) continue;
      grouped.get(lecture.weekId)?.push(lecture);
    }
    return grouped;
  }

  async createLecture(input: {
    id?: string;
    weekId: string;
    title: string;
    pdfPath: string;
    numPages: number;
    pageIndexPath: string;
    geminiFile?: LectureItem["pdf"]["geminiFile"];
  }): Promise<LectureItem> {
    return this.withFileLock(this.paths.lectures, async () => {
      const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
      const item: LectureItem = {
        id: input.id ?? id("lec"),
        weekId: input.weekId,
        title: input.title,
        pdf: {
          path: input.pdfPath,
          numPages: input.numPages,
          pageIndexPath: input.pageIndexPath,
          geminiFile: input.geminiFile
        },
        createdAt: now(),
        updatedAt: now()
      };
      lectures.push(item);
      await atomicWrite(this.paths.lectures, lectures);
      return item;
    });
  }

  async updateLecture(lectureId: string, patch: Partial<LectureItem>): Promise<LectureItem | null> {
    return this.withFileLock(this.paths.lectures, async () => {
      const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
      const index = lectures.findIndex((l) => l.id === lectureId);
      if (index === -1) return null;
      const updated = {
        ...lectures[index],
        ...patch,
        pdf: {
          ...lectures[index].pdf,
          ...(patch.pdf ?? {})
        },
        updatedAt: now()
      } satisfies LectureItem;
      lectures[index] = updated;
      await atomicWrite(this.paths.lectures, lectures);
      return updated;
    });
  }

  async getLecture(lectureId: string): Promise<LectureItem | null> {
    const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
    return lectures.find((l) => l.id === lectureId) ?? null;
  }

  async deleteLecture(lectureId: string): Promise<void> {
    const target = await this.withFileLock(this.paths.lectures, async () => {
      const lectures = await readJson<LectureItem[]>(this.paths.lectures, []);
      const matched = lectures.find((l) => l.id === lectureId);
      await atomicWrite(
        this.paths.lectures,
        lectures.filter((l) => l.id !== lectureId)
      );
      return matched;
    });
    if (target) {
      await this.deleteLectureFiles(target);
      await this.deleteSessionsByLecture(target.id);
    }
  }

  private async deleteLectureFiles(lecture: LectureItem): Promise<void> {
    const safePaths = [lecture.pdf.path, lecture.pdf.pageIndexPath].filter(Boolean);
    await Promise.all(
      safePaths.map(async (filePath) => {
        if (!this.isInsideUploadDir(filePath)) {
          return;
        }
        try {
          await fs.unlink(path.resolve(filePath));
        } catch {
          // no-op
        }
      })
    );
  }

  sessionPath(sessionId: string): string {
    return path.join(this.paths.sessionsDir, `${sessionId}.json`);
  }

  sessionIdFromLecture(lectureId: string): string {
    return `ses_${lectureId}`;
  }

  async getSessionByLecture(lectureId: string): Promise<SessionState | null> {
    const sessionId = this.sessionIdFromLecture(lectureId);
    return this.getSession(sessionId);
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    const file = this.sessionPath(sessionId);
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = normalizeStoredSessionLearningProgress(JSON.parse(raw) as SessionState);
      if (!parsed.integratedMemory) {
        parsed.integratedMemory = createInitialIntegratedMemory();
      }
      if (!parsed.quizAssessments) {
        parsed.quizAssessments = [];
      }
      if (parsed.activeIntervention === undefined) {
        parsed.activeIntervention = null;
      }
      if (!parsed.qaThread) {
        parsed.qaThread = createInitialQaThreadMemory();
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async saveSession(state: SessionState): Promise<void> {
    await this.withFileLock(this.sessionPath(state.sessionId), async () => {
      await atomicWrite(this.sessionPath(state.sessionId), state);
    });
  }

  async createSession(lectureId: string, ownerUserId?: string): Promise<SessionState> {
    const sessionId = ownerUserId
      ? `ses_${crypto.randomBytes(16).toString("hex")}`
      : this.sessionIdFromLecture(lectureId);
    const state: SessionState = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      lectureId,
      ownerUserId,
      currentPage: 1,
      learningProgressPage: 0,
      pageStates: [
        {
          page: 1,
          status: "NEW",
          lastTouchedAt: now()
        }
      ],
      messages: [],
      quizzes: [],
      feedback: [],
      learnerModel: {
        level: "INTERMEDIATE",
        confidence: 0.5,
        weakConcepts: [],
        strongConcepts: []
      },
      integratedMemory: createInitialIntegratedMemory(),
      quizAssessments: [],
      activeIntervention: null,
      qaThread: createInitialQaThreadMemory(),
      conversationSummary: "",
      updatedAt: now()
    };
    await this.saveSession(state);
    return state;
  }

  async getOrCreateSessionByLecture(lectureId: string): Promise<SessionState> {
    return this.withSessionLock(this.sessionIdFromLecture(lectureId), async () => {
      const existing = await this.getSessionByLecture(lectureId);
      if (existing) return existing;
      return this.createSession(lectureId);
    });
  }

  async listSessions(): Promise<SessionState[]> {
    await fs.mkdir(this.paths.sessionsDir, { recursive: true });
    const entries = await fs.readdir(this.paths.sessionsDir).catch(() => []);
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const raw = await fs.readFile(path.join(this.paths.sessionsDir, entry), "utf-8");
            return normalizeStoredSessionLearningProgress(JSON.parse(raw) as SessionState);
          } catch {
            return null;
          }
        })
    );
    return sessions.filter((session): session is SessionState => Boolean(session));
  }

  async listSessionsByLecture(lectureId: string): Promise<SessionState[]> {
    const sessions = await this.listSessions();
    return sessions.filter((session) => session.lectureId === lectureId);
  }

  async getSessionByLectureForOwner(
    lectureId: string,
    ownerUserId: string
  ): Promise<SessionState | null> {
    const sessions = await this.listSessionsByLecture(lectureId);
    return sessions.find((session) => session.ownerUserId === ownerUserId) ?? null;
  }

  async getOrCreateSessionByLectureForOwner(
    lectureId: string,
    ownerUserId: string
  ): Promise<SessionState> {
    return this.withSessionLock(`${lectureId}:${ownerUserId}`, async () => {
      const existing = await this.getSessionByLectureForOwner(lectureId, ownerUserId);
      if (existing) return existing;
      return this.createSession(lectureId, ownerUserId);
    });
  }

  async deleteSessionByLecture(lectureId: string): Promise<void> {
    await this.deleteSessionsByLecture(lectureId);
  }

  async deleteSessionsByLecture(lectureId: string): Promise<void> {
    await this.withSessionLock(this.sessionIdFromLecture(lectureId), async () => {
      const sessions = await this.listSessionsByLecture(lectureId);
      const sessionIds = new Set([
        this.sessionIdFromLecture(lectureId),
        ...sessions.map((session) => session.sessionId)
      ]);
      await Promise.all(
        Array.from(sessionIds).map(async (sessionId) => {
          try {
            await fs.unlink(this.sessionPath(sessionId));
          } catch {
            // no-op
          }
        })
      );
    });
  }

  async deleteSessionsByClassroom(classroomId: string): Promise<void> {
    const weeks = await this.listWeeksByClassroom(classroomId);
    const lecturesByWeek = await this.listLecturesByWeekIds(weeks.map((week) => week.id));
    const lectureIds = weeks.flatMap((week) =>
      (lecturesByWeek.get(week.id) ?? []).map((lecture) => lecture.id)
    );
    await Promise.all(lectureIds.map((lectureId) => this.deleteSessionsByLecture(lectureId)));
  }

  async appendQuizResultEntries(entries: QuizResultLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.withFileLock(this.paths.quizResults, async () => {
      const existing = await readJson<QuizResultLogEntry[]>(this.paths.quizResults, []);
      existing.push(...entries);
      await atomicWrite(this.paths.quizResults, existing);
    });
  }
}
