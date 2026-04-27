import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd().endsWith(path.join("apps", "server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();
const testDir = path.join(projectRoot, "apps/server/data-test");
const uploadDir = path.join(projectRoot, "apps/server/uploads-test");

beforeEach(async () => {
  process.env.PORT = "4000";
  process.env.MODEL_NAME = "gemini-1.5-pro";
  process.env.GOOGLE_API_KEY = "test-key";
  process.env.PASS_SCORE_RATIO = "0.7";
  process.env.CONTEXT_MAX_CHARS = "12000";
  process.env.RECENT_MESSAGES_N = "12";
  process.env.AI_BRIDGE_URL = "http://127.0.0.1:8001";
  process.env.DATA_DIR = testDir;
  process.env.UPLOAD_DIR = uploadDir;
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe("JsonStore", () => {
  it("serializes same-key locks and continues the queue after rejection", async () => {
    const { FileLock } = await import("../services/storage/FileLock.js");
    const lock = new FileLock();
    const secondLock = new FileLock();
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        lock.withLock("same-key", async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        })
      )
    );

    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const first = lock.withLock("reject-key", async () => {
      order.push("first-start");
      await firstCanFinish;
      order.push("first-fail");
      throw new Error("first failed");
    });
    const second = secondLock.withLock("reject-key", async () => {
      order.push("second-ran");
      return "second ok";
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();

    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second ok");
    expect(maxActive).toBe(1);
    expect(order).toEqual(["first-start", "first-fail", "second-ran"]);
  });

  it("creates and restores session", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    const classroom = await store.createClassroom("테스트");
    const week = await store.createWeek(classroom.id);
    await store.createLecture({
      id: "lec_test",
      weekId: week.id,
      title: "샘플",
      pdfPath: "/tmp/sample.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/sample.pageIndex.json"
    });

    const session = await store.getOrCreateSessionByLecture("lec_test");
    await store.saveSession(session);
    const loaded = await store.getSession(session.sessionId);

    expect(loaded?.sessionId).toBe(session.sessionId);
    expect(loaded?.activeIntervention).toBeNull();
    expect(loaded?.quizAssessments).toEqual([]);
  });

  it("backfills legacy session files without assessments", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    const classroom = await store.createClassroom("레거시 테스트");
    const week = await store.createWeek(classroom.id);
    await store.createLecture({
      id: "lec_legacy",
      weekId: week.id,
      title: "샘플",
      pdfPath: "/tmp/legacy.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/legacy.pageIndex.json"
    });

    const session = await store.getOrCreateSessionByLecture("lec_legacy");
    const legacyPayload = { ...session } as Record<string, unknown>;
    delete legacyPayload.quizAssessments;
    await fs.writeFile(store.sessionPath(session.sessionId), JSON.stringify(legacyPayload, null, 2));

    const loaded = await store.getSession(session.sessionId);
    expect(loaded?.quizAssessments).toEqual([]);
  });

  it("round-trips persisted quiz assessments with delivery metadata intact", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    const classroom = await store.createClassroom("assessment roundtrip");
    const week = await store.createWeek(classroom.id);
    await store.createLecture({
      id: "lec_roundtrip",
      weekId: week.id,
      title: "샘플",
      pdfPath: "/tmp/roundtrip.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/roundtrip.pageIndex.json"
    });

    const session = await store.getOrCreateSessionByLecture("lec_roundtrip");
    session.quizAssessments = [
      {
        id: "asm_roundtrip",
        quizId: "quiz_roundtrip",
        page: 1,
        quizType: "MCQ",
        version: "1.0",
        source: "DETERMINISTIC_V1",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:01:00.000Z",
        scoreRatio: 0.5,
        readiness: "REPAIR_REQUIRED",
        deliveryStatus: "CONSUMED",
        consumedAt: "2026-04-16T00:02:00.000Z",
        strengths: [],
        weaknesses: ["핵심 개념 보강 필요"],
        misconceptions: ["적용 기준 재점검 필요"],
        behaviorSignals: ["반복적으로 흔들리는 패턴"],
        memoryHint: {
          strengths: [],
          weaknesses: ["핵심 개념 보강 필요"],
          misconceptions: ["적용 기준 재점검 필요"],
          explanationPreferences: [],
          preferredQuizTypes: [],
          targetDifficulty: "FOUNDATIONAL",
          nextCoachingGoals: ["오답 이유를 짧게 다시 설명한 뒤 바로 재확인하기"]
        },
        summaryMarkdown: "최근 퀴즈 이해도는 50% 수준입니다.",
        evidence: ["WRONG · 핵심 개념"]
      }
    ];

    await store.saveSession(session);
    const loaded = await store.getSession(session.sessionId);

    expect(loaded?.quizAssessments).toHaveLength(1);
    expect(loaded?.quizAssessments?.[0]?.deliveryStatus).toBe("CONSUMED");
    expect(loaded?.quizAssessments?.[0]?.consumedAt).toBe("2026-04-16T00:02:00.000Z");
  });

  it("groups lectures for multiple weeks with one bulk read API", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    const classroom = await store.createClassroom("bulk lectures");
    const firstWeek = await store.createWeek(classroom.id, "1주차");
    const secondWeek = await store.createWeek(classroom.id, "2주차");
    await store.createLecture({
      id: "lec_first",
      weekId: firstWeek.id,
      title: "첫 강의",
      pdfPath: "/tmp/first.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/first.pageIndex.json"
    });
    await store.createLecture({
      id: "lec_second",
      weekId: secondWeek.id,
      title: "둘째 강의",
      pdfPath: "/tmp/second.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/second.pageIndex.json"
    });

    const grouped = await store.listLecturesByWeekIds([firstWeek.id, secondWeek.id, "wk_empty"]);
    expect(grouped.get(firstWeek.id)?.map((lecture) => lecture.id)).toEqual(["lec_first"]);
    expect(grouped.get(secondWeek.id)?.map((lecture) => lecture.id)).toEqual(["lec_second"]);
    expect(grouped.get("wk_empty")).toEqual([]);
  });

  it("preserves concurrent quiz-result appends", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.appendQuizResultEntries([
          {
            id: `qlog_${index}`,
            sessionId: "ses_concurrent",
            lectureId: "lec_concurrent",
            quizId: `quiz_${index}`,
            quizType: "MCQ",
            page: 1,
            score: 1,
            maxScore: 1,
            scoreRatio: 1,
            summaryMarkdown: "ok",
            createdAt: new Date().toISOString()
          }
        ])
      )
    );

    const raw = await fs.readFile(path.join(testDir, "quiz-results.json"), "utf-8");
    const entries = JSON.parse(raw) as Array<{ id: string }>;
    expect(entries).toHaveLength(12);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(12);
  });

  it("saves and loads classroom report", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    const classroom = await store.createClassroom("리포트 테스트");
    await store.saveClassroomReport({
      schemaVersion: "1.0",
      classroomId: classroom.id,
      classroomTitle: classroom.title,
      studentLabel: "현재 학습자",
      generatedAt: new Date().toISOString(),
      analysisStatus: "READY",
      generationMode: "HEURISTIC_FALLBACK",
      headline: "요약",
      summaryMarkdown: "- 요약",
      overallScore: 70,
      overallLevel: "PROFICIENT",
      competencies: ([
        "CONCEPT_UNDERSTANDING",
        "QUESTION_QUALITY",
        "PROBLEM_SOLVING",
        "APPLICATION_TRANSFER",
        "QUIZ_ACCURACY",
        "LEARNING_PERSISTENCE",
        "SELF_REFLECTION",
        "CLASS_PARTICIPATION",
        "CONFIDENCE_GROWTH",
        "IMPROVEMENT_MOMENTUM"
      ] as const).map((key) => ({
        key,
        label: key,
        score: 70,
        trend: "STEADY" as const,
        summary: "ok",
        evidence: ["근거"]
      })),
      strengths: ["강점"],
      growthAreas: ["보완"],
      coachingInsights: ["인사이트"],
      recommendedActions: [
        {
          title: "복습",
          description: "설명"
        }
      ],
      lectureInsights: [],
      sourceStats: {
        lectureCount: 0,
        sessionCount: 0,
        completedPageCount: 0,
        pageCoverageRatio: 0,
        questionCount: 0,
        quizCount: 0,
        gradedQuizCount: 0,
        averageQuizScore: 0,
        feedbackCount: 0,
        memoryRefreshCount: 0
      },
      dataQualityNote: "ok"
    });

    const loaded = await store.getClassroomReport(classroom.id);
    expect(loaded?.classroomId).toBe(classroom.id);
  });

  it("keeps classroom aggregate and student scoped reports separate", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    const classroom = await store.createClassroom("스코프 리포트 테스트");
    const makeReport = (scope: "CLASSROOM_AGGREGATE" | "STUDENT") => ({
      schemaVersion: "1.0" as const,
      classroomId: classroom.id,
      reportScope: scope,
      studentUserId: scope === "STUDENT" ? "usr_student" : undefined,
      classroomTitle: classroom.title,
      studentLabel: scope,
      generatedAt: new Date().toISOString(),
      analysisStatus: "READY" as const,
      generationMode: "HEURISTIC_FALLBACK" as const,
      headline: scope,
      summaryMarkdown: "- 요약",
      overallScore: 70,
      overallLevel: "PROFICIENT" as const,
      competencies: ([
        "CONCEPT_UNDERSTANDING",
        "QUESTION_QUALITY",
        "PROBLEM_SOLVING",
        "APPLICATION_TRANSFER",
        "QUIZ_ACCURACY",
        "LEARNING_PERSISTENCE",
        "SELF_REFLECTION",
        "CLASS_PARTICIPATION",
        "CONFIDENCE_GROWTH",
        "IMPROVEMENT_MOMENTUM"
      ] as const).map((key) => ({
        key,
        label: key,
        score: 70,
        trend: "STEADY" as const,
        summary: "ok",
        evidence: ["근거"]
      })),
      strengths: [],
      growthAreas: [],
      coachingInsights: [],
      recommendedActions: [],
      lectureInsights: [],
      sourceStats: {
        lectureCount: 0,
        sessionCount: 0,
        completedPageCount: 0,
        pageCoverageRatio: 0,
        questionCount: 0,
        quizCount: 0,
        gradedQuizCount: 0,
        averageQuizScore: 0,
        feedbackCount: 0,
        memoryRefreshCount: 0
      },
      dataQualityNote: "ok"
    });

    await store.saveClassroomReport(makeReport("STUDENT"));
    await store.saveClassroomReport(makeReport("CLASSROOM_AGGREGATE"));

    const aggregate = await store.getClassroomReport(classroom.id);
    expect(aggregate?.reportScope).toBe("CLASSROOM_AGGREGATE");
    expect(await store.listClassroomReports()).toHaveLength(2);
  });
});
