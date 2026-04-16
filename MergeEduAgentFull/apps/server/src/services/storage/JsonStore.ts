import fs from "node:fs/promises";
import path from "node:path";
import {
  Classroom,
  LectureItem,
  SCHEMA_VERSION,
  SessionState,
  StudentCompetencyReport,
  Week
} from "../../types/domain.js";
import { createInitialIntegratedMemory } from "../engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../engine/QaThreadService.js";
import { paths } from "./paths.js";

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
  const tmpPath = `${filePath}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmpPath, payload, "utf-8");
  await fs.rename(tmpPath, filePath);
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
  async init(): Promise<void> {
    await fs.mkdir(paths.sessionsDir, { recursive: true });
    await fs.mkdir(paths.uploadsDir, { recursive: true });
    await ensureFile(paths.classrooms, "[]");
    await ensureFile(paths.weeks, "[]");
    await ensureFile(paths.lectures, "[]");
    await ensureFile(paths.classroomReports, "[]");
    await ensureFile(paths.quizResults, "[]");
  }

  async listClassrooms(): Promise<Classroom[]> {
    return readJson<Classroom[]>(paths.classrooms, []);
  }

  async createClassroom(title: string): Promise<Classroom> {
    const classrooms = await this.listClassrooms();
    const item: Classroom = {
      id: id("cls"),
      title,
      createdAt: now(),
      updatedAt: now()
    };
    classrooms.push(item);
    await atomicWrite(paths.classrooms, classrooms);
    return item;
  }

  async deleteClassroom(classroomId: string): Promise<void> {
    const classrooms = await this.listClassrooms();
    await atomicWrite(
      paths.classrooms,
      classrooms.filter((c) => c.id !== classroomId)
    );
    await this.deleteClassroomReport(classroomId);

    const weeks = await this.listWeeksByClassroom(classroomId);
    const weekIds = weeks.map((w) => w.id);
    await this.deleteWeeksBulk(weekIds);
  }

  async listClassroomReports(): Promise<StudentCompetencyReport[]> {
    return readJson<StudentCompetencyReport[]>(paths.classroomReports, []);
  }

  async getClassroomReport(classroomId: string): Promise<StudentCompetencyReport | null> {
    const reports = await this.listClassroomReports();
    return reports.find((report) => report.classroomId === classroomId) ?? null;
  }

  async saveClassroomReport(report: StudentCompetencyReport): Promise<void> {
    const reports = await this.listClassroomReports();
    const next = reports.filter((item) => item.classroomId !== report.classroomId);
    next.push(report);
    await atomicWrite(paths.classroomReports, next);
  }

  async deleteClassroomReport(classroomId: string): Promise<void> {
    const reports = await this.listClassroomReports();
    await atomicWrite(
      paths.classroomReports,
      reports.filter((item) => item.classroomId !== classroomId)
    );
  }

  async listWeeksByClassroom(classroomId: string): Promise<Week[]> {
    const weeks = await readJson<Week[]>(paths.weeks, []);
    return weeks
      .filter((w) => w.classroomId === classroomId)
      .sort((a, b) => a.weekIndex - b.weekIndex);
  }

  async createWeek(classroomId: string, title?: string): Promise<Week> {
    const weeks = await readJson<Week[]>(paths.weeks, []);
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
    await atomicWrite(paths.weeks, weeks);
    return item;
  }

  async deleteWeek(weekId: string): Promise<void> {
    await this.deleteWeeksBulk([weekId]);
  }

  async deleteWeeksBulk(weekIds: string[]): Promise<void> {
    if (weekIds.length === 0) return;
    const weekSet = new Set(weekIds);
    const weeks = await readJson<Week[]>(paths.weeks, []);
    await atomicWrite(
      paths.weeks,
      weeks.filter((w) => !weekSet.has(w.id))
    );

    const lectures = await readJson<LectureItem[]>(paths.lectures, []);
    const toDelete = lectures.filter((l) => weekSet.has(l.weekId));
    await atomicWrite(
      paths.lectures,
      lectures.filter((l) => !weekSet.has(l.weekId))
    );

    await Promise.all(
      toDelete.map(async (lecture) => {
        await this.deleteLectureFiles(lecture);
        await this.deleteSessionByLecture(lecture.id);
      })
    );
  }

  async listLecturesByWeek(weekId: string): Promise<LectureItem[]> {
    const lectures = await readJson<LectureItem[]>(paths.lectures, []);
    return lectures.filter((l) => l.weekId === weekId);
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
    const lectures = await readJson<LectureItem[]>(paths.lectures, []);
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
    await atomicWrite(paths.lectures, lectures);
    return item;
  }

  async updateLecture(lectureId: string, patch: Partial<LectureItem>): Promise<LectureItem | null> {
    const lectures = await readJson<LectureItem[]>(paths.lectures, []);
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
    await atomicWrite(paths.lectures, lectures);
    return updated;
  }

  async getLecture(lectureId: string): Promise<LectureItem | null> {
    const lectures = await readJson<LectureItem[]>(paths.lectures, []);
    return lectures.find((l) => l.id === lectureId) ?? null;
  }

  async deleteLecture(lectureId: string): Promise<void> {
    const lectures = await readJson<LectureItem[]>(paths.lectures, []);
    const target = lectures.find((l) => l.id === lectureId);
    await atomicWrite(
      paths.lectures,
      lectures.filter((l) => l.id !== lectureId)
    );
    if (target) {
      await this.deleteLectureFiles(target);
      await this.deleteSessionByLecture(target.id);
    }
  }

  private async deleteLectureFiles(lecture: LectureItem): Promise<void> {
    const safePaths = [lecture.pdf.path, lecture.pdf.pageIndexPath].filter(Boolean);
    await Promise.all(
      safePaths.map(async (filePath) => {
        try {
          await fs.unlink(path.resolve(process.cwd(), filePath));
        } catch {
          // no-op
        }
      })
    );
  }

  sessionPath(sessionId: string): string {
    return path.join(paths.sessionsDir, `${sessionId}.json`);
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
    await atomicWrite(this.sessionPath(state.sessionId), state);
  }

  async createSession(lectureId: string): Promise<SessionState> {
    const sessionId = this.sessionIdFromLecture(lectureId);
    const state: SessionState = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      lectureId,
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
    const existing = await this.getSessionByLecture(lectureId);
    if (existing) return existing;
    return this.createSession(lectureId);
  }

  async deleteSessionByLecture(lectureId: string): Promise<void> {
    const file = this.sessionPath(this.sessionIdFromLecture(lectureId));
    try {
      await fs.unlink(file);
    } catch {
      // no-op
    }
  }

  async appendQuizResultEntries(entries: QuizResultLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const existing = await readJson<QuizResultLogEntry[]>(paths.quizResults, []);
    existing.push(...entries);
    await atomicWrite(paths.quizResults, existing);
  }
}
