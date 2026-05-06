import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const teacherUser = {
  id: "usr_week_visual_teacher",
  email: "week.visual.teacher@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "1357",
  emailVerified: true,
  hasPassword: true
};

const studentUser = {
  id: "usr_week_visual_student",
  email: "week.visual.student@example.com",
  displayName: "시나리오1 학생 01",
  role: "student",
  inviteCode: "8101",
  emailVerified: true,
  hasPassword: true
};

const weeks = Array.from({ length: 4 }, (_, index) => ({
  id: `wk_week_visual_${index + 1}`,
  classroomId: "cls_week_visual",
  weekIndex: index + 1,
  title: `${index + 1}주차`,
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z"
}));

const lectures = [
  {
    id: "lec_week_visual_1",
    weekId: "wk_week_visual_1",
    title: "MergeAISystem 가이드 테스트 자료",
    pdf: {
      id: "pdf_week_visual_1",
      originalName: "merge-ai-system.pdf",
      mimeType: "application/pdf",
      size: 1024,
      numPages: 13,
      createdAt: "2026-05-02T00:00:00.000Z"
    },
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z"
  },
  {
    id: "lec_week_visual_2",
    weekId: "wk_week_visual_1",
    title: "또 다른것",
    pdf: {
      id: "pdf_week_visual_2",
      originalName: "another.pdf",
      mimeType: "application/pdf",
      size: 2048,
      numPages: 6,
      createdAt: "2026-05-02T00:00:00.000Z"
    },
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z"
  }
];

const exams = [
  {
    id: "exam_week_visual_midterm",
    classroomId: "cls_week_visual",
    weekId: "wk_week_visual_1",
    status: "PUBLISHED",
    activePublishedVersion: 1,
    draftRevision: {
      version: 1,
      title: "중간고사",
      descriptionMarkdown: "",
      availableFrom: "2026-05-02T00:00:00.000Z",
      availableUntil: "2026-05-03T00:00:00.000Z",
      timeLimitMinutes: 30,
      passScoreRatio: 0.7,
      aiGradingEnabled: true,
      questions: [
        {
          id: "q_week_visual_1",
          type: "OX",
          promptMarkdown: "주차 화면 버튼 시각 검증 문항",
          points: 10,
          answer: { value: true }
        }
      ],
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    },
    publishedRevision: {
      version: 1,
      title: "중간고사",
      descriptionMarkdown: "",
      availableFrom: "2026-05-02T00:00:00.000Z",
      availableUntil: "2026-05-03T00:00:00.000Z",
      timeLimitMinutes: 30,
      passScoreRatio: 0.7,
      aiGradingEnabled: true,
      questions: [
        {
          id: "q_week_visual_1",
          type: "OX",
          promptMarkdown: "주차 화면 버튼 시각 검증 문항",
          points: 10,
          answer: { value: true }
        }
      ],
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    },
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    totalPoints: 10,
    publishedTotalPoints: 10
  }
];

const duplicateTitleExams = [
  exams[0],
  {
    ...exams[0],
    id: "exam_week_visual_midterm_retake",
    totalPoints: 8,
    publishedTotalPoints: 8,
    draftRevision: {
      ...exams[0].draftRevision,
      questions: [
        {
          id: "q_week_visual_2",
          type: "OX",
          promptMarkdown: "중복 제목 접근성 검증 문항",
          points: 8,
          answer: { value: true }
        }
      ]
    },
    publishedRevision: exams[0].publishedRevision
      ? {
          ...exams[0].publishedRevision,
          questions: [
            {
              id: "q_week_visual_2",
              type: "OX",
              promptMarkdown: "중복 제목 접근성 검증 문항",
              points: 8,
              answer: { value: true }
            }
          ]
        }
      : undefined
  }
];

function toStudentExamMetadata(exam: any, attempt: any = null) {
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

function makeAttempt(status: "IN_PROGRESS" | "GRADING" | "GRADED", examId = "exam_week_visual_midterm", grading?: any) {
  return {
    id: `attempt_week_visual_${examId}_${status.toLowerCase()}`,
    examId,
    status,
    examVersion: 1,
    startedAt: "2026-05-02T01:00:00.000Z",
    deadlineAt: "2026-05-02T01:30:00.000Z",
    submittedAt: status === "IN_PROGRESS" ? undefined : "2026-05-02T01:20:00.000Z",
    gradedAt: status === "GRADED" ? "2026-05-02T01:21:00.000Z" : undefined,
    answers: {},
    ...(grading ? { grading } : {})
  };
}

const fullScoreGrading = {
  totalScore: 10,
  maxScore: 10,
  scoreRatio: 1,
  items: [],
  summaryMarkdown: "정답입니다.",
  gradingSource: "AI"
};

async function mockWeekVisualData(
  page: Page,
  options: { exams?: any[]; user?: typeof teacherUser | typeof studentUser } = {}
) {
  const user = options.user ?? teacherUser;
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
  await page.route("**/api/classrooms/cls_week_visual/weeks", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: weeks })
    })
  );
  await page.route("**/api/classrooms/cls_week_visual/students", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/weeks/wk_week_visual_1/lectures", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: lectures })
    })
  );
  await page.route("**/api/weeks/wk_week_visual_1/exams", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: options.exams ?? exams })
    })
  );
}

async function finishAnimations(page: Page) {
  await page.evaluate(() => {
    document.getAnimations().forEach((animation) => animation.finish());
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function expectStudentActionOutline(button: Locator) {
  const styles = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
      height: rect.height,
      width: rect.width
    };
  });
  expect(styles.backgroundImage).toBe("none");
  expect(styles.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(styles.borderColor).toContain("103, 92, 255");
  expect(styles.boxShadow).toBe("none");
  expect(styles.color).toMatch(/rgb\(95, 99, 255\)|rgb\(107, 115, 255\)/);
  expect(styles.height).toBeGreaterThanOrEqual(42);
  return styles;
}

async function expectStudentResultActionReference(button: Locator) {
  const styles = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      color: style.color,
      height: rect.height,
      width: rect.width
    };
  });
  expect(styles.backgroundImage).toBe("none");
  expect(styles.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(styles.borderColor).toContain("103, 92, 255");
  expect(styles.borderRadius).toBe("8px");
  expect(styles.boxShadow).toBe("none");
  expect(styles.color).toBe("rgb(95, 99, 255)");
  expect(styles.height).toBeGreaterThanOrEqual(44);
  expect(styles.width).toBeGreaterThanOrEqual(132);
  return styles;
}

test("classroom week management matches the polished accordion reference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockWeekVisualData(page);

  await page.goto("/classrooms/cls_week_visual?section=weeks");
  const weeksSection = page.getByTestId("classroom-weeks-section");
  await expect(weeksSection).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 주차 추가" })).toBeVisible();
  await expect(page.getByRole("button", { name: "선택 주차 삭제" })).toBeVisible();

  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  const expandedCard = page.locator(".week-card.expanded");
  await expect(expandedCard).toHaveCount(1);
  await expect(expandedCard.locator(".lecture-row")).toHaveCount(3);
  await expect(expandedCard.locator(".week-empty-evaluation")).toHaveCount(0);
  const examRow = page.getByTestId("classroom-exam-row");
  await expect(examRow).toContainText("중간고사");
  await expect(examRow).toContainText("PUBLISHED · 10점");
  await expect(examRow.getByTestId("classroom-exam-edit")).toHaveText("수정");
  await expect(examRow.getByTestId("classroom-exam-report")).toHaveText("리포트");
  await expect(examRow.getByTestId("classroom-exam-delete")).toHaveText("");
  await expect(examRow.getByTestId("classroom-exam-edit")).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 수정");
  await expect(examRow.getByTestId("classroom-exam-report")).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 리포트");
  await expect(examRow.getByTestId("classroom-exam-delete")).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 삭제");
  await expect(examRow.getByTestId("classroom-exam-edit").locator("svg")).toHaveCount(1);
  await expect(examRow.getByTestId("classroom-exam-report").locator("svg")).toHaveCount(1);
  await expect(examRow.getByTestId("classroom-exam-delete").locator("svg")).toHaveCount(1);
  const desktopButtonStyles = await examRow.evaluate((row) => {
    const edit = row.querySelector<HTMLElement>("[data-testid='classroom-exam-edit']");
    const report = row.querySelector<HTMLElement>("[data-testid='classroom-exam-report']");
    const remove = row.querySelector<HTMLElement>("[data-testid='classroom-exam-delete']");
    if (!edit || !report || !remove) throw new Error("exam action buttons missing");
    return {
      deleteHeight: remove.getBoundingClientRect().height,
      deleteWidth: remove.getBoundingClientRect().width,
      editBackground: getComputedStyle(edit).backgroundImage,
      editColor: getComputedStyle(edit).color,
      reportBackground: getComputedStyle(report).backgroundImage,
      reportColor: getComputedStyle(report).color,
      removeBackground: getComputedStyle(remove).backgroundImage,
      removeColor: getComputedStyle(remove).color
    };
  });
  expect(desktopButtonStyles.reportBackground).toContain("linear-gradient");
  expect(desktopButtonStyles.reportColor).toBe("rgb(255, 255, 255)");
  expect(desktopButtonStyles.editBackground).toBe("none");
  expect(desktopButtonStyles.removeBackground).toBe("none");
  expect(Math.abs(desktopButtonStyles.deleteHeight - desktopButtonStyles.deleteWidth)).toBeLessThanOrEqual(2);

  const fitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(fitsViewport).toBe(true);

  mkdirSync("test-results", { recursive: true });
  await weeksSection.screenshot({ path: "test-results/classroom-week-management-redesign.png" });

  await page.setViewportSize({ width: 430, height: 900 });
  const mobileMetrics = await examRow.evaluate((row) => {
    const actions = row.querySelector<HTMLElement>(".lecture-actions");
    const edit = row.querySelector<HTMLElement>("[data-testid='classroom-exam-edit']");
    const report = row.querySelector<HTMLElement>("[data-testid='classroom-exam-report']");
    const remove = row.querySelector<HTMLElement>("[data-testid='classroom-exam-delete']");
    if (!actions || !edit || !report || !remove) throw new Error("mobile exam action probes missing");
    return {
      actionsWidth: actions.getBoundingClientRect().width,
      deleteHeight: remove.getBoundingClientRect().height,
      deleteWidth: remove.getBoundingClientRect().width,
      editVisible: edit.offsetParent !== null,
      reportVisible: report.offsetParent !== null,
      removeVisible: remove.offsetParent !== null,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(mobileMetrics.viewportWidth + 1);
  expect(mobileMetrics.editVisible).toBe(true);
  expect(mobileMetrics.reportVisible).toBe(true);
  expect(mobileMetrics.removeVisible).toBe(true);
  expect(mobileMetrics.deleteWidth).toBeLessThanOrEqual(56);
  expect(Math.abs(mobileMetrics.deleteHeight - mobileMetrics.deleteWidth)).toBeLessThanOrEqual(2);
});

test("student week exam take button matches the reference outline style", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockWeekVisualData(page, {
    user: studentUser,
    exams: [toStudentExamMetadata(exams[0])]
  });

  await page.goto("/classrooms/cls_week_visual?section=weeks");
  const weeksSection = page.getByTestId("classroom-weeks-section");
  await expect(weeksSection).toBeVisible();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();

  const examRow = page.getByTestId("classroom-exam-row");
  await expect(examRow).toContainText("중간고사");
  await expect(examRow.getByTestId("classroom-exam-edit")).toHaveCount(0);
  await expect(examRow.getByTestId("classroom-exam-report")).toHaveCount(0);
  await expect(examRow.getByTestId("classroom-exam-delete")).toHaveCount(0);

  const takeButton = examRow.getByTestId("classroom-exam-take");
  await expect(takeButton).toHaveText("시험 응시");
  await expect(takeButton).toHaveAttribute("href", /\/exams\/exam_week_visual_midterm$/);
  await expect(takeButton).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 시험 응시");
  await expect(takeButton.locator("svg")).toHaveCount(1);

  const desktopButtonStyles = await expectStudentActionOutline(takeButton);
  expect(desktopButtonStyles.width).toBeGreaterThanOrEqual(124);
  await expectNoHorizontalOverflow(page);

  mkdirSync("test-results", { recursive: true });
  await finishAnimations(page);
  await page.screenshot({ path: "test-results/classroom-week-student-exam-take-button.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 900 });
  await finishAnimations(page);
  const mobileMetrics = await takeButton.evaluate((button) => {
    const row = button.closest<HTMLElement>(".classroom-exam-row");
    const actions = button.closest<HTMLElement>(".lecture-actions");
    if (!row || !actions) throw new Error("student exam action probes missing");
    const buttonRect = button.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      actionsLeft: actionsRect.left,
      actionsRight: actionsRect.right,
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      buttonWidth: buttonRect.width,
      rowLeft: rowRect.left,
      rowRight: rowRect.right,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(mobileMetrics.viewportWidth + 1);
  expect(mobileMetrics.buttonLeft).toBeGreaterThanOrEqual(mobileMetrics.actionsLeft - 1);
  expect(mobileMetrics.buttonRight).toBeLessThanOrEqual(mobileMetrics.actionsRight + 1);
  expect(mobileMetrics.buttonLeft).toBeGreaterThanOrEqual(mobileMetrics.rowLeft - 1);
  expect(mobileMetrics.buttonRight).toBeLessThanOrEqual(mobileMetrics.rowRight + 1);
  expect(mobileMetrics.buttonWidth).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/classroom-week-student-exam-take-button-mobile.png", fullPage: true });
});

test("student week exam result button matches the reference outline style", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockWeekVisualData(page, {
    user: studentUser,
    exams: [toStudentExamMetadata(exams[0], makeAttempt("GRADED", exams[0].id, fullScoreGrading))]
  });

  await page.goto("/classrooms/cls_week_visual?section=weeks");
  const weeksSection = page.getByTestId("classroom-weeks-section");
  await expect(weeksSection).toBeVisible();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();

  const examRow = page.getByTestId("classroom-exam-row");
  await expect(examRow).toContainText("중간고사");
  await expect(examRow.getByTestId("classroom-exam-edit")).toHaveCount(0);
  await expect(examRow.getByTestId("classroom-exam-report")).toHaveCount(0);
  await expect(examRow.getByTestId("classroom-exam-delete")).toHaveCount(0);

  const resultButton = examRow.getByTestId("classroom-exam-result");
  await expect(resultButton).toHaveText("결과 보기");
  await expect(resultButton).toHaveAttribute("href", /\/exams\/exam_week_visual_midterm$/);
  await expect(resultButton).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 결과 보기");
  await expect(resultButton.locator("svg")).toHaveCount(1);
  await expectStudentResultActionReference(resultButton);
  await expectNoHorizontalOverflow(page);

  mkdirSync("test-results", { recursive: true });
  await finishAnimations(page);
  await expect(resultButton).toHaveScreenshot("classroom-week-student-exam-result-button-desktop.png", {
    animations: "disabled"
  });
  await page.screenshot({ path: "test-results/classroom-week-student-exam-result-button.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 900 });
  await finishAnimations(page);
  const mobileMetrics = await resultButton.evaluate((button) => {
    const row = button.closest<HTMLElement>(".classroom-exam-row");
    const actions = button.closest<HTMLElement>(".lecture-actions");
    if (!row || !actions) throw new Error("student result action probes missing");
    const buttonRect = button.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      actionsLeft: actionsRect.left,
      actionsRight: actionsRect.right,
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      buttonWidth: buttonRect.width,
      rowLeft: rowRect.left,
      rowRight: rowRect.right,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(mobileMetrics.viewportWidth + 1);
  expect(mobileMetrics.buttonLeft).toBeGreaterThanOrEqual(mobileMetrics.actionsLeft - 1);
  expect(mobileMetrics.buttonRight).toBeLessThanOrEqual(mobileMetrics.actionsRight + 1);
  expect(mobileMetrics.buttonLeft).toBeGreaterThanOrEqual(mobileMetrics.rowLeft - 1);
  expect(mobileMetrics.buttonRight).toBeLessThanOrEqual(mobileMetrics.rowRight + 1);
  expect(mobileMetrics.buttonWidth).toBeGreaterThan(0);
  await expect(resultButton).toHaveScreenshot("classroom-week-student-exam-result-button-mobile.png", {
    animations: "disabled"
  });
  await page.screenshot({ path: "test-results/classroom-week-student-exam-result-button-mobile.png", fullPage: true });
});

test("student week exam action states use distinct labels and accessibility", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const inProgressExam = toStudentExamMetadata(
    {
      ...exams[0],
      id: "exam_week_visual_progress"
    },
    makeAttempt("IN_PROGRESS", "exam_week_visual_progress")
  );
  const gradingExam = toStudentExamMetadata(
    {
      ...exams[0],
      id: "exam_week_visual_grading"
    },
    makeAttempt("GRADING", "exam_week_visual_grading")
  );
  const gradedExam = toStudentExamMetadata(
    {
      ...exams[0],
      id: "exam_week_visual_graded"
    },
    makeAttempt("GRADED", "exam_week_visual_graded", fullScoreGrading)
  );
  const gradedPendingExam = toStudentExamMetadata(
    {
      ...exams[0],
      id: "exam_week_visual_graded_pending"
    },
    makeAttempt("GRADED", "exam_week_visual_graded_pending")
  );
  await mockWeekVisualData(page, {
    user: studentUser,
    exams: [inProgressExam, gradingExam, gradedExam, gradedPendingExam]
  });

  await page.goto("/classrooms/cls_week_visual?section=weeks");
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();

  const inProgressButton = page.getByTestId("classroom-exam-take");
  await expect(inProgressButton).toHaveText("시험 응시");
  await expect(inProgressButton).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 시험 응시");
  await expect(inProgressButton).toHaveAttribute("href", /\/exams\/exam_week_visual_progress$/);
  await expect(inProgressButton.locator("svg")).toHaveCount(1);
  await expectStudentActionOutline(inProgressButton);

  const gradingButton = page.getByTestId("classroom-exam-grading");
  await expect(gradingButton).toHaveText("채점 중");
  await expect(gradingButton).toHaveAttribute("aria-label", "1주차 중간고사 2번 시험 채점 중");
  await expect(gradingButton).toHaveAttribute("aria-disabled", "true");
  await expect(gradingButton.locator("svg")).toHaveCount(1);
  await expectStudentActionOutline(gradingButton);
  const currentUrl = page.url();
  await gradingButton.click({ force: true });
  await expect(page).toHaveURL(currentUrl);

  const resultButton = page.getByTestId("classroom-exam-result");
  await expect(resultButton).toHaveText("결과 보기");
  await expect(resultButton).toHaveAttribute("aria-label", "1주차 중간고사 3번 시험 결과 보기");
  await expect(resultButton).toHaveAttribute("href", /\/exams\/exam_week_visual_graded$/);
  await expect(resultButton.locator("svg")).toHaveCount(1);
  await expectStudentActionOutline(resultButton);

  const pendingButton = page.getByTestId("classroom-exam-result-pending");
  await expect(pendingButton).toHaveText("결과 준비 중");
  await expect(pendingButton).toHaveAttribute("aria-label", "1주차 중간고사 4번 시험 결과 준비 중");
  await expect(pendingButton).toHaveAttribute("aria-disabled", "true");
  await expect(pendingButton.locator("svg")).toHaveCount(1);
  const pendingUrl = page.url();
  await pendingButton.click({ force: true });
  await expect(page).toHaveURL(pendingUrl);
  await expectNoHorizontalOverflow(page);
});

test("classroom week exam action labels distinguish duplicate exam titles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockWeekVisualData(page, { exams: duplicateTitleExams });

  await page.goto("/classrooms/cls_week_visual?section=weeks");
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();

  const editButtons = page.getByTestId("classroom-exam-edit");
  const reportLinks = page.getByTestId("classroom-exam-report");
  const deleteButtons = page.getByTestId("classroom-exam-delete");
  await expect(editButtons).toHaveCount(2);
  await expect(reportLinks).toHaveCount(2);
  await expect(deleteButtons).toHaveCount(2);

  await expect(editButtons.nth(0)).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 수정");
  await expect(editButtons.nth(1)).toHaveAttribute("aria-label", "1주차 중간고사 2번 시험 수정");
  await expect(reportLinks.nth(0)).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 리포트");
  await expect(reportLinks.nth(1)).toHaveAttribute("aria-label", "1주차 중간고사 2번 시험 리포트");
  await expect(deleteButtons.nth(0)).toHaveAttribute("aria-label", "1주차 중간고사 1번 시험 삭제");
  await expect(deleteButtons.nth(1)).toHaveAttribute("aria-label", "1주차 중간고사 2번 시험 삭제");
});
