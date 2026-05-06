import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const now = "2026-05-02T00:00:00.000Z";
const studentUser = {
  id: "usr_exam_take_student",
  email: "s01@mergeedu.local",
  displayName: "시나리오1 학생 01",
  role: "student",
  inviteCode: "8101",
  emailVerified: true,
  hasPassword: true
};
const classroom = {
  id: "cls_take_visual",
  title: "시험 응시 디자인 강의실",
  ownerUserId: "usr_exam_take_teacher",
  inviteCode: "7788",
  createdAt: now,
  updatedAt: now
};
const week = {
  id: "wk_take_visual",
  classroomId: classroom.id,
  weekIndex: 1,
  title: "1주차",
  createdAt: now,
  updatedAt: now
};
const baseQuestions = [
  {
    id: "q_ox",
    type: "OX",
    promptMarkdown: "Kerberos는 대칭키 암호화를 기반으로 동작한다.",
    points: 2
  },
  {
    id: "q_mcq",
    type: "MCQ",
    promptMarkdown: "다음 중 정보 보안의 3요소에 해당하지 않는 것은 무엇입니까?",
    points: 2,
    choices: [
      { id: "confidentiality", textMarkdown: "기밀성 (Confidentiality)" },
      { id: "integrity", textMarkdown: "무결성 (Integrity)" },
      { id: "availability", textMarkdown: "가용성 (Availability)" },
      { id: "efficiency", textMarkdown: "효율성 (Efficiency)" }
    ]
  },
  {
    id: "q_short",
    type: "SHORT",
    promptMarkdown: "SSL/TLS 프로토콜의 기본 포트 번호는 무엇입니까?",
    points: 2
  },
  {
    id: "q_essay",
    type: "ESSAY",
    promptMarkdown: "대칭키 암호화의 장점과 단점을 각각 설명하십시오.",
    points: 4
  }
];
const baseAnswers = {
  q_ox: { value: true },
  q_mcq: { choiceId: "availability" },
  q_short: "443",
  q_essay:
    "장점은 처리 속도가 빠르고 구현이 단순하다는 점입니다.\n단점은 키 분배 문제가 있으며, 키 관리가 어려워 사용자 수가 많아질수록 보안 유지가 복잡해집니다."
};

function metadataFor(examId: string, metadata: Record<string, unknown> = {}) {
  return {
    id: examId,
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
    questionCount: baseQuestions.length,
    attempt: null,
    ...metadata
  };
}

function attemptFor(examId: string, attempt: Record<string, unknown> = {}) {
  return {
    id: `att_${examId}`,
    examId,
    status: "IN_PROGRESS",
    examVersion: 1,
    startedAt: now,
    deadlineAt: "2026-05-02T00:59:53.000Z",
    answers: baseAnswers,
    questions: baseQuestions,
    ...attempt
  };
}

async function mockStudentExamRoutes(
  page: Page,
  configs: Record<
    string,
    {
      metadata?: Record<string, unknown>;
      attempt?: Record<string, unknown> | null;
      savePayloads?: unknown[];
      submitPayloads?: unknown[];
      submitDelay?: Promise<void>;
    }
  >
) {
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [classroom] }) })
  );
  await page.route(/\/api\/exams\/([^/]+)$/, (route) => {
    const examId = route.request().url().match(/\/api\/exams\/([^/]+)$/)?.[1] ?? "";
    const config = configs[examId];
    return route.fulfill({
      status: config ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(config ? { ok: true, data: metadataFor(examId, config.metadata) } : { ok: false, error: "not found" })
    });
  });
  await page.route(/\/api\/exams\/([^/]+)\/attempts\/me$/, (route) => {
    const examId = route.request().url().match(/\/api\/exams\/([^/]+)\/attempts\/me$/)?.[1] ?? "";
    const config = configs[examId];
    const attempt = config?.attempt === null ? null : attemptFor(examId, config?.attempt);
    return route.fulfill({
      status: config ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(config ? { ok: true, data: attempt } : { ok: false, error: "not found" })
    });
  });
  await page.route(/\/api\/exam-attempts\/([^/]+)\/answers$/, (route) => {
    const attemptId = route.request().url().match(/\/api\/exam-attempts\/([^/]+)\/answers$/)?.[1] ?? "";
    const examId = attemptId.replace(/^att_/, "");
    const config = configs[examId];
    config?.savePayloads?.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
  });
  await page.route(/\/api\/exam-attempts\/([^/]+)\/submit$/, async (route) => {
    const attemptId = route.request().url().match(/\/api\/exam-attempts\/([^/]+)\/submit$/)?.[1] ?? "";
    const examId = attemptId.replace(/^att_/, "");
    const config = configs[examId];
    const payload = route.request().postDataJSON();
    config?.submitPayloads?.push(payload);
    if (config?.submitDelay) await config.submitDelay;
    return route.fulfill({
      status: config ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(
        config
          ? {
              ok: true,
              data: {
                ...attemptFor(examId, config.attempt ?? {}),
                status: "GRADED",
                submittedAt: "2026-05-02T00:30:00.000Z",
                answers: payload.answers,
                grading: {
                  totalScore: 10,
                  maxScore: 10,
                  scoreRatio: 1,
                  items: baseQuestions.map((question) => ({
                    questionId: question.id,
                    score: question.points,
                    maxScore: question.points,
                    verdict: "CORRECT",
                    feedbackMarkdown: "응답이 저장되었습니다."
                  })),
                  summaryMarkdown: "제출되었습니다.",
                  gradingSource: "DETERMINISTIC_FALLBACK"
                }
              }
            }
          : { ok: false, error: "not found" }
      )
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function expectInProgressLayoutFit(page: Page) {
  const geometry = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>("[data-testid='app-shell-nav']")?.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>("[data-testid='app-shell-content']")?.getBoundingClientRect();
    const hero = document.querySelector<HTMLElement>("[data-testid='exam-taking-hero']")?.getBoundingClientRect();
    const firstCard = document.querySelector<HTMLElement>("[data-testid='exam-taking-question-card']")?.getBoundingClientRect();
    const firstPrompt = document.querySelector<HTMLElement>(".exam-taking-question-prompt")?.getBoundingClientRect();
    const firstAnswer = document.querySelector<HTMLElement>(".exam-taking-answer-panel")?.getBoundingClientRect();
    if (!nav || !content || !hero || !firstCard || !firstPrompt || !firstAnswer) return null;
    return {
      clearsSidebar: content.left >= nav.right + 20,
      heroContained: hero.left >= content.left - 1 && hero.right <= content.right + 1,
      cardContained: firstCard.left >= content.left - 1 && firstCard.right <= content.right + 1,
      twoColumn: firstAnswer.left > firstPrompt.right
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry?.clearsSidebar).toBe(true);
  expect(geometry?.heroContained).toBe(true);
  expect(geometry?.cardContained).toBe(true);
  expect(geometry?.twoColumn).toBe(true);
}

test("student in-progress exam matches the reference layout on desktop", async ({ page }) => {
  mkdirSync("test-results", { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockStudentExamRoutes(page, { exam_take_visual: {} });

  await page.goto("/exams/exam_take_visual");

  await expect(page.getByTestId("exam-taking-dashboard")).toBeVisible();
  await expect(page.getByTestId("exam-start-dashboard")).toHaveCount(0);
  await expect(page.locator(".classroom-hero")).toHaveCount(0);
  await expect(page.getByTestId("exam-taking-hero")).toContainText("중간고사");
  await expect(page.getByTestId("exam-taking-hero")).toContainText("10점");
  await expect(page.getByTestId("exam-taking-hero")).toContainText("60분");
  await expect(page.getByTestId("exam-countdown")).toHaveText("59:53");
  await expect(page.getByTestId("exam-taking-question-card")).toHaveCount(4);
  await expect(page.getByTestId("exam-question-type-badge").nth(0)).toHaveText("OX 문제");
  await expect(page.getByTestId("exam-question-type-badge").nth(1)).toHaveText("객관식");
  await expect(page.getByTestId("exam-question-type-badge").nth(2)).toHaveText("단답식");
  await expect(page.getByTestId("exam-question-type-badge").nth(3)).toHaveText("서술형");
  await expect(page.locator("select[data-testid='exam-answer-input']")).toHaveCount(0);
  await expect(page.getByTestId("exam-ox-option").filter({ hasText: "O" })).toHaveClass(/is-selected/);
  await expect(page.getByTestId("exam-choice-option").filter({ hasText: "가용성" })).toHaveClass(/is-selected/);
  await expectInProgressLayoutFit(page);
  await expectNoHorizontalOverflow(page);

  await expect(page).toHaveScreenshot("exam-taking-in-progress-redesign-desktop.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
  await page.screenshot({ path: "test-results/exam-taking-in-progress-redesign.png", fullPage: true });
});

test("student in-progress exam stacks cleanly on mobile", async ({ page }) => {
  mkdirSync("test-results", { recursive: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await mockStudentExamRoutes(page, { exam_take_mobile: {} });

  await page.goto("/exams/exam_take_mobile");

  await expect(page.getByTestId("exam-taking-dashboard")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const stacked = await page.evaluate(() => {
    const prompt = document.querySelector<HTMLElement>(".exam-taking-question-prompt")?.getBoundingClientRect();
    const answer = document.querySelector<HTMLElement>(".exam-taking-answer-panel")?.getBoundingClientRect();
    return Boolean(prompt && answer && answer.top > prompt.bottom);
  });
  expect(stacked).toBe(true);

  await expect(page).toHaveScreenshot("exam-taking-in-progress-redesign-mobile.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
  await page.screenshot({ path: "test-results/exam-taking-in-progress-redesign-mobile.png", fullPage: true });
});

test("student answers preserve payloads and submit result removes submit action", async ({ page }) => {
  const savePayloads: unknown[] = [];
  const submitPayloads: unknown[] = [];
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockStudentExamRoutes(page, {
    exam_take_payloads: {
      attempt: { answers: {} },
      savePayloads,
      submitPayloads
    }
  });

  await page.goto("/exams/exam_take_payloads");
  const oxO = page.getByTestId("exam-ox-option").filter({ hasText: "O" });
  await oxO.click();
  await oxO.click();
  await expect.poll(() => savePayloads.at(-1)).toMatchObject({ answers: { q_ox: "" } });

  await oxO.click();
  await page.getByTestId("exam-choice-option").filter({ hasText: "가용성" }).click();
  await page.locator("[data-testid='exam-answer-input'][data-question-id='q_short']").fill("443");
  await page.locator("[data-testid='exam-answer-input'][data-question-id='q_essay']").fill("서술형 답안 ".repeat(180));

  await expect.poll(() => savePayloads.at(-1)).toMatchObject({
    answers: {
      q_ox: { value: true },
      q_mcq: { choiceId: "availability" },
      q_short: "443"
    }
  });

  await page.getByTestId("exam-submit-button").click();
  await expect.poll(() => submitPayloads.length).toBe(1);
  expect(submitPayloads[0]).toMatchObject({
    answers: {
      q_ox: { value: true },
      q_mcq: { choiceId: "availability" },
      q_short: "443"
    }
  });
  expect(String((submitPayloads[0] as any).answers.q_essay).length).toBeGreaterThan(1000);
  await expect(page.getByTestId("exam-score-summary")).toContainText("10 / 10점");
  await expect(page.getByTestId("exam-submit-button")).toHaveCount(0);
});

test("delayed submit disables answers and prevents duplicate submit posts", async ({ page }) => {
  let releaseSubmit!: () => void;
  const submitDelay = new Promise<void>((resolve) => {
    releaseSubmit = resolve;
  });
  const savePayloads: unknown[] = [];
  const submitPayloads: unknown[] = [];
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockStudentExamRoutes(page, {
    exam_take_delayed: {
      savePayloads,
      submitPayloads,
      submitDelay
    }
  });

  await page.goto("/exams/exam_take_delayed");
  await expect(page.getByTestId("exam-submit-button")).toBeEnabled();
  await page.waitForTimeout(700);
  const shortInput = page.locator("[data-testid='exam-answer-input'][data-question-id='q_short']");
  await shortInput.fill("444");
  await expect(shortInput).toHaveValue("444");
  const savedCountBeforeSubmit = savePayloads.length;
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("[data-testid='exam-submit-button']");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document
      .querySelector<HTMLButtonElement>("[data-testid='exam-ox-option'][data-value='false']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document
      .querySelector<HTMLButtonElement>("[data-testid='exam-choice-option'][data-choice-id='efficiency']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const short = document.querySelector<HTMLInputElement>("[data-testid='exam-answer-input'][data-question-id='q_short']");
    if (short) {
      short.value = "999";
      short.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    }
  });
  await expect.poll(() => submitPayloads.length).toBe(1);
  expect(submitPayloads[0]).toMatchObject({
    answers: {
      q_ox: { value: true },
      q_mcq: { choiceId: "availability" },
      q_short: "444"
    }
  });
  await expect(page.getByTestId("exam-submit-button")).toBeDisabled();
  await expect(page.getByTestId("exam-ox-option").first()).toBeDisabled();
  await expect(page.getByTestId("exam-choice-option").first()).toBeDisabled();
  await expect(page.locator("[data-testid='exam-answer-input'][data-question-id='q_short']")).toBeDisabled();
  await expect(page.locator("[data-testid='exam-answer-input'][data-question-id='q_essay']")).toBeDisabled();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("[data-testid='exam-ox-option']")?.click();
    document.querySelector<HTMLButtonElement>("[data-testid='exam-choice-option']")?.click();
  });
  await page.waitForTimeout(700);
  expect(savePayloads.length).toBe(savedCountBeforeSubmit);

  releaseSubmit();
  await expect(page.getByTestId("exam-score-summary")).toBeVisible();
});

test("route changes reset delayed submit latch for the next exam", async ({ page }) => {
  let releaseFirstSubmit!: () => void;
  const firstSubmitDelay = new Promise<void>((resolve) => {
    releaseFirstSubmit = resolve;
  });
  const firstSubmitPayloads: unknown[] = [];
  const secondSubmitPayloads: unknown[] = [];
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockStudentExamRoutes(page, {
    exam_take_late_a: {
      submitPayloads: firstSubmitPayloads,
      submitDelay: firstSubmitDelay
    },
    exam_take_late_b: {
      metadata: { title: "다음 중간고사" },
      submitPayloads: secondSubmitPayloads
    }
  });

  await page.goto("/exams/exam_take_late_a");
  await page.getByTestId("exam-submit-button").click();
  await expect.poll(() => firstSubmitPayloads.length).toBe(1);
  await page.evaluate(() => {
    window.history.pushState({}, "", "/exams/exam_take_late_b");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { name: "다음 중간고사" })).toBeVisible();
  await page.getByTestId("exam-submit-button").click();
  await expect.poll(() => secondSubmitPayloads.length).toBe(1);
  releaseFirstSubmit();
  await expect(page.getByRole("heading", { name: "다음 중간고사" })).toBeVisible();
});

test("status, empty questions, and unknown question type render safe fallbacks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockStudentExamRoutes(page, {
    exam_take_grading: {
      attempt: { status: "GRADING", answers: baseAnswers }
    },
    exam_take_graded_pending: {
      attempt: { status: "GRADED", answers: baseAnswers }
    },
    exam_take_empty: {
      metadata: { questionCount: 0, totalPoints: 0 },
      attempt: { questions: [], answers: {} }
    },
    exam_take_unknown: {
      attempt: {
        answers: {},
        questions: [
          {
            id: "q_unknown",
            type: "MATCHING",
            promptMarkdown: "아직 지원하지 않는 문항입니다.",
            points: 2
          }
        ]
      }
    }
  });

  await page.goto("/exams/exam_take_grading");
  await expect(page.getByTestId("exam-submit-status-card")).toHaveText("채점 중입니다.");
  await expect(page.getByTestId("exam-submit-button")).toHaveCount(0);

  await page.goto("/exams/exam_take_graded_pending");
  await expect(page.getByTestId("exam-submit-status-card")).toHaveText("제출된 시험입니다. 결과를 불러오는 중입니다.");
  await expect(page.getByTestId("exam-submit-button")).toHaveCount(0);

  await page.goto("/exams/exam_take_empty");
  await expect(page.getByTestId("exam-taking-empty-questions")).toContainText("문항을 불러오지 못했습니다.");
  await expect(page.getByTestId("exam-submit-button")).toHaveCount(0);

  await page.goto("/exams/exam_take_unknown");
  await expect(page.getByTestId("exam-question-type-badge")).toHaveText("지원되지 않는 유형");
  await expect(page.getByTestId("exam-taking-unsupported-question")).toHaveText("지원되지 않는 문항 유형입니다.");
  await expect(page.getByTestId("exam-answer-input")).toHaveCount(0);
  await expect(page.getByTestId("exam-ox-option")).toHaveCount(0);
  await expect(page.getByTestId("exam-choice-option")).toHaveCount(0);
  await expect(page.getByTestId("exam-submit-button")).toBeVisible();
});
