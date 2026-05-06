import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function streamObject(content: string): string {
  return `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
}

function makePdfFixture(): string {
  const page1 =
    "0.94 0.97 1 rg 0 0 1000 700 re f\n" +
    "0 0 0 rg BT /F1 42 Tf 70 610 Td (Left page 1) Tj ET\n" +
    "0.1 0.32 0.7 rg BT /F1 42 Tf 700 90 Td (Right side 1) Tj ET";
  const page2 =
    "0.94 1 0.97 rg 0 0 1000 700 re f\n" +
    "0 0 0 rg BT /F1 42 Tf 70 610 Td (Left page 2) Tj ET\n" +
    "0.1 0.45 0.35 rg BT /F1 42 Tf 700 90 Td (Right side 2) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 700] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    streamObject(page1),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 700] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    streamObject(page2)
  ];

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

type BoxSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ViewportMetrics = {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
};

type ContainmentSnapshot = {
  sessionLayout: BoxSnapshot;
  pdfShell: BoxSnapshot;
  chatShell: BoxSnapshot;
  chatPanel: BoxSnapshot;
  pdfViewport: BoxSnapshot;
  chatBubble: BoxSnapshot;
  chatBubbleFontSize: string;
  pdfMetrics: ViewportMetrics;
};

async function getBox(locator: Locator): Promise<BoxSnapshot> {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  return box!;
}

async function getViewportMetrics(locator: Locator): Promise<ViewportMetrics> {
  return locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight
  }));
}

async function captureContainmentSnapshot(page: Page): Promise<ContainmentSnapshot> {
  const chatBubble = page.getByTestId("session-chat-bubble").first();
  return {
    sessionLayout: await getBox(page.getByTestId("session-layout")),
    pdfShell: await getBox(page.getByTestId("pdf-viewer-shell")),
    chatShell: await getBox(page.getByTestId("session-chat-shell")),
    chatPanel: await getBox(page.getByTestId("session-chat-panel")),
    pdfViewport: await getBox(page.getByTestId("pdf-viewport")),
    chatBubble: await getBox(chatBubble),
    chatBubbleFontSize: await chatBubble.evaluate((element) => getComputedStyle(element).fontSize),
    pdfMetrics: await getViewportMetrics(page.getByTestId("pdf-viewport"))
  };
}

function expectClose(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectStableBox(actual: BoxSnapshot, expected: BoxSnapshot, tolerance = 2) {
  expectClose(actual.x, expected.x, tolerance);
  expectClose(actual.y, expected.y, tolerance);
  expectClose(actual.width, expected.width, tolerance);
  expectClose(actual.height, expected.height, tolerance);
}

function expectContainedZoom(before: ContainmentSnapshot, after: ContainmentSnapshot) {
  expectStableBox(after.sessionLayout, before.sessionLayout);
  expectStableBox(after.pdfShell, before.pdfShell);
  expectStableBox(after.chatShell, before.chatShell);
  expectStableBox(after.chatPanel, before.chatPanel);
  expectStableBox(after.pdfViewport, before.pdfViewport);
  expectStableBox(after.chatBubble, before.chatBubble);
  expect(after.chatBubbleFontSize).toBe(before.chatBubbleFontSize);
  expectClose(after.pdfMetrics.clientWidth, before.pdfMetrics.clientWidth);
  expectClose(after.pdfMetrics.clientHeight, before.pdfMetrics.clientHeight);
  expect(
    after.pdfMetrics.scrollWidth > before.pdfMetrics.scrollWidth + 20 ||
    after.pdfMetrics.scrollHeight > before.pdfMetrics.scrollHeight + 20
  ).toBe(true);
}

async function setupPdfPanFixture(page: Page, suffix: string) {
  const sessionId = `ses_pdf_pan_${suffix}`;
  const lectureId = `lec_pdf_pan_${suffix}`;
  const pdfFile = `e2e-pan-${suffix}.pdf`;
  const session = {
    schemaVersion: "1.0",
    sessionId,
    lectureId,
    currentPage: 1,
    learningProgressPage: 0,
    messages: [
      {
        id: `msg_seed_${suffix}`,
        role: "assistant",
        agent: "SYSTEM",
        contentMarkdown: "PDF viewer containment test session is ready.",
        createdAt: new Date().toISOString()
      }
    ],
    quizzes: [],
    learnerModel: {
      level: "BEGINNER",
      confidence: 0.5,
      weakConcepts: [],
      strongConcepts: []
    },
    activeIntervention: null
  };

  const eventResponse = () => ({
    ok: true,
    newMessages: session.messages,
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
      learnerModel: session.learnerModel,
      activeIntervention: null,
      quizRecord: null
    }
  });

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          user: {
            id: `usr_pdf_pan_${suffix}`,
            email: `teacher.pdf-pan-${suffix}@example.com`,
            displayName: "PDF Pan Teacher",
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
            weekId: `wk_pdf_pan_${suffix}`,
            title: "PDF pan zoom fixture",
            pdf: {
              path: `/mock/${pdfFile}`,
              numPages: 2,
              pageIndexPath: `/mock/${pdfFile}.index.json`,
              geminiFile: {
                fileName: `mock-files/${pdfFile}`,
                fileUri: `mock://${pdfFile}`,
                mimeType: "application/pdf"
              }
            }
          },
          pdfUrl: `/api/uploads/${pdfFile}`,
          aiStatus: { connected: true }
        }
      })
    });
  });

  await page.route(`**/api/uploads/${pdfFile}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: makePdfFixture()
    });
  });

  await page.route(`**/api/session/${sessionId}/event/stream`, async (route) => {
    const payload = route.request().postDataJSON() as {
      event?: { type?: string; payload?: { page?: number } };
      clientContext?: { currentPage?: number };
    };
    if (payload.event?.type === "PAGE_CHANGED") {
      session.currentPage = Number(payload.event.payload?.page ?? payload.clientContext?.currentPage ?? 1);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "final", data: eventResponse() })}\n`
    });
  });

  return { lectureId };
}

async function openFixtureAndZoom(page: Page, lectureId: string) {
  await page.goto(`/session/${lectureId}`);
  await expect(page.getByTestId("pdf-viewport")).toBeVisible();
  await expect(page.getByTestId("session-chat-bubble").first()).toBeVisible();
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible({ timeout: 20_000 });
  const before = await captureContainmentSnapshot(page);
  await page.getByTestId("pdf-zoom-slider").fill("2");
  await expect(page.getByTestId("pdf-zoom-readout")).toHaveText("200%");
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLElement>("[data-testid='pdf-viewport']");
    return Boolean(
      element &&
      (element.scrollWidth > element.clientWidth + 20 ||
        element.scrollHeight > element.clientHeight + 20)
    );
  });
  const after = await captureContainmentSnapshot(page);
  expectContainedZoom(before, after);
  return { before, after };
}

test("PDF viewer zoom slider and drag pan inspect enlarged pages", async ({ page }) => {
  const session = {
    schemaVersion: "1.0",
    sessionId: "ses_pdf_pan",
    lectureId: "lec_pdf_pan",
    currentPage: 1,
    learningProgressPage: 0,
    messages: [
      {
        id: "msg_seed",
        role: "assistant",
        agent: "SYSTEM",
        contentMarkdown: "PDF viewer test session is ready.",
        createdAt: new Date().toISOString()
      }
    ],
    quizzes: [],
    learnerModel: {
      level: "BEGINNER",
      confidence: 0.5,
      weakConcepts: [],
      strongConcepts: []
    },
    activeIntervention: null
  };

  const eventResponse = () => ({
    ok: true,
    newMessages: session.messages,
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
      learnerModel: session.learnerModel,
      activeIntervention: null,
      quizRecord: null
    }
  });

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          user: {
            id: "usr_pdf_pan",
            email: "teacher.pdf-pan@example.com",
            displayName: "PDF Pan Teacher",
            role: "teacher",
            inviteCode: "1234",
            emailVerified: true,
            hasPassword: true
          }
        }
      })
    });
  });

  await page.route("**/api/session/by-lecture/lec_pdf_pan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          session,
          lecture: {
            id: "lec_pdf_pan",
            weekId: "wk_pdf_pan",
            title: "PDF pan zoom fixture",
            pdf: {
              path: "/mock/e2e-pan.pdf",
              numPages: 2,
              pageIndexPath: "/mock/e2e-pan.index.json",
              geminiFile: {
                fileName: "mock-files/e2e-pan.pdf",
                fileUri: "mock://e2e-pan.pdf",
                mimeType: "application/pdf"
              }
            }
          },
          pdfUrl: "/api/uploads/e2e-pan.pdf",
          aiStatus: { connected: true }
        }
      })
    });
  });

  await page.route("**/api/uploads/e2e-pan.pdf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: makePdfFixture()
    });
  });

  await page.route("**/api/session/ses_pdf_pan/event/stream", async (route) => {
    const payload = route.request().postDataJSON() as {
      event?: { type?: string; payload?: { page?: number } };
      clientContext?: { currentPage?: number };
    };
    if (payload.event?.type === "PAGE_CHANGED") {
      session.currentPage = Number(payload.event.payload?.page ?? payload.clientContext?.currentPage ?? 1);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "final", data: eventResponse() })}\n`
    });
  });

  await page.goto("/session/lec_pdf_pan");

  const viewport = page.getByTestId("pdf-viewport");
  const panSurface = page.getByTestId("pdf-pan-surface");
  const slider = page.getByTestId("pdf-zoom-slider");
  const readout = page.getByTestId("pdf-zoom-readout");
  const reset = page.getByTestId("pdf-reset-fit");
  const chatBubble = page.getByTestId("session-chat-bubble").first();

  await expect(viewport).toBeVisible();
  await expect(panSurface).toBeVisible();
  await expect(slider).toBeVisible();
  await expect(page.getByTestId("session-layout")).toBeVisible();
  await expect(page.getByTestId("pdf-viewer-shell")).toBeVisible();
  await expect(page.getByTestId("session-chat-shell")).toBeVisible();
  await expect(page.getByTestId("session-chat-panel")).toBeVisible();
  await expect(chatBubble).toBeVisible();
  await expect(readout).toHaveText("100%");
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible({ timeout: 20_000 });

  const beforeZoom = await captureContainmentSnapshot(page);
  await slider.fill("2");
  await expect(readout).toHaveText("200%");
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLElement>("[data-testid='pdf-viewport']");
    return Boolean(element && element.scrollWidth > element.clientWidth + 20);
  });
  const afterZoom = await captureContainmentSnapshot(page);
  expectContainedZoom(beforeZoom, afterZoom);

  await viewport.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });

  const readoutBeforeNativeWheel = await readout.textContent();
  const wheelBox = await viewport.boundingBox();
  expect(wheelBox).toBeTruthy();
  await page.mouse.move(wheelBox!.x + wheelBox!.width / 2, wheelBox!.y + wheelBox!.height / 2);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(readout).toHaveText(readoutBeforeNativeWheel ?? "200%");
  await viewport.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });

  const beforeDrag = await viewport.evaluate((element) => element.scrollLeft);
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();
  const dragX = box!.x + box!.width / 2;
  const dragY = box!.y + Math.min(180, box!.height / 2);
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX - 180, dragY, { steps: 8 });
  await page.mouse.up();
  const afterLeftDrag = await viewport.evaluate((element) => element.scrollLeft);
  expect(afterLeftDrag).toBeGreaterThan(beforeDrag);

  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 100, dragY, { steps: 8 });
  await page.mouse.up();
  const afterRightDrag = await viewport.evaluate((element) => element.scrollLeft);
  expect(afterRightDrag).toBeLessThan(afterLeftDrag);

  await reset.click();
  await expect(readout).toHaveText("100%");
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLElement>("[data-testid='pdf-viewport']");
    return Boolean(
      element &&
      element.scrollWidth <= element.clientWidth + 1 &&
      element.scrollHeight <= element.clientHeight + 1
    );
  });

  await viewport.dispatchEvent("wheel", {
    deltaY: -500,
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  });
  await expect(readout).toHaveText(/10[1-9]%|1[1-9][0-9]%|200%/);

  await reset.click();
  await expect(readout).toHaveText("100%");
  await viewport.dispatchEvent("wheel", {
    deltaY: -500,
    metaKey: true,
    bubbles: true,
    cancelable: true
  });
  await expect(readout).toHaveText(/10[1-9]%|1[1-9][0-9]%|200%/);

  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByText("2 / 2 페이지")).toBeVisible();
  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByText("1 / 2 페이지")).toBeVisible();
});

test("PDF zoom stays contained on a short desktop viewport", async ({ page }) => {
  const viewportSize = { width: 1180, height: 560 };
  await page.setViewportSize(viewportSize);
  const { lectureId } = await setupPdfPanFixture(page, "short_desktop");
  const { after } = await openFixtureAndZoom(page, lectureId);
  const expectedWorkspaceHeight = viewportSize.height - 62 - 92;
  expect(after.sessionLayout.height).toBeLessThanOrEqual(expectedWorkspaceHeight + 2);
  expect(after.pdfShell.height).toBeLessThanOrEqual(expectedWorkspaceHeight + 2);
  expect(after.chatShell.height).toBeLessThanOrEqual(expectedWorkspaceHeight + 2);
});

test("PDF zoom stays contained on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { lectureId } = await setupPdfPanFixture(page, "mobile");
  const { before, after } = await openFixtureAndZoom(page, lectureId);
  expectStableBox(after.pdfShell, before.pdfShell);
  expectStableBox(after.pdfViewport, before.pdfViewport);
});

test("late page-change stream does not overwrite the current session page", async ({ page }) => {
  const session = {
    schemaVersion: "1.0",
    sessionId: "ses_pdf_pan_race",
    lectureId: "lec_pdf_pan_race",
    currentPage: 1,
    learningProgressPage: 0,
    messages: [
      {
        id: "msg_race_seed",
        role: "assistant",
        agent: "SYSTEM",
        contentMarkdown: "Race guard session is ready.",
        createdAt: new Date().toISOString()
      }
    ],
    quizzes: [],
    learnerModel: {
      level: "BEGINNER",
      confidence: 0.5,
      weakConcepts: [],
      strongConcepts: []
    },
    activeIntervention: null
  };

  const eventResponse = (pageNumber: number, learningProgressPage = 0) => ({
    ok: true,
    newMessages: [
      {
        id: `msg_page_${pageNumber}`,
        role: "assistant",
        agent: "SYSTEM",
        contentMarkdown: `late page response ${pageNumber}`,
        createdAt: new Date().toISOString()
      }
    ],
    ui: {
      openQuizModal: false,
      quiz: null,
      disableQuizClose: false,
      passScoreRatio: 0.7,
      widgets: []
    },
    patch: {
      currentPage: pageNumber,
      learningProgressPage,
      progressText: `~${learningProgressPage}페이지까지 진행`,
      learnerModel: session.learnerModel,
      activeIntervention: null,
      quizRecord: null
    }
  });

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          user: {
            id: "usr_pdf_pan_race",
            email: "teacher.pdf-pan-race@example.com",
            displayName: "PDF Pan Race Teacher",
            role: "teacher",
            inviteCode: "1234",
            emailVerified: true,
            hasPassword: true
          }
        }
      })
    });
  });

  await page.route("**/api/session/by-lecture/lec_pdf_pan_race", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          session,
          lecture: {
            id: "lec_pdf_pan_race",
            weekId: "wk_pdf_pan_race",
            title: "PDF pan zoom race fixture",
            pdf: {
              path: "/mock/e2e-pan-race.pdf",
              numPages: 2,
              pageIndexPath: "/mock/e2e-pan-race.index.json",
              geminiFile: {
                fileName: "mock-files/e2e-pan-race.pdf",
                fileUri: "mock://e2e-pan-race.pdf",
                mimeType: "application/pdf"
              }
            }
          },
          pdfUrl: "/api/uploads/e2e-pan-race.pdf",
          aiStatus: { connected: true }
        }
      })
    });
  });

  await page.route("**/api/uploads/e2e-pan-race.pdf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: makePdfFixture()
    });
  });

  let firstPageChangeRoute: import("@playwright/test").Route | null = null;
  let resolveFirstPageChangeSeen: (() => void) | null = null;
  const firstPageChangeSeen = new Promise<void>((resolve) => {
    resolveFirstPageChangeSeen = resolve;
  });

  await page.route("**/api/session/ses_pdf_pan_race/event/stream", async (route) => {
    const payload = route.request().postDataJSON() as {
      event?: { type?: string; payload?: { page?: number } };
      clientContext?: { currentPage?: number };
    };
    const targetPage = Number(payload.event?.payload?.page ?? payload.clientContext?.currentPage ?? 1);

    if (payload.event?.type === "PAGE_CHANGED" && targetPage === 2 && !firstPageChangeRoute) {
      firstPageChangeRoute = route;
      resolveFirstPageChangeSeen?.();
      return;
    }

    session.currentPage = targetPage;
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "final", data: eventResponse(targetPage) })}\n`
    });
  });

  await page.goto("/session/lec_pdf_pan_race");
  await expect(page.getByTestId("pdf-viewport")).toBeVisible();
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "다음" }).click();
  await firstPageChangeSeen;
  await expect(page.getByText("2 / 2 페이지")).toBeVisible();
  await expect(page.locator(".session-progress-pill")).toHaveText("~0페이지까지 진행");
  await expect(page.locator(".session-chat-head")).toContainText("0 / 2 page");

  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByText("1 / 2 페이지")).toBeVisible();
  await expect(page.getByText("late page response 1")).toBeVisible();

  if (firstPageChangeRoute) {
    await firstPageChangeRoute.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "final", data: eventResponse(2, 2) })}\n`
    }).catch(() => {
      // The intended implementation aborts the superseded request; either abort or stale-final ignore is acceptable here.
    });
  }

  await page.waitForTimeout(200);
  await expect(page.getByText("1 / 2 페이지")).toBeVisible();
  await expect(page.getByText("late page response 2")).toHaveCount(0);
  await expect(page.locator(".session-progress-pill")).toHaveText("~0페이지까지 진행");
  await expect(page.locator(".session-chat-head")).toContainText("0 / 2 page");
});
