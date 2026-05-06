import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { tmpdir } from "node:os";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { appConfig } from "../config.js";
import { AuthService } from "../services/auth/AuthService.js";
import { DevEmailSender } from "../services/auth/EmailSender.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import { PublicUser, SessionState, TeacherExamRevision } from "../types/domain.js";

const origin = "http://localhost:5173";
let testDir = "";
let uploadDir = "";

beforeEach(async () => {
  Object.assign(appConfig, {
    appOrigin: origin,
    authDevExposeVerificationCode: true,
    authCookieName: "merge_edu_session",
    authEmailDeliveryMode: "dev",
    authEmailResendCooldownSeconds: 0,
    requestEncryptionMode: "optional",
    requestEncryptionRequiredPaths: []
  });
  const root = await fs.mkdtemp(path.join(tmpdir(), "merge-edu-attendance-route-"));
  testDir = path.join(root, "data");
  uploadDir = path.join(root, "uploads");
});

afterEach(async () => {
  if (!testDir) return;
  await fs.rm(path.dirname(testDir), { recursive: true, force: true });
  testDir = "";
  uploadDir = "";
});

async function startServer() {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge: {} as any,
    pdfIngest: {} as any,
    engine: {} as any
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    store,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function makeClient(baseUrl: string) {
  let cookie = "";
  return {
    async request(pathname: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("content-type") && init.body) {
        headers.set("content-type", "application/json");
      }
      headers.set("origin", origin);
      if (cookie) headers.set("cookie", cookie);
      const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    }
  };
}

async function signupClient(
  baseUrl: string,
  input: { email: string; role: "teacher" | "student"; displayName: string }
): Promise<{ client: ReturnType<typeof makeClient>; user: PublicUser }> {
  const client = makeClient(baseUrl);
  const signup = await client.request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: "pass1234",
      displayName: input.displayName,
      role: input.role
    })
  });
  expect(signup.status).toBe(201);
  const signupPayload = await signup.json() as {
    data: { user: PublicUser };
    devVerificationCode: string;
  };
  const verify = await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email: input.email, code: signupPayload.devVerificationCode })
  });
  expect(verify.status).toBe(200);
  const verifyPayload = await verify.json() as { data: { user: PublicUser } };
  return { client, user: verifyPayload.data.user };
}

async function createLectureFixture(
  store: JsonStore,
  input: { weekId: string; lectureId: string; title: string; pages: number; createdAt?: string }
) {
  await fs.mkdir(uploadDir, { recursive: true });
  const pdfPath = path.join(uploadDir, `${input.lectureId}.pdf`);
  const pageIndexPath = path.join(uploadDir, `${input.lectureId}.pageIndex.json`);
  await fs.writeFile(pdfPath, `%PDF-1.4\n% ${input.title}\n`, "utf-8");
  await fs.writeFile(
    pageIndexPath,
    JSON.stringify({ lectureId: input.lectureId, numPages: input.pages, pages: [] }),
    "utf-8"
  );
  const lecture = await store.createLecture({
    id: input.lectureId,
    weekId: input.weekId,
    title: input.title,
    pdfPath,
    numPages: input.pages,
    pageIndexPath
  });
  if (input.createdAt) {
    await store.updateLecture(lecture.id, { createdAt: input.createdAt, updatedAt: input.createdAt });
  }
  return (await store.getLecture(lecture.id))!;
}

async function saveOwnedSession(
  store: JsonStore,
  input: {
    lectureId: string;
    ownerUserId: string;
    currentPage: number;
    learningProgressPage?: number;
    pageStates?: SessionState["pageStates"];
    updatedAt: string;
  }
) {
  const session = await store.createSession(input.lectureId, input.ownerUserId);
  session.currentPage = input.currentPage;
  if (input.learningProgressPage !== undefined) {
    session.learningProgressPage = input.learningProgressPage;
  }
  session.pageStates = input.pageStates ?? [
    {
      page: input.currentPage,
      status: "EXPLAINED",
      lastTouchedAt: input.updatedAt
    }
  ];
  session.updatedAt = input.updatedAt;
  await store.saveSession(session);
  return session;
}

function makeExamRevision(input: {
  title: string;
  availableFrom?: string;
  availableUntil?: string;
}): Omit<TeacherExamRevision, "version" | "createdAt" | "updatedAt"> {
  return {
    title: input.title,
    descriptionMarkdown: `${input.title} 설명`,
    availableFrom: input.availableFrom ?? "2026-05-01T00:00:00.000Z",
    availableUntil: input.availableUntil ?? "2099-05-01T00:00:00.000Z",
    timeLimitMinutes: 60,
    passScoreRatio: 0.6,
    aiGradingEnabled: false,
    questions: [
      {
        id: `${input.title}-q1`,
        type: "MCQ",
        promptMarkdown: `${input.title} 문항`,
        points: 10,
        choices: [
          { id: "a", textMarkdown: "정답" },
          { id: "b", textMarkdown: "오답" }
        ],
        answer: { choiceId: "a" }
      }
    ]
  };
}

async function createPublishedExamFixture(
  store: JsonStore,
  input: { classroomId: string; weekId: string; title: string; availableFrom?: string; availableUntil?: string }
) {
  const revision = makeExamRevision({
    title: input.title,
    availableFrom: input.availableFrom,
    availableUntil: input.availableUntil
  });
  const created = await store.createTeacherExam({
    classroomId: input.classroomId,
    weekId: input.weekId,
    draftRevision: revision
  });
  expect(created).toBeTruthy();
  const published = await store.publishTeacherExam(created!.id, revision);
  expect(published).toBeTruthy();
  return published!;
}

describe("classroom attendance route", () => {
  it("aggregates student lecture completion from owner-scoped sessions", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "attendance.teacher@example.com",
        role: "teacher",
        displayName: "Attendance Teacher"
      });
      const otherTeacher = await signupClient(server.baseUrl, {
        email: "attendance.other.teacher@example.com",
        role: "teacher",
        displayName: "Other Teacher"
      });
      const firstStudent = await signupClient(server.baseUrl, {
        email: "attendance.first@example.com",
        role: "student",
        displayName: "시나리오1 학생 01"
      });
      const secondStudent = await signupClient(server.baseUrl, {
        email: "attendance.second@example.com",
        role: "student",
        displayName: "시나리오1 학생 02"
      });

      const classroom = await server.store.createClassroom("출석 테스트 강의실", teacher.user.id);
      const firstWeek = await server.store.createWeek(classroom.id, "1주차");
      const secondWeek = await server.store.createWeek(classroom.id, "2주차");
      await server.store.enrollStudent(classroom.id, firstStudent.user.id, teacher.user.id);
      await server.store.enrollStudent(classroom.id, secondStudent.user.id, teacher.user.id);
      await server.store.enrollStudent(classroom.id, otherTeacher.user.id, teacher.user.id);

      const firstLecture = await createLectureFixture(server.store, {
        weekId: firstWeek.id,
        lectureId: "lec_attendance_guide",
        title: "MergeAISystem 가이드 테스트 자료",
        pages: 13,
        createdAt: "2026-05-01T00:00:00.000Z"
      });
      const secondLecture = await createLectureFixture(server.store, {
        weekId: firstWeek.id,
        lectureId: "lec_attendance_other",
        title: "또 다른것",
        pages: 6,
        createdAt: "2026-05-01T01:00:00.000Z"
      });
      const thirdLecture = await createLectureFixture(server.store, {
        weekId: secondWeek.id,
        lectureId: "lec_attendance_transformer",
        title: "Transformer 기초 정리",
        pages: 18,
        createdAt: "2026-05-02T00:00:00.000Z"
      });
      const malformedLecture = await createLectureFixture(server.store, {
        weekId: secondWeek.id,
        lectureId: "lec_attendance_malformed",
        title: "깨진 세션 자료",
        pages: 10,
        createdAt: "2026-05-02T01:00:00.000Z"
      });
      const legacyNoPageStatesLecture = await createLectureFixture(server.store, {
        weekId: secondWeek.id,
        lectureId: "lec_attendance_legacy_no_page_states",
        title: "옛 세션 자료",
        pages: 9,
        createdAt: "2026-05-02T02:00:00.000Z"
      });
      const badTimestampLecture = await createLectureFixture(server.store, {
        weekId: secondWeek.id,
        lectureId: "lec_attendance_bad_timestamp",
        title: "시간 깨진 세션 자료",
        pages: 8,
        createdAt: "2026-05-02T03:00:00.000Z"
      });

      await saveOwnedSession(server.store, {
        lectureId: firstLecture.id,
        ownerUserId: firstStudent.user.id,
        currentPage: 4,
        learningProgressPage: 4,
        updatedAt: "2026-05-03T09:00:00.000Z",
        pageStates: [
          { page: 2, status: "EXPLAINED", lastTouchedAt: "2026-05-03T08:00:00.000Z" },
          { page: 8, status: "EXPLAINED", lastTouchedAt: "2026-05-03T10:00:00.000Z" }
        ]
      });
      await saveOwnedSession(server.store, {
        lectureId: secondLecture.id,
        ownerUserId: firstStudent.user.id,
        currentPage: 6,
        learningProgressPage: 6,
        updatedAt: "2026-05-03T11:00:00.000Z"
      });
      await saveOwnedSession(server.store, {
        lectureId: thirdLecture.id,
        ownerUserId: firstStudent.user.id,
        currentPage: 99,
        learningProgressPage: 18,
        updatedAt: "2026-05-03T12:00:00.000Z"
      });
      const malformed = await server.store.createSession(malformedLecture.id, firstStudent.user.id);
      await fs.writeFile(
        server.store.sessionPath(malformed.sessionId),
        JSON.stringify(
          {
            ...malformed,
            currentPage: "bad",
            pageStates: [{ page: "bad", status: "EXPLAINED", lastTouchedAt: "2026-05-05T12:00:00.000Z" }],
            updatedAt: "2026-05-05T12:00:00.000Z"
          },
          null,
          2
        )
      );
      const legacyNoPageStates = await server.store.createSession(legacyNoPageStatesLecture.id, firstStudent.user.id);
      await fs.writeFile(
        server.store.sessionPath(legacyNoPageStates.sessionId),
        JSON.stringify(
          {
            ...legacyNoPageStates,
            currentPage: 9,
            pageStates: undefined,
            updatedAt: "2026-05-03T07:00:00.000Z"
          },
          null,
          2
        )
      );
      const badTimestamp = await server.store.createSession(badTimestampLecture.id, firstStudent.user.id);
      await fs.writeFile(
        server.store.sessionPath(badTimestamp.sessionId),
        JSON.stringify(
          {
            ...badTimestamp,
            currentPage: 4,
            learningProgressPage: 8,
            pageStates: [{ page: 6, status: "EXPLAINED", lastTouchedAt: "bad-date" }],
            updatedAt: "bad-date"
          },
          null,
          2
        )
      );
      const ownerless = await server.store.getOrCreateSessionByLecture(firstLecture.id);
      ownerless.currentPage = 13;
      ownerless.updatedAt = "2026-05-06T12:00:00.000Z";
      await server.store.saveSession(ownerless);

      const teacherResponse = await teacher.client.request(`/classrooms/${classroom.id}/attendance`);
      expect(teacherResponse.status).toBe(200);
      const teacherPayload = await teacherResponse.json() as {
        data: {
          totalStudents: number;
          activeStudentCount: number;
          attentionStudentCount: number;
          totalLectureCount: number;
          totalPages: number;
          weeks: Array<{ title: string; weekIndex: number }>;
          students: Array<{
            displayName: string;
            status: string;
            completedLectureCount: number;
            totalLectureCount: number;
            totalReachedPages: number;
            totalPages: number;
            currentWeekTitle?: string;
            lastTouchedAt?: string;
            lectures: Array<{ lectureTitle: string; maxReachedPage: number; totalPages: number; completed: boolean; lastTouchedAt?: string }>;
          }>;
        };
      };

      expect(teacherPayload.data.totalStudents).toBe(2);
      expect(teacherPayload.data.activeStudentCount).toBe(1);
      expect(teacherPayload.data.attentionStudentCount).toBe(1);
      expect(teacherPayload.data.totalLectureCount).toBe(6);
      expect(teacherPayload.data.totalPages).toBe(64);
      expect(teacherPayload.data.weeks.map((week) => week.title)).toEqual(["1주차", "2주차"]);
      expect(teacherPayload.data.students.map((student) => student.displayName)).toEqual([
        "시나리오1 학생 01",
        "시나리오1 학생 02"
      ]);

      const activeStudent = teacherPayload.data.students[0];
      expect(activeStudent.status).toBe("active");
      expect(activeStudent.completedLectureCount).toBe(3);
      expect(activeStudent.totalReachedPages).toBe(36);
      expect(activeStudent.totalPages).toBe(64);
      expect(activeStudent.currentWeekTitle).toBe("2주차");
      expect(activeStudent.lastTouchedAt).toBe("2026-05-03T12:00:00.000Z");
      expect(activeStudent.lectures.map((lecture) => lecture.lectureTitle)).toEqual([
        "MergeAISystem 가이드 테스트 자료",
        "또 다른것",
        "Transformer 기초 정리",
        "깨진 세션 자료",
        "옛 세션 자료",
        "시간 깨진 세션 자료"
      ]);
      expect(activeStudent.lectures.map((lecture) => lecture.maxReachedPage)).toEqual([4, 6, 18, 0, 0, 8]);
      expect(activeStudent.lectures.map((lecture) => lecture.completed)).toEqual([false, true, true, false, false, true]);
      expect(activeStudent.lectures[3].lastTouchedAt).toBeUndefined();
      expect(activeStudent.lectures[4].lastTouchedAt).toBeUndefined();
      expect(activeStudent.lectures[5].lastTouchedAt).toBeUndefined();

      const idleStudent = teacherPayload.data.students[1];
      expect(idleStudent.status).toBe("notStarted");
      expect(idleStudent.totalReachedPages).toBe(0);
      expect(idleStudent.currentWeekTitle).toBeUndefined();

      const otherTeacherResponse = await otherTeacher.client.request(`/classrooms/${classroom.id}/attendance`);
      expect(otherTeacherResponse.status).toBe(403);
      const studentResponse = await firstStudent.client.request(`/classrooms/${classroom.id}/attendance`);
      expect(studentResponse.status).toBe(403);
    } finally {
      await server.close();
    }
  }, 20_000);

  it("returns student-only attendance summary with sanitized exam participation", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "attendance.mine.teacher@example.com",
        role: "teacher",
        displayName: "Mine Teacher"
      });
      const firstStudent = await signupClient(server.baseUrl, {
        email: "attendance.mine.first@example.com",
        role: "student",
        displayName: "시나리오1 학생 01"
      });
      const secondStudent = await signupClient(server.baseUrl, {
        email: "attendance.mine.second@example.com",
        role: "student",
        displayName: "비공개 학생 02"
      });
      const classroom = await server.store.createClassroom("학생 출석 강의실", teacher.user.id);
      const firstWeek = await server.store.createWeek(classroom.id, "1주차");
      const secondWeek = await server.store.createWeek(classroom.id, "2주차");
      await server.store.enrollStudent(classroom.id, firstStudent.user.id, teacher.user.id);
      await server.store.enrollStudent(classroom.id, secondStudent.user.id, teacher.user.id);

      const firstLecture = await createLectureFixture(server.store, {
        weekId: firstWeek.id,
        lectureId: "lec_student_attendance_guide",
        title: "MergeAISystem 가이드",
        pages: 10
      });
      const secondLecture = await createLectureFixture(server.store, {
        weekId: firstWeek.id,
        lectureId: "lec_student_attendance_other",
        title: "또 다른것",
        pages: 5
      });
      await saveOwnedSession(server.store, {
        lectureId: firstLecture.id,
        ownerUserId: firstStudent.user.id,
        currentPage: 8,
        learningProgressPage: 8,
        updatedAt: "2026-05-03T09:00:00.000Z"
      });
      await saveOwnedSession(server.store, {
        lectureId: secondLecture.id,
        ownerUserId: firstStudent.user.id,
        currentPage: 5,
        learningProgressPage: 5,
        updatedAt: "2026-05-03T10:00:00.000Z"
      });

      const gradedExam = await createPublishedExamFixture(server.store, {
        classroomId: classroom.id,
        weekId: firstWeek.id,
        title: "중간고사"
      });
      const openExam = await createPublishedExamFixture(server.store, {
        classroomId: classroom.id,
        weekId: secondWeek.id,
        title: "기말 예비"
      });
      const inProgressExam = await createPublishedExamFixture(server.store, {
        classroomId: classroom.id,
        weekId: secondWeek.id,
        title: "진행 중 확인"
      });
      const gradingExam = await createPublishedExamFixture(server.store, {
        classroomId: classroom.id,
        weekId: secondWeek.id,
        title: "채점 대기 확인"
      });
      const missedExam = await createPublishedExamFixture(server.store, {
        classroomId: classroom.id,
        weekId: secondWeek.id,
        title: "마감된 확인",
        availableFrom: "2000-01-01T00:00:00.000Z",
        availableUntil: "2000-01-02T00:00:00.000Z"
      });
      const upcomingExam = await createPublishedExamFixture(server.store, {
        classroomId: classroom.id,
        weekId: secondWeek.id,
        title: "예정된 확인",
        availableFrom: "2099-01-01T00:00:00.000Z",
        availableUntil: "2099-01-02T00:00:00.000Z"
      });
      const draftExam = await server.store.createTeacherExam({
        classroomId: classroom.id,
        weekId: secondWeek.id,
        draftRevision: makeExamRevision({ title: "초안 노출 금지" })
      });
      expect(draftExam).toBeTruthy();
      const privateExam = await createPublishedExamFixture(server.store, {
        classroomId: classroom.id,
        weekId: secondWeek.id,
        title: "비공개 학생 응시 시험"
      });

      const firstAttemptStart = await server.store.getOrCreateExamAttemptForStudent(
        gradedExam.id,
        firstStudent.user.id,
        "2026-05-05T00:00:00.000Z"
      );
      expect(firstAttemptStart.ok).toBe(true);
      if (!firstAttemptStart.ok) throw new Error("expected first attempt");
      const firstClaim = await server.store.claimExamAttemptSubmission(
        firstAttemptStart.attempt.id,
        firstStudent.user.id,
        { [gradedExam.publishedRevision!.questions[0].id]: { choiceId: "a" } },
        "2026-05-05T00:10:00.000Z"
      );
      expect(firstClaim.ok).toBe(true);
      if (!firstClaim.ok || !firstClaim.submissionId) throw new Error("expected first claim");
      await server.store.commitExamAttemptGradingAndUpsertResult({
        attemptId: firstAttemptStart.attempt.id,
        submissionId: firstClaim.submissionId,
        atIso: "2026-05-05T00:10:05.000Z",
        grading: {
          totalScore: 10,
          maxScore: 10,
          scoreRatio: 1,
          items: [
            {
              questionId: gradedExam.publishedRevision!.questions[0].id,
              score: 10,
              maxScore: 10,
              verdict: "CORRECT",
              feedbackMarkdown: "잘했습니다."
            }
          ],
          summaryMarkdown: "만점입니다.",
          gradingSource: "DETERMINISTIC_FALLBACK"
        }
      });

      const privateAttemptStart = await server.store.getOrCreateExamAttemptForStudent(
        privateExam.id,
        secondStudent.user.id,
        "2026-05-05T00:00:00.000Z"
      );
      expect(privateAttemptStart.ok).toBe(true);
      if (!privateAttemptStart.ok) throw new Error("expected private attempt");
      const privateClaim = await server.store.claimExamAttemptSubmission(
        privateAttemptStart.attempt.id,
        secondStudent.user.id,
        { [privateExam.publishedRevision!.questions[0].id]: "LEAK_SECRET_ANSWER" },
        "2026-05-05T00:12:00.000Z"
      );
      expect(privateClaim.ok).toBe(true);
      if (!privateClaim.ok || !privateClaim.submissionId) throw new Error("expected private claim");
      await server.store.commitExamAttemptGradingAndUpsertResult({
        attemptId: privateAttemptStart.attempt.id,
        submissionId: privateClaim.submissionId,
        atIso: "2026-05-05T00:12:05.000Z",
        grading: {
          totalScore: 0,
          maxScore: 10,
          scoreRatio: 0,
          items: [
            {
              questionId: privateExam.publishedRevision!.questions[0].id,
              score: 0,
              maxScore: 10,
              verdict: "WRONG",
              feedbackMarkdown: "LEAK_SECRET_FEEDBACK"
            }
          ],
          summaryMarkdown: "LEAK_SECRET_SUMMARY",
          gradingSource: "DETERMINISTIC_FALLBACK"
        }
      });

      const liveAttemptAt = new Date(Date.now() - 1_000).toISOString();
      const inProgressAttemptStart = await server.store.getOrCreateExamAttemptForStudent(
        inProgressExam.id,
        firstStudent.user.id,
        liveAttemptAt
      );
      expect(inProgressAttemptStart.ok).toBe(true);
      if (!inProgressAttemptStart.ok) throw new Error("expected in-progress attempt");
      const inProgressSave = await server.store.saveExamAttemptAnswers(
        inProgressAttemptStart.attempt.id,
        firstStudent.user.id,
        { [inProgressExam.publishedRevision!.questions[0].id]: "OWN_SECRET_DRAFT_ANSWER" },
        liveAttemptAt
      );
      expect(inProgressSave.ok).toBe(true);

      const gradingAttemptStart = await server.store.getOrCreateExamAttemptForStudent(
        gradingExam.id,
        firstStudent.user.id,
        liveAttemptAt
      );
      expect(gradingAttemptStart.ok).toBe(true);
      if (!gradingAttemptStart.ok) throw new Error("expected grading attempt");
      const gradingClaim = await server.store.claimExamAttemptSubmission(
        gradingAttemptStart.attempt.id,
        firstStudent.user.id,
        { [gradingExam.publishedRevision!.questions[0].id]: "OWN_SECRET_SUBMITTED_ANSWER" },
        liveAttemptAt
      );
      expect(gradingClaim.ok).toBe(true);
      if (!gradingClaim.ok || !gradingClaim.submissionId) throw new Error("expected grading claim");

      const response = await firstStudent.client.request(`/classrooms/${classroom.id}/attendance/me`);
      expect(response.status).toBe(200);
      const responseText = await response.text();
      const payload = JSON.parse(responseText) as {
        data: {
          studentUserId: string;
          totalWeeks: number;
          totalLectureCount: number;
          completedLectureCount: number;
          overallAttendanceRatio: number;
          totalExamCount: number;
          completedExamCount: number;
          weeks: Array<{
            weekTitle: string;
            lectureCount: number;
            lectureAttendanceRatio: number;
            examCount: number;
            completedExamCount: number;
            inProgressExamCount: number;
            missedExamCount: number;
            examStatusLabel: string;
            exams: Array<{
              examId: string;
              title: string;
              participationStatus: string;
              statusLabel: string;
              statusTone: string;
              action: { kind: string; label?: string };
              attempt?: { status: string };
            }>;
          }>;
        };
      };

      expect(payload.data.studentUserId).toBe(firstStudent.user.id);
      expect(payload.data.totalWeeks).toBe(2);
      expect(payload.data.totalLectureCount).toBe(2);
      expect(payload.data.completedLectureCount).toBe(1);
      expect(payload.data.overallAttendanceRatio).toBeCloseTo(0.9);
      expect(payload.data.totalExamCount).toBe(7);
      expect(payload.data.completedExamCount).toBe(2);
      expect(payload.data.weeks[0]).toMatchObject({
        weekTitle: "1주차",
        lectureCount: 2,
        completedExamCount: 1
      });
      expect(payload.data.weeks[0].lectureAttendanceRatio).toBeCloseTo(0.9);
      expect(payload.data.weeks[0].exams[0]).toMatchObject({
        examId: gradedExam.id,
        title: "중간고사",
        participationStatus: "graded",
        statusLabel: "응시 완료",
        statusTone: "complete",
        action: { kind: "result" },
        attempt: { status: "GRADED" }
      });
      const openExamRow = payload.data.weeks[1].exams.find((exam) => exam.examId === openExam.id);
      expect(openExamRow).toMatchObject({
        title: "기말 예비",
        participationStatus: "open",
        statusLabel: "시험 대기",
        action: { kind: "take" }
      });
      const inProgressExamRow = payload.data.weeks[1].exams.find((exam) => exam.examId === inProgressExam.id);
      expect(inProgressExamRow).toMatchObject({
        title: "진행 중 확인",
        participationStatus: "inProgress",
        statusLabel: "응시 중",
        action: { kind: "take" },
        attempt: { status: "IN_PROGRESS" }
      });
      const gradingExamRow = payload.data.weeks[1].exams.find((exam) => exam.examId === gradingExam.id);
      expect(gradingExamRow).toMatchObject({
        title: "채점 대기 확인",
        participationStatus: "submitted",
        statusLabel: "채점 중",
        action: { kind: "disabled", label: "채점 중" },
        attempt: { status: "GRADING" }
      });
      const missedExamRow = payload.data.weeks[1].exams.find((exam) => exam.examId === missedExam.id);
      expect(missedExamRow).toMatchObject({
        title: "마감된 확인",
        participationStatus: "missed",
        statusLabel: "시험 미응시",
        action: { kind: "disabled", label: "시험 종료" }
      });
      const upcomingExamRow = payload.data.weeks[1].exams.find((exam) => exam.examId === upcomingExam.id);
      expect(upcomingExamRow).toMatchObject({
        title: "예정된 확인",
        participationStatus: "upcoming",
        statusLabel: "시험 예정",
        action: { kind: "disabled", label: "시험 예정" }
      });
      expect(payload.data.weeks[1]).toMatchObject({
        examCount: 6,
        completedExamCount: 1,
        inProgressExamCount: 1,
        missedExamCount: 1,
        examStatusLabel: "시험 응시 중"
      });
      expect(payload.data.weeks[1].exams.some((exam) => exam.examId === draftExam!.id)).toBe(false);
      expect(responseText).not.toContain("students");
      expect(responseText).not.toContain("totalStudents");
      expect(responseText).not.toContain(secondStudent.user.id);
      expect(responseText).not.toContain(secondStudent.user.displayName);
      expect(responseText).not.toContain(secondStudent.user.email);
      expect(responseText).not.toContain("inviteCode");
      expect(responseText).not.toContain("maskedEmail");
      expect(responseText).not.toContain("초안 노출 금지");
      expect(responseText).not.toContain(firstAttemptStart.attempt.id);
      expect(responseText).not.toContain(inProgressAttemptStart.attempt.id);
      expect(responseText).not.toContain(gradingAttemptStart.attempt.id);
      expect(responseText).not.toContain(privateAttemptStart.attempt.id);
      expect(responseText).not.toContain("OWN_SECRET_DRAFT_ANSWER");
      expect(responseText).not.toContain("OWN_SECRET_SUBMITTED_ANSWER");
      expect(responseText).not.toContain("LEAK_SECRET_ANSWER");
      expect(responseText).not.toContain("LEAK_SECRET_FEEDBACK");
      expect(responseText).not.toContain("LEAK_SECRET_SUMMARY");

      const teacherStudentEndpointResponse = await teacher.client.request(`/classrooms/${classroom.id}/attendance/me`);
      expect(teacherStudentEndpointResponse.status).toBe(403);
      const studentRosterEndpointResponse = await firstStudent.client.request(`/classrooms/${classroom.id}/attendance`);
      expect(studentRosterEndpointResponse.status).toBe(403);
    } finally {
      await server.close();
    }
  }, 20_000);

  it("returns neutral no-materials status when a classroom has students but no lectures", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "attendance.empty.teacher@example.com",
        role: "teacher",
        displayName: "Empty Teacher"
      });
      const student = await signupClient(server.baseUrl, {
        email: "attendance.empty.student@example.com",
        role: "student",
        displayName: "자료 대기 학생"
      });
      const classroom = await server.store.createClassroom("자료 없는 강의실", teacher.user.id);
      await server.store.createWeek(classroom.id, "1주차");
      await server.store.enrollStudent(classroom.id, student.user.id, teacher.user.id);

      const response = await teacher.client.request(`/classrooms/${classroom.id}/attendance`);
      expect(response.status).toBe(200);
      const payload = await response.json() as {
        data: {
          activeStudentCount: number;
          attentionStudentCount: number;
          totalLectureCount: number;
          students: Array<{ status: string; totalLectureCount: number; totalPages: number }>;
        };
      };

      expect(payload.data.activeStudentCount).toBe(0);
      expect(payload.data.attentionStudentCount).toBe(0);
      expect(payload.data.totalLectureCount).toBe(0);
      expect(payload.data.students[0]).toMatchObject({
        status: "noMaterials",
        totalLectureCount: 0,
        totalPages: 0
      });
    } finally {
      await server.close();
    }
  });
});
