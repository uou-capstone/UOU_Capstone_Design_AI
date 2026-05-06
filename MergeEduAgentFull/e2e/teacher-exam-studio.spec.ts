import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route, TestInfo } from "@playwright/test";

const now = "2026-05-02T00:00:00.000Z";
const teacherUser = {
  id: "teacher_exam",
  email: "teacher.exam@example.com",
  displayName: "Exam Teacher",
  role: "teacher",
  inviteCode: "1111",
  emailVerified: true,
  hasPassword: true
};
const studentUser = {
  id: "student_exam",
  email: "student.exam@example.com",
  displayName: "Exam Student",
  role: "student",
  inviteCode: "2222",
  emailVerified: true,
  hasPassword: true
};
const week = {
  id: "wk_exam",
  classroomId: "cls_exam",
  weekIndex: 1,
  title: "1주차",
  createdAt: now,
  updatedAt: now
};

function examFromDraft(id: string, draft: any, status: "DRAFT" | "PUBLISHED") {
  const safeDraft = {
    title: draft?.title ?? "AI 보강 시험",
    descriptionMarkdown: draft?.descriptionMarkdown ?? "",
    availableFrom: draft?.availableFrom ?? now,
    availableUntil: draft?.availableUntil ?? "2026-05-03T00:00:00.000Z",
    timeLimitMinutes: draft?.timeLimitMinutes ?? 3,
    passScoreRatio: draft?.passScoreRatio ?? 0.7,
    aiGradingEnabled: draft?.aiGradingEnabled ?? true,
    questions: Array.isArray(draft?.questions) ? draft.questions : []
  };
  return {
    id,
    classroomId: "cls_exam",
    weekId: "wk_exam",
    status,
    activePublishedVersion: status === "PUBLISHED" ? 1 : undefined,
    draftRevision: {
      ...safeDraft,
      version: status === "PUBLISHED" ? 1 : 0,
      createdAt: now,
      updatedAt: now
    },
    publishedRevision:
      status === "PUBLISHED"
        ? {
            ...safeDraft,
            version: 1,
            createdAt: now,
            updatedAt: now
          }
        : undefined,
    createdAt: now,
    updatedAt: now,
    totalPoints: safeDraft.questions.reduce((sum: number, question: any) => sum + Number(question.points ?? 0), 0),
    publishedTotalPoints:
      status === "PUBLISHED"
        ? safeDraft.questions.reduce((sum: number, question: any) => sum + Number(question.points ?? 0), 0)
        : undefined
  };
}

function ndjson(events: any[]) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function repeatedLines(label: string, count: number) {
  return Array.from(
    { length: count },
    (_, index) => `${label} ${index + 1}: 시험 설계 화면의 내부 스크롤과 고정 액션 영역을 함께 확인합니다.`
  ).join("\n");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function mockTeacherClassroom(
  page: Page,
  options: {
    chatRoute?: Parameters<Page["route"]>[1];
    pdfRoute?: Parameters<Page["route"]>[1];
    publishRoute?: (route: Route, state: TeacherMockState) => Promise<void> | void;
    initialExams?: any[];
  } = {}
) {
  const state: TeacherMockState = {
    exams: [...(options.initialExams ?? [])],
    studioChatSourceTexts: [],
    createCount: 0,
    updateCount: 0,
    publishCount: 0,
    createPayloads: [],
    updatePayloads: [],
    publishPayloads: []
  };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { user: teacherUser } }) })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "request encryption disabled in mocked e2e" })
    })
  );
  await page.route("**/api/classrooms/cls_exam/weeks", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [week] }) })
  );
  await page.route("**/api/classrooms/cls_exam/students", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route("**/api/classrooms/cls_exam/invitations", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route("**/api/weeks/wk_exam/lectures", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route("**/api/weeks/wk_exam/exams", async (route) => {
    if (route.request().method() === "POST") {
      const draft = route.request().postDataJSON();
      state.createCount += 1;
      state.createPayloads.push(cloneJson(draft));
      const exam = examFromDraft("exam_created", draft, "DRAFT");
      state.exams.splice(0, state.exams.length, exam);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, data: exam }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: state.exams }) });
  });
  await page.route("**/api/weeks/wk_exam/exam-studio/pdf-context", (route) => {
    if (options.pdfRoute) {
      return options.pdfRoute(route);
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          text: "uploaded pdf context for gradient descent",
          numPages: 2,
          truncated: false
        }
      })
    });
  });
  await page.route("**/api/weeks/wk_exam/exam-studio/chat/stream", async (route) => {
    if (options.chatRoute) {
      return options.chatRoute(route);
    }
    state.studioChatSourceTexts.push(String(route.request().postDataJSON().sourceText ?? ""));
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson([
        { type: "stage", stage: "PREPARING", label: "요청 정리", progress: 0.1 },
        { type: "stage", stage: "AI_THINKING", label: "사고 요약 스트리밍", progress: 0.42 },
        { type: "thought_delta", text: "문항 유형과 시간을 검토하고 있습니다." },
        {
          type: "proposal",
          thoughtSummary: "문항 유형과 시간을 검토했습니다.",
          data: {
            answerMarkdown: "AI가 OX 문항을 제안했습니다.",
            replyMarkdown: "AI가 OX 문항을 제안했습니다.",
            operations: [
              {
                method: "patchExamSettings",
                params: {
                  title: "AI 보강 시험",
                  availableFrom: "2026-05-02T10:00:00+09:00",
                  availableUntil: "2026-05-02T11:00:00+09:00",
                  timeLimitMinutes: 45
                }
              },
              {
                method: "appendQuestions",
                params: {
                  questions: [
                    {
                      id: "q_ai",
                      type: "OX",
                      promptMarkdown: "경사하강법은 손실을 줄이는 방향으로 이동한다.",
                      points: 3,
                      answer: { value: true }
                    }
                  ]
                }
              }
            ],
            source: "AI"
          }
        },
        { type: "stage", stage: "VALIDATING_JSON", label: "JSON 검증", progress: 0.76 },
        { type: "stage", stage: "COMPLETE", label: "완료", progress: 1 },
        { type: "done" }
      ])
    });
  });
  await page.route(/\/api\/exams\/[^/]+$/, async (route) => {
    const examId = route.request().url().split("/").pop() ?? "";
    if (route.request().method() === "PUT") {
      const draft = route.request().postDataJSON();
      state.updateCount += 1;
      state.updatePayloads.push(cloneJson(draft));
      const exam = examFromDraft(examId, draft, "DRAFT");
      state.exams.splice(0, state.exams.length, exam);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: exam }) });
      return;
    }
    const exam = state.exams.find((candidate) => candidate.id === examId);
    await route.fulfill({
      status: exam ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(exam ? { ok: true, data: exam } : { ok: false, error: "not found" })
    });
  });
  await page.route(/\/api\/exams\/[^/]+\/publish$/, async (route) => {
    state.publishPayloads.push(cloneJson(route.request().postDataJSON()));
    state.publishCount += 1;
    if (options.publishRoute) {
      await options.publishRoute(route, state);
      return;
    }
    const examId = route.request().url().split("/").slice(-2)[0] ?? "exam_created";
    const draft = route.request().postDataJSON();
    const exam = examFromDraft(examId, draft, "PUBLISHED");
    state.exams.splice(0, state.exams.length, exam);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: exam }) });
  });
  await page.route("**/api/exams/exam_created/report", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          exam: state.exams[0],
          summary: { enrolledCount: 1, attemptCount: 1, gradedCount: 1, averageScore: 8, maxScore: 8, completionRatio: 1 },
          students: [{ studentUserId: "student_exam", displayName: "Exam Student", status: "GRADED", attempt: null }],
          questionStats: [{ questionId: "q_ai", maxScore: 3, averageScore: 3, attempts: 1 }]
        }
      })
    })
  );
  return {
    getStudioChatSourceTexts: () => state.studioChatSourceTexts,
    getCreateCount: () => state.createCount,
    getUpdateCount: () => state.updateCount,
    getPublishCount: () => state.publishCount,
    getCreatePayloads: () => state.createPayloads.map((payload) => cloneJson(payload)),
    getUpdatePayloads: () => state.updatePayloads.map((payload) => cloneJson(payload)),
    getPublishPayloads: () => state.publishPayloads.map((payload) => cloneJson(payload)),
    setExams: (nextExams: any[]) => {
      state.exams.splice(0, state.exams.length, ...nextExams);
    }
  };
}

type TeacherMockState = {
  exams: any[];
  studioChatSourceTexts: string[];
  createCount: number;
  updateCount: number;
  publishCount: number;
  createPayloads: any[];
  updatePayloads: any[];
  publishPayloads: any[];
};

async function assertNoModalSideEffects(page: Page) {
  await expect(page.locator(".exam-studio-backdrop")).toHaveCount(0);
  await expect(page.locator("[role='dialog']")).toHaveCount(0);
  await expect(page.locator("[aria-modal='true']")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains("modal-open"))).toBe(false);
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("#root > *")).some((element) => {
        const htmlElement = element as HTMLElement & { inert?: boolean };
        return element.getAttribute("aria-hidden") === "true" || Boolean(htmlElement.inert);
      })
    )
  ).toBe(false);
}

async function captureExamStudioScreenshot(page: Page, testInfo: TestInfo, name: "desktop" | "mobile" | "ai-proposal" | "ai-proposal-mobile") {
  const path = join(process.cwd(), "test-results", `exam-studio-page-${name}.png`);
  mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`exam-studio-page-${name}`, { path, contentType: "image/png" });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
}

async function assertNoTextOverflow(page: Page) {
  const overflowing = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-testid='exam-studio-page'] button, [data-testid='exam-studio-page'] input, [data-testid='exam-studio-page'] textarea, [data-testid='exam-studio-page'] select"
      )
    )
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({
        text: element.textContent ?? element.getAttribute("placeholder") ?? element.getAttribute("value") ?? "",
        overflowX: element.scrollWidth - element.clientWidth,
        overflowY: element.scrollHeight - element.clientHeight
      }))
      .filter((entry) => entry.overflowX > 2 || entry.overflowY > 2)
  );
  expect(overflowing).toEqual([]);
}

async function readExamStudioContainment(page: Page) {
  return page.evaluate(() => {
    const pageShell = document.querySelector<HTMLElement>(".page-shell.exam-studio-page");
    const editor = document.querySelector<HTMLElement>("[data-testid='exam-studio-editor']");
    const thread = document.querySelector<HTMLElement>("[data-testid='exam-ai-thread']");
    const review = document.querySelector<HTMLElement>("[data-testid='exam-ai-review-stack']");
    const composer = document.querySelector<HTMLElement>("[data-testid='exam-ai-composer']");
    const actions = document.querySelector<HTMLElement>("[data-testid='exam-studio-actions']");
    const aiPanel = document.querySelector<HTMLElement>("[data-testid='exam-studio-ai-panel']");
    if (!pageShell || !editor || !thread || !composer || !actions || !aiPanel) {
      throw new Error("exam studio containment probes are missing");
    }
    const rectOf = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        width: Math.round(rect.width)
      };
    };
    return {
      actions: rectOf(actions),
      aiPanel: rectOf(aiPanel),
      composer: rectOf(composer),
      documentScrollHeight: document.documentElement.scrollHeight,
      editorClientHeight: editor.clientHeight,
      editorScrollHeight: editor.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      pageShell: rectOf(pageShell),
      reviewClientHeight: review?.clientHeight ?? 0,
      reviewScrollHeight: review?.scrollHeight ?? 0,
      threadClientHeight: thread.clientHeight,
      threadScrollHeight: thread.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
  });
}

function expectRectInViewport(
  rect: { bottom: number; left: number; right: number; top: number },
  viewportHeight: number,
  viewportWidth: number
) {
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.bottom).toBeLessThanOrEqual(viewportHeight + 1);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(viewportWidth + 1);
}

async function assertNoBoxOverlap(page: Page, firstTestId: string, secondTestId: string) {
  const overlap = await page.evaluate(
    ([firstId, secondId]) => {
      const first = document.querySelector<HTMLElement>(`[data-testid='${firstId}']`);
      const second = document.querySelector<HTMLElement>(`[data-testid='${secondId}']`);
      if (!first || !second) throw new Error(`Missing layout target: ${firstId} or ${secondId}`);
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    },
    [firstTestId, secondTestId]
  );
  expect(overlap).toBe(false);
}

async function installExamAiObservationProbe(page: Page) {
  await page.addInitScript(() => {
    (window as any).__examStudioAiObservations = [];
    window.addEventListener("exam-studio-ai-observation", (event) => {
      (window as any).__examStudioAiObservations.push((event as CustomEvent).detail);
    });
  });
}

async function readExamAiObservations(page: Page) {
  return page.evaluate(() => ((window as any).__examStudioAiObservations ?? []) as Array<Record<string, unknown>>);
}

async function assertBoxOrder(page: Page, firstTestId: string, secondTestId: string, axis: "x" | "y") {
  const ordered = await page.evaluate(
    ([firstId, secondId, orderAxis]) => {
      const first = document.querySelector<HTMLElement>(`[data-testid='${firstId}']`);
      const second = document.querySelector<HTMLElement>(`[data-testid='${secondId}']`);
      if (!first || !second) throw new Error(`Missing layout target: ${firstId} or ${secondId}`);
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      return orderAxis === "x" ? a.left < b.left : a.bottom < b.top;
    },
    [firstTestId, secondTestId, axis]
  );
  expect(ordered).toBe(true);
}

async function assertExamStudioLayout(page: Page, testInfo: TestInfo, name: "desktop" | "mobile") {
  await expect(page.getByTestId("exam-studio-hero")).toBeVisible();
  await expect(page.getByTestId("exam-studio-basic-info")).toBeVisible();
  await expect(page.getByTestId("exam-studio-question-design")).toBeVisible();
  await expect(page.getByTestId("exam-studio-ai-panel")).toBeVisible();
  await expect(page.getByTestId("exam-studio-actions")).toBeVisible();
  await assertNoModalSideEffects(page);
  await assertNoHorizontalOverflow(page);
  await assertNoTextOverflow(page);

  if (name === "desktop") {
    await assertBoxOrder(page, "exam-studio-basic-info", "exam-studio-ai-panel", "x");
    await assertBoxOrder(page, "exam-studio-hero", "exam-studio-basic-info", "y");
    await assertNoBoxOverlap(page, "exam-studio-basic-info", "exam-studio-ai-panel");
  } else {
    await assertBoxOrder(page, "exam-studio-hero", "exam-studio-basic-info", "y");
    await assertBoxOrder(page, "exam-studio-basic-info", "exam-studio-question-design", "y");
    await assertBoxOrder(page, "exam-studio-question-design", "exam-studio-ai-panel", "y");
    await assertBoxOrder(page, "exam-studio-ai-panel", "exam-studio-actions", "y");
  }

  await captureExamStudioScreenshot(page, testInfo, name);
}

async function openNewExamStudio(page: Page) {
  await page.goto("/classrooms/cls_exam");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-add-exam").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_exam\/weeks\/wk_exam\/exam-studio$/);
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await assertNoModalSideEffects(page);
}

test("teacher exam studio rejects invalid local schedule before saving", async ({ page }) => {
  const state = await mockTeacherClassroom(page);
  await openNewExamStudio(page);

  await page.getByTestId("exam-available-from-input").fill("");
  await page.getByTestId("exam-save-draft").click();

  await expect(page.getByTestId("exam-studio-error")).toContainText("시험 시작/종료 시간과 제한 시간을 올바르게 입력해 주세요.");
  await expect.poll(() => state.getCreatePayloads().length).toBe(0);
});

test("teacher reviews and applies AI exam studio operations before publishing", async ({ page }, testInfo) => {
  await installExamAiObservationProbe(page);
  const state = await mockTeacherClassroom(page);
  const readAiLayout = async () =>
    page.getByTestId("exam-studio-ai-panel").evaluate((panelElement) => {
      const composer = panelElement.querySelector<HTMLElement>("[data-testid='exam-ai-composer']");
      const thread = panelElement.querySelector<HTMLElement>("[data-testid='exam-ai-thread']");
      const reviewStack = panelElement.querySelector<HTMLElement>("[data-testid='exam-ai-review-stack']");
      const proposal = panelElement.querySelector<HTMLElement>("[data-testid='exam-ai-proposal-card']");
      if (!composer || !thread) {
        throw new Error("AI panel layout probes are missing");
      }
      const panelRect = panelElement.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const threadRect = thread.getBoundingClientRect();
      const reviewStackRect = reviewStack?.getBoundingClientRect();
      const proposalRect = proposal?.getBoundingClientRect();
      return {
        composerBottomGap: Math.round(panelRect.bottom - composerRect.bottom),
        composerTop: Math.round(composerRect.top),
        threadTop: Math.round(threadRect.top),
        threadBottom: Math.round(threadRect.bottom),
        reviewStackBottom: reviewStackRect ? Math.round(reviewStackRect.bottom) : null,
        reviewStackOverlapsComposer: reviewStackRect
          ? !(reviewStackRect.right <= composerRect.left || composerRect.right <= reviewStackRect.left || reviewStackRect.bottom <= composerRect.top || composerRect.bottom <= reviewStackRect.top)
          : false,
        proposalBottom: proposalRect ? Math.round(proposalRect.bottom) : null,
        proposalOverflowsReviewStack: Boolean(reviewStackRect && proposalRect && proposalRect.bottom > reviewStackRect.bottom)
      };
    });

  await openNewExamStudio(page);
  const studio = page.getByTestId("exam-studio-page");
  await expect(page.getByTestId("exam-studio-hero")).toBeVisible();
  await expect(page.getByTestId("exam-studio-ai-empty-state")).toBeVisible();
  await expect(page.getByTestId("exam-studio-ai-recommendation-card")).toBeVisible();
  await expect(studio.getByText("PDF 자료")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "전송" })).toBeVisible();
  await expect(page.getByTestId("exam-ai-send")).toHaveText("");
  expect(await page.getByTestId("exam-ai-chat-input").evaluate((element) => element.tagName)).toBe("TEXTAREA");
  await expect(page.getByTestId("exam-add-question")).toHaveText("+ 문항 추가");
  await expect(page.getByLabel("배점")).toBeVisible();
  await expect(page.getByTestId("exam-question-card").first().getByText("점")).toBeVisible();
  await expect(page.getByRole("button", { name: "문항 삭제" })).toBeVisible();
  await expect(page.getByTestId("exam-delete-question")).toHaveText("");

  const initialAiLayout = await readAiLayout();
  expect(initialAiLayout.composerBottomGap).toBeLessThanOrEqual(28);
  expect(initialAiLayout.composerTop).toBeGreaterThan(initialAiLayout.threadTop);

  await page.getByTestId("exam-question-prompt").fill("2 + 2 = ?");
  await expect(page.getByTestId("exam-question-choice")).toHaveCount(2);
  await page.getByTestId("exam-add-choice").click();
  await expect(page.getByTestId("exam-question-choice")).toHaveCount(3);
  await page.getByTestId("exam-question-choice").nth(0).fill("4");
  await page.getByTestId("exam-question-choice").nth(1).fill("5");
  await page.getByTestId("exam-question-choice").nth(2).fill("3");

  await expect(page.getByTestId("exam-ai-attach")).toBeVisible();
  await page.getByTestId("exam-ai-attachment-input").setInputFiles({
    name: "lecture-context.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n", "utf-8")
  });
  await expect(page.getByTestId("exam-ai-attachment-status")).toContainText("lecture-context.pdf");

  const initialTitle = await page.getByTestId("exam-title-input").inputValue();
  const initialAvailableFrom = await page.getByTestId("exam-available-from-input").inputValue();
  const initialAvailableUntil = await page.getByTestId("exam-available-until-input").inputValue();
  const initialTimeLimit = await page.getByTestId("exam-time-limit-input").inputValue();
  const initialQuestionCount = await page.getByTestId("exam-question-card").count();

  await page.getByTestId("exam-ai-chat-input").fill("OX 문항 하나 제안해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-progress")).toBeVisible();
  await expect(page.getByTestId("exam-ai-stage-PREPARING")).toBeVisible();
  await expect(page.getByTestId("exam-ai-stage-AI_THINKING")).toBeVisible();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await expect(page.getByTestId("exam-ai-proposal-summary")).toBeVisible();
  await expect(page.getByTestId("exam-ai-proposal-summary-card")).toHaveCount(2);
  await expect(page.getByTestId("exam-ai-applied-card")).toHaveCount(0);
  await expect(page.getByTestId("exam-ai-proposal-card")).not.toContainText("반영했습니다");
  await expect(page.getByTestId("exam-ai-proposal-card")).not.toContainText("변경했습니다");
  await expect(page.getByTestId("exam-title-input")).toHaveValue(initialTitle);
  await expect(page.getByTestId("exam-available-from-input")).toHaveValue(initialAvailableFrom);
  await expect(page.getByTestId("exam-available-until-input")).toHaveValue(initialAvailableUntil);
  await expect(page.getByTestId("exam-time-limit-input")).toHaveValue(initialTimeLimit);
  await expect(page.getByTestId("exam-question-card")).toHaveCount(initialQuestionCount);
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("exam-ai-thought-toggle").click();
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("exam-ai-thought-summary")).toContainText("문항 유형");
  const proposalAiLayout = await readAiLayout();
  expect(proposalAiLayout.composerBottomGap).toBeLessThanOrEqual(28);
  expect(proposalAiLayout.proposalBottom).not.toBeNull();
  expect(proposalAiLayout.composerTop).toBeGreaterThanOrEqual(proposalAiLayout.reviewStackBottom ?? proposalAiLayout.threadBottom);
  expect(proposalAiLayout.reviewStackOverlapsComposer).toBe(false);
  expect(proposalAiLayout.proposalOverflowsReviewStack).toBe(true);
  await assertNoHorizontalOverflow(page);
  await assertNoTextOverflow(page);
  await captureExamStudioScreenshot(page, testInfo, "ai-proposal");
  expect(state.getStudioChatSourceTexts().some((text) => text.includes("uploaded pdf context"))).toBe(true);
  await expect(page.getByTestId("exam-ai-attachment-status")).toHaveCount(0);

  let observations = await readExamAiObservations(page);
  expect(observations.some((event) => event.eventName === "proposal_pending" && event.operationCount === 2)).toBe(true);
  expect(JSON.stringify(observations)).not.toContain("경사하강법은");
  expect(JSON.stringify(observations)).not.toContain("uploaded pdf context");
  expect(JSON.stringify(observations)).not.toContain("AI가 OX 문항을 제안했습니다");

  await page.getByTestId("exam-ai-apply-proposal").click();
  await expect(page.getByTestId("exam-ai-applied-card")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("AI 보강 시험");
  await expect(page.getByTestId("exam-available-from-input")).toHaveValue("2026-05-02T10:00");
  await expect(page.getByTestId("exam-available-until-input")).toHaveValue("2026-05-02T11:00");
  await expect(page.getByTestId("exam-time-limit-input")).toHaveValue("45");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(2);
  observations = await readExamAiObservations(page);
  expect(observations.some((event) => event.eventName === "proposal_apply_clicked" && event.operationCount === 2)).toBe(true);
  expect(observations.some((event) => event.eventName === "proposal_apply_result" && event.appendQuestionCount === 1)).toBe(true);

  await page.getByTestId("exam-ai-attachment-input").setInputFiles({
    name: "diagram-context.png",
    mimeType: "image/png",
    buffer: Buffer.from("png bytes for mocked image attachment", "utf-8")
  });
  await expect(page.getByTestId("exam-ai-attachment-status")).toContainText("diagram-context.png");
  await expect(studio.getByText("이미지를 첨부했습니다.")).toBeVisible();
  const storageAfterImageAttach = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  expect(storageAfterImageAttach).not.toContain("diagram-context.png");
  await page.getByLabel("첨부 해제").click();
  await expect(page.getByTestId("exam-ai-attachment-status")).toHaveCount(0);
  const recoveryDump = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  expect(recoveryDump).not.toContain("2 + 2");
  expect(recoveryDump).not.toContain("경사하강법");
  expect(recoveryDump).not.toContain("lecture-context.pdf");
  expect(recoveryDump).not.toContain("uploaded pdf context");
  expect(recoveryDump).not.toContain("diagram-context.png");
  expect(recoveryDump).not.toContain("OX 문항 하나 제안해줘");
  await page.getByTestId("exam-publish").click();

  await expect(page.getByTestId("classroom-exam-row")).toContainText("AI 보강 시험");
  await page.getByTestId("classroom-exam-report").click();
  await expect(page.getByTestId("exam-report-page")).toContainText("Exam Student");
});

test("teacher exam studio renders the dedicated page on desktop and narrow screens", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await mockTeacherClassroom(page);

  await openNewExamStudio(page);
  await assertExamStudioLayout(page, testInfo, "desktop");

  await page.setViewportSize({ width: 430, height: 900 });
  await assertExamStudioLayout(page, testInfo, "mobile");
  const layout = await page.evaluate(() => {
    const question = document.querySelector<HTMLElement>("[data-testid='exam-question-card']");
    const aiPanel = document.querySelector<HTMLElement>("[data-testid='exam-studio-ai-panel']");
    const composer = document.querySelector<HTMLElement>("[data-testid='exam-ai-composer']");
    const actions = document.querySelector<HTMLElement>("[data-testid='exam-studio-actions']");
    if (!question || !aiPanel || !composer || !actions) {
      throw new Error("exam studio mobile layout probes are missing");
    }
    const questionRect = question.getBoundingClientRect();
    const aiRect = aiPanel.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      questionBottom: Math.round(questionRect.bottom),
      aiTop: Math.round(aiRect.top),
      aiBottom: Math.round(aiRect.bottom),
      composerBottomGap: Math.round(aiRect.bottom - composerRect.bottom),
      actionsTop: Math.round(actionsRect.top),
      actionsPosition: window.getComputedStyle(actions).position
    };
  });

  expect(layout.questionBottom).toBeLessThan(layout.aiTop);
  expect(layout.composerBottomGap).toBeLessThanOrEqual(2);
  expect(layout.aiBottom).toBeLessThan(layout.actionsTop);
  expect(layout.actionsPosition).toBe("static");
});

test("teacher exam studio keeps overflowing editor and AI review inside desktop containers", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const longProposalText = repeatedLines("긴 AI 제안", 80);
  const state = await mockTeacherClassroom(page, {
    chatRoute: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "stage", stage: "PREPARING", label: "요청 정리", progress: 0.1 },
          { type: "stage", stage: "AI_THINKING", label: "사고 요약 스트리밍", progress: 0.54 },
          { type: "thought_delta", text: "긴 제안과 문항 목록을 함께 검토합니다." },
          {
            type: "proposal",
            thoughtSummary: "레이아웃 경계 안에서 반영할 긴 제안을 준비했습니다.",
            data: {
              answerMarkdown: longProposalText,
              replyMarkdown: longProposalText,
              operations: [
                {
                  method: "patchExamSettings",
                  params: {
                    title: "컨테이너 유지 시험",
                    timeLimitMinutes: 55
                  }
                },
                {
                  method: "appendQuestions",
                  params: {
                    questions: [
                      {
                        id: "q_ai_contained",
                        type: "OX",
                        promptMarkdown: "컨테이너 스크롤은 페이지 전체를 늘리지 않는다.",
                        points: 4,
                        answer: { value: true }
                      }
                    ]
                  }
                }
              ],
              source: "AI"
            }
          },
          { type: "stage", stage: "COMPLETE", label: "완료", progress: 1 },
          { type: "done" }
        ])
      })
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-title-input").fill("내부 스크롤 시험");
  await page.getByTestId("exam-question-prompt").fill("초기 문항");
  for (let index = 0; index < 12; index += 1) {
    await page.getByTestId("exam-add-question").click();
  }

  const deleteTarget = page.getByTestId("exam-question-card").nth(1);
  const deletedQuestionId = await deleteTarget.getAttribute("data-question-id");
  expect(deletedQuestionId).toBeTruthy();
  await deleteTarget.getByTestId("exam-delete-question").click();

  const lastQuestion = page.getByTestId("exam-question-card").last();
  await lastQuestion.getByTestId("exam-question-prompt").fill("내부 스크롤에서 수정한 마지막 문항");
  await lastQuestion.getByTestId("exam-question-points").fill("7");
  await lastQuestion.getByTestId("exam-question-choice").first().fill("내부 스크롤 선택지 A");
  await lastQuestion.getByTestId("exam-question-choice").nth(1).fill("내부 스크롤 선택지 B");

  await page.getByTestId("exam-ai-chat-input").fill("긴 제안으로 패널 넘침을 확인해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();

  const proposalLayout = await readExamStudioContainment(page);
  expect(proposalLayout.documentScrollHeight).toBeLessThanOrEqual(Math.max(proposalLayout.viewportHeight, 720) + 8);
  expect(proposalLayout.editorScrollHeight).toBeGreaterThan(proposalLayout.editorClientHeight + 20);
  expect(proposalLayout.threadScrollHeight).toBeGreaterThan(proposalLayout.threadClientHeight + 20);
  expect(proposalLayout.reviewScrollHeight).toBeGreaterThan(proposalLayout.reviewClientHeight + 20);
  expect(proposalLayout.horizontalOverflow).toBeLessThanOrEqual(1);
  expectRectInViewport(proposalLayout.composer, proposalLayout.viewportHeight, proposalLayout.viewportWidth);
  expectRectInViewport(proposalLayout.actions, proposalLayout.viewportHeight, proposalLayout.viewportWidth);

  await page.getByTestId("exam-ai-apply-proposal").click();
  await expect(page.getByTestId("exam-ai-applied-card")).toBeVisible();
  const appliedLayout = await readExamStudioContainment(page);
  expect(appliedLayout.documentScrollHeight).toBeLessThanOrEqual(Math.max(appliedLayout.viewportHeight, 720) + 8);
  expectRectInViewport(appliedLayout.composer, appliedLayout.viewportHeight, appliedLayout.viewportWidth);
  expectRectInViewport(appliedLayout.actions, appliedLayout.viewportHeight, appliedLayout.viewportWidth);

  await page.getByTestId("exam-save-draft").click();
  await expect.poll(() => state.getCreatePayloads().length).toBe(1);
  const payload = state.getCreatePayloads()[0];
  expect(payload.title).toBe("컨테이너 유지 시험");
  expect(payload.timeLimitMinutes).toBe(55);
  expect(payload.questions.some((question: any) => question.id === deletedQuestionId)).toBe(false);
  expect(payload.questions.some((question: any) => question.id === "q_ai_contained")).toBe(true);
  expect(payload.questions.some((question: any) => question.promptMarkdown === "내부 스크롤에서 수정한 마지막 문항")).toBe(true);
  const editedQuestion = payload.questions.find((question: any) => question.promptMarkdown === "내부 스크롤에서 수정한 마지막 문항");
  expect(editedQuestion?.points).toBe(7);
  expect(editedQuestion?.choices?.map((choice: any) => choice.textMarkdown)).toEqual(["내부 스크롤 선택지 A", "내부 스크롤 선택지 B"]);
});

test("teacher exam studio contains existing draft update and publish retry errors on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const existingExam = examFromDraft(
    "exam_existing",
    {
      title: "기존 시험",
      availableFrom: "2026-05-02T00:00:00.000Z",
      availableUntil: "2026-05-03T00:00:00.000Z",
      timeLimitMinutes: 20,
      questions: [
        {
          id: "q_existing",
          type: "OX",
          promptMarkdown: "기존 문항",
          points: 5,
          answer: { value: true }
        }
      ]
    },
    "DRAFT"
  );
  let failFirstPublish = true;
  const state = await mockTeacherClassroom(page, {
    initialExams: [existingExam],
    publishRoute: async (route, mockState) => {
      if (failFirstPublish) {
        failFirstPublish = false;
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: repeatedLines("게시 오류", 48) })
        });
        return;
      }
      const draft = route.request().postDataJSON();
      const exam = examFromDraft("exam_existing", draft, "PUBLISHED");
      mockState.exams.splice(0, mockState.exams.length, exam);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: exam })
      });
    }
  });

  await page.goto("/classrooms/cls_exam/weeks/wk_exam/exam-studio/exam_existing");
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await page.getByTestId("exam-title-input").fill("기존 시험 내부 스크롤 업데이트");
  await page.getByTestId("exam-add-question").click();
  const addedQuestion = page.getByTestId("exam-question-card").last();
  await addedQuestion.getByTestId("exam-question-prompt").fill("업데이트 저장 문항");
  await addedQuestion.getByTestId("exam-question-choice").first().fill("업데이트 선택지 A");
  await addedQuestion.getByTestId("exam-question-choice").nth(1).fill("업데이트 선택지 B");
  await page.getByTestId("exam-save-draft").click();

  await expect.poll(() => state.getUpdatePayloads().length).toBe(1);
  const updatePayload = state.getUpdatePayloads()[0];
  expect(updatePayload.title).toBe("기존 시험 내부 스크롤 업데이트");
  expect(updatePayload.questions.some((question: any) => question.promptMarkdown === "업데이트 저장 문항")).toBe(true);

  await page.goto("/classrooms/cls_exam/weeks/wk_exam/exam-studio/exam_existing");
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("기존 시험 내부 스크롤 업데이트");
  await page.getByTestId("exam-publish").click();

  await expect(page.getByTestId("exam-studio-error")).toContainText("게시 오류");
  const errorBox = await page.getByTestId("exam-studio-error").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(errorBox.clientHeight).toBeLessThanOrEqual(96);
  expect(errorBox.scrollHeight).toBeGreaterThan(errorBox.clientHeight + 20);
  const failedPublishLayout = await readExamStudioContainment(page);
  expect(failedPublishLayout.documentScrollHeight).toBeLessThanOrEqual(Math.max(failedPublishLayout.viewportHeight, 720) + 8);
  expect(failedPublishLayout.horizontalOverflow).toBeLessThanOrEqual(1);
  expectRectInViewport(failedPublishLayout.composer, failedPublishLayout.viewportHeight, failedPublishLayout.viewportWidth);
  expectRectInViewport(failedPublishLayout.actions, failedPublishLayout.viewportHeight, failedPublishLayout.viewportWidth);

  await page.getByTestId("exam-publish").click();
  await expect.poll(() => state.getPublishPayloads().length).toBe(2);
  await expect(page.getByTestId("classroom-exam-row")).toContainText("기존 시험 내부 스크롤 업데이트");
  const publishPayloads = state.getPublishPayloads();
  expect(publishPayloads[0].title).toBe("기존 시험 내부 스크롤 업데이트");
  expect(publishPayloads[1].questions.some((question: any) => question.promptMarkdown === "업데이트 저장 문항")).toBe(true);
});

test("teacher exam studio locks save and publish after ended exam response", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const existingExam = examFromDraft(
    "exam_existing",
    {
      title: "종료 대상 시험",
      availableFrom: "2026-05-02T00:00:00.000Z",
      availableUntil: "2026-05-03T00:00:00.000Z",
      timeLimitMinutes: 20,
      questions: [
        {
          id: "q_existing",
          type: "OX",
          promptMarkdown: "기존 문항",
          points: 5,
          answer: { value: true }
        }
      ]
    },
    "DRAFT"
  );
  const state = await mockTeacherClassroom(page, {
    initialExams: [existingExam],
    publishRoute: async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "종료된 시험은 수정할 수 없습니다.", code: "EXAM_ENDED" })
      });
    }
  });

  await page.goto("/classrooms/cls_exam/weeks/wk_exam/exam-studio/exam_existing");
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await page.getByTestId("exam-title-input").fill("종료 후 수정 시도");
  await page.getByTestId("exam-publish").click();

  await expect.poll(() => state.getPublishPayloads().length).toBe(1);
  await expect(page.getByTestId("exam-studio-error")).toContainText("종료된 시험은 수정하거나 다시 게시할 수 없습니다.");
  await expect(page.getByTestId("exam-save-draft")).toBeDisabled();
  await expect(page.getByTestId("exam-publish")).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
          .filter((key): key is string => Boolean(key))
          .filter((key) => key.startsWith("mergeEdu.examStudio.")).length
      )
    )
    .toBe(0);
});

test("teacher exam studio recovers a materialized draft after publish failure without duplicate create", async ({ page }) => {
  let failFirstPublish = true;
  const state = await mockTeacherClassroom(page, {
    publishRoute: async (route, mockState) => {
      if (failFirstPublish) {
        failFirstPublish = false;
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "publish forbidden" })
        });
        return;
      }
      const draft = route.request().postDataJSON();
      const exam = examFromDraft("exam_created", draft, "PUBLISHED");
      mockState.exams.splice(0, mockState.exams.length, exam);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: exam })
      });
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-title-input").fill("게시 재시도 시험");
  await page.getByTestId("exam-question-prompt").fill("재시도 문항");
  await page.getByTestId("exam-publish").click();

  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await expect(page.getByText("publish forbidden")).toBeVisible();
  expect(state.getCreateCount()).toBe(1);
  expect(state.getPublishCount()).toBe(1);

  await page.reload();
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("게시 재시도 시험");
  await page.getByTestId("exam-publish").click();

  await expect(page.getByTestId("classroom-exam-row")).toContainText("게시 재시도 시험");
  expect(state.getCreateCount()).toBe(1);
  expect(state.getPublishCount()).toBe(2);
});

test("teacher edits an existing exam with confirmation-first AI proposals", async ({ page }) => {
  const existingExam = examFromDraft(
    "exam_existing",
    {
      title: "기존 시험",
      availableFrom: "2026-05-02T00:00:00.000Z",
      availableUntil: "2026-05-03T00:00:00.000Z",
      timeLimitMinutes: 20,
      questions: [
        {
          id: "q_existing",
          type: "OX",
          promptMarkdown: "기존 문항",
          points: 5,
          answer: { value: true }
        }
      ]
    },
    "DRAFT"
  );
  const state = await mockTeacherClassroom(page, { initialExams: [existingExam] });

  await page.goto("/classrooms/cls_exam/weeks/wk_exam/exam-studio/exam_existing");
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("기존 시험");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(1);

  await page.getByTestId("exam-ai-chat-input").fill("문항 하나 추가하고 제한 시간도 조정해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("기존 시험");
  await expect(page.getByTestId("exam-time-limit-input")).toHaveValue("20");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(1);

  await page.getByTestId("exam-ai-apply-proposal").click();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("AI 보강 시험");
  await expect(page.getByTestId("exam-time-limit-input")).toHaveValue("45");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(2);
  await page.getByTestId("exam-publish").click();

  await expect.poll(() => state.getPublishCount()).toBe(1);
  expect(state.getCreateCount()).toBe(0);
});

test("teacher exam studio reports invalid page routes without opening a modal", async ({ page }) => {
  const mismatchedWeekExam = {
    ...examFromDraft("exam_mismatched_week", { title: "다른 주차 시험" }, "DRAFT"),
    weekId: "other_week"
  };
  await mockTeacherClassroom(page, { initialExams: [mismatchedWeekExam] });

  await page.goto("/classrooms/cls_exam/weeks/missing_week/exam-studio");
  await expect(page.getByTestId("exam-studio-error")).toContainText("현재 강의실에 속한 주차");
  await assertNoModalSideEffects(page);

  await page.goto("/classrooms/cls_exam/weeks/wk_exam/exam-studio/missing_exam");
  await expect(page.getByTestId("exam-studio-error")).toContainText("시험 또는 주차");
  await assertNoModalSideEffects(page);

  await page.goto("/classrooms/cls_exam/weeks/wk_exam/exam-studio/exam_mismatched_week");
  await expect(page.getByTestId("exam-studio-error")).toContainText("현재 경로와 일치하는 교사용 시험");
  await assertNoModalSideEffects(page);
});

test("teacher exam studio ignores delayed PDF attachment after leaving the page", async ({ page }) => {
  let releasePdf: (() => void) | undefined;
  const pdfGate = new Promise<void>((resolve) => {
    releasePdf = resolve;
  });
  await mockTeacherClassroom(page, {
    pdfRoute: async (route) => {
      await pdfGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: { text: "late pdf text should be ignored", numPages: 1, truncated: false }
          })
        });
      } catch {
        // The page aborts the upload request while leaving the studio.
      }
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-attachment-input").setInputFiles({
    name: "late-context.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n", "utf-8")
  });
  await page.getByRole("button", { name: "취소" }).click();
  releasePdf?.();
  await expect(page.getByTestId("exam-studio-page")).toHaveCount(0);

  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await expect(page.getByTestId("exam-ai-attachment-status")).toHaveCount(0);
  await expect(page.getByText("late pdf text should be ignored")).toHaveCount(0);
});

test("teacher exam studio shows persistent essay field labels while editing", async ({ page }) => {
  await mockTeacherClassroom(page);

  await openNewExamStudio(page);

  await page.getByTestId("exam-question-type").selectOption("ESSAY");
  const card = page.getByTestId("exam-question-card").first();
  await expect(card.getByLabel("문항 유형")).toHaveValue("ESSAY");
  await expect(card.getByLabel("배점")).toHaveValue("5");
  await expect(card.getByLabel("문제")).toHaveValue("");
  await expect(card.getByLabel("채점 기준")).toHaveValue("");
  await expect(card.getByLabel("모범 답안")).toHaveValue("");

  await card.getByLabel("문제").fill("서술형 문제");
  await card.getByLabel("채점 기준").fill("근거와 구조를 평가");
  await card.getByLabel("모범 답안").fill("상세한 예시 답안");
  await expect(card.getByText("학생에게 보여질 문제 내용을 입력하세요.")).toBeVisible();
  await expect(card.getByText("부분 점수 부여 기준을 포함하여 입력하세요.")).toBeVisible();
  await expect(card.getByText("학생에게 제공하지 않는 상세한 모범 답안을 입력하세요.")).toBeVisible();
});

test("teacher exam studio persistent question field labels keep short-answer editing clear", async ({ page }) => {
  await mockTeacherClassroom(page);

  await openNewExamStudio(page);

  await page.getByTestId("exam-question-type").selectOption("SHORT");
  const card = page.getByTestId("exam-question-card").first();
  await expect(card.getByLabel("문항 유형")).toHaveValue("SHORT");
  await expect(card.getByLabel("배점")).toHaveValue("5");
  await expect(card.getByLabel("문제")).toHaveValue("");
  await expect(card.getByTestId("exam-question-answer")).toHaveCount(0);
  await expect(card.getByPlaceholder("기준 답안")).toHaveCount(0);
  await expect(card.getByLabel("채점 기준")).toHaveValue("");
  await expect(card.getByLabel("모범 답안")).toHaveValue("");

  await card.getByLabel("문제").fill("삼국 시대의 통일 과정을 순서대로 간단히 서술하세요.");
  await card.getByLabel("채점 기준").fill("순서가 정확하면 정답 (5점)\n통일 주체가 포함되면 부분 점수 (3점)");
  await card.getByLabel("모범 답안").fill("고구려 -> 백제 -> 신라");
  await expect(card.getByText("학생에게 보여질 문제 내용을 입력하세요.")).toBeVisible();
  await expect(card.getByText("부분 점수 부여 기준을 포함하여 입력하세요.")).toBeVisible();
  await expect(card.getByText("학생에게 제공하지 않는 상세한 모범 답안을 입력하세요.")).toBeVisible();

  const geometry = await card.evaluate((element) => {
    const deleteButton = element.querySelector<HTMLElement>("[data-testid='exam-delete-question']");
    const typeControl = element.querySelector<HTMLElement>("[data-testid='exam-question-type']");
    const pointsControl = element.querySelector<HTMLElement>("[data-testid='exam-question-points']");
    if (!deleteButton || !typeControl || !pointsControl) {
      throw new Error("question field label geometry probes are missing");
    }
    const cardRect = element.getBoundingClientRect();
    const deleteRect = deleteButton.getBoundingClientRect();
    const typeRect = typeControl.getBoundingClientRect();
    const pointsRect = pointsControl.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) =>
      !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    return {
      overflowX: element.scrollWidth - element.clientWidth,
      deleteOverlapsType: overlaps(deleteRect, typeRect),
      deleteOverlapsPoints: overlaps(deleteRect, pointsRect),
      cardWidth: Math.round(cardRect.width)
    };
  });
  expect(geometry.overflowX).toBeLessThanOrEqual(2);
  expect(geometry.deleteOverlapsType).toBe(false);
  expect(geometry.deleteOverlapsPoints).toBe(false);
});

test("teacher exam studio migrates legacy short reference answers into visible model answers", async ({ page }) => {
  const existingExam = examFromDraft(
    "exam_short_legacy",
    {
      title: "legacy 단답식 시험",
      questions: [
        {
          id: "q_short_legacy",
          type: "SHORT",
          promptMarkdown: "legacy 단답식 문항",
          points: 5,
          referenceAnswer: { text: "legacy 기준 답안" },
          rubricMarkdown: "핵심 기준",
          modelAnswerMarkdown: ""
        }
      ]
    },
    "DRAFT"
  );
  const state = await mockTeacherClassroom(page, { initialExams: [existingExam] });

  await page.goto("/classrooms/cls_exam/weeks/wk_exam/exam-studio/exam_short_legacy");
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  const shortCard = page.getByTestId("exam-question-card").filter({ has: page.getByTestId("exam-question-model-answer") });
  await expect(shortCard.getByTestId("exam-question-answer")).toHaveCount(0);
  await expect(shortCard.getByPlaceholder("기준 답안")).toHaveCount(0);
  await expect(shortCard.getByTestId("exam-question-model-answer")).toHaveValue("legacy 기준 답안");

  await page.getByTestId("exam-publish").click();
  await expect.poll(() => state.getPublishCount()).toBe(1);
  const payload = state.getPublishPayloads()[0];
  expect(payload.questions[0].referenceAnswer?.text).toBe("");
  expect(payload.questions[0].modelAnswerMarkdown).toBe("legacy 기준 답안");
});

test("teacher exam studio migrates AI short reference proposals into visible model answers", async ({ page }) => {
  const state = await mockTeacherClassroom(page, {
    chatRoute: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "stage", stage: "PREPARING", label: "요청 정리", progress: 0.1 },
          {
            type: "proposal",
            data: {
              answerMarkdown: "단답식 문항 제안입니다.",
              replyMarkdown: "단답식 문항 제안입니다.",
              operations: [
                {
                  method: "appendQuestions",
                  params: {
                    questions: [
                      {
                        id: "q_ai_short",
                        type: "SHORT",
                        promptMarkdown: "AI 단답식 문항",
                        points: 5,
                        referenceAnswer: { text: "AI legacy 기준 답안" },
                        rubricMarkdown: "핵심 기준"
                      }
                    ]
                  }
                }
              ],
              source: "AI"
            }
          },
          { type: "stage", stage: "COMPLETE", label: "완료", progress: 1 },
          { type: "done" }
        ])
      })
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-question-prompt").fill("기본 객관식 문항");
  await page.getByTestId("exam-question-choice").nth(0).fill("정답");
  await page.getByTestId("exam-question-choice").nth(1).fill("오답");
  await page.getByTestId("exam-ai-chat-input").fill("단답식 문항 하나 추가해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();

  await page.getByTestId("exam-ai-apply-proposal").click();
  await expect(page.getByTestId("exam-question-card")).toHaveCount(2);
  const shortCard = page.getByTestId("exam-question-card").filter({ has: page.getByTestId("exam-question-model-answer") });
  await expect(shortCard.getByTestId("exam-question-answer")).toHaveCount(0);
  await expect(shortCard.getByPlaceholder("기준 답안")).toHaveCount(0);
  await expect(shortCard.getByTestId("exam-question-model-answer")).toHaveValue("AI legacy 기준 답안");

  await page.getByTestId("exam-publish").click();
  await expect.poll(() => state.getPublishCount()).toBe(1);
  const shortQuestion = state.getPublishPayloads()[0].questions.find((question: any) => question.id === "q_ai_short");
  expect(shortQuestion?.referenceAnswer?.text).toBe("");
  expect(shortQuestion?.modelAnswerMarkdown).toBe("AI legacy 기준 답안");
});

test("teacher exam studio holds stale AI operations for review instead of overwriting local edits", async ({ page }) => {
  let releaseChat: (() => void) | undefined;
  const chatGate = new Promise<void>((resolve) => {
    releaseChat = resolve;
  });
  await mockTeacherClassroom(page, {
    chatRoute: async (route) => {
      await chatGate;
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "stage", stage: "AI_THINKING", label: "사고 요약 스트리밍", progress: 0.42 },
          {
            type: "proposal",
            data: {
              answerMarkdown: "제목을 AI 제목으로 바꾸겠습니다.",
              replyMarkdown: "제목을 AI 제목으로 바꾸겠습니다.",
              operations: [
                {
                  method: "patchExamSettings",
                  params: { title: "AI가 늦게 보낸 제목" }
                }
              ],
              source: "AI"
            }
          },
          { type: "done" }
        ])
      });
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-chat-input").fill("제목 바꿔줘");
  await page.getByTestId("exam-ai-send").click();
  await page.getByTestId("exam-title-input").fill("선생님이 직접 바꾼 제목");
  releaseChat?.();

  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("선생님이 직접 바꾼 제목");
  await expect(page.getByTestId("exam-ai-applied-card")).toHaveCount(0);

  await page.getByTestId("exam-ai-apply-proposal").click();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("AI가 늦게 보낸 제목");
});

test("teacher exam studio resets thought state and ignores late stream events after close", async ({ page }) => {
  let releaseChat: (() => void) | undefined;
  const chatGate = new Promise<void>((resolve) => {
    releaseChat = resolve;
  });
  await mockTeacherClassroom(page, {
    chatRoute: async (route) => {
      await chatGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: ndjson([
            {
              type: "proposal",
              data: {
                answerMarkdown: "늦게 도착한 제목 변경입니다.",
                replyMarkdown: "늦게 도착한 제목 변경입니다.",
                operations: [
                  {
                    method: "patchExamSettings",
                    params: { title: "닫힌 뒤 도착한 제목" }
                  }
                ],
                source: "AI"
              }
            },
            { type: "done" }
          ])
        });
      } catch {
        // The browser may have already aborted this request after the modal closes.
      }
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-chat-input").fill("늦게 제목을 바꿔줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "취소" }).click();
  releaseChat?.();
  await expect(page.getByTestId("exam-studio-page")).toHaveCount(0);

  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("새 시험");
  await expect(page.getByTestId("exam-ai-progress")).toHaveCount(0);
});

test("teacher exam studio marks stream protocol errors as failed without mutating the draft", async ({ page }) => {
  await installExamAiObservationProbe(page);
  await mockTeacherClassroom(page, {
    chatRoute: async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "stage", stage: "AI_THINKING", label: "사고 요약 스트리밍", progress: 0.42 }
        ])
      });
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-title-input").fill("선생님이 지킨 제목");
  await page.getByTestId("exam-ai-chat-input").fill("제목과 시간을 바꿔줘");
  await page.getByTestId("exam-ai-send").click();

  await expect(page.getByTestId("exam-ai-progress")).toHaveClass(/failed/);
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("exam-ai-thought-toggle").click();
  await expect(page.getByTestId("exam-ai-thought-summary")).toContainText("AI 응답 완료 신호");
  await expect(page.getByTestId("exam-title-input")).toHaveValue("선생님이 지킨 제목");
  await expect(page.getByTestId("exam-ai-applied-card")).toHaveCount(0);
  await expect(page.getByTestId("exam-ai-proposal-card")).toHaveCount(0);
  const observations = await readExamAiObservations(page);
  expect(observations.some((event) => event.eventName === "stream_failure_no_proposal" && event.reason === "missing_done")).toBe(true);
  expect(observations.some((event) => event.eventName === "proposal_pending")).toBe(false);
});

test("teacher exam studio rejects completed streams without a proposal", async ({ page }) => {
  await installExamAiObservationProbe(page);
  await mockTeacherClassroom(page, {
    chatRoute: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "stage", stage: "AI_THINKING", label: "검토", progress: 0.4 },
          { type: "done" }
        ])
      })
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-title-input").fill("제안 없음 보호 제목");
  await page.getByTestId("exam-ai-chat-input").fill("제안 없이 끝내봐");
  await page.getByTestId("exam-ai-send").click();

  await expect(page.getByTestId("exam-ai-progress")).toHaveClass(/failed/);
  await expect(page.getByTestId("exam-title-input")).toHaveValue("제안 없음 보호 제목");
  await expect(page.getByTestId("exam-ai-proposal-card")).toHaveCount(0);
  const observations = await readExamAiObservations(page);
  expect(observations.some((event) => event.eventName === "stream_failure_no_proposal" && event.reason === "missing_proposal")).toBe(true);
  expect(observations.some((event) => event.eventName === "proposal_pending")).toBe(false);
});

test("teacher exam studio shows proposal thought summary without early draft mutation", async ({ page }) => {
  await mockTeacherClassroom(page, {
    chatRoute: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "stage", stage: "AI_THINKING", label: "검토", progress: 0.4 },
          {
            type: "proposal",
            thoughtSummary: "제안 요약만 안전하게 표시됩니다.",
            data: {
              answerMarkdown: "검토 후 반영할 문항을 제안했습니다.",
              replyMarkdown: "검토 후 반영할 문항을 제안했습니다.",
              operations: [
                {
                  method: "appendQuestions",
                  params: {
                    questions: [
                      {
                        id: "q_summary_only",
                        type: "OX",
                        promptMarkdown: "요약 확인용 문항입니다.",
                        points: 2,
                        answer: { value: true }
                      }
                    ]
                  }
                }
              ],
              source: "AI"
            }
          },
          { type: "stage", stage: "COMPLETE", label: "완료", progress: 1 },
          { type: "done" }
        ])
      })
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-chat-input").fill("요약만 있는 제안을 만들어줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await expect(page.getByTestId("exam-question-card")).toHaveCount(1);
  await page.getByTestId("exam-ai-thought-toggle").click();
  await expect(page.getByTestId("exam-ai-thought-summary")).toContainText("제안 요약만 안전하게 표시됩니다.");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(1);
});

test("teacher exam studio sanitizes raw stream error events", async ({ page }) => {
  await installExamAiObservationProbe(page);
  await mockTeacherClassroom(page, {
    chatRoute: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "error", error: "RAW_PROVIDER_SECRET 경사하강법은 손실을 줄이는 방향" }
        ])
      })
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-title-input").fill("원본 보호 제목");
  await page.getByTestId("exam-ai-chat-input").fill("민감한 오류를 내봐");
  await page.getByTestId("exam-ai-send").click();

  await expect(page.getByTestId("exam-ai-progress")).toHaveClass(/failed/);
  await expect(page.getByTestId("exam-studio-page")).not.toContainText("RAW_PROVIDER_SECRET");
  await expect(page.getByTestId("exam-studio-page")).not.toContainText("경사하강법은 손실");
  await expect(page.getByTestId("exam-title-input")).toHaveValue("원본 보호 제목");
  await expect(page.getByTestId("exam-ai-proposal-card")).toHaveCount(0);
  const observations = await readExamAiObservations(page);
  expect(observations.some((event) => event.eventName === "stream_failure_no_proposal" && event.reason === "stream_error")).toBe(true);
  expect(JSON.stringify(observations)).not.toContain("RAW_PROVIDER_SECRET");
});

test("teacher exam studio rejects malformed AI streams after proposal events", async ({ page }) => {
  await installExamAiObservationProbe(page);
  await mockTeacherClassroom(page, {
    chatRoute: async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          {
            type: "proposal",
            data: {
              answerMarkdown: "제목을 변경했습니다.",
              replyMarkdown: "제목을 변경했습니다.",
              operations: [
                {
                  method: "patchExamSettings",
                  params: { title: "적용되면 안 되는 제목" }
                }
              ],
              source: "AI"
            }
          }
        ])
      });
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-title-input").fill("프로토콜 보호 제목");
  await page.getByTestId("exam-ai-chat-input").fill("제목 바꿔줘");
  await page.getByTestId("exam-ai-send").click();

  await expect(page.getByTestId("exam-ai-progress")).toHaveClass(/failed/);
  await expect(page.getByTestId("exam-title-input")).toHaveValue("프로토콜 보호 제목");
  await expect(page.getByTestId("exam-ai-proposal-card")).toHaveCount(0);
  await expect(page.getByTestId("exam-ai-applied-card")).toHaveCount(0);
  const observations = await readExamAiObservations(page);
  expect(observations.some((event) => event.eventName === "stream_failure_no_proposal" && event.reason === "missing_done")).toBe(true);
  expect(observations.some((event) => event.eventName === "proposal_pending")).toBe(false);
});

for (const malformedCase of [
  {
    name: "duplicate proposal",
    body: ndjson([
      {
        type: "proposal",
        data: { replyMarkdown: "첫 제안", operations: [{ method: "patchExamSettings", params: { title: "첫 제목" } }], source: "AI" }
      },
      {
        type: "proposal",
        data: { replyMarkdown: "둘째 제안", operations: [{ method: "patchExamSettings", params: { title: "둘째 제목" } }], source: "AI" }
      },
      { type: "done" }
    ])
  },
  {
    name: "done before proposal",
    body: ndjson([
      { type: "done" },
      {
        type: "proposal",
        data: { replyMarkdown: "늦은 제안", operations: [{ method: "patchExamSettings", params: { title: "늦은 제목" } }], source: "AI" }
      }
    ])
  },
  {
    name: "event after done",
    body: ndjson([
      {
        type: "proposal",
        data: { replyMarkdown: "제안", operations: [{ method: "patchExamSettings", params: { title: "후속 제목" } }], source: "AI" }
      },
      { type: "done" },
      { type: "stage", stage: "COMPLETE", label: "완료", progress: 1 }
    ])
  },
  {
    name: "duplicate done",
    body: ndjson([
      {
        type: "proposal",
        data: { replyMarkdown: "제안", operations: [{ method: "patchExamSettings", params: { title: "중복 완료 제목" } }], source: "AI" }
      },
      { type: "done" },
      { type: "done" }
    ])
  },
  {
    name: "invalid ndjson",
    body: "{\"type\":\"stage\",\"stage\":\"AI_THINKING\",\"label\":\"검토\",\"progress\":0.3}\n{not valid json}\n"
  }
]) {
  test(`teacher exam studio rejects malformed AI stream order: ${malformedCase.name}`, async ({ page }) => {
    await installExamAiObservationProbe(page);
    await mockTeacherClassroom(page, {
      chatRoute: (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: malformedCase.body
        })
    });

    await openNewExamStudio(page);
    await page.getByTestId("exam-title-input").fill("순서 보호 제목");
    await page.getByTestId("exam-ai-chat-input").fill("제목 바꿔줘");
    await page.getByTestId("exam-ai-send").click();

    await expect(page.getByTestId("exam-ai-progress")).toHaveClass(/failed/);
    await expect(page.getByTestId("exam-title-input")).toHaveValue("순서 보호 제목");
    await expect(page.getByTestId("exam-ai-proposal-card")).toHaveCount(0);
    await expect(page.getByTestId("exam-ai-applied-card")).toHaveCount(0);
    const observations = await readExamAiObservations(page);
    const expectedReason = malformedCase.name === "invalid ndjson" ? "invalid_ndjson" : "malformed_order";
    expect(observations.some((event) => event.eventName === "stream_failure_no_proposal" && event.reason === expectedReason)).toBe(true);
    expect(observations.some((event) => event.eventName === "proposal_pending")).toBe(false);
  });
}

test("teacher exam studio drops unapplied proposal state after reload", async ({ page }) => {
  await mockTeacherClassroom(page);

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-chat-input").fill("OX 문항 하나 제안해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("새 시험");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(1);

  const storageBeforeReload = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  expect(storageBeforeReload).not.toContain("q_ai");
  expect(storageBeforeReload).not.toContain("경사하강법은");
  expect(storageBeforeReload).not.toContain("patchExamSettings");

  await page.reload();
  await expect(page.getByTestId("exam-studio-page")).toBeVisible();
  await expect(page.getByTestId("exam-ai-proposal-card")).toHaveCount(0);
  await expect(page.getByTestId("exam-title-input")).toHaveValue("새 시험");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(1);
  const storageAfterReload = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  expect(storageAfterReload).not.toContain("q_ai");
  expect(storageAfterReload).not.toContain("경사하강법은");
  expect(storageAfterReload).not.toContain("patchExamSettings");
});

test("teacher exam studio renders pending AI proposal cleanly on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await mockTeacherClassroom(page);

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-chat-input").fill("OX 문항 하나 제안해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await expect(page.getByTestId("exam-ai-proposal-summary-card")).toHaveCount(2);

  const layout = await page.evaluate(() => {
    const proposal = document.querySelector<HTMLElement>("[data-testid='exam-ai-proposal-card']");
    const composer = document.querySelector<HTMLElement>("[data-testid='exam-ai-composer']");
    const actions = document.querySelector<HTMLElement>("[data-testid='exam-studio-actions']");
    const shellNav = document.querySelector<HTMLElement>("[data-testid='app-shell-nav']");
    const pageRoot = document.querySelector<HTMLElement>("[data-testid='exam-studio-page']");
    if (!proposal || !composer || !actions) {
      throw new Error("mobile proposal layout probes are missing");
    }
    const proposalRect = proposal.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const shellNavRect = shellNav?.getBoundingClientRect();
    const pageRootRect = pageRoot?.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) =>
      !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const visible = (rect: DOMRect | undefined) =>
      Boolean(rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth);
    return {
      proposalBottom: Math.round(proposalRect.bottom),
      composerTop: Math.round(composerRect.top),
      composerBottom: Math.round(composerRect.bottom),
      actionsTop: Math.round(actionsRect.top),
      proposalOverlapsComposer: overlaps(proposalRect, composerRect),
      composerOverlapsActions: overlaps(composerRect, actionsRect),
      shellNavOverlapsPage: visible(shellNavRect) && visible(pageRootRect) && Boolean(shellNavRect && pageRootRect && overlaps(shellNavRect, pageRootRect))
    };
  });

  expect(layout.proposalBottom).toBeLessThan(layout.composerTop);
  expect(layout.composerBottom).toBeLessThan(layout.actionsTop);
  expect(layout.proposalOverlapsComposer).toBe(false);
  expect(layout.composerOverlapsActions).toBe(false);
  expect(layout.shellNavOverlapsPage).toBe(false);
  await assertNoHorizontalOverflow(page);
  await assertNoTextOverflow(page);
  await captureExamStudioScreenshot(page, testInfo, "ai-proposal-mobile");
});

test("teacher exam studio prevents applying an AI proposal while publish is saving", async ({ page }) => {
  let releasePublish: (() => void) | undefined;
  const publishGate = new Promise<void>((resolve) => {
    releasePublish = resolve;
  });
  await mockTeacherClassroom(page, {
    publishRoute: async (route, mockState) => {
      await publishGate;
      const draft = route.request().postDataJSON();
      const exam = examFromDraft("exam_created", draft, "PUBLISHED");
      mockState.exams.splice(0, mockState.exams.length, exam);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: exam })
      });
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-chat-input").fill("OX 문항 하나 제안해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await page.getByTestId("exam-publish").click();
  await expect(page.getByTestId("exam-ai-apply-proposal")).toBeDisabled();
  await page.getByTestId("exam-ai-apply-proposal").click({ force: true });
  await expect(page.getByTestId("exam-title-input")).toHaveValue("새 시험");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(1);
  releasePublish?.();
  await expect(page.getByTestId("classroom-exam-row")).toContainText("새 시험");
});

test("teacher exam studio ignores PDF context that resolves after chat send", async ({ page }) => {
  let releasePdf: (() => void) | undefined;
  const pdfGate = new Promise<void>((resolve) => {
    releasePdf = resolve;
  });
  const sourceTexts: string[] = [];
  await mockTeacherClassroom(page, {
    pdfRoute: async (route) => {
      await pdfGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: { text: "late uploaded pdf context should not attach", numPages: 1, truncated: false }
          })
        });
      } catch {
        // The chat send invalidates the in-flight extraction request.
      }
    },
    chatRoute: async (route) => {
      sourceTexts.push(String(route.request().postDataJSON().sourceText ?? ""));
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          {
            type: "proposal",
            data: {
              replyMarkdown: "자료 없이 제안했습니다.",
              operations: [],
              source: "AI"
            }
          },
          { type: "done" }
        ])
      });
    }
  });

  await openNewExamStudio(page);
  await page.getByTestId("exam-ai-attachment-input").setInputFiles({
    name: "slow-context.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n", "utf-8")
  });
  await page.getByTestId("exam-ai-chat-input").fill("첨부 없이 먼저 물어볼게");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByText("자료 없이 제안했습니다.")).toBeVisible();
  expect(sourceTexts).toEqual([""]);
  releasePdf?.();
  await expect(page.getByTestId("exam-ai-attachment-status")).toHaveCount(0);

  await page.getByTestId("exam-ai-chat-input").fill("다음 질문");
  await page.getByTestId("exam-ai-send").click();
  await expect.poll(() => sourceTexts.length).toBe(2);
  expect(sourceTexts[1]).toBe("");
});

test("teacher exam studio applies a relative tomorrow 3 PM AI operation to the left draft", async ({ page }) => {
  await mockTeacherClassroom(page, {
    chatRoute: async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "stage", stage: "PREPARING", label: "요청 정리", progress: 0.1 },
          { type: "thought_delta", text: "AI가 요청한 시간 설정과 시험 편집 명령을 JSON 구조로 정리하고 있습니다." },
          {
            type: "proposal",
            data: {
              answerMarkdown: "시험 시작 시간을 내일 오후 3시로, 종료 시간을 오후 3시 30분으로 변경했습니다.",
              replyMarkdown: "시험 시작 시간을 내일 오후 3시로, 종료 시간을 오후 3시 30분으로 변경했습니다.",
              operations: [
                {
                  method: "patchExamSettings",
                  params: {
                    availableFrom: "2026-05-03T06:00:00.000Z",
                    availableUntil: "2026-05-03T06:30:00.000Z",
                    timeLimitMinutes: 30
                  }
                }
              ],
              source: "AI"
            }
          },
          { type: "stage", stage: "COMPLETE", label: "완료", progress: 1 },
          { type: "done" }
        ])
      });
    }
  });

  await openNewExamStudio(page);
  const initialAvailableFrom = await page.getByTestId("exam-available-from-input").inputValue();
  const initialAvailableUntil = await page.getByTestId("exam-available-until-input").inputValue();
  const initialTimeLimit = await page.getByTestId("exam-time-limit-input").inputValue();
  await page.getByTestId("exam-ai-chat-input").fill("시험 시간을 내일 오후 3시로 바꿔줘");
  await page.getByTestId("exam-ai-send").click();

  await expect(page.getByTestId("exam-ai-proposal-card")).toBeVisible();
  await expect(page.getByTestId("exam-ai-applied-card")).toHaveCount(0);
  await expect(page.getByTestId("exam-available-from-input")).toHaveValue(initialAvailableFrom);
  await expect(page.getByTestId("exam-available-until-input")).toHaveValue(initialAvailableUntil);
  await expect(page.getByTestId("exam-time-limit-input")).toHaveValue(initialTimeLimit);
  await page.getByTestId("exam-ai-apply-proposal").click();
  await expect(page.getByTestId("exam-ai-applied-card")).toBeVisible();
  await expect(page.getByTestId("exam-available-from-input")).toHaveValue("2026-05-03T15:00");
  await expect(page.getByTestId("exam-available-until-input")).toHaveValue("2026-05-03T15:30");
  await expect(page.getByTestId("exam-time-limit-input")).toHaveValue("30");
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "false");
});

test("student exam countdown auto-submits with a fake clock", async ({ page }) => {
  let submitCount = 0;
  await page.addInitScript(() => {
    window.__MERGE_EDU_TEST_CLOCK_NOW__ = Date.parse("2026-05-02T00:00:00.000Z");
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { user: studentUser } }) })
  );
  await page.route("**/api/exams/exam_take", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id: "exam_take",
          classroomId: "cls_exam",
          weekId: "wk_exam",
          status: "PUBLISHED",
          title: "응시 테스트",
          descriptionMarkdown: "",
          availableFrom: now,
          availableUntil: "2026-05-03T00:00:00.000Z",
          timeLimitMinutes: 1,
          passScoreRatio: 0.7,
          totalPoints: 5,
          questionCount: 1,
          attempt: null
        }
      })
    })
  );
  await page.route("**/api/exams/exam_take/attempts/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: null }) })
  );
  await page.route("**/api/exams/exam_take/start", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id: "att_take",
          examId: "exam_take",
          status: "IN_PROGRESS",
          examVersion: 1,
          startedAt: now,
          deadlineAt: "2026-05-02T00:00:03.000Z",
          answers: {},
          questions: [
            {
              id: "q1",
              type: "MCQ",
              promptMarkdown: "2 + 2 = ?",
              points: 5,
              choices: [
                { id: "a", textMarkdown: "3" },
                { id: "b", textMarkdown: "4" }
              ]
            }
          ]
        }
      })
    })
  );
  await page.route("**/api/exam-attempts/att_take/answers", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) })
  );
  await page.route("**/api/exam-attempts/att_take/submit", async (route) => {
    submitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id: "att_take",
          examId: "exam_take",
          status: "GRADED",
          examVersion: 1,
          startedAt: now,
          deadlineAt: "2026-05-02T00:00:03.000Z",
          submittedAt: "2026-05-02T00:00:06.000Z",
          answers: route.request().postDataJSON().answers,
          questions: [
            {
              id: "q1",
              type: "MCQ",
              promptMarkdown: "2 + 2 = ?",
              points: 5,
              choices: [
                { id: "a", textMarkdown: "3" },
                { id: "b", textMarkdown: "4" }
              ]
            }
          ],
          grading: {
            totalScore: 5,
            maxScore: 5,
            scoreRatio: 1,
            items: [{ questionId: "q1", score: 5, maxScore: 5, verdict: "CORRECT", feedbackMarkdown: "정답" }],
            summaryMarkdown: "자동 제출되었습니다.",
            gradingSource: "DETERMINISTIC_FALLBACK"
          }
        }
      })
    });
  });

  await page.goto("/exams/exam_take");
  await page.getByTestId("exam-start-button").click();
  await expect(page.getByTestId("exam-countdown")).toHaveText("0:03");
  await expect(page.getByTestId("exam-taking-page").getByText("2 + 2 = ?")).toBeVisible();
  await expect(page.getByTestId("exam-question-prompt")).toHaveCount(0);
  await expect(page.getByText("채점 기준")).toHaveCount(0);
  await expect(page.getByText("모범 답안")).toHaveCount(0);
  await expect(page.getByText("힌트")).toHaveCount(0);
  await expect(page.locator(".exam-feedback")).toHaveCount(0);
  await page.getByTestId("exam-choice-option").filter({ hasText: "4" }).click();
  await page.evaluate(() => {
    window.__MERGE_EDU_TEST_CLOCK_NOW__ = Date.parse("2026-05-02T00:00:06.000Z");
  });

  await expect.poll(() => submitCount).toBe(1);
  await expect(page.getByTestId("exam-score-summary")).toContainText("5 / 5점");
});

test("student exam OX blank selection saves as unanswered instead of X", async ({ page }) => {
  let savedAnswers: Record<string, unknown> | null = null;
  await page.addInitScript(() => {
    window.__MERGE_EDU_TEST_CLOCK_NOW__ = Date.parse("2026-05-02T00:00:00.000Z");
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { user: studentUser } }) })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "disabled" }) })
  );
  await page.route("**/api/exams/exam_take_ox", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id: "exam_take_ox",
          classroomId: "cls_exam",
          weekId: "wk_exam",
          status: "PUBLISHED",
          title: "OX 응시 테스트",
          descriptionMarkdown: "",
          availableFrom: now,
          availableUntil: "2026-05-03T00:00:00.000Z",
          timeLimitMinutes: 30,
          passScoreRatio: 0.7,
          totalPoints: 1,
          questionCount: 1,
          attempt: null
        }
      })
    })
  );
  await page.route("**/api/exams/exam_take_ox/attempts/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: null }) })
  );
  await page.route("**/api/exams/exam_take_ox/start", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id: "att_take_ox",
          examId: "exam_take_ox",
          status: "IN_PROGRESS",
          examVersion: 1,
          startedAt: now,
          deadlineAt: "2026-05-02T00:30:00.000Z",
          answers: {},
          questions: [
            {
              id: "q_ox",
              type: "OX",
              promptMarkdown: "Kerberos는 티켓 기반 인증 시스템이다.",
              points: 1
            }
          ]
        }
      })
    })
  );
  await page.route("**/api/exam-attempts/att_take_ox/answers", (route) => {
    const payload = route.request().postDataJSON();
    savedAnswers = payload.answers ?? payload;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
  });

  await page.goto("/exams/exam_take_ox");
  await page.getByTestId("exam-start-button").click();
  const oxOption = page.getByTestId("exam-ox-option").filter({ hasText: "O" });
  await oxOption.click();
  await oxOption.click();

  await expect.poll(() => savedAnswers).toEqual({ q_ox: "" });
});
