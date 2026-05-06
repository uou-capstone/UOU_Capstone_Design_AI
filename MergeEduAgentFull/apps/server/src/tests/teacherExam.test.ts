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

async function enrollTestStudent(
  store: JsonStore,
  classroomId: string,
  suffix: string
) {
  const user = await store.createUser({
    email: `student-${suffix}@mergedu.local`,
    emailNormalized: `student-${suffix}@mergedu.local`,
    displayName: `시나리오1 학생 ${suffix}`,
    role: "student",
    inviteCode: `STU${suffix}`
  });
  await store.enrollStudent(classroomId, user.id, "teacher-1");
  return user;
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

  it("updates draft exam settings without mutating questions", async () => {
    const { service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);

    const updated = await service.updateSettings(exam.id, {
      title: "설정만 수정한 시험",
      availableFrom: "2026-05-02T01:00:00.000Z",
      availableUntil: "2026-05-03T01:00:00.000Z",
      timeLimitMinutes: 45
    });

    expect(updated.status).toBe("DRAFT");
    expect(updated.draftRevision.title).toBe("설정만 수정한 시험");
    expect(updated.draftRevision.timeLimitMinutes).toBe(45);
    expect(updated.draftRevision.questions).toEqual(exam.draftRevision.questions);
    expect(updated.publishedRevision).toBeUndefined();
  });

  it("updates published settings without publishing draft-only question edits or mutating attempts", async () => {
    const { store, service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);
    const started = await service.startAttempt(published.id, "student-1");
    if (!started.id) {
      throw new Error("expected an in-progress attempt id");
    }
    const originalAttempt = await store.getTeacherExamAttempt(started.id);
    expect(originalAttempt?.settingsSnapshot.title).toBe("중간 점검");
    expect(originalAttempt?.settingsSnapshot.timeLimitMinutes).toBe(30);

    await service.updateDraft(published.id, {
      ...baseDraft,
      title: "미공개 드래프트 제목",
      questions: [
        {
          ...baseDraft.questions[0],
          promptMarkdown: "드래프트에서만 바꾼 문항"
        }
      ]
    });

    const updated = await service.updateSettings(published.id, {
      title: "공개 일정 수정",
      availableFrom: "2026-05-02T00:05:00.000Z",
      availableUntil: "2026-05-03T02:00:00.000Z",
      timeLimitMinutes: 45
    });

    expect(updated.status).toBe("PUBLISHED");
    expect(updated.activePublishedVersion).toBe(updated.publishedRevision?.version);
    expect(updated.draftRevision.title).toBe("공개 일정 수정");
    expect(updated.draftRevision.questions[0].promptMarkdown).toBe("드래프트에서만 바꾼 문항");
    expect(updated.publishedRevision?.title).toBe("공개 일정 수정");
    expect(updated.publishedRevision?.questions[0].promptMarkdown).toBe("2 + 2 = ?");
    expect(updated.publishedRevision?.timeLimitMinutes).toBe(45);

    const metadata = await service.studentMetadataDto(updated, "student-2");
    expect(metadata.title).toBe("공개 일정 수정");
    expect(metadata.timeLimitMinutes).toBe(45);

    const persistedAttempt = await store.getTeacherExamAttempt(started.id);
    expect(persistedAttempt?.settingsSnapshot.title).toBe("중간 점검");
    expect(persistedAttempt?.settingsSnapshot.timeLimitMinutes).toBe(30);
    expect(persistedAttempt?.examSnapshot.questions[0].promptMarkdown).toBe("2 + 2 = ?");
  });

  it("rejects invalid settings patches", async () => {
    const { service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);

    await expect(
      service.updateSettings(exam.id, {
        title: " ",
        availableFrom: "2026-05-03T00:00:00.000Z",
        availableUntil: "2026-05-02T00:00:00.000Z",
        timeLimitMinutes: 0
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });

    await expect(
      service.updateSettings(exam.id, {
        title: "a".repeat(101),
        availableFrom: "not-a-date",
        availableUntil: "2026-05-03T00:00:00.000Z",
        timeLimitMinutes: 30
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });
  });

  it("rejects settings, draft saves, and publish after the active exam schedule ended", async () => {
    const { service, classroom, week, clock } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);
    clock.set("2026-05-03T00:00:01.000Z");

    await expect(
      service.updateSettings(published.id, {
        title: "종료 후 설정 수정",
        availableFrom: "2026-05-04T00:00:00.000Z",
        availableUntil: "2026-05-05T00:00:00.000Z",
        timeLimitMinutes: 45
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EXAM_ENDED"
    });

    await expect(
      service.updateDraft(published.id, {
        ...baseDraft,
        title: "종료 후 드래프트 수정",
        availableFrom: "2026-05-04T00:00:00.000Z",
        availableUntil: "2026-05-05T00:00:00.000Z"
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EXAM_ENDED"
    });

    await expect(
      service.publish(published.id, {
        ...baseDraft,
        title: "종료 후 재게시",
        availableFrom: "2026-05-04T00:00:00.000Z",
        availableUntil: "2026-05-05T00:00:00.000Z"
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EXAM_ENDED"
    });
  });

  it("locks draft-only exams after their draft schedule ended", async () => {
    const { service, classroom, week, clock } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    clock.set("2026-05-03T00:00:01.000Z");

    await expect(
      service.updateSettings(exam.id, {
        title: "종료된 드래프트 설정",
        availableFrom: "2026-05-04T00:00:00.000Z",
        availableUntil: "2026-05-05T00:00:00.000Z",
        timeLimitMinutes: 45
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EXAM_ENDED"
    });

    await expect(
      service.updateDraft(exam.id, {
        ...baseDraft,
        title: "종료된 드래프트 저장",
        availableFrom: "2026-05-04T00:00:00.000Z",
        availableUntil: "2026-05-05T00:00:00.000Z"
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EXAM_ENDED"
    });

    await expect(
      service.publish(exam.id, {
        ...baseDraft,
        title: "종료된 드래프트 게시",
        availableFrom: "2026-05-04T00:00:00.000Z",
        availableUntil: "2026-05-05T00:00:00.000Z"
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EXAM_ENDED"
    });
  });

  it("locks published exams by the active published schedule even when the draft schedule is future", async () => {
    const { service, classroom, week, clock } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);

    await service.updateDraft(published.id, {
      ...baseDraft,
      title: "미래 드래프트",
      availableFrom: "2026-05-04T00:00:00.000Z",
      availableUntil: "2026-05-05T00:00:00.000Z"
    });

    clock.set("2026-05-03T00:00:01.000Z");

    await expect(
      service.updateSettings(published.id, {
        title: "활성 일정 종료 후 수정",
        availableFrom: "2026-05-04T00:00:00.000Z",
        availableUntil: "2026-05-05T00:00:00.000Z",
        timeLimitMinutes: 45
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EXAM_ENDED"
    });
  });

  it("rejects malformed draft and publish schedule input instead of silently falling back", async () => {
    const { service, classroom, week } = await makeService();
    const exam = await service.createExam(week.id, classroom.id, baseDraft);

    await expect(
      service.updateDraft(exam.id, {
        ...baseDraft,
        availableFrom: "not-a-date"
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });

    await expect(
      service.publish(exam.id, {
        ...baseDraft,
        availableUntil: "not-a-date"
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });

    await expect(
      service.updateDraft(exam.id, {
        ...baseDraft,
        timeLimitMinutes: 45.5
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });

    await expect(
      service.updateDraft(exam.id, {
        ...baseDraft,
        availableFrom: "2026-02-31T14:00:00+09:00"
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });

    await expect(
      service.publish(exam.id, {
        ...baseDraft,
        availableUntil: "2026-05-03T15:30:00"
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });
  });

  it("rejects malformed create schedule input before a draft can be published later", async () => {
    const { store, service, classroom, week } = await makeService();
    const malformedPayloads = [
      { ...baseDraft, availableFrom: "not-a-date" },
      { ...baseDraft, availableUntil: "2026-02-31T14:00:00+09:00" },
      { ...baseDraft, availableFrom: "2026-05-02T15:30:00" },
      { ...baseDraft, availableFrom: "2026-05-03T00:00:00.000Z", availableUntil: "2026-05-02T00:00:00.000Z" },
      { ...baseDraft, timeLimitMinutes: 45.5 }
    ];

    for (const payload of malformedPayloads) {
      await expect(service.createExam(week.id, classroom.id, payload)).rejects.toMatchObject({
        status: 400,
        code: "VALIDATION_ERROR"
      });
    }

    await expect(store.listTeacherExamsByWeek(week.id)).resolves.toEqual([]);
  });

  it("publishes short-answer questions with rubric or model answer without reference answer", async () => {
    const { service, classroom, week } = await makeService();
    const validDraft = {
      ...baseDraft,
      questions: [
        {
          id: "q-short-model",
          type: "SHORT",
          promptMarkdown: "핵심 개념을 쓰세요.",
          points: 5,
          referenceAnswer: { text: "" },
          rubricMarkdown: "",
          modelAnswerMarkdown: "모범 답안"
        }
      ]
    } as any;
    const validExam = await service.createExam(week.id, classroom.id, validDraft);
    await expect(service.publish(validExam.id, validDraft)).resolves.toMatchObject({
      id: validExam.id,
      status: "PUBLISHED"
    });

    const invalidDraft = {
      ...baseDraft,
      questions: [
        {
          id: "q-short-empty",
          type: "SHORT",
          promptMarkdown: "비어 있는 단답식",
          points: 5,
          referenceAnswer: { text: "" },
          rubricMarkdown: "",
          modelAnswerMarkdown: ""
        }
      ]
    } as any;
    const invalidExam = await service.createExam(week.id, classroom.id, invalidDraft);
    try {
      await service.publish(invalidExam.id, invalidDraft);
      throw new Error("expected publish to fail");
    } catch (error) {
      expect((error as Error).message).toContain("채점 기준 또는 모범 답안");
      expect((error as Error).message).not.toContain("기준 답안");
    }
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

  it("excludes written questions from grading totals when AI written grading is disabled", async () => {
    const grading = await new TeacherExamGradingService().grade({
      model: "test-model",
      exam: {
        ...baseDraft,
        version: 1,
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
        questions: [...baseDraft.questions] as any
      },
      answers: {
        q1: { choiceId: "b" },
        q2: "오차 최소화"
      },
      aiEnabled: false
    });

    expect(grading.totalScore).toBe(5);
    expect(grading.maxScore).toBe(5);
    expect(grading.items[0]).toMatchObject({ questionId: "q1", maxScore: 5, gradingMode: "SYSTEM" });
    expect(grading.items[1]).toMatchObject({
      questionId: "q2",
      maxScore: 0,
      excludedFromScore: true,
      gradingMode: "EXCLUDED"
    });
  });

  it("grades short answers from the visible model answer instead of stale references", async () => {
    const exam = {
      ...baseDraft,
      version: 1,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      questions: [
        {
          id: "q-short",
          type: "SHORT",
          promptMarkdown: "주요 개념을 쓰세요.",
          points: 5,
          referenceAnswer: { text: "숨은 기준" },
          rubricMarkdown: "모범 답안 핵심",
          modelAnswerMarkdown: "보이는 모범 답안"
        }
      ]
    } as any;
    const grading = new TeacherExamGradingService();

    const visibleAnswer = grading.gradeDeterministically(exam, { "q-short": "보이는 모범 답안" }, false);
    const staleReference = grading.gradeDeterministically(exam, { "q-short": "숨은 기준" }, false);

    expect(visibleAnswer.totalScore).toBe(5);
    expect(visibleAnswer.items[0].verdict).toBe("CORRECT");
    expect(staleReference.totalScore).toBe(0);
    expect(staleReference.items[0].verdict).toBe("WRONG");
  });

  it("sends only written questions to AI grading and keeps objective grading local", async () => {
    let capturedExam: any;
    let capturedAnswers: any;
    const grading = new TeacherExamGradingService({
      gradeTeacherExam: async (input: any) => {
        capturedExam = input.exam;
        capturedAnswers = input.answers;
        return {
          totalScore: 8,
          maxScore: 10,
          scoreRatio: 0.8,
          items: [
            {
              questionId: "q-short",
              score: 5,
              maxScore: 5,
              verdict: "CORRECT",
              feedbackMarkdown: "AI 채점"
            },
            {
              questionId: "q-essay",
              score: 3,
              maxScore: 5,
              verdict: "PARTIAL",
              feedbackMarkdown: "AI 서술형 채점"
            }
          ],
          summaryMarkdown: "AI 채점 완료",
          gradingSource: "AI"
        };
      }
    } as any);
    const exam = {
      ...baseDraft,
      version: 1,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      questions: [
        baseDraft.questions[0],
        {
          id: "q-short",
          type: "SHORT",
          promptMarkdown: "주요 개념을 쓰세요.",
          points: 5,
          referenceAnswer: { text: "숨은 기준" },
          rubricMarkdown: "모범 답안 핵심",
          modelAnswerMarkdown: "보이는 모범 답안"
        },
        {
          id: "q-essay",
          type: "ESSAY",
          promptMarkdown: "풀이 과정을 설명하세요.",
          points: 5,
          rubricMarkdown: "근거가 있어야 함",
          modelAnswerMarkdown: "근거와 결론을 연결한다."
        }
      ]
    } as any;

    const result = await grading.grade({
      model: "test-model",
      exam,
      answers: {
        q1: { choiceId: "b" },
        "q-short": "보이는 모범 답안",
        "q-essay": "근거를 들어 설명합니다."
      },
      aiEnabled: true
    });

    expect(result.gradingSource).toBe("AI");
    expect(result.totalScore).toBe(13);
    expect(result.maxScore).toBe(15);
    expect(result.items.map((item) => item.questionId)).toEqual(["q1", "q-short", "q-essay"]);
    expect(result.items[0]).toMatchObject({ questionId: "q1", score: 5, gradingMode: "SYSTEM" });
    expect(capturedExam.questions.map((question: any) => question.id)).toEqual(["q-short", "q-essay"]);
    expect(Object.keys(capturedAnswers)).toEqual(["q-short", "q-essay"]);
    expect(capturedExam.questions[0].referenceAnswer.text).toBe("");
    expect(capturedExam.questions[0].modelAnswerMarkdown).toBe("보이는 모범 답안");
  });

  it("falls back when AI grading items omit required score or feedback fields", async () => {
    const malformedPayloads = [
      { items: [{ questionId: "q2" }], summaryMarkdown: "missing score and feedback" },
      { items: [{ questionId: "q2", score: "bad", feedbackMarkdown: "숫자가 아님" }], summaryMarkdown: "bad score" },
      { items: [{ questionId: "q2", score: 4, feedbackMarkdown: "" }], summaryMarkdown: "missing feedback" }
    ];

    for (const payload of malformedPayloads) {
      const grading = new TeacherExamGradingService({
        gradeTeacherExam: async () => payload
      } as any);
      const result = await grading.grade({
        model: "test-model",
        exam: {
          ...baseDraft,
          version: 1,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
          questions: [...baseDraft.questions] as any
        },
        answers: {
          q1: { choiceId: "b" },
          q2: "오차 최소화"
        },
        aiEnabled: true
      });

      expect(result.fallback).toBe(true);
      expect(result.gradingSource).toBe("DETERMINISTIC_FALLBACK");
      expect(result.totalScore).toBe(10);
      expect(result.items[0]).toMatchObject({ questionId: "q1", score: 5, gradingMode: "SYSTEM" });
      expect(result.items[1]).toMatchObject({ questionId: "q2", score: 5, gradingMode: "FALLBACK" });
    }
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

  it("sanitizes short-answer studio proposals with visible or legacy grading aids", async () => {
    const { service } = await makeService();
    const proposal = service.sanitizeExamStudioProposal(
      {
        answerMarkdown: "단답식 제안입니다.",
        operations: [
          {
            method: "appendQuestions",
            params: {
              questions: [
                {
                  id: "q-short-model",
                  type: "SHORT",
                  promptMarkdown: "모범 답안만 있는 단답식",
                  points: 5,
                  modelAnswerMarkdown: "보이는 모범 답안"
                },
                {
                  id: "q-short-legacy",
                  type: "SHORT",
                  promptMarkdown: "legacy 기준 답안만 있는 단답식",
                  points: 5,
                  referenceAnswer: { text: "legacy 답안" }
                },
                {
                  id: "q-short-empty",
                  type: "SHORT",
                  promptMarkdown: "채점 보조 정보가 없는 단답식",
                  points: 5
                }
              ]
            }
          }
        ],
        source: "AI"
      },
      baseDraft
    );

    expect(proposal.appendQuestions?.map((question) => question.id)).toEqual([
      "q-short-model",
      "q-short-legacy"
    ]);
    expect(proposal.operations?.[0]).toMatchObject({
      method: "appendQuestions",
      params: {
        questions: [
          { id: "q-short-model", modelAnswerMarkdown: "보이는 모범 답안" },
          { id: "q-short-legacy", referenceAnswer: { text: "legacy 답안" } }
        ]
      }
    });
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
    const draft = {
      ...baseDraft,
      questions: [
        baseDraft.questions[0],
        {
          ...baseDraft.questions[1],
          modelAnswerMarkdown: "오차를 최소화하는 것이 목표입니다."
        }
      ]
    };
    const exam = await service.createExam(week.id, classroom.id, draft);
    const published = await service.publish(exam.id, draft);
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
    expect(attempt.questions?.[1]).toMatchObject({
      id: "q2",
      type: "SHORT",
      promptMarkdown: "선형회귀의 목표를 쓰세요.",
      points: 5
    });
    expect(attempt.questions?.[1]).not.toHaveProperty("answer");
    expect(attempt.questions?.[1]).not.toHaveProperty("referenceAnswer");
    expect(attempt.questions?.[1]).not.toHaveProperty("rubricMarkdown");
    expect(attempt.questions?.[1]).not.toHaveProperty("modelAnswerMarkdown");
    expect(attempt.questions?.[1]).not.toHaveProperty("explanationMarkdown");
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

  it("reports teacher exam statuses and submitted counts separately from graded counts", async () => {
    const { store, service, classroom, week, clock } = await makeService();
    const waiting = await enrollTestStudent(store, classroom.id, "01");
    const inProgress = await enrollTestStudent(store, classroom.id, "02");
    const gradedStudent = await enrollTestStudent(store, classroom.id, "03");
    const gradingStudent = await enrollTestStudent(store, classroom.id, "04");
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);

    await service.startAttempt(published.id, inProgress.id);
    const gradedAttempt = await service.startAttempt(published.id, gradedStudent.id);
    if (!gradedAttempt.id) throw new Error("expected graded attempt id");
    await service.submitAttempt(gradedAttempt.id, gradedStudent.id, {
      q1: { choiceId: "b" },
      q2: "오차 최소화"
    });
    const gradingAttempt = await service.startAttempt(published.id, gradingStudent.id);
    if (!gradingAttempt.id) throw new Error("expected grading attempt id");
    const claim = await store.claimExamAttemptSubmission(
      gradingAttempt.id,
      gradingStudent.id,
      { q1: { choiceId: "a" } },
      "2026-05-02T00:10:30.000Z"
    );
    expect(claim.ok).toBe(true);

    const activeReport = await service.report(published);
    expect(activeReport.summary.submittedCount).toBe(2);
    expect(activeReport.summary.gradedCount).toBe(1);
    expect(activeReport.summary.completionRatio).toBe(0.5);
    expect(activeReport.students.find((student) => student.studentUserId === waiting.id)?.status).toBe("NOT_STARTED");
    expect(activeReport.students.find((student) => student.studentUserId === inProgress.id)?.status).toBe("IN_PROGRESS");
    expect(activeReport.students.find((student) => student.studentUserId === gradedStudent.id)?.status).toBe("SUBMITTED");
    expect(activeReport.students.find((student) => student.studentUserId === gradingStudent.id)?.status).toBe("SUBMITTED");

    clock.set("2026-05-03T00:00:01.000Z");
    const expiredReport = await service.report(published);
    expect(expiredReport.students.find((student) => student.studentUserId === waiting.id)?.status).toBe("MISSED");
  });

  it("excludes written questions from report scores when AI written grading is disabled", async () => {
    const { store, service, classroom, week } = await makeService();
    const student = await enrollTestStudent(store, classroom.id, "essay");
    const draft = {
      ...baseDraft,
      questions: [
        ...baseDraft.questions,
        {
          id: "q3",
          type: "ESSAY",
          promptMarkdown: "보안 설계를 설명하세요.",
          points: 90,
          rubricMarkdown: "구조와 근거가 있어야 함",
          modelAnswerMarkdown: "방어 계층을 설명한다."
        }
      ]
    } as const;
    const exam = await service.createExam(week.id, classroom.id, draft);
    const published = await service.publish(exam.id, draft);
    const attempt = await service.startAttempt(published.id, student.id);
    if (!attempt.id) throw new Error("expected attempt id");

    await service.submitAttempt(attempt.id, student.id, {
      q1: { choiceId: "b" },
      q2: "틀린 답",
      q3: "방어 계층과 근거를 설명합니다."
    });

    const report = await service.report(published);
    expect(report.summary.maxScore).toBe(5);
    expect(report.summary.averageScore).toBe(5);
    expect(report.students[0].reportScore).toMatchObject({ score: 5, maxScore: 5 });
    const essay = report.questionStats.find((stat) => stat.questionId === "q3");
    expect(essay).toMatchObject({
      type: "ESSAY",
      maxScore: 90,
      averageScore: 0,
      attempts: 0,
      unsupportedReason: "서술형 AI 채점이 꺼져 있어 종합 점수에서 제외되었습니다."
    });
  });

  it("persists per-student teacher exam result JSON with feedback", async () => {
    const { store, service, classroom, week } = await makeService();
    const student = await enrollTestStudent(store, classroom.id, "result-json");
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const published = await service.publish(exam.id, baseDraft);
    const attempt = await service.startAttempt(published.id, student.id);
    if (!attempt.id) throw new Error("expected attempt id");

    await service.submitAttempt(attempt.id, student.id, {
      q1: { choiceId: "b" },
      q2: "오차 최소화"
    });
    const records = await store.listTeacherExamResultRecordsForStudent(classroom.id, student.id);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      attemptId: attempt.id,
      submissionId: expect.any(String),
      studentUserId: student.id,
      examId: published.id,
      examTitle: "중간 점검"
    });
    expect(records[0].answers).toMatchObject({ q1: { choiceId: "b" }, q2: "오차 최소화" });
    expect(records[0].grading.items.find((item) => item.questionId === "q2")).toMatchObject({
      excludedFromScore: true,
      feedbackMarkdown: expect.stringContaining("종합 점수에서 제외")
    });
  });

  it("includes AI-graded essay questions in teacher exam report stats", async () => {
    const grading = new TeacherExamGradingService({
      gradeTeacherExam: async () =>
        ({
          items: [
            {
              questionId: "q2",
              score: 5,
              maxScore: 5,
              verdict: "CORRECT",
              feedbackMarkdown: "단답식 AI 채점"
            },
            {
              questionId: "q3",
              score: 80,
              maxScore: 90,
              verdict: "PARTIAL",
              feedbackMarkdown: "서술형 AI 피드백"
            }
          ],
          summaryMarkdown: "AI written grading complete",
          gradingSource: "AI"
        }) as any
    } as any);
    const { store, service, classroom, week } = await makeService(
      new MutableClock("2026-05-02T00:10:00.000Z"),
      new ConsoleExamLogger(),
      grading
    );
    const student = await enrollTestStudent(store, classroom.id, "essay-ai");
    const draft = {
      ...baseDraft,
      aiGradingEnabled: true,
      questions: [
        ...baseDraft.questions,
        {
          id: "q3",
          type: "ESSAY",
          promptMarkdown: "보안 설계를 설명하세요.",
          points: 90,
          rubricMarkdown: "구조와 근거가 있어야 함",
          modelAnswerMarkdown: "방어 계층을 설명한다."
        }
      ]
    } as any;
    const exam = await service.createExam(week.id, classroom.id, draft);
    const published = await service.publish(exam.id, draft);
    const attempt = await service.startAttempt(published.id, student.id);
    if (!attempt.id) throw new Error("expected attempt id");

    await service.submitAttempt(attempt.id, student.id, {
      q1: { choiceId: "b" },
      q2: "오차 최소화",
      q3: "방어 계층과 근거를 설명합니다."
    });

    const report = await service.report(published);
    expect(report.summary.maxScore).toBe(100);
    expect(report.summary.averageScore).toBe(90);
    const essay = report.questionStats.find((stat) => stat.questionId === "q3");
    expect(essay).toMatchObject({
      type: "ESSAY",
      maxScore: 90,
      averageScore: 80,
      attempts: 1,
      partialCount: 1
    });
    expect(essay?.respondents?.[0]).toMatchObject({
      score: 80,
      maxScore: 90,
      result: "PARTIAL"
    });
  });

  it("uses visible short-answer model answers for report correctness", async () => {
    const { store, service, classroom, week } = await makeService();
    const student = await enrollTestStudent(store, classroom.id, "short-report");
    const draft = {
      ...baseDraft,
      aiGradingEnabled: true,
      questions: [
        {
          id: "q-short",
          type: "SHORT",
          promptMarkdown: "주요 개념을 쓰세요.",
          points: 5,
          referenceAnswer: { text: "숨은 기준" },
          rubricMarkdown: "모범 답안 핵심",
          modelAnswerMarkdown: "보이는 모범 답안"
        }
      ]
    } as any;
    const exam = await service.createExam(week.id, classroom.id, draft);
    const published = await service.publish(exam.id, draft);
    const attempt = await service.startAttempt(published.id, student.id);
    if (!attempt.id) throw new Error("expected attempt id");

    await service.submitAttempt(attempt.id, student.id, {
      "q-short": "보이는 모범 답안"
    });

    const report = await service.report(published);
    const stat = report.questionStats.find((item) => item.questionId === "q-short");
    expect(stat).toMatchObject({
      correctAnswerLabel: "보이는 모범 답안",
      correctCount: 1,
      attempts: 1
    });
    expect(stat?.distribution?.find((item) => item.label === "보이는 모범 답안")).toMatchObject({
      count: 1,
      isCorrect: true
    });
  });

  it("keeps migrated short-answer reference and model answers in the same report row", async () => {
    const { store, service, classroom, week } = await makeService();
    const student = await enrollTestStudent(store, classroom.id, "short-migrate");
    const legacyDraft = {
      ...baseDraft,
      aiGradingEnabled: true,
      questions: [
        {
          id: "q-short",
          type: "SHORT",
          promptMarkdown: "주요 개념을 쓰세요.",
          points: 5,
          referenceAnswer: { text: "같은 정답" },
          rubricMarkdown: "핵심",
          modelAnswerMarkdown: ""
        }
      ]
    } as any;
    const exam = await service.createExam(week.id, classroom.id, legacyDraft);
    const published = await service.publish(exam.id, legacyDraft);
    const attempt = await service.startAttempt(published.id, student.id);
    if (!attempt.id) throw new Error("expected attempt id");
    await service.submitAttempt(attempt.id, student.id, { "q-short": "같은 정답" });

    const migrated = await service.publish(published.id, {
      ...legacyDraft,
      questions: [
        {
          ...legacyDraft.questions[0],
          referenceAnswer: { text: "" },
          modelAnswerMarkdown: "같은 정답"
        }
      ]
    });
    const report = await service.report(migrated);
    const active = report.questionStats.find((item) => item.statId === "active:q-short");
    const archived = report.questionStats.find((item) => item.questionId === "q-short" && item.isArchivedQuestion);

    expect(active).toMatchObject({ attempts: 1, correctCount: 1 });
    expect(archived).toBeUndefined();
  });

  it("archives short-answer stats when the visible model answer changes", async () => {
    const { store, service, classroom, week } = await makeService();
    const student = await enrollTestStudent(store, classroom.id, "short-change");
    const firstDraft = {
      ...baseDraft,
      aiGradingEnabled: true,
      questions: [
        {
          id: "q-short",
          type: "SHORT",
          promptMarkdown: "주요 개념을 쓰세요.",
          points: 5,
          referenceAnswer: { text: "" },
          rubricMarkdown: "핵심",
          modelAnswerMarkdown: "첫 번째 정답"
        }
      ]
    } as any;
    const exam = await service.createExam(week.id, classroom.id, firstDraft);
    const published = await service.publish(exam.id, firstDraft);
    const attempt = await service.startAttempt(published.id, student.id);
    if (!attempt.id) throw new Error("expected attempt id");
    await service.submitAttempt(attempt.id, student.id, { "q-short": "첫 번째 정답" });

    const changed = await service.publish(published.id, {
      ...firstDraft,
      questions: [
        {
          ...firstDraft.questions[0],
          modelAnswerMarkdown: "두 번째 정답"
        }
      ]
    });
    const report = await service.report(changed);
    const active = report.questionStats.find((item) => item.statId === "active:q-short");
    const archived = report.questionStats.find((item) => item.questionId === "q-short" && item.isArchivedQuestion);

    expect(active).toMatchObject({ attempts: 0, correctCount: 0 });
    expect(archived).toMatchObject({
      attempts: 1,
      correctCount: 1,
      correctAnswerLabel: "첫 번째 정답"
    });
  });

  it("keeps changed same-id questions as archived report rows", async () => {
    const { store, service, classroom, week } = await makeService();
    const student = await enrollTestStudent(store, classroom.id, "archive");
    const exam = await service.createExam(week.id, classroom.id, baseDraft);
    const first = await service.publish(exam.id, baseDraft);
    const attempt = await service.startAttempt(first.id, student.id);
    if (!attempt.id) throw new Error("expected attempt id");
    await service.submitAttempt(attempt.id, student.id, {
      q1: { choiceId: "b" },
      q2: "오차 최소화"
    });

    const republished = await service.publish(first.id, {
      ...baseDraft,
      questions: [
        {
          ...baseDraft.questions[0],
          answer: { choiceId: "a" },
          explanationMarkdown: "정답을 바꾼 문항입니다."
        },
        baseDraft.questions[1]
      ]
    });

    const report = await service.report(republished);
    const active = report.questionStats.find((stat) => stat.statId === "active:q1");
    const archived = report.questionStats.find((stat) => stat.questionId === "q1" && stat.isArchivedQuestion);
    expect(active?.attempts).toBe(0);
    expect(archived).toMatchObject({
      questionId: "q1",
      isArchivedQuestion: true,
      attempts: 1,
      correctCount: 1
    });
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
    expect(report.summary.averageScore).toBe(5);
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
