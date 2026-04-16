import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testDir = path.resolve(process.cwd(), "apps/server/data-test");

beforeEach(async () => {
  process.env.PORT = "4000";
  process.env.MODEL_NAME = "gemini-1.5-pro";
  process.env.GOOGLE_API_KEY = "test-key";
  process.env.PASS_SCORE_RATIO = "0.7";
  process.env.CONTEXT_MAX_CHARS = "12000";
  process.env.RECENT_MESSAGES_N = "12";
  process.env.AI_BRIDGE_URL = "http://127.0.0.1:8001";
  process.env.DATA_DIR = "./apps/server/data-test";
  process.env.UPLOAD_DIR = "./apps/server/uploads-test";
  await fs.rm(testDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("JsonStore", () => {
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
});
