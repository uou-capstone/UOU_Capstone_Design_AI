import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SystemExamClock } from "../services/exams/ExamClock.js";
import { ConsoleExamLogger } from "../services/exams/ExamLogger.js";
import { TeacherExamGradingService } from "../services/exams/TeacherExamGradingService.js";
import { TeacherExamService } from "../services/exams/TeacherExamService.js";
import { JsonStore } from "../services/storage/JsonStore.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-teacher-exam-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-teacher-exam-test");

class MutableClock extends SystemExamClock {
  constructor(private current: string) {
    super();
  }

  set(value: string) {
    this.current = value;
  }

  now(): Date {
    return new Date(this.current);
  }
}

class MemoryExamLogger extends ConsoleExamLogger {
  readonly events: Array<{ name: string; payload: unknown }> = [];

  event(name: string, payload: any): void {
    this.events.push({ name, payload });
  }
}

const baseDraft = {
  title: "중간 점검",
  descriptionMarkdown: "직접 만든 시험",
  availableFrom: "2026-05-02T00:00:00.000Z",
  availableUntil: "2026-05-03T00:00:00.000Z",
  timeLimitMinutes: 30,
  passScoreRatio: 0.7,
  aiGradingEnabled: false,
  questions: [
    {
      id: "q1",
      type: "MCQ",
      promptMarkdown: "2 + 2 = ?",
      points: 5,
      choices: [
        { id: "a", textMarkdown: "3" },
        { id: "b", textMarkdown: "4" }
      ],
      answer: { choiceId: "b" },
      explanationMarkdown: "2와 2를 더하면 4입니다."
    },
    {
      id: "q2",
      type: "SHORT",
      promptMarkdown: "선형회귀의 목표를 쓰세요.",
      points: 5,
      referenceAnswer: { text: "오차 최소화" },
      rubricMarkdown: "오차를 줄인다는 핵심이 있어야 함"
    }
  ]
} as const;

beforeEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

async function makeService(
  clock = new MutableClock("2026-05-02T00:10:00.000Z"),
  logger = new ConsoleExamLogger(),
  grading = new TeacherExamGradingService()
) {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const service = new TeacherExamService(
    store,
    grading,
    clock,
    logger
  );
  const classroom = await store.createClassroom("시험 강의실", "teacher-1");
  const week = await store.createWeek(classroom.id, "1주차");
  return { store, service, classroom, week, clock, logger };
}

describe("teacher-authored exams", () => {
  it("does not expose draft exams to students", async () => {
    const { service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);

    await expect(service.studentMetadataDto(exam, "student-1")).rejects.toMatchObject({
      code: "NOT_PUBLISHED"
    });
  });

  it("snapshots the active published revision when the student starts", async () => {
    const { store, service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);

    const started = await store.getOrCreateExamAttemptForStudent(
      published.id,
      "student-1",
      "2026-05-02T00:10:00.000Z"
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.attempt.examVersion).toBe(1);
    expect(started.attempt.examSnapshot.questions[0].promptMarkdown).toBe("2 + 2 = ?");

    await service.publish(published.id, {
      ...baseDraft,
      title: "수정된 시험",
      questions: [
        {
          ...baseDraft.questions[0],
          promptMarkdown: "3 + 3 = ?"
        }
      ]
    });

    const resumed = await store.getOrCreateExamAttemptForStudent(
      published.id,
      "student-1",
      "2026-05-02T00:12:00.000Z"
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.attempt.examVersion).toBe(1);
    expect(resumed.attempt.examSnapshot.questions[0].promptMarkdown).toBe("2 + 2 = ?");
  });

  it("grades objective and short answers deterministically", async () => {
    const grading = new TeacherExamGradingService().gradeDeterministically(
      {
        ...baseDraft,
        version: 1,
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
        questions: [...baseDraft.questions] as any
      },
      {
        q1: { choiceId: "b" },
        q2: "오차 최소화"
      },
      false
    );
    expect(grading.totalScore).toBe(10);
    expect(grading.items.every((item) => item.verdict === "CORRECT")).toBe(true);
  });

  it("does not treat unanswered false OX questions as correct", async () => {
    const exam = {
      ...baseDraft,
      version: 1,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      questions: [
        {
          id: "q-ox",
          type: "OX",
          promptMarkdown: "모든 행렬은 역행렬을 가진다.",
          points: 4,
          answer: { value: false }
        }
      ]
    } as any;

    const unanswered = new TeacherExamGradingService().gradeDeterministically(exam, {}, false);
    const answered = new TeacherExamGradingService().gradeDeterministically(
      exam,
      { "q-ox": { value: false } },
      false
    );

    expect(unanswered.totalScore).toBe(0);
    expect(answered.totalScore).toBe(4);
  });

  it("rejects OX questions without an explicit answer", async () => {
    const { service } = await makeService();
    const draft = service.normalizeDraft({
      ...baseDraft,
      questions: [
        {
          id: "q-ox-missing",
          type: "OX",
          promptMarkdown: "정답이 명시되지 않은 OX",
          points: 2,
          answer: {}
        }
      ]
    });

    expect(service.validatePublish(draft)).toContain("OX 문항의 정답을 지정해 주세요.");
  });

  it("rejects blank MCQ choices before publish", async () => {
    const { service } = await makeService();
    const draft = service.normalizeDraft({
      ...baseDraft,
      questions: [
        {
          ...baseDraft.questions[0],
          choices: [
            { id: "a", textMarkdown: "" },
            { id: "b", textMarkdown: "4" }
          ]
        }
      ]
    });

    expect(service.validatePublish(draft)).toContain("객관식 문항의 모든 선택지 내용을 입력해 주세요.");
  });

  it("hides explanations until grading is complete", async () => {
    const { service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);

    const started = await service.startAttempt(published.id, "student-1");
    expect(started.questions[0].explanationMarkdown).toBeUndefined();
    const attemptId = started.id;
    if (!attemptId) {
      throw new Error("expected an in-progress attempt id");
    }
    const graded = await service.submitAttempt(attemptId, "student-1", {
      q1: { choiceId: "b" },
      q2: "오차 최소화"
    });
    expect(graded.questions[0].explanationMarkdown).toBe("2와 2를 더하면 4입니다.");
  });

  it("rejects brand-new answer submissions after the grace cutoff", async () => {
    const { service, classroom, week, clock } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, {
      ...baseDraft,
      timeLimitMinutes: 1
    });
    const published = await service.publish(exam.id, {
      ...baseDraft,
      timeLimitMinutes: 1
    });

    const started = await service.startAttempt(published.id, "student-1");
    const attemptId = started.id;
    if (!attemptId) {
      throw new Error("expected an in-progress attempt id");
    }
    clock.set("2026-05-02T00:11:06.000Z");

    await expect(
      service.submitAttempt(attemptId, "student-1", { q1: { choiceId: "b" } })
    ).rejects.toMatchObject({
      status: 409,
      code: "LATE_AFTER_GRACE"
    });
  });

  it("sanitizes AI studio operation proposals before they reach the client", async () => {
    const { service } = await makeService();
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "**제안입니다.**",
        operations: [
          {
            method: "patchExamSettings",
            params: {
              title: "AI 시험",
              timeLimitMinutes: 999,
              passScoreRatio: 2,
              aiGradingEnabled: true,
              ignored: "drop"
            }
          },
          {
            method: "appendQuestions",
            params: {
              questions: [
                {
                  id: "q-bad",
                  type: "MCQ",
                  promptMarkdown: "빈 선택지는 탈락해야 한다.",
                  points: 3,
                  choices: [
                    { id: "a", textMarkdown: "" },
                    { id: "b", textMarkdown: "내용" }
                  ],
                  answer: { choiceId: "b" }
                },
                {
                  type: "OX",
                  promptMarkdown: "ID 없는 문항은 탈락해야 한다.",
                  points: 3,
                  answer: { value: true }
                },
                {
                  id: "q-no-type",
                  promptMarkdown: "유형 없는 문항은 탈락해야 한다.",
                  points: 3,
                  answer: { value: true }
                },
                {
                  id: "q-no-points",
                  type: "OX",
                  promptMarkdown: "배점 없는 문항은 탈락해야 한다.",
                  answer: { value: true }
                },
                {
                  id: "q-ai",
                  type: "OX",
                  promptMarkdown: "경사하강법은 손실을 줄이는 방향으로 이동한다.",
                  points: 3,
                  answer: { value: true },
                  extra: "drop"
                },
                {
                  id: "q-missing-ox",
                  type: "OX",
                  promptMarkdown: "정답 없는 OX는 탈락해야 한다.",
                  points: 3,
                  answer: {}
                },
                {
                  id: "q-ai",
                  type: "OX",
                  promptMarkdown: "중복 ID는 탈락해야 한다.",
                  points: 3,
                  answer: { value: true }
                }
              ]
            }
          }
        ],
        source: "UNTRUSTED"
      },
      baseDraft
    );

    expect(proposal.answerMarkdown).toBe("**제안입니다.**");
    expect(proposal.replyMarkdown).toBe("**제안입니다.**");
    expect(proposal.settingsPatch?.timeLimitMinutes).toBe(240);
    expect(proposal.settingsPatch?.passScoreRatio).toBe(1);
    expect(proposal.appendQuestions?.[0]).toMatchObject({
      id: "q-ai",
      type: "OX",
      answer: { value: true }
    });
    expect(proposal.appendQuestions).toHaveLength(1);
    expect(proposal.replaceQuestionId).toBeUndefined();
    expect(proposal.source).toBe("AI");
    expect(proposal.operations?.map((operation) => operation.method)).toEqual([
      "patchExamSettings",
      "appendQuestions"
    ]);
  });

  it("ignores legacy mutation fields unless explicit compatibility mode is enabled", async () => {
    const { service } = await makeService();
    const raw = {
      answerMarkdown: "제안입니다.",
      settingsPatch: { title: "legacy 제목", timeLimitMinutes: 20 },
      appendQuestions: [
        {
          id: "q_legacy",
          type: "OX",
          promptMarkdown: "legacy 문항",
          points: 1,
          answer: { value: true }
        }
      ],
      source: "AI"
    };

    const proposal = service.sanitizeExamStudioProposal(raw, baseDraft);
    expect(proposal.settingsPatch).toBeUndefined();
    expect(proposal.appendQuestions).toBeUndefined();
    expect(proposal.operations).toBeUndefined();

    const legacyProposal = service.sanitizeExamStudioProposal(raw, baseDraft, {
      allowLegacyMutationFields: true
    });
    expect(legacyProposal.settingsPatch).toMatchObject({ title: "legacy 제목", timeLimitMinutes: 20 });
    expect(legacyProposal.appendQuestions).toHaveLength(1);
    expect(legacyProposal.operations?.map((operation) => operation.method)).toEqual([
      "patchExamSettings",
      "appendQuestions"
    ]);
  });

  it("uses answerMarkdown as the reply source when legacy reply text conflicts", async () => {
    const { service } = await makeService();
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "최신 JSON 답변입니다.",
        replyMarkdown: "예전 호환 답변입니다.",
        operations: [],
        source: "AI"
      },
      baseDraft
    );

    expect(proposal.answerMarkdown).toBe("최신 JSON 답변입니다.");
    expect(proposal.replyMarkdown).toBe("최신 JSON 답변입니다.");
  });

  it("sanitizes AI studio operations into method calls", async () => {
    const { service } = await makeService();
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "바로 반영할게요.",
        operations: [
          {
            method: "patchExamSettings",
            params: {
              availableFrom: "2026-05-02T01:00:00.000Z",
              availableUntil: "2026-05-02T02:30:00.000Z",
              timeLimitMinutes: 999
            }
          },
          {
            method: "appendQuestions",
            params: {
              questions: [
                {
                  id: "q_new",
                  type: "OX",
                  promptMarkdown: "경사하강법은 손실을 줄이는 방향으로 이동한다.",
                  points: 3,
                  answer: { value: true }
                }
              ]
            }
          },
          {
            method: "replaceQuestion",
            params: {
              replaceQuestionId: "q1",
              question: {
                id: "q1",
                type: "MCQ",
                promptMarkdown: "2 + 2의 값은?",
                points: 5,
                choices: [
                  { id: "a", textMarkdown: "4" },
                  { id: "b", textMarkdown: "5" }
                ],
                answer: { choiceId: "a" }
              }
            }
          },
          {
            method: "deleteEverything",
            params: {}
          }
        ]
      },
      baseDraft
    );

    expect(proposal.settingsPatch).toMatchObject({
      availableFrom: "2026-05-02T01:00:00.000Z",
      availableUntil: "2026-05-02T02:30:00.000Z",
      timeLimitMinutes: 240
    });
    expect(proposal.operations?.map((operation) => operation.method)).toEqual([
      "patchExamSettings",
      "appendQuestions",
      "replaceQuestion"
    ]);
    expect(proposal.appendQuestions).toHaveLength(2);
    expect(proposal.replaceQuestionId).toBe("q1");
  });

  it("does not infer exam setting operations from teacher natural language or answer text", async () => {
    const logger = new MemoryExamLogger();
    const { service } = await makeService(undefined, logger);
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "시험 시작 시간을 내일 오후 3시로 바꾸겠습니다.",
        source: "AI"
      },
      baseDraft
    );

    expect(proposal.replyMarkdown).toBe("시험 시작 시간을 내일 오후 3시로 바꾸겠습니다.");
    expect(proposal.settingsPatch).toBeUndefined();
    expect(proposal.operations).toBeUndefined();
    expect(logger.events.some((event) => event.name === "[exam_studio_time_repair]")).toBe(false);
  });

  it("drops malformed time operations instead of repairing them from text", async () => {
    const { service } = await makeService();
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "시험 시작 시간을 2026년 5월 3일 오후 2시로, 제한 시간을 1시간으로 변경했습니다.",
        operations: [
          {
            method: "patchExamSettings",
            params: {
              availableFrom: "5월 3일 오후 2시",
              timeLimitMinutes: "1시간"
            }
          }
        ],
        source: "AI"
      },
      baseDraft
    );

    expect(proposal.settingsPatch).toBeUndefined();
    expect(proposal.operations).toBeUndefined();
  });

  it("drops impossible or timezone-less ISO time operation params", async () => {
    const { service } = await makeService();
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "시간 변경을 시도했습니다.",
        operations: [
          {
            method: "patchExamSettings",
            params: {
              availableFrom: "2026-02-31T14:00:00+09:00",
              availableUntil: "2026-05-03T15:30:00",
              timeLimitMinutes: 30
            }
          }
        ],
        source: "AI"
      },
      baseDraft
    );

    expect(proposal.settingsPatch).toEqual({ timeLimitMinutes: 30 });
    expect(proposal.operations?.[0]).toMatchObject({
      method: "patchExamSettings",
      params: { timeLimitMinutes: 30 }
    });
    expect(JSON.stringify(proposal)).not.toContain("2026-02-31");
    expect(JSON.stringify(proposal)).not.toContain("2026-05-03T15:30:00");
  });

  it("accepts explicit LLM time operations and normalizes them", async () => {
    const { service } = await makeService();
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "시험 시작 시간을 내일 오후 3시로 옮기고 종료 시간을 오후 3시 30분으로 설정했습니다.",
        operations: [
          {
            method: "patchExamSettings",
            params: {
              availableFrom: "2026-05-03T15:00:00+09:00",
              availableUntil: "2026-05-03T15:30:00+09:00",
              timeLimitMinutes: 30
            }
          }
        ]
      },
      baseDraft
    );

    expect(proposal.settingsPatch).toMatchObject({
      availableFrom: "2026-05-03T06:00:00.000Z",
      availableUntil: "2026-05-03T06:30:00.000Z",
      timeLimitMinutes: 30
    });
  });

  it("strips all mutation fields from fallback AI studio proposals", async () => {
    const logger = new MemoryExamLogger();
    const { service } = await makeService(undefined, logger);
    const proposal = service.sanitizeExamStudioProposal(
      {
        replyMarkdown: "AI를 사용할 수 없습니다.",
        fallback: true,
        source: "AI_UNAVAILABLE",
        settingsPatch: { title: "반영되면 안 됨" },
        operations: [
          {
            method: "patchExamSettings",
            params: { timeLimitMinutes: 10 }
          }
        ],
        appendQuestions: [
          {
            id: "q_fallback",
            type: "OX",
            promptMarkdown: "fallback 문항",
            points: 1,
            answer: { value: true }
          }
        ]
      },
      baseDraft
    );

    expect(proposal).toEqual({
      replyMarkdown: "AI를 사용할 수 없습니다.",
      fallback: true,
      source: "AI_UNAVAILABLE"
    });
    expect(logger.events.some((event) => event.name === "[exam_studio_time_repair]")).toBe(false);
  });

  it("does not expose answers or grading aids while a student attempt is in progress", async () => {
    const { service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);
    const attempt = await service.startAttempt(published.id, "student-1");

    expect(attempt.questions?.[0]).toMatchObject({
      id: "q1",
      type: "MCQ",
      promptMarkdown: "2 + 2 = ?",
      points: 5,
      choices: [
        { id: "a", textMarkdown: "3" },
        { id: "b", textMarkdown: "4" }
      ]
    });
    expect(attempt.questions?.[0]).not.toHaveProperty("answer");
    expect(attempt.questions?.[0]).not.toHaveProperty("referenceAnswer");
    expect(attempt.questions?.[0]).not.toHaveProperty("rubricMarkdown");
    expect(attempt.questions?.[0]).not.toHaveProperty("modelAnswerMarkdown");
    expect(attempt.questions?.[0]).not.toHaveProperty("explanationMarkdown");
  });

  it("finalizes expired attempts when reports are read", async () => {
    const { service, classroom, week, clock } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, {
      ...baseDraft,
      timeLimitMinutes: 1
    });
    const published = await service.publish(exam.id, {
      ...baseDraft,
      timeLimitMinutes: 1
    });

    await service.startAttempt(published.id, "student-1");
    clock.set("2026-05-02T00:11:06.000Z");
    const report = await service.report(published);

    expect(report.summary.attemptCount).toBe(1);
    expect(report.summary.gradedCount).toBe(1);
  });

  it("marks AI grading bridge failures as fallback and logs them", async () => {
    const logger = new MemoryExamLogger();
    const grading = new TeacherExamGradingService({
      gradeTeacherExam: async () => {
        throw new Error("bridge down");
      }
    } as any);
    const { service, classroom, week } = await makeService(
      new MutableClock("2026-05-02T00:10:00.000Z"),
      logger,
      grading
    );
    const draft = { ...baseDraft, aiGradingEnabled: true };
    const exam = await service.createExam(week.id, classroom.id, draft);
    const published = await service.publish(exam.id, draft);
    const started = await service.startAttempt(published.id, "student-1");
    const attemptId = started.id;
    if (!attemptId) {
      throw new Error("expected an in-progress attempt id");
    }

    const graded = await service.submitAttempt(attemptId, "student-1", {
      q1: { choiceId: "b" },
      q2: "오차 최소화"
    });

    expect(graded.grading?.fallback).toBe(true);
    expect(logger.events.some((event) => event.name === "[exam_submit]")).toBe(true);
    expect(logger.events.some((event) => event.name === "[exam_ai_grade_fallback]")).toBe(true);
  });

  it("treats malformed AI grading payloads as deterministic fallback", async () => {
    const logger = new MemoryExamLogger();
    const grading = new TeacherExamGradingService({
      gradeTeacherExam: async () => ({ items: [], summaryMarkdown: "malformed" })
    } as any);
    const { service, classroom, week } = await makeService(
      new MutableClock("2026-05-02T00:10:00.000Z"),
      logger,
      grading
    );
    const draft = { ...baseDraft, aiGradingEnabled: true };
    const exam = await service.createExam(week.id, classroom.id, draft);
    const published = await service.publish(exam.id, draft);
    const started = await service.startAttempt(published.id, "student-1");
    const attemptId = started.id;
    if (!attemptId) {
      throw new Error("expected an in-progress attempt id");
    }

    const graded = await service.submitAttempt(attemptId, "student-1", {
      q1: { choiceId: "b" },
      q2: "오차 최소화"
    });

    expect(graded.grading?.fallback).toBe(true);
    expect(graded.grading?.totalScore).toBe(10);
    expect(logger.events.some((event) => event.name === "[exam_ai_grade_fallback]")).toBe(true);
  });

  it("recovers stale grading leases when reports are read", async () => {
    const { store, service, classroom, week, clock } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);
    const started = await service.startAttempt(published.id, "student-1");
    const attemptId = started.id;
    if (!attemptId) {
      throw new Error("expected an in-progress attempt id");
    }
    const claimed = await store.claimExamAttemptSubmission(
      attemptId,
      "student-1",
      { q1: { choiceId: "b" }, q2: "오차 최소화" },
      "2026-05-02T00:10:30.000Z"
    );
    expect(claimed.ok).toBe(true);
    clock.set("2026-05-02T00:12:01.000Z");

    const report = await service.report(published);

    expect(report.summary.gradedCount).toBe(1);
    expect(report.summary.averageScore).toBe(10);
  });

  it("uses the deadline grace cutoff for late autosave", async () => {
    const { service, classroom, week, clock } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, {
      ...baseDraft,
      timeLimitMinutes: 1
    });
    const published = await service.publish(exam.id, {
      ...baseDraft,
      timeLimitMinutes: 1
    });

    const started = await service.startAttempt(published.id, "student-1");
    expect(started.status).toBe("IN_PROGRESS");
    const attemptId = started.id;
    if (!attemptId) {
      throw new Error("expected an in-progress attempt id");
    }
    await service.saveAnswers(attemptId, "student-1", { q1: { choiceId: "b" } });
    clock.set("2026-05-02T00:11:06.000Z");
    const finalized = await service.saveAnswers(attemptId, "student-1", {
      q1: { choiceId: "a" }
    });
    expect(finalized.status).toBe("GRADED");
    expect(finalized.grading?.totalScore).toBe(5);
  });
});
