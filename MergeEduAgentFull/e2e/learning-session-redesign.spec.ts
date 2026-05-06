import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function streamObject(content: string): string {
  return `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
}

function makePdfFixture(): string {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const kids: string[] = [];

  for (let pageNumber = 1; pageNumber <= 13; pageNumber += 1) {
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = pageObjectNumber + 1;
    const content =
      "0.96 0.98 1 rg 0 0 720 960 re f\n" +
      `0 0 0 rg BT /F1 30 Tf 80 830 Td (EduPilot learning session ${pageNumber}) Tj ET\n` +
      `0.08 0.22 0.55 rg BT /F1 22 Tf 80 760 Td (${pageNumber}) Tj ET\n` +
      "0.08 0.22 0.55 rg BT /F1 22 Tf 120 760 Td (Classroom setup guide) Tj ET\n" +
      "0.1 0.45 0.8 rg 250 610 230 120 re f\n" +
      "1 1 1 rg BT /F1 18 Tf 278 670 Td (Weekly lecture PDF) Tj ET\n" +
      "0.1 0.45 0.8 rg 270 410 190 80 re f\n" +
      "1 1 1 rg BT /F1 16 Tf 295 455 Td (Learning flow) Tj ET";
    kids.push(`${pageObjectNumber} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 960] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      streamObject(content)
    );
  }

  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count 13 >>`;

  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = byteLength(body);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return body;
}

async function expectInViewport(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  const viewport = locator.page().viewportSize();
  expect(viewport).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(-2);
  expect(box!.y).toBeGreaterThanOrEqual(-2);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 2);
  expect(box!.y + Math.min(box!.height, viewport!.height)).toBeLessThanOrEqual(viewport!.height + 2);
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function setupLearningSessionFixture(page: Page) {
  const sessionId = "ses_learning_visual";
  const lectureId = "lec_learning_visual";
  const events: string[] = [];
  const learnerModel = {
    level: "BEGINNER",
    confidence: 0.58,
    weakConcepts: [],
    strongConcepts: []
  };
  const session = {
    schemaVersion: "1.0",
    sessionId,
    lectureId,
    currentPage: 4,
    learningProgressPage: 2,
    messages: [
      {
        id: "msg_intro",
        role: "assistant",
        agent: "ORCHESTRATOR",
        contentMarkdown: "학습 세션에 오신 것을 환영합니다. 현재 4페이지입니다.\n\n바로 설명부터 시작할까요?",
        thoughtSummaryMarkdown: "현재 페이지와 학습 흐름을 확인하고 시작 여부를 묻습니다.",
        createdAt: new Date().toISOString(),
        widget: {
          type: "BINARY_CHOICE",
          decisionType: "START_EXPLANATION_DECISION"
        }
      },
      {
        id: "msg_user",
        role: "user",
        agent: "SYSTEM",
        contentMarkdown: "퀴즈 풀고 싶어",
        createdAt: new Date().toISOString()
      },
      {
        id: "msg_quiz_picker",
        role: "assistant",
        agent: "ORCHESTRATOR",
        contentMarkdown: "좋습니다. 현재까지의 학습 내용을 기준으로 퀴즈 유형을 선택해 주세요.",
        thoughtSummaryMarkdown: "객관식이 빠르게 이해도를 확인하기에 적절합니다.",
        createdAt: new Date().toISOString(),
        widget: {
          type: "QUIZ_TYPE_PICKER",
          recommendedId: "MCQ",
          badgeText: "추천됨",
          options: [
            { id: "MCQ", label: "객관식" },
            { id: "OX", label: "OX" },
            { id: "SHORT", label: "단답형" },
            { id: "ESSAY", label: "서술형" }
          ]
        }
      },
      {
        id: "msg_grader",
        role: "assistant",
        agent: "GRADER",
        contentMarkdown: "채점 준비 중입니다. 퀴즈 응시 후 결과를 자동으로 확인해 드릴게요.",
        createdAt: new Date().toISOString()
      }
    ],
    quizzes: [],
    learnerModel,
    activeIntervention: null
  };

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          user: {
            id: "usr_learning_visual",
            email: "teacher.learning-visual@example.com",
            displayName: "테스트 선생님",
            role: "teacher",
            inviteCode: "1234",
            emailVerified: true,
            hasPassword: true
          }
        }
      })
    });
  });

  await page.route(`**/api/session/by-lecture/${lectureId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          session,
          lecture: {
            id: lectureId,
            weekId: "wk_learning_visual",
            title: "학습 세션 디자인 테스트",
            pdf: {
              path: "/mock/learning-session.pdf",
              numPages: 13,
              pageIndexPath: "/mock/learning-session.index.json",
              geminiFile: {
                fileName: "mock-files/learning-session.pdf",
                fileUri: "mock://learning-session.pdf",
                mimeType: "application/pdf"
              }
            }
          },
          pdfUrl: "/api/uploads/learning-session.pdf",
          aiStatus: { connected: true }
        }
      })
    });
  });

  await page.route("**/api/uploads/learning-session.pdf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: makePdfFixture()
    });
  });

  await page.addInitScript(({ targetSessionId, targetLearnerModel }) => {
    const originalFetch = window.fetch.bind(window);
    const eventTypes: string[] = [];
    const eventPayloads: unknown[] = [];
    let currentPage = 4;
    let learningProgressPage = 2;
    (window as unknown as { __learningEventTypes: string[] }).__learningEventTypes = eventTypes;
    (window as unknown as { __learningEventPayloads: unknown[] }).__learningEventPayloads = eventPayloads;

    const buildQuiz = (quizType: string) => ({
      schemaVersion: "1.0",
      quizId: `quiz_learning_visual_${quizType}`,
      quizType,
      page: 4,
      title: `4페이지 ${quizType === "ESSAY" ? "서술형" : "객관식"} 퀴즈`,
      questions: quizType === "ESSAY"
        ? [
            {
              id: "q1",
              promptMarkdown: "현재 페이지의 학습 핵심을 서술해 주세요.",
              referenceAnswer: { text: "학습 세션의 흐름과 현재 페이지 핵심을 설명한다." }
            }
          ]
        : [
            {
              id: "q1",
              promptMarkdown: "학습 세션에서 가장 먼저 확인해야 하는 것은 무엇인가요?",
              choices: [
                { id: "a", textMarkdown: "현재 페이지의 핵심 개념" },
                { id: "b", textMarkdown: "브라우저 테마 색상" }
              ],
              answer: { choiceId: "a" }
            }
          ]
    });

    const makeResponse = (eventType = "", body: any = {}) => {
      const quizType = String(body.event?.payload?.quizType ?? "MCQ");
      const targetPage = Number(
        body.event?.payload?.page ??
        body.clientContext?.currentPage ??
        currentPage
      );
      if (Number.isFinite(targetPage) && targetPage > 0) {
        currentPage = Math.floor(targetPage);
      }
      if (eventType === "START_EXPLANATION_DECISION") {
        learningProgressPage = 3;
      }
      const quizRecord = eventType === "QUIZ_SUBMITTED"
        ? {
            id: `record_${Date.now()}`,
            quizType: String(body.event?.payload?.quizType ?? "ESSAY"),
            createdFromPage: 4,
            createdAt: new Date().toISOString(),
            quizJson: buildQuiz(String(body.event?.payload?.quizType ?? "ESSAY")),
            userAnswers: body.event?.payload?.answers ?? {},
            grading: {
              status: "GRADED",
              score: 8,
              maxScore: 10,
              scoreRatio: 0.8,
              summaryMarkdown: "서술형 답안의 핵심 흐름을 확인했습니다.",
              items: [
                {
                  questionId: "q1",
                  score: 8,
                  maxScore: 10,
                  verdict: "PARTIAL",
                  feedbackMarkdown: "핵심 개념을 포함했고, 근거 설명을 조금 더 보강하면 좋습니다."
                }
              ]
            }
          }
        : null;

      return {
        ok: true,
        newMessages: eventType === "USER_MESSAGE"
          ? [
              {
                id: `msg_answer_${Date.now()}`,
                role: "assistant",
                agent: "QA",
                contentMarkdown: "좋아요. 지금 페이지 기준으로 바로 도와드릴게요.",
                createdAt: new Date().toISOString()
              }
            ]
          : [],
        ui: {
          openQuizModal: eventType === "QUIZ_TYPE_SELECTED",
          quiz: eventType === "QUIZ_TYPE_SELECTED" ? buildQuiz(quizType) : null,
          disableQuizClose: false,
          passScoreRatio: 0.7,
          widgets: []
        },
        patch: {
          currentPage,
          learningProgressPage,
          progressText: `~${learningProgressPage}페이지까지 진행`,
          learnerModel: targetLearnerModel,
          activeIntervention: null,
          quizRecord
        }
      };
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (!url.includes(`/api/session/${targetSessionId}/event/stream`)) {
        return originalFetch(input, init);
      }

      const body = JSON.parse(String(init?.body ?? "{}"));
      const eventType = String(body.event?.type ?? "");
      eventTypes.push(eventType);
      eventPayloads.push(body);

      const encoder = new TextEncoder();
      const chunks: unknown[] = [];
      if (eventType === "USER_MESSAGE") {
        chunks.push({
          type: "agent_delta",
          tool: "ANSWER_QUESTION",
          agent: "QA",
          channel: "answer",
          text: "응답을 준비하고 있습니다."
        });
      }
      if (eventType === "QUIZ_SUBMITTED") {
        chunks.push({
          type: "agent_delta",
          tool: "GRADE_QUIZ",
          agent: "GRADER",
          channel: "thought",
          text: "서술형 답안을 기준과 대조합니다."
        });
        chunks.push({
          type: "agent_delta",
          tool: "GRADE_QUIZ",
          agent: "GRADER",
          channel: "answer",
          text: "채점 결과를 정리합니다."
        });
      }
      chunks.push({ type: "final", data: makeResponse(eventType, body) });

      return new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
              if (eventType === "USER_MESSAGE") {
                await new Promise((resolve) => window.setTimeout(resolve, 80));
              }
            }
            controller.close();
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/x-ndjson; charset=utf-8" }
        }
      );
    };
  }, { targetSessionId: sessionId, targetLearnerModel: learnerModel });

  await page.route(`**/api/session/${sessionId}/event`, async (route) => {
    const eventType = "SAVE_AND_EXIT";
    events.push(eventType);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        newMessages: [],
        ui: {
          openQuizModal: false,
          quiz: null,
          disableQuizClose: false,
          passScoreRatio: 0.7,
          widgets: []
        },
        patch: {
          currentPage: session.currentPage,
          learningProgressPage: session.learningProgressPage,
          progressText: `~${session.learningProgressPage}페이지까지 진행`,
          learnerModel,
          activeIntervention: null,
          quizRecord: null
        }
      })
    });
  });

  await page.goto(`/session/${lectureId}`);
  await expect(page.getByTestId("session-layout")).toBeVisible();
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible({ timeout: 20_000 });

  return { events };
}

async function getStreamEventTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __learningEventTypes?: string[] }).__learningEventTypes ?? []);
}

async function getStreamEventPayloads(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as unknown as { __learningEventPayloads?: any[] }).__learningEventPayloads ?? []);
}

test("learning session redesign keeps visual surfaces and event callbacks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { events } = await setupLearningSessionFixture(page);

  await expect(page.getByText("LEARNING SESSION")).toBeVisible();
  await expect(page.getByRole("heading", { name: "학습 세션" })).toBeVisible();
  await expect(page.getByText("PDF Viewer")).toBeVisible();
  await expect(page.locator(".session-chat-head")).toContainText("AI Tutor");
  await expect(page.locator(".session-chat-head")).toContainText("학습 진행률");
  await expect(page.locator(".session-chat-head")).toContainText("2 / 13 page");
  await expect(page.locator(".session-progress-pill")).toHaveText("~2페이지까지 진행");
  await expect(page.getByTestId("pdf-zoom-readout")).toHaveText("100%");
  await expect(page.getByRole("button", { name: /객관식/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "예" })).toBeVisible();
  await expect(page.getByLabel("첨부 파일")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectInViewport(page.getByTestId("pdf-viewer-shell"));
  await expectInViewport(page.getByTestId("session-chat-shell"));
  await expectInViewport(page.locator(".session-composer"));

  await page.screenshot({
    path: "test-results/learning-session-redesign-desktop.png",
    fullPage: true
  });

  await page.getByRole("button", { name: /서술형/ }).click();
  await expect.poll(() => getStreamEventTypes(page)).toContain("QUIZ_TYPE_SELECTED");
  await expect(page.getByRole("dialog", { name: "4페이지 서술형 퀴즈" })).toBeVisible();
  await page.getByLabel("서술형 답안").fill("현재 페이지의 핵심 개념을 확인하고 학습 흐름을 정리합니다.");
  await page.getByRole("button", { name: "채점하기" }).click();
  await expect(page.getByText("채점 에이전트 스트리밍")).toBeVisible();
  await expect(page.getByText("서술형 답안의 핵심 흐름을 확인했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "채점 완료" })).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByText("채점 에이전트 스트리밍")).toBeHidden();
  await page.getByLabel("퀴즈 모달 닫기").click();

  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByText("3 / 13 페이지")).toBeVisible();
  await expect(page.locator(".session-progress-pill")).toHaveText("~2페이지까지 진행");
  await expect(page.locator(".session-chat-head")).toContainText("2 / 13 page");

  await page.getByRole("button", { name: "예" }).click();
  await expect.poll(() => getStreamEventTypes(page)).toContain("START_EXPLANATION_DECISION");
  await expect(page.locator(".session-progress-pill")).toHaveText("~3페이지까지 진행");
  await expect(page.locator(".session-chat-head")).toContainText("3 / 13 page");

  const userPrompt = "이 페이지를 한 문장으로 요약해줘";
  await page.getByLabel("질문 또는 요청").fill(userPrompt);
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText(userPrompt)).toBeVisible();
  await expect(page.getByText("응답을 준비하고 있습니다.")).toBeVisible();
  await expect(page.getByText("좋아요. 지금 페이지 기준으로 바로 도와드릴게요.")).toBeVisible();
  await expect(page.getByText("응답을 준비하고 있습니다.")).toBeHidden();
  await expect.poll(() => getStreamEventTypes(page)).toContain("USER_MESSAGE");
  const userMessagePayload = (await getStreamEventPayloads(page)).find((item) => item.event?.type === "USER_MESSAGE");
  expect(userMessagePayload.event.payload.text).toBe(userPrompt);
  expect(userMessagePayload.clientContext.currentPage).toBe(3);
  await expect.poll(() => page.getByTestId("session-chat-panel").evaluate((element) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  ))).toBeLessThan(90);

  await page.getByRole("button", { name: "저장 및 종료" }).click();
  await expect.poll(() => events.includes("SAVE_AND_EXIT")).toBe(true);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
});

test("learning session redesign remains contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupLearningSessionFixture(page);

  await expectNoHorizontalOverflow(page);
  await expectInViewport(page.getByTestId("pdf-viewer-shell"));
  await expectInViewport(page.getByTestId("session-chat-shell"));
  await expectInViewport(page.locator(".session-composer"));
  await expect(page.getByRole("button", { name: /객관식/ })).toBeVisible();
  await expect(page.getByLabel("질문 또는 요청")).toBeVisible();

  await page.screenshot({
    path: "test-results/learning-session-redesign-mobile.png",
    fullPage: true
  });
});
