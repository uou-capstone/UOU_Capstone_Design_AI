import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import {
  AuthSession,
  Classroom,
  ClassroomEnrollment,
  InviteAuditLogEntry,
  LectureItem,
  OAuthState,
  RateLimitBucket,
  SCHEMA_VERSION,
  SessionState,
  StudentCompetencyReport,
  User,
  Week
} from "../../types/domain.js";
import { createInitialIntegratedMemory } from "../engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../engine/QaThreadService.js";
import { FileLock } from "./FileLock.js";
import { createStoragePaths, StoragePathOptions, StoragePaths } from "./paths.js";

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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
    await ensureFile(this.paths.classroomReports, "[]");
    await ensureFile(this.paths.quizResults, "[]");
    await ensureFile(this.paths.users, "[]");
    await ensureFile(this.paths.authSessions, "[]");
    await ensureFile(this.paths.classroomEnrollments, "[]");
    await ensureFile(this.paths.oauthStates, "[]");
    await ensureFile(this.paths.inviteAuditLog, "[]");
    await ensureFile(this.paths.rateLimits, "[]");
    await this.migrateLectureUploadPaths();
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
    await this.withFileLock(this.paths.classrooms, async () => {
      const classrooms = await this.listClassrooms();
      await atomicWrite(
        this.paths.classrooms,
        classrooms.filter((c) => c.id !== classroomId)
      );
    });
    await this.deleteClassroomReport(classroomId);
    await this.deleteEnrollmentsByClassroom(classroomId);

    const weeks = await this.listWeeksByClassroom(classroomId);
    const weekIds = weeks.map((w) => w.id);
    await this.deleteWeeksBulk(weekIds);
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
    await this.withFileLock(this.paths.weeks, async () => {
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
      const parsed = JSON.parse(raw) as SessionState;
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
            return JSON.parse(raw) as SessionState;
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
