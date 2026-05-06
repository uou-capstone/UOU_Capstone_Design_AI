import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const now = "2026-05-02T00:00:00.000Z";
const studentUser = {
  id: "usr_exam_start_student",
  email: "exam.start.student@example.com",
  displayName: "시나리오1 학생 01",
  role: "student",
  inviteCode: "8101",
  emailVerified: true,
  hasPassword: true
};
const classroom = {
  id: "cls_start_visual",
  title: "시험 시작 디자인 강의실",
  ownerUserId: "usr_exam_start_teacher",
  inviteCode: "7788",
  createdAt: now,
  updatedAt: now
};
const week = {
  id: "wk_start_visual",
  classroomId: classroom.id,
  weekIndex: 1,
  title: "1주차",
  createdAt: now,
  updatedAt: now
};
const baseMetadata = {
  id: "exam_start_visual",
  classroomId: classroom.id,
  weekId: week.id,
  status: "PUBLISHED",
  activePublishedVersion: 1,
  title: "중간고사",
  descriptionMarkdown: "학기중에 이야기했던 중간고사",
  availableFrom: now,
  availableUntil: "2026-05-03T00:00:00.000Z",
  timeLimitMinutes: 60,
  passScoreRatio: 0.7,
  totalPoints: 10,
  questionCount: 1,
  attempt: null
};

function startedAttempt(examId: string) {
  return {
    id: `att_${examId}`,
    examId,
    status: "IN_PROGRESS",
    examVersion: 1,
    startedAt: now,
    deadlineAt: "2026-05-02T01:00:00.000Z",
    answers: {},
    questions: [
      {
        id: "q_start_visual",
        type: "MCQ",
        promptMarkdown: "시작 화면 검증 문항",
        points: 10,
        choices: [
          { id: "a", textMarkdown: "1번" },
          { id: "b", textMarkdown: "2번" }
        ]
      }
    ]
  };
}

async function mockExamStartRoute(
  page: Page,
  options: {
    examId?: string;
    metadata?: Record<string, unknown>;
    attempt?: Record<string, unknown> | null;
    failMetadata?: boolean;
    failStart?: boolean;
    startDelay?: Promise<void>;
    startMethods?: string[];
    submitDelay?: Promise<void>;
    submitMethods?: string[];
  } = {}
) {
  const examId = options.examId ?? String(options.metadata?.id ?? baseMetadata.id);
  const metadata = { ...baseMetadata, id: examId, ...(options.metadata ?? {}) };
  await page.addInitScript(() => {
    window.__MERGE_EDU_TEST_CLOCK_NOW__ = Date.parse("2026-05-02T00:00:00.000Z");
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { user: studentUser } })
    })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "request encryption disabled in mocked e2e" })
    })
  );
  await page.route("**/api/classrooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [classroom] })
    })
  );
  await page.route(`**/api/exams/${examId}`, (route) => {
    if (options.failMetadata) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "시험 정보를 불러오지 못했습니다." })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: metadata })
    });
  });
  await page.route(`**/api/exams/${examId}/attempts/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: options.attempt ?? null })
    })
  );
  await page.route(`**/api/exams/${examId}/start`, (route) => {
    options.startMethods?.push(route.request().method());
    if (options.failStart) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "시험을 시작하지 못했습니다." })
      });
    }
    if (options.startDelay) {
      return options.startDelay.then(() =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: startedAttempt(examId) })
        })
      );
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: startedAttempt(examId) })
    });
  });
  await page.route(`**/api/exam-attempts/att_${examId}/answers`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) })
  );
  await page.route(`**/api/exam-attempts/att_${examId}/submit`, (route) => {
    options.submitMethods?.push(route.request().method());
    const fulfill = () =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            ...startedAttempt(examId),
            status: "GRADED",
            submittedAt: "2026-05-02T00:30:00.000Z",
            answers: route.request().postDataJSON().answers,
            grading: {
              totalScore: 10,
              maxScore: 10,
              scoreRatio: 1,
              items: [{ questionId: "q_start_visual", score: 10, maxScore: 10, verdict: "CORRECT", feedbackMarkdown: "정답" }],
              summaryMarkdown: "제출되었습니다.",
              gradingSource: "DETERMINISTIC_FALLBACK"
            }
          }
        })
      });
    if (options.submitDelay) {
      return options.submitDelay.then(fulfill);
    }
    return fulfill();
  });
}

async function mockClassroomLaunchPath(page: Page) {
  await page.route(`**/api/classrooms/${classroom.id}/weeks`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [week] })
    })
  );
  await page.route(`**/api/weeks/${week.id}/lectures`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route(`**/api/weeks/${week.id}/exams`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [baseMetadata] })
    })
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function expectStartElementsFit(page: Page) {
  const fits = await page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>("[data-testid='exam-start-hero']");
    const card = document.querySelector<HTMLElement>("[data-testid='exam-start-card']");
    if (!hero || !card) throw new Error("start surface probes are missing");
    return {
      heroFits: hero.scrollWidth <= hero.clientWidth + 1,
      cardFits: card.scrollWidth <= card.clientWidth + 1
    };
  });
  expect(fits.heroFits).toBe(true);
  expect(fits.cardFits).toBe(true);
}

test("student exam start screen matches the provided pre-start reference", async ({ page }) => {
  const startMethods: string[] = [];
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockExamStartRoute(page, { startMethods });
  await page.goto("/exams/exam_start_visual");

  await expect(page.getByTestId("app-shell-nav")).toBeVisible();
  await expect(page.getByTestId("exam-start-dashboard")).toBeVisible();
  await expect(page.getByTestId("exam-start-hero")).toBeVisible();
  await expect(page.getByRole("heading", { name: "중간고사" })).toBeVisible();
  await expect(page.getByText("학기중에 이야기했던 중간고사")).toBeVisible();
  await expect(page.getByTestId("exam-start-stat-card")).toContainText("10");
  await expect(page.getByTestId("exam-start-stat-card")).toContainText("60");
  await expect(page.getByTestId("exam-start-button")).toContainText("시험 시작");
  await expect(page.getByTestId("exam-start-button").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("exam-back-link")).toHaveAttribute("href", /\/classrooms\/cls_start_visual$/);

  const visualMetrics = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-testid='app-shell-nav']");
    const content = document.querySelector<HTMLElement>("[data-testid='app-shell-content']");
    const hero = document.querySelector<HTMLElement>("[data-testid='exam-start-hero']");
    const statCard = document.querySelector<HTMLElement>("[data-testid='exam-start-stat-card']");
    const secondStat = document.querySelector<HTMLElement>(".exam-start-stat + .exam-start-stat");
    const startCard = document.querySelector<HTMLElement>("[data-testid='exam-start-card']");
    const primaryButton = document.querySelector<HTMLElement>("[data-testid='exam-start-button']");
    const backLink = document.querySelector<HTMLElement>("[data-testid='exam-back-link']");
    if (!shell || !content || !hero || !statCard || !secondStat || !startCard || !primaryButton || !backLink) {
      throw new Error("visual probes are missing");
    }
    const shellRect = shell.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    const startCardRect = startCard.getBoundingClientRect();
    const primaryRect = primaryButton.getBoundingClientRect();
    const backRect = backLink.getBoundingClientRect();
    return {
      contentLeft: contentRect.left,
      shellRight: shellRect.right,
      heroBackground: getComputedStyle(hero).backgroundImage,
      heroRadius: Number.parseFloat(getComputedStyle(hero).borderRadius),
      heroHeight: heroRect.height,
      statBackground: getComputedStyle(statCard).backgroundColor,
      statDivider: getComputedStyle(secondStat).borderLeftColor,
      startCardHeight: startCardRect.height,
      primaryBackground: getComputedStyle(primaryButton).backgroundImage,
      primaryHeight: primaryRect.height,
      primaryWidth: primaryRect.width,
      backBackground: getComputedStyle(backLink).backgroundColor,
      backBorder: getComputedStyle(backLink).borderTopColor,
      backHeight: backRect.height
    };
  });
  expect(visualMetrics.contentLeft).toBeGreaterThanOrEqual(visualMetrics.shellRight - 4);
  expect(visualMetrics.heroBackground).toContain("linear-gradient");
  expect(visualMetrics.heroRadius).toBeGreaterThanOrEqual(14);
  expect(visualMetrics.heroHeight).toBeGreaterThanOrEqual(300);
  expect(visualMetrics.statBackground).toContain("255, 255, 255");
  expect(visualMetrics.statDivider).toContain("203, 213, 225");
  expect(visualMetrics.startCardHeight).toBeGreaterThanOrEqual(190);
  expect(visualMetrics.primaryBackground).toContain("linear-gradient");
  expect(visualMetrics.primaryHeight).toBeGreaterThanOrEqual(52);
  expect(visualMetrics.primaryWidth).toBeGreaterThanOrEqual(170);
  expect(visualMetrics.backBackground).toBe("rgb(255, 255, 255)");
  expect(visualMetrics.backBorder).toMatch(/rgb\(100, 116, 139\)|rgba\(100, 116, 139/);
  expect(visualMetrics.backHeight).toBeGreaterThanOrEqual(52);
  await expectNoHorizontalOverflow(page);
  await expectStartElementsFit(page);

  await expect(page).toHaveScreenshot("exam-taking-start-redesign-desktop.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/exam-taking-start-redesign.png", fullPage: true });

  await page.setViewportSize({ width: 1920, height: 1080 });
  const wideDashboardWidth = await page.getByTestId("exam-start-dashboard").evaluate((element) =>
    element.getBoundingClientRect().width
  );
  expect(wideDashboardWidth).toBeLessThanOrEqual(1240);
  await expectNoHorizontalOverflow(page);
  await expectStartElementsFit(page);

  await page.getByTestId("exam-start-button").click();
  await expect.poll(() => startMethods.join(",")).toBe("POST");
  await expect(page.getByTestId("exam-start-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("exam-countdown")).toBeVisible();
  await expect(page.getByText("시작 화면 검증 문항")).toBeVisible();
});

test("student exam start screen remains polished on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mockExamStartRoute(page);
  await page.goto("/exams/exam_start_visual");

  await expect(page.getByTestId("exam-start-dashboard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "중간고사" })).toBeVisible();
  await expect(page.getByTestId("exam-start-stat-card")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectStartElementsFit(page);

  await expect(page).toHaveScreenshot("exam-taking-start-redesign-mobile.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/exam-taking-start-redesign-mobile.png", fullPage: true });
});

test("student can reach the redesigned pre-start screen from the week exam action", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockExamStartRoute(page);
  await mockClassroomLaunchPath(page);

  await page.goto(`/classrooms/${classroom.id}?section=weeks`);
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-exam-take").click();

  await expect(page).toHaveURL(/\/exams\/exam_start_visual$/);
  await expect(page.getByTestId("exam-start-dashboard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "중간고사" })).toBeVisible();
});

test("student exam start screen handles fallback, metadata failure, and existing attempts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockExamStartRoute(page, {
    examId: "exam_start_empty_description",
    metadata: { descriptionMarkdown: "   " }
  });
  await page.goto("/exams/exam_start_empty_description");
  await expect(page.getByTestId("exam-start-hero")).toContainText("시작 버튼을 누르면 문항이 공개됩니다.");

  await mockExamStartRoute(page, {
    examId: "exam_start_stale_metadata_failure",
    failMetadata: true
  });
  await page.evaluate(() => {
    window.history.pushState({}, "", "/exams/exam_start_stale_metadata_failure");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/exams\/exam_start_stale_metadata_failure$/);
  await expect(page.getByText("시험 정보를 불러오지 못했습니다.")).toBeVisible();
  await expect(page.getByTestId("exam-start-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("exam-start-button")).toHaveCount(0);

  const delayedPage = await page.context().newPage();
  await delayedPage.setViewportSize({ width: 1440, height: 960 });
  let releaseLateStart!: () => void;
  const lateStart = new Promise<void>((resolve) => {
    releaseLateStart = resolve;
  });
  const lateStartMethods: string[] = [];
  await mockExamStartRoute(delayedPage, {
    examId: "exam_start_late_response",
    startDelay: lateStart,
    startMethods: lateStartMethods
  });
  await delayedPage.goto("/exams/exam_start_late_response");
  await delayedPage.getByTestId("exam-start-button").click();
  await expect.poll(() => lateStartMethods.join(",")).toBe("POST");
  await mockExamStartRoute(delayedPage, {
    examId: "exam_start_after_late_response",
    metadata: { title: "다음 시험" }
  });
  await delayedPage.evaluate(() => {
    window.history.pushState({}, "", "/exams/exam_start_after_late_response");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(delayedPage.getByRole("heading", { name: "다음 시험" })).toBeVisible();
  releaseLateStart();
  await delayedPage.waitForTimeout(100);
  await expect(delayedPage.getByRole("heading", { name: "다음 시험" })).toBeVisible();
  await expect(delayedPage.getByText("시작 화면 검증 문항")).toHaveCount(0);
  await expect(delayedPage.getByTestId("exam-countdown")).toHaveCount(0);
  await delayedPage.close();

  const delayedSubmitPage = await page.context().newPage();
  await delayedSubmitPage.setViewportSize({ width: 1440, height: 960 });
  let releaseLateSubmit!: () => void;
  const lateSubmit = new Promise<void>((resolve) => {
    releaseLateSubmit = resolve;
  });
  const lateSubmitMethods: string[] = [];
  await mockExamStartRoute(delayedSubmitPage, {
    examId: "exam_submit_late_response",
    attempt: startedAttempt("exam_submit_late_response"),
    submitDelay: lateSubmit,
    submitMethods: lateSubmitMethods
  });
  await delayedSubmitPage.goto("/exams/exam_submit_late_response");
  await expect(delayedSubmitPage.getByTestId("exam-submit-button")).toBeEnabled();
  await delayedSubmitPage.getByTestId("exam-submit-button").click();
  await expect.poll(() => lateSubmitMethods.join(",")).toBe("POST");
  await mockExamStartRoute(delayedSubmitPage, {
    examId: "exam_submit_after_late_response",
    metadata: { title: "제출 다음 시험" },
    attempt: startedAttempt("exam_submit_after_late_response")
  });
  await delayedSubmitPage.evaluate(() => {
    window.history.pushState({}, "", "/exams/exam_submit_after_late_response");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(delayedSubmitPage.getByRole("heading", { name: "제출 다음 시험" })).toBeVisible();
  await expect(delayedSubmitPage.getByTestId("exam-submit-button")).toHaveText("제출");
  await expect(delayedSubmitPage.getByTestId("exam-submit-button")).toBeEnabled();
  releaseLateSubmit();
  await delayedSubmitPage.waitForTimeout(100);
  await expect(delayedSubmitPage.getByRole("heading", { name: "제출 다음 시험" })).toBeVisible();
  await expect(delayedSubmitPage.getByTestId("exam-submit-button")).toBeEnabled();
  await expect(delayedSubmitPage.getByTestId("exam-score-summary")).toHaveCount(0);
  await delayedSubmitPage.close();

  const startFailurePage = await page.context().newPage();
  await startFailurePage.setViewportSize({ width: 1440, height: 960 });
  await mockExamStartRoute(startFailurePage, {
    examId: "exam_start_start_failure",
    failStart: true
  });
  await startFailurePage.goto("/exams/exam_start_start_failure");
  await startFailurePage.getByTestId("exam-start-button").click();
  await expect(startFailurePage.getByText("시험을 시작하지 못했습니다.")).toBeVisible();
  await expect(startFailurePage.getByTestId("exam-start-dashboard")).toBeVisible();
  await expect(startFailurePage.getByTestId("exam-start-button")).toBeVisible();
  await startFailurePage.close();

  const failurePage = await page.context().newPage();
  await failurePage.setViewportSize({ width: 1440, height: 960 });
  await mockExamStartRoute(failurePage, {
    examId: "exam_start_metadata_failure",
    failMetadata: true
  });
  await failurePage.goto("/exams/exam_start_metadata_failure");
  await expect(failurePage.getByText("시험 정보를 불러오지 못했습니다.")).toBeVisible();
  await expect(failurePage.getByTestId("exam-start-button")).toHaveCount(0);
  await failurePage.close();

  const attemptPage = await page.context().newPage();
  await attemptPage.setViewportSize({ width: 1440, height: 960 });
  await mockExamStartRoute(attemptPage, {
    examId: "exam_start_existing_attempt",
    attempt: startedAttempt("exam_start_existing_attempt")
  });
  await attemptPage.goto("/exams/exam_start_existing_attempt");
  await expect(attemptPage.getByTestId("exam-start-dashboard")).toHaveCount(0);
  await expect(attemptPage.getByTestId("exam-countdown")).toBeVisible();
  await expect(attemptPage.getByText("시작 화면 검증 문항")).toBeVisible();
  await attemptPage.close();
});
