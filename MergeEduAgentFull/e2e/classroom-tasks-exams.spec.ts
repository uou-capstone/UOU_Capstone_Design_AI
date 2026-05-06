import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const teacherUser = {
  id: "usr_tasks_teacher",
  email: "tasks.teacher@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "2468",
  emailVerified: true,
  hasPassword: true
};

const studentUser = {
  id: "usr_tasks_student",
  email: "tasks.student@example.com",
  displayName: "테스트 학생",
  role: "student",
  inviteCode: "1357",
  emailVerified: true,
  hasPassword: true
};

const weeks = Array.from({ length: 4 }, (_, index) => ({
  id: `wk_tasks_${index + 1}`,
  classroomId: "cls_tasks",
  weekIndex: index + 1,
  title: `${index + 1}주차`,
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z"
}));

function isoFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function toDatetimeLocal(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function localDatetimeToIso(value: string) {
  return new Date(value).toISOString();
}

function addMinutesToDatetimeLocal(value: string, minutes: number) {
  return toDatetimeLocal(new Date(new Date(value).getTime() + minutes * 60_000));
}

function makeRevision(input: {
  title: string;
  fromMinutes: number;
  untilMinutes: number;
  timeLimitMinutes: number;
  prompt?: string;
}) {
  return {
    version: 1,
    title: input.title,
    descriptionMarkdown: "",
    availableFrom: isoFromNow(input.fromMinutes),
    availableUntil: isoFromNow(input.untilMinutes),
    timeLimitMinutes: input.timeLimitMinutes,
    passScoreRatio: 0.7,
    aiGradingEnabled: true,
    questions: [
      {
        id: "q1",
        type: "MCQ",
        promptMarkdown: input.prompt ?? "핵심 개념을 고르세요.",
        points: 5,
        choices: [
          { id: "a", textMarkdown: "선택지 A" },
          { id: "b", textMarkdown: "선택지 B" }
        ],
        answer: { choiceId: "b" }
      }
    ],
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z"
  };
}

function makeExam(input: {
  id: string;
  weekId: string;
  title: string;
  fromMinutes: number;
  untilMinutes: number;
  timeLimitMinutes: number;
  createdAt: string;
}) {
  const revision = makeRevision(input);
  return {
    id: input.id,
    classroomId: "cls_tasks",
    weekId: input.weekId,
    status: "PUBLISHED",
    activePublishedVersion: 1,
    draftRevision: revision,
    publishedRevision: revision,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    totalPoints: 5,
    publishedTotalPoints: 5
  };
}

function makeStudentAttempt(
  exam: ReturnType<typeof makeExam>,
  status: "IN_PROGRESS" | "GRADING" | "GRADED",
  withGrading = false
) {
  return {
    id: `attempt_${exam.id}`,
    examId: exam.id,
    status,
    examVersion: 1,
    startedAt: isoFromNow(-12),
    deadlineAt: isoFromNow(48),
    ...(status !== "IN_PROGRESS" ? { submittedAt: isoFromNow(-8) } : {}),
    ...(status === "GRADED" ? { gradedAt: isoFromNow(-6) } : {}),
    answers: {},
    ...(withGrading
      ? {
          grading: {
            totalScore: 5,
            maxScore: 5,
            scoreRatio: 1,
            items: [],
            summaryMarkdown: "자동 채점 완료",
            gradingSource: "DETERMINISTIC_FALLBACK"
          }
        }
      : {})
  };
}

function toStudentExamMetadata(
  exam: ReturnType<typeof makeExam>,
  attempt: ReturnType<typeof makeStudentAttempt> | null
) {
  const revision = exam.publishedRevision ?? exam.draftRevision;
  return {
    id: exam.id,
    classroomId: exam.classroomId,
    weekId: exam.weekId,
    status: exam.status,
    activePublishedVersion: exam.activePublishedVersion,
    title: revision.title,
    descriptionMarkdown: revision.descriptionMarkdown,
    availableFrom: revision.availableFrom,
    availableUntil: revision.availableUntil,
    timeLimitMinutes: revision.timeLimitMinutes,
    passScoreRatio: revision.passScoreRatio,
    totalPoints: exam.publishedTotalPoints ?? exam.totalPoints ?? 0,
    questionCount: revision.questions.length,
    attempt
  };
}

async function mockTasksData(
  page: Page,
  user = teacherUser,
  options: {
    delayedSettingsExamIds?: string[];
    endedSettingsExamIds?: string[];
    studentUsesTeacherShape?: boolean;
  } = {}
) {
  const state = {
    exams: [
      makeExam({
        id: "exam_tasks_1",
        weekId: "wk_tasks_1",
        title: "1주차 개념 확인 시험",
        fromMinutes: -30,
        untilMinutes: 60,
        timeLimitMinutes: 40,
        createdAt: "2026-05-01T00:00:00.000Z"
      }),
      makeExam({
        id: "exam_tasks_2",
        weekId: "wk_tasks_2",
        title: "자료 구조 기초 퀴즈",
        fromMinutes: 24 * 60,
        untilMinutes: 24 * 60 + 60,
        timeLimitMinutes: 30,
        createdAt: "2026-05-02T00:00:00.000Z"
      }),
      makeExam({
        id: "exam_tasks_3",
        weekId: "wk_tasks_3",
        title: "선형대수 중간 점검",
        fromMinutes: -48 * 60,
        untilMinutes: -47 * 60,
        timeLimitMinutes: 50,
        createdAt: "2026-05-03T00:00:00.000Z"
      }),
      makeExam({
        id: "exam_tasks_4",
        weekId: "wk_tasks_3",
        title: "확률과 통계 응용 평가",
        fromMinutes: -52 * 60,
        untilMinutes: -51 * 60,
        timeLimitMinutes: 35,
        createdAt: "2026-05-04T00:00:00.000Z"
      }),
      makeExam({
        id: "exam_tasks_5",
        weekId: "wk_tasks_4",
        title: "Transformer 이해도 테스트",
        fromMinutes: -60 * 60,
        untilMinutes: -59 * 60,
        timeLimitMinutes: 60,
        createdAt: "2026-05-05T00:00:00.000Z"
      }),
      makeExam({
        id: "exam_tasks_6",
        weekId: "wk_tasks_4",
        title: "기말 프로젝트 사전 진단",
        fromMinutes: 72 * 60,
        untilMinutes: 72 * 60 + 60,
        timeLimitMinutes: 25,
        createdAt: "2026-05-06T00:00:00.000Z"
      })
    ]
  };
  const patchBodies: unknown[] = [];
  const examFetches: string[] = [];
  const studentExamPayloads: unknown[][] = [];
  const teacherOnlyRequestUrls: string[] = [];
  const delayedSettingsExamIds = new Set(options.delayedSettingsExamIds ?? []);
  const endedSettingsExamIds = new Set(options.endedSettingsExamIds ?? []);
  const pendingSettingsResponses = new Map<string, Array<() => void>>();
  const studentAttempts = new Map<string, ReturnType<typeof makeStudentAttempt>>([
    ["exam_tasks_2", makeStudentAttempt(state.exams[1], "IN_PROGRESS")],
    ["exam_tasks_3", makeStudentAttempt(state.exams[2], "GRADING")],
    ["exam_tasks_4", makeStudentAttempt(state.exams[3], "GRADED")],
    ["exam_tasks_5", makeStudentAttempt(state.exams[4], "GRADED", true)]
  ]);

  function releaseSettingsResponse(examId: string) {
    const pending = pendingSettingsResponses.get(examId);
    const release = pending?.shift();
    release?.();
  }

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { user } })
    })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "request encryption disabled in mocked e2e" })
    })
  );
  await page.route("**/api/classrooms/cls_tasks/weeks", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: weeks })
    })
  );
  await page.route("**/api/classrooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  for (const week of weeks) {
    await page.route(`**/api/weeks/${week.id}/lectures`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
    );
    await page.route(`**/api/weeks/${week.id}/exams`, (route) => {
      examFetches.push(week.id);
      const weekExams = state.exams.filter((exam) => exam.weekId === week.id);
      const data = user.role === "student" && !options.studentUsesTeacherShape
        ? weekExams.map((exam) => toStudentExamMetadata(exam, studentAttempts.get(exam.id) ?? null))
        : weekExams;
      if (user.role === "student") {
        studentExamPayloads.push(data);
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data
        })
      });
    });
  }
  await page.route("**/api/exams/*/report", (route) => {
    teacherOnlyRequestUrls.push(route.request().url());
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Teacher-only report endpoint should not be used here" })
    });
  });
  await page.route("**/api/exams/*/settings", async (route) => {
    teacherOnlyRequestUrls.push(route.request().url());
    const request = route.request();
    const examId = new URL(request.url()).pathname.split("/").at(-2)!;
    const body = request.postDataJSON() as {
      title?: string;
      availableFrom?: string;
      availableUntil?: string;
      timeLimitMinutes?: number;
      questions?: unknown;
      descriptionMarkdown?: unknown;
      passScoreRatio?: unknown;
      aiGradingEnabled?: unknown;
    };
    patchBodies.push(body);
    if (delayedSettingsExamIds.has(examId)) {
      await new Promise<void>((resolve) => {
        const pending = pendingSettingsResponses.get(examId) ?? [];
        pending.push(resolve);
        pendingSettingsResponses.set(examId, pending);
      });
    }
    expect(Object.keys(body).sort()).toEqual([
      "availableFrom",
      "availableUntil",
      "timeLimitMinutes",
      "title"
    ]);
    const target = state.exams.find((exam) => exam.id === examId);
    if (!target) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Exam not found" })
      });
    }
    if (endedSettingsExamIds.has(examId)) {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "종료된 시험은 수정할 수 없습니다.", code: "EXAM_ENDED" })
      });
    }
    target.draftRevision = {
      ...target.draftRevision,
      title: String(body.title),
      availableFrom: String(body.availableFrom),
      availableUntil: String(body.availableUntil),
      timeLimitMinutes: Number(body.timeLimitMinutes),
      updatedAt: "2026-05-03T12:00:00.000Z"
    };
    target.publishedRevision = target.publishedRevision
      ? {
          ...target.publishedRevision,
          version: target.publishedRevision.version + 1,
          title: String(body.title),
          availableFrom: String(body.availableFrom),
          availableUntil: String(body.availableUntil),
          timeLimitMinutes: Number(body.timeLimitMinutes),
          updatedAt: "2026-05-03T12:00:00.000Z"
        }
      : undefined;
    target.updatedAt = "2026-05-03T12:00:00.000Z";
    target.activePublishedVersion = target.publishedRevision?.version ?? target.activePublishedVersion;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: target })
    });
  });
  await page.route("**/api/exams/*", (route) => {
    if (route.request().method() === "DELETE") {
      teacherOnlyRequestUrls.push(route.request().url());
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Teacher-only delete endpoint should not be used here" })
      });
    }
    return route.fallback();
  });

  return { state, patchBodies, examFetches, studentExamPayloads, teacherOnlyRequestUrls, releaseSettingsResponse };
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function finishAnimations(page: Page) {
  await page.evaluate(() => {
    document.getAnimations().forEach((animation) => animation.finish());
  });
}

async function readTaskSettingsActionMetrics(settingsPanel: Locator) {
  const rectFor = async (locator: Locator) =>
    locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom
      };
    });

  const actions = settingsPanel.locator(".tasks-settings-actions");
  const cancel = settingsPanel.getByRole("button", { name: "취소" });
  const save = settingsPanel.getByRole("button", { name: /수정 저장|저장 중/ });
  return {
    actions: await rectFor(actions),
    cancel: await rectFor(cancel),
    save: await rectFor(save)
  };
}

function expectTaskSettingsDesktopActionSizing(metrics: Awaited<ReturnType<typeof readTaskSettingsActionMetrics>>) {
  expect(Math.abs(metrics.cancel.height - metrics.save.height)).toBeLessThanOrEqual(1);
  expect(metrics.cancel.height).toBeGreaterThanOrEqual(52);
  expect(metrics.save.height).toBeGreaterThanOrEqual(52);
  expect(metrics.cancel.width).toBeLessThan(metrics.save.width);
  expect(metrics.cancel.width).toBeGreaterThanOrEqual(74);
  expect(metrics.save.width).toBeGreaterThanOrEqual(126);
}

function expectTaskSettingsMobileActionSizing(metrics: Awaited<ReturnType<typeof readTaskSettingsActionMetrics>>) {
  expect(Math.abs(metrics.cancel.height - metrics.save.height)).toBeLessThanOrEqual(1);
  expect(metrics.cancel.height).toBeGreaterThanOrEqual(52);
  expect(metrics.save.height).toBeGreaterThanOrEqual(52);
  expect(Math.abs(metrics.cancel.width - metrics.actions.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.save.width - metrics.actions.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.cancel.top - metrics.save.top)).toBeGreaterThanOrEqual(52);
}

function expectTaskSettingsActionRowStable(
  before: Awaited<ReturnType<typeof readTaskSettingsActionMetrics>>,
  after: Awaited<ReturnType<typeof readTaskSettingsActionMetrics>>
) {
  expect(Math.abs(before.actions.width - after.actions.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.actions.height - after.actions.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.cancel.width - after.cancel.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.cancel.height - after.cancel.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.save.width - after.save.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.save.height - after.save.height)).toBeLessThanOrEqual(1);
}

test("teacher opens classroom tasks, filters, sorts, edits settings, and sees week sync", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await mockTasksData(page);

  await page.goto("/classrooms/cls_tasks?section=weeks");
  await page.getByTestId("topbar-nav-tasks").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_tasks\?section=tasks$/);
  await expect(page.getByTestId("topbar-nav-tasks")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-classroom")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "과제/시험" })).toBeVisible();
  const hero = page.getByTestId("classroom-tasks-hero");
  await expect(hero).toContainText("전체 시험");
  await expect(hero).toContainText("6개");
  await expect(hero).toContainText("주차");
  await expect(hero).toContainText("4개");
  await expect(hero).toContainText("진행 중 시험");
  await expect(hero).toContainText("1개");
  await expect(page.getByRole("button", { name: /자료 업로드/ })).toHaveCount(0);
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(6);

  await finishAnimations(page);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-tasks-exams-desktop.png", fullPage: true });

  await page.getByLabel("시험명으로 검색").fill("Transformer");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("Transformer 이해도 테스트");

  await page.getByLabel("시험명으로 검색").fill("");
  await expect(page.getByLabel("주차 필터").locator("option")).toHaveCount(5);
  await expect(page.getByLabel("주차 필터").locator("option")).toHaveText([
    "전체 주차",
    "1주차",
    "2주차",
    "3주차",
    "4주차"
  ]);
  await page.getByLabel("주차 필터").selectOption("wk_tasks_3");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(2);

  await page.getByLabel("주차 필터").selectOption("all");
  await page.getByLabel("진행 상태").selectOption("ongoing");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("진행 중");
  await page.getByLabel("진행 상태").selectOption("upcoming");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(2);
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("예정");
  await page.getByLabel("진행 상태").selectOption("ended");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(3);
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("종료");

  await page.getByLabel("진행 상태").selectOption("all");
  await page.getByLabel("정렬").selectOption("createdDesc");
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("기말 프로젝트 사전 진단");
  await page.getByLabel("정렬").selectOption("createdAsc");

  const targetRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "1주차 개념 확인 시험" });
  await targetRow.getByRole("button", { name: /더보기/ }).click();
  await expect(page.getByTestId("classroom-task-exam-settings")).toBeVisible();
  await page.screenshot({ path: "test-results/classroom-tasks-exams-expanded.png", fullPage: true });
  await page.getByRole("textbox", { name: "시험 이름" }).fill("1주차 개념 확인 시험 수정");
  const settingsPanel = page.getByTestId("classroom-task-exam-settings");
  expectTaskSettingsDesktopActionSizing(await readTaskSettingsActionMetrics(settingsPanel));
  const startInput = page.getByRole("textbox", { name: "시작 시간" });
  const endInput = page.getByRole("textbox", { name: "종료 시간" });
  const durationInput = settingsPanel.getByRole("spinbutton");
  const initialStartLocal = toDatetimeLocal(new Date(Date.now() + 2 * 24 * 60 * 60_000));
  await startInput.fill(initialStartLocal);
  await expect(endInput).toHaveValue(addMinutesToDatetimeLocal(initialStartLocal, 40));
  await durationInput.fill("45");
  await expect(endInput).toHaveValue(addMinutesToDatetimeLocal(initialStartLocal, 45));
  const shiftedStartLocal = addMinutesToDatetimeLocal(initialStartLocal, 75);
  await startInput.fill(shiftedStartLocal);
  await expect(endInput).toHaveValue(addMinutesToDatetimeLocal(shiftedStartLocal, 45));
  const manualEndLocal = addMinutesToDatetimeLocal(shiftedStartLocal, 75);
  await endInput.fill(manualEndLocal);
  await expect(endInput).toHaveValue(manualEndLocal);
  await startInput.fill("");
  await durationInput.fill("30");
  await expect(endInput).toHaveValue(manualEndLocal);
  await startInput.fill(shiftedStartLocal);
  await expect(endInput).toHaveValue(addMinutesToDatetimeLocal(shiftedStartLocal, 30));
  await endInput.fill(manualEndLocal);
  await durationInput.fill("");
  await expect(endInput).toHaveValue(manualEndLocal);
  await durationInput.fill("0");
  await expect(endInput).toHaveValue(manualEndLocal);
  await durationInput.fill("241");
  await expect(endInput).toHaveValue(manualEndLocal);
  await durationInput.fill("45.5");
  await expect(endInput).toHaveValue(manualEndLocal);
  const lateStartLocal = `${shiftedStartLocal.slice(0, 10)}T23:45`;
  await startInput.fill(lateStartLocal);
  await durationInput.fill("30");
  await expect(endInput).toHaveValue(addMinutesToDatetimeLocal(lateStartLocal, 30));
  await startInput.fill(shiftedStartLocal);
  await expect(endInput).toHaveValue(addMinutesToDatetimeLocal(shiftedStartLocal, 30));
  await durationInput.fill("45");
  await expect(endInput).toHaveValue(addMinutesToDatetimeLocal(shiftedStartLocal, 45));
  await endInput.fill(manualEndLocal);
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByTestId("classroom-task-exam-row").filter({ hasText: "1주차 개념 확인 시험 수정" })).toHaveCount(1);
  expect(mock.patchBodies).toHaveLength(1);
  expect(mock.patchBodies[0]).toMatchObject({
    title: "1주차 개념 확인 시험 수정",
    timeLimitMinutes: 45
  });
  expect((mock.patchBodies[0] as { availableFrom: string }).availableFrom).toBe(localDatetimeToIso(shiftedStartLocal));
  expect((mock.patchBodies[0] as { availableUntil: string }).availableUntil).toBe(localDatetimeToIso(manualEndLocal));

  const sixtyMinuteEndLocal = addMinutesToDatetimeLocal(shiftedStartLocal, 60);
  await durationInput.fill("60");
  await expect(endInput).toHaveValue(sixtyMinuteEndLocal);
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect.poll(() => mock.patchBodies.length).toBe(2);
  expect(mock.patchBodies[1]).toMatchObject({
    title: "1주차 개념 확인 시험 수정",
    timeLimitMinutes: 60,
    availableFrom: localDatetimeToIso(shiftedStartLocal),
    availableUntil: localDatetimeToIso(sixtyMinuteEndLocal)
  });

  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await expect(page.getByTestId("classroom-exam-list")).toContainText("1주차 개념 확인 시험 수정");

  await expectNoHorizontalOverflow(page);
});

test("ended teacher exam settings are read-only and do not submit patches", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await mockTasksData(page, teacherUser);

  await page.goto("/classrooms/cls_tasks?section=tasks");
  await page.getByLabel("진행 상태").selectOption("ended");
  const endedRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "선형대수 중간 점검" });
  await endedRow.getByRole("button", { name: /더보기/ }).click();

  const settingsPanel = page.getByTestId("classroom-task-exam-settings");
  await expect(settingsPanel).toBeVisible();
  await expect(settingsPanel).toContainText("종료된 시험은 기록 보존을 위해 이름과 시간 설정을 수정할 수 없습니다.");
  await expect(settingsPanel.getByRole("textbox", { name: "시험 이름" })).toBeDisabled();
  await expect(settingsPanel.getByRole("textbox", { name: "시작 시간" })).toBeDisabled();
  await expect(settingsPanel.getByRole("textbox", { name: "종료 시간" })).toBeDisabled();
  await expect(settingsPanel.getByRole("spinbutton", { name: "진행 시간" })).toBeDisabled();
  await expect(settingsPanel.getByRole("button", { name: "수정 저장" })).toBeDisabled();
  expectTaskSettingsDesktopActionSizing(await readTaskSettingsActionMetrics(settingsPanel));

  await settingsPanel.evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => mock.patchBodies.length).toBe(0);
});

test("teacher settings lock after server reports an exam has ended", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await mockTasksData(page, teacherUser, {
    endedSettingsExamIds: ["exam_tasks_1"]
  });

  await page.goto("/classrooms/cls_tasks?section=tasks");
  const row = page.getByTestId("classroom-task-exam-row").filter({ hasText: "1주차 개념 확인 시험" });
  await row.getByRole("button", { name: /더보기/ }).click();

  const settingsPanel = page.getByTestId("classroom-task-exam-settings");
  const beforeServerLockMetrics = await readTaskSettingsActionMetrics(settingsPanel);
  await settingsPanel.getByRole("textbox", { name: "시험 이름" }).fill("서버 종료 응답 시험");
  await settingsPanel.getByRole("button", { name: "수정 저장" }).click();

  await expect.poll(() => mock.patchBodies.length).toBe(1);
  await expect(settingsPanel).toContainText("종료된 시험은 수정할 수 없습니다.");
  await expect(settingsPanel.getByRole("textbox", { name: "시험 이름" })).toBeDisabled();
  await expect(settingsPanel.getByRole("textbox", { name: "시험 이름" })).toHaveValue("1주차 개념 확인 시험");
  await expect(settingsPanel.getByRole("button", { name: "수정 저장" })).toBeDisabled();
  const afterServerLockMetrics = await readTaskSettingsActionMetrics(settingsPanel);
  expectTaskSettingsDesktopActionSizing(afterServerLockMetrics);
  expectTaskSettingsActionRowStable(beforeServerLockMetrics, afterServerLockMetrics);
});

test("teacher stale settings save does not overwrite another open exam draft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await mockTasksData(page, teacherUser, {
    delayedSettingsExamIds: ["exam_tasks_1", "exam_tasks_2"]
  });

  await page.goto("/classrooms/cls_tasks?section=tasks");
  const firstRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "1주차 개념 확인 시험" });
  await firstRow.getByRole("button", { name: /더보기/ }).click();
  await page.getByRole("textbox", { name: "시험 이름" }).fill("지연 저장 시험");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect.poll(() => mock.patchBodies.length).toBe(1);

  const secondRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "자료 구조 기초 퀴즈" });
  await secondRow.getByRole("button", { name: /더보기/ }).click();
  await expect(page.getByRole("textbox", { name: "시험 이름" })).toHaveValue("자료 구조 기초 퀴즈");
  await page.getByRole("textbox", { name: "시험 이름" }).fill("자료 구조 기초 퀴즈 수정");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect.poll(() => mock.patchBodies.length).toBe(2);
  await expect(page.getByRole("button", { name: /저장 중/ })).toBeVisible();
  expectTaskSettingsDesktopActionSizing(await readTaskSettingsActionMetrics(page.getByTestId("classroom-task-exam-settings")));

  mock.releaseSettingsResponse("exam_tasks_1");
  await expect(page.getByTestId("classroom-task-exam-row").filter({ hasText: "지연 저장 시험" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /저장 중/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "시험 이름" })).toHaveValue("자료 구조 기초 퀴즈 수정");

  mock.releaseSettingsResponse("exam_tasks_2");
  await expect(page.getByTestId("classroom-task-exam-row").filter({ hasText: "자료 구조 기초 퀴즈 수정" })).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "시험 이름" })).toHaveValue("자료 구조 기초 퀴즈 수정");
});

test("student opens classroom tasks, sees read-only exam actions, and keeps week-detail actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await mockTasksData(page, studentUser);

  await page.goto("/classrooms/cls_tasks?section=weeks");
  await page.getByTestId("topbar-nav-tasks").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_tasks\?section=tasks$/);
  await expect(page.getByTestId("topbar-nav-tasks")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-tasks-section")).toBeVisible();
  await expect(page.getByRole("heading", { name: "과제/시험" })).toBeVisible();
  const hero = page.getByTestId("classroom-tasks-hero");
  await expect(hero).toContainText("전체 시험");
  await expect(hero).toContainText("6개");
  await expect(hero).toContainText("주차");
  await expect(hero).toContainText("4개");
  await expect(hero).toContainText("진행 중 시험");
  await expect(hero).toContainText("1개");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(6);
  await expect.poll(() => mock.examFetches.length).toBe(4);
  expect(mock.studentExamPayloads.flat()).toHaveLength(6);
  expect(mock.studentExamPayloads.flat().every((exam) => !("draftRevision" in (exam as Record<string, unknown>)))).toBe(true);

  const takeRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "1주차 개념 확인 시험" });
  await expect(takeRow.getByTestId("classroom-exam-take")).toContainText("시험 응시");
  const inProgressRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "자료 구조 기초 퀴즈" });
  await expect(inProgressRow.getByTestId("classroom-exam-take")).toContainText("시험 응시");
  const gradingRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "선형대수 중간 점검" });
  const gradingButton = gradingRow.getByTestId("classroom-exam-grading");
  await expect(gradingButton).toContainText("채점 중");
  await expect(gradingButton).toBeDisabled();
  await expect(gradingButton).toHaveAttribute("aria-disabled", "true");
  await expect(gradingButton).not.toHaveAttribute("href", /.*/);
  await expect(gradingButton).toHaveJSProperty("tagName", "BUTTON");
  await expect(gradingButton).toHaveAttribute("type", "button");
  const pendingRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "확률과 통계 응용 평가" });
  const pendingButton = pendingRow.getByTestId("classroom-exam-result-pending");
  await expect(pendingButton).toContainText("결과 준비 중");
  await expect(pendingButton).toBeDisabled();
  await expect(pendingButton).toHaveAttribute("aria-disabled", "true");
  await expect(pendingButton).not.toHaveAttribute("href", /.*/);
  await expect(pendingButton).toHaveJSProperty("tagName", "BUTTON");
  await expect(pendingButton).toHaveAttribute("type", "button");
  const resultRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "Transformer 이해도 테스트" });
  await expect(resultRow.getByTestId("classroom-exam-result")).toContainText("결과 보기");

  await expect(page.getByTestId("classroom-task-exam-settings")).toHaveCount(0);
  await expect(page.getByTestId("classroom-exam-edit")).toHaveCount(0);
  await expect(page.getByTestId("classroom-exam-delete")).toHaveCount(0);
  await expect(page.getByTestId("classroom-exam-report")).toHaveCount(0);
  await expect(page.locator(".tasks-chevron-btn")).toHaveCount(0);
  await expect(page.locator(".tasks-more-btn")).toHaveCount(0);

  await finishAnimations(page);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-tasks-exams-student-desktop.png", fullPage: true });

  await page.getByLabel("시험명으로 검색").fill("Transformer");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("Transformer 이해도 테스트");
  await page.getByLabel("시험명으로 검색").fill("");
  await page.getByLabel("주차 필터").selectOption("wk_tasks_3");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(2);
  await page.getByLabel("주차 필터").selectOption("all");
  await page.getByLabel("진행 상태").selectOption("ongoing");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(1);
  await page.getByLabel("진행 상태").selectOption("upcoming");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(2);
  await page.getByLabel("진행 상태").selectOption("ended");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(3);
  await page.getByLabel("진행 상태").selectOption("all");
  await page.getByLabel("정렬").selectOption("createdAsc");
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("Transformer 이해도 테스트");
  await page.getByLabel("정렬").selectOption("createdDesc");
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("기말 프로젝트 사전 진단");
  await page.getByLabel("정렬").selectOption("startAsc");
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("Transformer 이해도 테스트");
  await page.getByLabel("정렬").selectOption("startDesc");
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("기말 프로젝트 사전 진단");
  await page.getByLabel("정렬").selectOption("titleAsc");
  await expect(page.getByTestId("classroom-task-exam-row").first()).toContainText("1주차 개념 확인 시험");
  await expectNoHorizontalOverflow(page);

  await takeRow.getByTestId("classroom-exam-take").click();
  await expect(page).toHaveURL(/\/exams\/exam_tasks_1$/);
  await page.goto("/classrooms/cls_tasks?section=tasks");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(6);
  await page.getByTestId("classroom-task-exam-row").filter({ hasText: "Transformer 이해도 테스트" }).getByTestId("classroom-exam-result").click();
  await expect(page).toHaveURL(/\/exams\/exam_tasks_5$/);

  await page.goto("/classrooms/cls_tasks?section=weeks");
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await expect(page.getByTestId("classroom-exam-list")).toContainText("1주차 개념 확인 시험");
  await expect(page.getByTestId("classroom-exam-list").getByTestId("classroom-exam-take")).toContainText("시험 응시");

  expect(mock.patchBodies).toHaveLength(0);
  expect(mock.teacherOnlyRequestUrls).toHaveLength(0);
  await expectNoHorizontalOverflow(page);
});

test("student tasks hides teacher-shaped exam rows defensively", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTasksData(page, studentUser, { studentUsesTeacherShape: true });

  await page.goto("/classrooms/cls_tasks?section=tasks");
  await expect(page.getByTestId("classroom-tasks-section")).toBeVisible();
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(0);
  await expect(page.getByTestId("classroom-task-exam-settings")).toHaveCount(0);
  await expect(page.locator(".tasks-chevron-btn")).toHaveCount(0);
  await expect(page.locator(".tasks-more-btn")).toHaveCount(0);
  await expect(page.getByTestId("classroom-exam-edit")).toHaveCount(0);
  await expect(page.getByTestId("classroom-exam-delete")).toHaveCount(0);
  await expect(page.getByTestId("classroom-exam-report")).toHaveCount(0);
  await expect(page.getByText("아직 공개된 시험이 없습니다. 선생님이 시험을 공개하면 이곳에 표시됩니다.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("tasks stays on dashboard without classroom context and mobile layout stays inside viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTasksData(page, teacherUser);

  await page.goto("/");
  await page.getByTestId("mobile-nav-open").click();
  await page.getByTestId("mobile-nav-tasks").click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/classrooms/cls_tasks?section=tasks");
  await expect(page.getByTestId("classroom-task-exam-row")).toHaveCount(6);
  const firstRow = page.getByTestId("classroom-task-exam-row").filter({ hasText: "1주차 개념 확인 시험" });
  await firstRow.getByRole("button", { name: /더보기/ }).click();
  const settingsPanel = page.getByTestId("classroom-task-exam-settings");
  await expect(settingsPanel).toBeVisible();
  expectTaskSettingsMobileActionSizing(await readTaskSettingsActionMetrics(settingsPanel));
  await finishAnimations(page);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-tasks-exams-mobile.png", fullPage: true });
  await expectNoHorizontalOverflow(page);
});
