import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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

async function mockTeacherClassroom(
  page: Page,
  options: { chatRoute?: Parameters<Page["route"]>[1] } = {}
) {
  const exams: any[] = [];
  const studioChatSourceTexts: string[] = [];
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
  await page.route("**/api/weeks/wk_exam/lectures", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route("**/api/weeks/wk_exam/exams", async (route) => {
    if (route.request().method() === "POST") {
      const draft = route.request().postDataJSON();
      const exam = examFromDraft("exam_created", draft, "DRAFT");
      exams.splice(0, exams.length, exam);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, data: exam }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: exams }) });
  });
  await page.route("**/api/weeks/wk_exam/exam-studio/pdf-context", (route) =>
    route.fulfill({
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
    })
  );
  await page.route("**/api/weeks/wk_exam/exam-studio/chat/stream", async (route) => {
    if (options.chatRoute) {
      return options.chatRoute(route);
    }
    studioChatSourceTexts.push(String(route.request().postDataJSON().sourceText ?? ""));
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
  await page.route("**/api/exams/exam_created/publish", async (route) => {
    const draft = route.request().postDataJSON();
    const exam = examFromDraft("exam_created", draft, "PUBLISHED");
    exams.splice(0, exams.length, exam);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: exam }) });
  });
  await page.route("**/api/exams/exam_created/report", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          exam: exams[0],
          summary: { enrolledCount: 1, attemptCount: 1, gradedCount: 1, averageScore: 8, maxScore: 8, completionRatio: 1 },
          students: [{ studentUserId: "student_exam", displayName: "Exam Student", status: "GRADED", attempt: null }],
          questionStats: [{ questionId: "q_ai", maxScore: 3, averageScore: 3, attempts: 1 }]
        }
      })
    })
  );
  return {
    getStudioChatSourceTexts: () => studioChatSourceTexts
  };
}

test("teacher publishes a studio exam after AI operations update the draft live", async ({ page }) => {
  const state = await mockTeacherClassroom(page);
  const readAiLayout = async () =>
    page.getByTestId("exam-studio-ai-panel").evaluate((panelElement) => {
      const composer = panelElement.querySelector<HTMLElement>("[data-testid='exam-ai-composer']");
      const thread = panelElement.querySelector<HTMLElement>("[data-testid='exam-ai-thread']");
      if (!composer || !thread) {
        throw new Error("AI panel layout probes are missing");
      }
      const panelRect = panelElement.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const threadRect = thread.getBoundingClientRect();
      return {
        composerBottomGap: Math.round(panelRect.bottom - composerRect.bottom),
        composerTop: Math.round(composerRect.top),
        threadTop: Math.round(threadRect.top),
        threadBottom: Math.round(threadRect.bottom)
      };
    });

  await page.goto("/classrooms/cls_exam");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-modal")).toBeVisible();
  const studio = page.getByTestId("exam-studio-modal");
  await expect(page.getByTestId("exam-studio-header")).toBeVisible();
  await expect(page.getByTestId("exam-studio-kicker")).toHaveText("시험 스튜디오");
  await expect(page.getByTestId("exam-studio-close")).toBeVisible();
  await expect(studio.getByText("PDF 자료")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "전송" })).toBeVisible();
  await expect(page.getByTestId("exam-ai-send")).toHaveText("");
  expect(await page.getByTestId("exam-ai-chat-input").evaluate((element) => element.tagName)).toBe("TEXTAREA");
  await expect(page.getByRole("button", { name: "문항 삭제" })).toBeVisible();
  await expect(page.getByTestId("exam-delete-question")).toHaveText("");

  const modalZIndex = await studio.evaluate((element) => {
    const backdrop = element.closest(".exam-studio-backdrop");
    return Number(window.getComputedStyle(backdrop as Element).zIndex);
  });
  const navZIndex = await page.getByTestId("classroom-section-nav").evaluate((element) =>
    Number(window.getComputedStyle(element).zIndex)
  );
  expect(modalZIndex).toBeGreaterThan(navZIndex);
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

  await page.getByTestId("exam-ai-chat-input").fill("OX 문항 하나 제안해줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-progress")).toBeVisible();
  await expect(page.getByTestId("exam-ai-stage-PREPARING")).toBeVisible();
  await expect(page.getByTestId("exam-ai-stage-AI_THINKING")).toBeVisible();
  await expect(page.getByTestId("exam-ai-applied-card")).toBeVisible();
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("exam-ai-thought-toggle").click();
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("exam-ai-thought-summary")).toContainText("문항 유형");
  const proposalAiLayout = await readAiLayout();
  expect(proposalAiLayout.composerBottomGap).toBeLessThanOrEqual(28);
  expect(proposalAiLayout.composerTop).toBeGreaterThan(proposalAiLayout.threadBottom);
  expect(state.getStudioChatSourceTexts().some((text) => text.includes("uploaded pdf context"))).toBe(true);
  await expect(page.getByTestId("exam-ai-attachment-status")).toHaveCount(0);
  await expect(page.getByTestId("exam-title-input")).toHaveValue("AI 보강 시험");
  await expect(page.getByTestId("exam-available-from-input")).toHaveValue("2026-05-02T10:00");
  await expect(page.getByTestId("exam-available-until-input")).toHaveValue("2026-05-02T11:00");
  await expect(page.getByTestId("exam-time-limit-input")).toHaveValue("45");
  await expect(page.getByTestId("exam-question-card")).toHaveCount(2);

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
  await page.getByRole("link", { name: "리포트" }).click();
  await expect(page.getByTestId("exam-report-page")).toContainText("Exam Student");
});

test("teacher exam studio keeps the generated mock structure on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await mockTeacherClassroom(page);

  await page.goto("/classrooms/cls_exam");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-modal")).toBeVisible();
  await expect(page.getByTestId("exam-studio-kicker")).toHaveText("시험 스튜디오");

  const layout = await page.evaluate(() => {
    const question = document.querySelector<HTMLElement>("[data-testid='exam-question-card']");
    const aiPanel = document.querySelector<HTMLElement>("[data-testid='exam-studio-ai-panel']");
    const composer = document.querySelector<HTMLElement>("[data-testid='exam-ai-composer']");
    const actions = document.querySelector<HTMLElement>(".exam-studio-actions");
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

  await page.goto("/classrooms/cls_exam");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-modal")).toBeVisible();
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

  await page.goto("/classrooms/cls_exam");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-modal")).toBeVisible();
  await page.getByTestId("exam-ai-chat-input").fill("늦게 제목을 바꿔줘");
  await page.getByTestId("exam-ai-send").click();
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("exam-studio-close").click();
  releaseChat?.();
  await expect(page.getByTestId("exam-studio-modal")).toHaveCount(0);

  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-modal")).toBeVisible();
  await expect(page.getByTestId("exam-title-input")).toHaveValue("새 시험");
  await expect(page.getByTestId("exam-ai-progress")).toHaveCount(0);
});

test("teacher exam studio marks stream protocol errors as failed without mutating the draft", async ({ page }) => {
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

  await page.goto("/classrooms/cls_exam");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-modal")).toBeVisible();
  await page.getByTestId("exam-title-input").fill("선생님이 지킨 제목");
  await page.getByTestId("exam-ai-chat-input").fill("제목과 시간을 바꿔줘");
  await page.getByTestId("exam-ai-send").click();

  await expect(page.getByTestId("exam-ai-progress")).toHaveClass(/failed/);
  await expect(page.getByTestId("exam-ai-thought-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("exam-ai-thought-toggle").click();
  await expect(page.getByTestId("exam-ai-thought-summary")).toContainText("완료 이벤트 없이");
  await expect(page.getByTestId("exam-title-input")).toHaveValue("선생님이 지킨 제목");
  await expect(page.getByTestId("exam-ai-applied-card")).toHaveCount(0);
  await expect(page.getByTestId("exam-ai-proposal-card")).toHaveCount(0);
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

  await page.goto("/classrooms/cls_exam");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByTestId("classroom-add-exam").click();
  await expect(page.getByTestId("exam-studio-modal")).toBeVisible();
  await page.getByTestId("exam-ai-chat-input").fill("시험 시간을 내일 오후 3시로 바꿔줘");
  await page.getByTestId("exam-ai-send").click();

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
