import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const now = "2026-05-02T00:00:00.000Z";
const teacherUser = {
  id: "usr_shell_teacher",
  email: "shell.teacher@example.com",
  displayName: "김에듀",
  role: "teacher",
  inviteCode: "4321",
  emailVerified: true,
  hasPassword: true
};
const studentUser = {
  id: "usr_shell_student",
  email: "shell.student@example.com",
  displayName: "박학생",
  role: "student",
  inviteCode: "2244",
  emailVerified: true,
  hasPassword: true
};
const classrooms = [
  {
    id: "cls_shell",
    title: "UX/UI 디자인 입문",
    ownerUserId: "usr_shell_teacher",
    inviteCode: "9988",
    createdAt: now,
    updatedAt: now
  },
  {
    id: "cls_shell_2",
    title: "AI 기반 학습 설계",
    ownerUserId: "usr_shell_teacher",
    inviteCode: "7766",
    createdAt: now,
    updatedAt: now
  }
];
const weeks = [
  {
    id: "wk_shell_1",
    classroomId: "cls_shell",
    weekIndex: 1,
    title: "1주차. 사용자 경험의 이해",
    createdAt: now,
    updatedAt: now
  }
];
const shellLecture = {
  id: "lec_shell",
  weekId: "wk_shell_1",
  title: "셸 확인 강의",
  pdf: {
    path: "/mock/shell.pdf",
    numPages: 2,
    pageIndexPath: "/mock/shell.pdf.index.json",
    geminiFile: {
      fileName: "mock-files/shell.pdf",
      fileUri: "mock://shell.pdf",
      mimeType: "application/pdf"
    }
  },
  createdAt: now,
  updatedAt: now
};
const examMetadata = {
  id: "exam_shell",
  classroomId: "cls_shell",
  weekId: "wk_shell_1",
  title: "셸 확인 시험",
  descriptionMarkdown: "앱 셸 검증용 시험입니다.",
  availableFrom: "2026-05-02T00:00:00.000Z",
  availableUntil: "2026-05-09T00:00:00.000Z",
  timeLimitMinutes: 30,
  totalPoints: 5,
  status: "PUBLISHED",
  attempt: null
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function streamObject(content: string): string {
  return `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
}

function makePdfFixture(): string {
  const page1 = "0.96 0.98 1 rg 0 0 1000 700 re f\n0 0 0 rg BT /F1 42 Tf 70 610 Td (Shell page 1) Tj ET";
  const page2 = "0.96 1 0.98 rg 0 0 1000 700 re f\n0 0 0 rg BT /F1 42 Tf 70 610 Td (Shell page 2) Tj ET";
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

async function mockShellData(
  page: Page,
  user = teacherUser,
  options: {
    classroomsFailure?: boolean;
    classroomList?: typeof classrooms;
    classroomCreateFailure?: boolean;
    failClassroomListAfterCreate?: boolean;
  } = {}
) {
  let classroomList = [...(options.classroomList ?? classrooms)];
  let createdDuringTest = false;
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
  await page.route("**/api/classrooms", async (route) => {
    if (route.request().method() === "POST") {
      if (options.classroomCreateFailure) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "강의실 생성 실패" })
        });
      }

      const requestBody = route.request().postDataJSON() as { title?: string } | null;
      const createdClassroom = {
        id: "cls_created",
        title: requestBody?.title ?? "새 강의실",
        ownerUserId: user.id,
        teacherId: user.id,
        inviteCode: "3344",
        createdAt: now,
        updatedAt: now
      };
      classroomList = [...classroomList, createdClassroom];
      createdDuringTest = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: createdClassroom
        })
      });
    }

    if (options.classroomsFailure || (options.failClassroomListAfterCreate && createdDuringTest)) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "강의실 목록 실패" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: classroomList })
    });
  });
  await page.route("**/api/classrooms/cls_shell/weeks", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: weeks })
    })
  );
  await page.route("**/api/classrooms/cls_shell/students", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/classrooms/cls_shell/invitations", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/classrooms/cls_shell/notices", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/classrooms/cls_shell/discussions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/students/invitations", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/weeks/wk_shell_1/lectures", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [shellLecture] })
    })
  );
  await page.route("**/api/weeks/wk_shell_1/exams", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/session/by-lecture/lec_shell", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "mocked session unavailable" })
    })
  );
  await page.route("**/api/exams/exam_shell", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: examMetadata })
    })
  );
  await page.route("**/api/exams/exam_shell/attempts/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: null })
    })
  );
  await page.route("**/api/exams/exam_shell/report", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          exam: {
            id: "exam_shell",
            classroomId: "cls_shell",
            publishedRevision: {
              title: "셸 확인 시험"
            }
          },
          summary: {
            enrolledCount: 1,
            attemptCount: 0,
            gradedCount: 0,
            averageScore: 0,
            maxScore: 5,
            completionRatio: 0
          },
          students: [],
          questionStats: []
        }
      })
    })
  );
  await page.route("**/api/classrooms/cls_shell/report/students", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/classrooms/cls_shell/report/criteria**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/classrooms/cls_shell/materials", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
}

const contextualSessionPath = "/session/lec_shell?classroomId=cls_shell&section=weeks&week=wk_shell_1#reader";

async function mockShellSessionSuccess(page: Page) {
  await page.unroute("**/api/session/by-lecture/lec_shell").catch(() => null);
  await page.route("**/api/session/by-lecture/lec_shell", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          session: {
            schemaVersion: "1.0",
            sessionId: "ses_shell",
            lectureId: "lec_shell",
            currentPage: 1,
            messages: [
              {
                id: "msg_shell_1",
                role: "assistant",
                agent: "SYSTEM",
                contentMarkdown: "세션 준비 완료",
                createdAt: now
              }
            ],
            quizzes: [],
            learnerModel: {
              level: "BEGINNER",
              confidence: 0.5,
              weakConcepts: [],
              strongConcepts: []
            }
          },
          lecture: shellLecture,
          pdfUrl: "/api/uploads/shell.pdf",
          aiStatus: { connected: true }
        }
      })
    })
  );
  await page.route("**/api/uploads/shell.pdf", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: makePdfFixture()
    })
  );
}

async function mockShellSessionEventFailure(page: Page, status: number, code?: string) {
  await page.unroute("**/api/session/ses_shell/event/stream").catch(() => null);
  await page.route("**/api/session/ses_shell/event/stream", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: code === "EMAIL_NOT_VERIFIED" ? "이메일 인증이 필요합니다." : "세션 이벤트 실패",
        code
      })
    })
  );
}

async function expectNextParam(page: Page, expectedNext: string) {
  await expect.poll(() => new URL(page.url()).searchParams.get("next")).toBe(expectedNext);
}

async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-testid='app-shell-nav']");
    const content = document.querySelector<HTMLElement>("[data-testid='app-shell-content'], main.page-shell");
    if (!shell || !content) {
      throw new Error("app shell probes are missing");
    }
    const shellRect = shell.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      shellRight: Math.round(shellRect.right),
      shellBottom: Math.round(shellRect.bottom),
      contentLeft: Math.round(contentRect.left),
      contentRight: Math.round(contentRect.right),
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  });
}

test("desktop dashboard uses fixed sidebar and right content workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockShellData(page);

  await page.goto("/");
  await expect(page.getByTestId("app-shell-nav")).toBeVisible();
  await expect(page).toHaveTitle("EduPilot");
  await expect(page.getByTestId("app-brand")).toHaveText("EduPilot");
  await expect(page.getByRole("button", { name: "알림", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "더 보기", exact: true })).toHaveCount(0);
  await expect(page.locator(".topbar-utility-actions")).toHaveCount(0);
  await expect(page.locator(".topbar-icon-button")).toHaveCount(0);
  await expect(page.getByTestId("app-shell-nav").getByText("내 계정")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-hero")).toBeVisible();
  await expect(page.getByTestId("dashboard-hero")).not.toContainText("전체 흐름");
  await expect(page.locator("[data-testid='dashboard-hero'] .dashboard-progress-block")).toHaveCount(0);
  await expect(page.locator("[data-testid='dashboard-hero'] .dashboard-progress-track")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-content-grid")).toBeVisible();
  await expect(page.locator(".dashboard-side-stack")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-classroom-panel")).toBeVisible();
  await expect(page.getByTestId("dashboard-classroom-panel").getByTestId("dashboard-classroom-list")).toBeVisible();
  await expect(page.locator(".dashboard-panel-action")).toHaveCount(0);
  const addClassroomCard = page.locator(".add-classroom-card");
  await expect(addClassroomCard).toHaveCount(1);
  await expect(addClassroomCard).toBeVisible();
  await addClassroomCard.click();
  await expect(page.getByRole("dialog", { name: "강의실 추가" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("dialog", { name: "강의실 추가" })).toHaveCount(0);
  await expect(page.getByTestId("app-shell-content").getByText("워크스페이스")).toHaveCount(0);
  await expect(page.locator(".dashboard-notice-card")).toHaveCount(0);

  for (const navId of ["classroom", "notice", "files", "tasks", "chat", "grades", "calendar"]) {
    await page.getByTestId(`topbar-nav-${navId}`).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("topbar-nav-classroom")).toHaveAttribute("aria-current", "page");
    if (navId !== "classroom") {
      await expect(page.getByTestId(`topbar-nav-${navId}`)).not.toHaveAttribute("aria-current", "page");
    }
  }

  const geometry = await shellGeometry(page);
  expect(geometry.shellRight).toBeLessThan(geometry.contentLeft);
  expect(geometry.contentRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
});

test("dashboard classroom fetch failure stays visible inside the classroom panel", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page, teacherUser, { classroomsFailure: true });

  await page.goto("/");
  await expect(page.getByTestId("dashboard-classroom-panel").getByRole("alert")).toContainText("강의실 목록 실패");
  await expect(page.getByTestId("dashboard-classroom-panel").getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page.locator(".dashboard-panel-action")).toHaveCount(0);
  await expect(page.locator(".add-classroom-card")).toHaveCount(1);
  await expect(page.locator(".dashboard-side-stack")).toHaveCount(0);
});

test("teacher dashboard keeps the add tile as the only creation path with no classrooms", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page, teacherUser, { classroomList: [] });

  await page.goto("/");
  await expect(page.locator(".dashboard-panel-action")).toHaveCount(0);
  const addClassroomCard = page.locator(".add-classroom-card");
  await expect(addClassroomCard).toHaveCount(1);
  await expect(addClassroomCard).toBeVisible();
  await addClassroomCard.click();
  await expect(page.getByRole("dialog", { name: "강의실 추가" })).toBeVisible();
});

test("teacher creates a fresh classroom from the remaining add tile", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page, teacherUser, { classroomList: [] });

  await page.goto("/");
  const addClassroomCard = page.locator(".add-classroom-card");
  await expect(addClassroomCard).toHaveCount(1);
  await addClassroomCard.click();

  const dialog = page.getByRole("dialog", { name: "강의실 추가" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("새 강의실 이름").fill("새 구성 강의실");
  await dialog.getByRole("button", { name: "생성" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".classroom-card").filter({ hasText: "새 구성 강의실" })).toBeVisible();
  await expect(page.locator(".add-classroom-card")).toHaveCount(1);
});

test("teacher keeps the created classroom visible when refresh fails after creation", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page, teacherUser, {
    classroomList: [],
    failClassroomListAfterCreate: true
  });

  await page.goto("/");
  await page.locator(".add-classroom-card").click();
  const dialog = page.getByRole("dialog", { name: "강의실 추가" });
  await page.getByLabel("새 강의실 이름").fill("새로 만든 강의실");
  await dialog.getByRole("button", { name: "생성" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".classroom-card").filter({ hasText: "새로 만든 강의실" })).toBeVisible();
  const panel = page.getByTestId("dashboard-classroom-panel");
  await expect(panel.getByRole("alert")).toContainText("강의실 목록 실패");
  await panel.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator(".classroom-card").filter({ hasText: "새로 만든 강의실" })).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText("강의실 목록 실패");
});

test("teacher can recover from classroom creation failure through the remaining add tile", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page, teacherUser, { classroomList: [], classroomCreateFailure: true });

  await page.goto("/");
  await expect(page.locator(".dashboard-panel-action")).toHaveCount(0);
  const addClassroomCard = page.locator(".add-classroom-card");
  await expect(addClassroomCard).toHaveCount(1);
  await addClassroomCard.click();

  const dialog = page.getByRole("dialog", { name: "강의실 추가" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("새 강의실 이름").fill("생성 실패 확인 강의실");
  await dialog.getByRole("button", { name: "생성" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("강의실 생성 실패");
  await expect(dialog.getByRole("button", { name: "생성" })).toBeEnabled();

  await page.getByLabel("새 강의실 이름").fill("다시 시도할 강의실");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  await addClassroomCard.click();
  await expect(page.getByRole("dialog", { name: "강의실 추가" })).toBeVisible();
});

test("desktop classroom nests detail menu under the global sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell?section=weeks");
  await expect(page.getByTestId("classroom-hero")).toBeVisible();
  await expect(page.getByTestId("classroom-hero")).not.toContainText("전체 구성");
  await expect(page.locator("[data-testid='classroom-hero'] .dashboard-progress-block")).toHaveCount(0);
  await expect(page.locator("[data-testid='classroom-hero'] .dashboard-progress-track")).toHaveCount(0);
  await expect(page.getByTestId("classroom-section-nav")).toBeVisible();
  await expect(page.getByTestId("classroom-nav-weeks")).toHaveAttribute("aria-current", "page");

  const geometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-testid='app-shell-nav']");
    const subNav = document.querySelector<HTMLElement>("[data-testid='classroom-section-nav']");
    const panel = document.querySelector<HTMLElement>("[data-testid='classroom-section-panel']");
    if (!shell || !subNav || !panel) {
      throw new Error("classroom geometry probes are missing");
    }
    const shellRect = shell.getBoundingClientRect();
    const navRect = subNav.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      shellLeft: Math.round(shellRect.left),
      shellRight: Math.round(shellRect.right),
      navLeft: Math.round(navRect.left),
      navRight: Math.round(navRect.right),
      panelLeft: Math.round(panelRect.left),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });

  expect(geometry.navLeft).toBeGreaterThanOrEqual(geometry.shellLeft);
  expect(geometry.navRight).toBeLessThanOrEqual(geometry.shellRight);
  expect(geometry.shellRight).toBeLessThan(geometry.panelLeft);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
});

test("mobile shell stays compact without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShellData(page);

  await page.goto("/");
  await expect(page.getByTestId("app-shell-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-topbar")).toBeVisible();
  await expect(page.getByTestId("mobile-topbar-title")).toHaveText("강의실");
  await expect(page.locator(".topbar-nav")).toBeHidden();
  let geometry = await shellGeometry(page);
  expect(geometry.shellBottom).toBeLessThanOrEqual(86);
  expect(geometry.contentLeft).toBeGreaterThanOrEqual(13);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  await page.screenshot({ path: "test-results/mobile-topbar-closed-390.png", fullPage: true, animations: "disabled" });

  const openButton = page.getByTestId("mobile-nav-open");
  await expect(openButton).toHaveAttribute("aria-expanded", "false");
  await openButton.click();
  await expect(openButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("mobile-nav-drawer")).toBeVisible();
  await expect(page.getByTestId("mobile-nav-classroom")).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: "test-results/mobile-drawer-open-390.png", fullPage: true, animations: "disabled" });
  await page.getByTestId("mobile-nav-brand").focus();
  await page.keyboard.press("Shift+Tab");
  let focusInsideDrawer = await page.evaluate(() => {
    const drawer = document.querySelector("[data-testid='mobile-nav-drawer']");
    return Boolean(drawer?.contains(document.activeElement));
  });
  expect(focusInsideDrawer).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);
  await expect(openButton).toBeFocused();
  await expect(openButton).toHaveAttribute("aria-expanded", "false");

  await openButton.click();
  await page.getByTestId("mobile-nav-close").click();
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);
  await expect(openButton).toBeFocused();

  await openButton.click();
  await page.getByTestId("mobile-nav-backdrop").click({ position: { x: 380, y: 12 } });
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);

  await page.goto("/classrooms/cls_shell");
  await expect(page.getByTestId("mobile-topbar-title")).toHaveText("강의실");
  await expect(page.getByTestId("classroom-section-nav")).toBeHidden();
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-classroom-section-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-classroom-nav-invite")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("mobile-classroom-nav-weeks").click();
  await expect(page).toHaveURL(/section=weeks/);
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);
  geometry = await shellGeometry(page);
  expect(geometry.contentLeft).toBeGreaterThanOrEqual(13);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/classrooms/cls_shell?section=notices");
  await expect(page.getByTestId("mobile-topbar-title")).toHaveText("공지사항");
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-classroom-section-nav")).toBeVisible();
  const drawerGeometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-testid='app-shell-nav']");
    const drawer = document.querySelector<HTMLElement>("[data-testid='mobile-nav-drawer']");
    if (!shell || !drawer) throw new Error("mobile drawer probes are missing");
    const drawerRect = drawer.getBoundingClientRect();
    const shellZ = Number.parseInt(getComputedStyle(shell).zIndex, 10);
    const drawerZ = Number.parseInt(getComputedStyle(drawer).zIndex, 10);
    const modalZ = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--modal-z"), 10);
    return {
      drawerLeft: Math.round(drawerRect.left),
      drawerTop: Math.round(drawerRect.top),
      drawerBottom: Math.round(drawerRect.bottom),
      drawerHeight: Math.round(drawerRect.height),
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      shellZ,
      drawerZ,
      modalZ
    };
  });
  expect(drawerGeometry.drawerLeft).toBe(0);
  expect(drawerGeometry.drawerTop).toBe(0);
  expect(drawerGeometry.drawerBottom).toBeLessThanOrEqual(drawerGeometry.viewportHeight);
  expect(drawerGeometry.drawerHeight).toBeGreaterThanOrEqual(drawerGeometry.viewportHeight - 1);
  expect(drawerGeometry.drawerHeight).toBeLessThanOrEqual(drawerGeometry.viewportHeight);
  expect(drawerGeometry.scrollWidth).toBeLessThanOrEqual(drawerGeometry.viewportWidth + 1);
  expect(drawerGeometry.drawerZ).toBeGreaterThan(drawerGeometry.shellZ);
  expect(drawerGeometry.drawerZ).toBeLessThan(drawerGeometry.modalZ);
  await page.screenshot({ path: "test-results/mobile-drawer-open-768.png", fullPage: true, animations: "disabled" });

  await page.setViewportSize({ width: 1366, height: 820 });
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);
  await expect(page.locator(".topbar-nav")).toBeVisible();
  await expect(page.getByTestId("topbar-nav-notice")).toHaveAttribute("aria-current", "page");
  const lockClearedAfterDesktopResize = await page.evaluate(() => !document.body.classList.contains("mobile-nav-lock"));
  expect(lockClearedAfterDesktopResize).toBe(true);
});

test("mobile drawer exposes report and contextual classroom submenu rules", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell/report");
  await expect(page.getByTestId("mobile-topbar-title")).toHaveText("성적");
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-report-section-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-report-nav-content")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("mobile-report-nav-students").click();
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);

  await page.goto(contextualSessionPath);
  await expect(page.getByTestId("mobile-topbar-title")).toHaveText("강의실");
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-classroom-section-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-classroom-nav-weeks")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);

  await page.goto("/classrooms/cls_shell/weeks/wk_shell_1/exam-studio");
  await expect(page.getByTestId("mobile-topbar-title")).toHaveText("과제/시험");
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-classroom-section-nav")).toHaveCount(0);
  await expect(page.getByTestId("mobile-report-section-nav")).toHaveCount(0);
  await page.getByTestId("mobile-nav-classroom").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=weeks&week=wk_shell_1$/);
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);
});

test("classroom section query sync and role fallback stay observable", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell?section=report");
  await expect(page.getByTestId("classroom-nav-report")).toHaveCount(0);
  await expect(page.getByTestId("classroom-report-entry")).toBeVisible();

  await page.goto("/classrooms/cls_shell?section=not-real");
  await expect(page.getByTestId("classroom-nav-invite")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-invite-panel")).toBeVisible();

  await page.getByTestId("classroom-nav-weeks").click();
  await expect(page).toHaveURL(/section=weeks/);
  await expect(page.getByTestId("classroom-week-timeline")).toBeVisible();

  await page.getByRole("button", { name: "+ 주차 추가" }).click();
  await expect(page).toHaveURL(/section=weeks/);
});

test("contextual sidebar notice opens the selected classroom notices", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell?section=weeks");
  await page.getByTestId("topbar-nav-notice").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=notices$/);
  await expect(page.getByTestId("topbar-nav-notice")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "공지사항" })).toBeVisible();
});

test("classroom sidebar returns to the current teacher classroom instead of selection", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  const teacherContexts = [
    "/classrooms/cls_shell?section=notices",
    "/classrooms/cls_shell?section=files",
    "/classrooms/cls_shell?section=tasks",
    "/classrooms/cls_shell?section=discussion",
    "/classrooms/cls_shell/report"
  ];

  for (const path of teacherContexts) {
    await page.goto(path);
    await expect(page.getByTestId("app-shell-nav")).toBeVisible();
    await page.getByTestId("topbar-nav-classroom").click();
    await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=invite$/);
    await expect(page.getByTestId("dashboard-classroom-panel")).toHaveCount(0);
    await expect(page.getByTestId("classroom-section-nav")).toBeVisible();
    await expect(page.getByTestId("classroom-nav-invite")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("classroom-nav-weeks")).toBeVisible();
  }

  await page.getByTestId("app-brand").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("dashboard-classroom-panel")).toBeVisible();
});

test("classroom sidebar returns students to current classroom weeks", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page, studentUser);

  await page.goto("/classrooms/cls_shell?section=discussion");
  await expect(page.getByTestId("topbar-nav-chat")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("topbar-nav-classroom").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=weeks$/);
  await expect(page.getByTestId("classroom-section-nav")).toBeVisible();
  await expect(page.getByTestId("classroom-nav-weeks")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-nav-invite")).toHaveCount(0);

  await page.getByTestId("app-brand").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("dashboard-classroom-panel")).toBeVisible();
});

test("classroom sidebar preserves exam studio week context", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell/weeks/wk_shell_1/exam-studio");
  await expect(page.getByTestId("topbar-nav-tasks")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-classroom")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-section-nav")).toHaveCount(0);
  await page.getByTestId("topbar-nav-classroom").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=weeks&week=wk_shell_1$/);
  await expect(page.getByTestId("classroom-section-nav")).toBeVisible();
  await expect(page.getByTestId("classroom-nav-weeks")).toHaveAttribute("aria-current", "page");
});

test("profile disclosure owns account actions without a duplicate sidebar item", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/");
  await expect(page.getByTestId("app-shell-nav").getByText("내 계정")).toHaveCount(0);
  const disclosure = page.getByTestId("profile-disclosure");
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  const popover = page.getByTestId("profile-popover");
  await expect(popover).toBeVisible();
  await expect(page.getByTestId("profile-account-action")).toBeVisible();
  await expect(page.getByTestId("profile-menu-divider")).toHaveCount(1);
  await expect(page.getByTestId("profile-logout-action")).toBeVisible();
  await expect(page.getByTestId("profile-menu-arrow")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>("[data-testid='profile-disclosure']");
    const menu = document.querySelector<HTMLElement>("[data-testid='profile-popover']");
    const account = document.querySelector<HTMLElement>("[data-testid='profile-account-action']");
    const divider = document.querySelector<HTMLElement>("[data-testid='profile-menu-divider']");
    const logout = document.querySelector<HTMLElement>("[data-testid='profile-logout-action']");
    const arrow = document.querySelector<HTMLElement>("[data-testid='profile-menu-arrow']");
    if (!trigger || !menu || !account || !divider || !logout || !arrow) {
      throw new Error("profile menu probes are missing");
    }
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const accountRect = account.getBoundingClientRect();
    const dividerRect = divider.getBoundingClientRect();
    const logoutRect = logout.getBoundingClientRect();
    const arrowRect = arrow.getBoundingClientRect();
    const triggerStyle = getComputedStyle(trigger);
    const logoutStyle = getComputedStyle(logout);
    const colorChannels = (logoutStyle.color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      trigger: {
        top: triggerRect.top,
        left: triggerRect.left,
        width: triggerRect.width
      },
      menu: {
        x: menuRect.x,
        y: menuRect.y,
        width: menuRect.width,
        height: menuRect.height,
        bottom: menuRect.bottom,
        right: menuRect.right
      },
      accountBottom: accountRect.bottom,
      dividerCenterY: dividerRect.top + dividerRect.height / 2,
      logoutTop: logoutRect.top,
      arrowCenterX: arrowRect.left + arrowRect.width / 2,
      triggerCenterX: triggerRect.left + triggerRect.width / 2,
      triggerBorderWidth: Number.parseFloat(triggerStyle.borderTopWidth),
      triggerBorderColor: triggerStyle.borderTopColor,
      logoutColorChannels: colorChannels
    };
  });
  expect(geometry.menu.bottom).toBeLessThan(geometry.trigger.top + 2);
  expect(geometry.menu.width).toBeGreaterThanOrEqual(240);
  expect(geometry.menu.x).toBeGreaterThanOrEqual(0);
  expect(geometry.menu.y).toBeGreaterThanOrEqual(0);
  expect(geometry.menu.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.menu.y + geometry.menu.height).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.triggerBorderWidth).toBeGreaterThanOrEqual(1);
  expect(geometry.triggerBorderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(geometry.dividerCenterY).toBeGreaterThan(geometry.accountBottom);
  expect(geometry.dividerCenterY).toBeLessThan(geometry.logoutTop);
  expect(geometry.logoutColorChannels[0]).toBeGreaterThan(geometry.logoutColorChannels[1]);
  expect(Math.abs(geometry.arrowCenterX - geometry.triggerCenterX)).toBeLessThanOrEqual(16);
  await page.screenshot({
    path: "test-results/profile-popover-desktop.png",
    clip: { x: 0, y: 0, width: 320, height: 820 },
    animations: "disabled"
  });
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(disclosure).toBeFocused();
});

test("profile popover stays anchored on a short desktop sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 560 });
  await mockShellData(page);

  await page.goto("/");
  const disclosure = page.getByTestId("profile-disclosure");
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".topbar-nav");
    const user = document.querySelector<HTMLElement>(".topbar-user");
    const trigger = document.querySelector<HTMLElement>("[data-testid='profile-disclosure']");
    const menu = document.querySelector<HTMLElement>("[data-testid='profile-popover']");
    if (!nav || !user || !trigger || !menu) {
      throw new Error("short sidebar probes are missing");
    }
    const navRect = nav.getBoundingClientRect();
    const userRect = user.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      navBottom: navRect.bottom,
      userTop: userRect.top,
      triggerTop: triggerRect.top,
      menuX: menuRect.x,
      menuY: menuRect.y,
      menuRight: menuRect.right,
      menuBottom: menuRect.bottom
    };
  });
  expect(geometry.navBottom).toBeLessThanOrEqual(geometry.userTop + 1);
  expect(geometry.menuBottom).toBeLessThan(geometry.triggerTop + 2);
  expect(geometry.menuX).toBeGreaterThanOrEqual(0);
  expect(geometry.menuY).toBeGreaterThanOrEqual(0);
  expect(geometry.menuRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.menuBottom).toBeLessThanOrEqual(geometry.viewportHeight);
});

test("profile popover keeps visible affordances in forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.emulateMedia({ forcedColors: "active" });
  await mockShellData(page);

  await page.goto("/");
  await page.getByTestId("profile-disclosure").click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  const affordances = await page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>("[data-testid='profile-disclosure']");
    const divider = document.querySelector<HTMLElement>("[data-testid='profile-menu-divider']");
    const arrow = document.querySelector<HTMLElement>("[data-testid='profile-menu-arrow']");
    const account = document.querySelector<HTMLElement>("[data-testid='profile-account-action']");
    const logout = document.querySelector<HTMLElement>("[data-testid='profile-logout-action']");
    if (!trigger || !divider || !arrow || !account || !logout) {
      throw new Error("forced-colors profile probes are missing");
    }
    const triggerStyle = getComputedStyle(trigger);
    const dividerStyle = getComputedStyle(divider);
    const arrowStyle = getComputedStyle(arrow);
    const accountStyle = getComputedStyle(account);
    const logoutStyle = getComputedStyle(logout);
    return {
      triggerOutlineWidth: Number.parseFloat(triggerStyle.outlineWidth),
      triggerBorderWidth: Number.parseFloat(triggerStyle.borderTopWidth),
      dividerHeight: divider.getBoundingClientRect().height,
      dividerBackground: dividerStyle.backgroundColor,
      arrowDisplay: arrowStyle.display,
      accountColor: accountStyle.color,
      logoutColor: logoutStyle.color,
      logoutBorderWidth: Number.parseFloat(logoutStyle.borderTopWidth)
    };
  });
  expect(Math.max(affordances.triggerOutlineWidth, affordances.triggerBorderWidth)).toBeGreaterThanOrEqual(1);
  expect(affordances.dividerHeight).toBeGreaterThanOrEqual(1);
  expect(affordances.dividerBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(affordances.arrowDisplay).toBe("none");
  expect(affordances.logoutBorderWidth).toBeGreaterThanOrEqual(1);
  expect(affordances.logoutColor).not.toBe(affordances.accountColor);
});

test("protected account page content is not hidden under the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "회원 정보 수정" })).toBeVisible();
  const geometry = await shellGeometry(page);
  expect(geometry.shellRight).toBeLessThan(geometry.contentLeft);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
});

test("protected workspace pages avoid the desktop sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  const routes = [
    { path: "/session/lec_shell", text: "세션을 열 수 없습니다." },
    { path: "/exams/exam_shell", testId: "exam-taking-page" },
    { path: "/exams/exam_shell/report", testId: "exam-report-page" },
    { path: "/classrooms/cls_shell/report", text: "학생별 역량 리포트" }
  ];

  for (const route of routes) {
    await page.goto(route.path);
    if (route.testId) {
      await expect(page.getByTestId(route.testId)).toBeVisible();
    } else {
      await expect(page.getByText(route.text!).first()).toBeVisible();
    }
    const geometry = await shellGeometry(page);
    expect(geometry.shellRight).toBeLessThan(geometry.contentLeft);
    expect(geometry.contentRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  }
});

test("contextual learning session keeps classroom weeks selected in the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto(contextualSessionPath);
  await expect(page.getByText("세션을 열 수 없습니다.").first()).toBeVisible();
  await expect(page.getByTestId("topbar-nav-classroom")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-section-nav")).toBeVisible();
  await expect(page.getByTestId("classroom-nav-weeks")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-files")).not.toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: "test-results/session-sidebar-context.png", fullPage: true });

  await page.getByTestId("topbar-nav-classroom").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=weeks&week=wk_shell_1$/);

  await page.goto(contextualSessionPath);
  await page.getByTestId("classroom-nav-weeks").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=weeks&week=wk_shell_1$/);

  await page.goto(contextualSessionPath);
  await page.getByTestId("topbar-nav-files").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_shell\?section=files$/);
  await expect(page.getByTestId("topbar-nav-files")).toHaveAttribute("aria-current", "page");
});

test("direct and malformed learning sessions do not masquerade as materials", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  const paths = [
    "/session/lec_shell",
    "/session/lec_shell?section=weeks&week=wk_shell_1",
    "/session/lec_shell?classroomId=&section=weeks&week=wk_shell_1",
    "/session/lec_shell?classroomId=bad%2Fid&section=weeks&week=wk_shell_1"
  ];

  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByText("세션을 열 수 없습니다.").first()).toBeVisible();
    await expect(page.getByTestId("topbar-nav-files")).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("topbar-nav-classroom")).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("classroom-section-nav")).toHaveCount(0);
  }

  await page.goto("/session/lec_shell?classroomId=cls_shell&section=files&week=wk_shell_1");
  await expect(page.getByText("세션을 열 수 없습니다.").first()).toBeVisible();
  await expect(page.getByTestId("topbar-nav-classroom")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-nav-weeks")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-files")).not.toHaveAttribute("aria-current", "page");
});

test("classroom learning start links carry session sidebar context", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell?section=weeks");
  await page.getByRole("button", { name: "1주차. 사용자 경험의 이해" }).click();
  const startLink = page.getByRole("link", { name: "학습 시작" });
  await expect(startLink).toHaveAttribute(
    "href",
    /\/session\/lec_shell\?classroomId=cls_shell&section=weeks&week=wk_shell_1$/
  );
});

test("contextual session auth redirects preserve the full next url", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "unauthorized" })
    })
  );

  await page.goto(contextualSessionPath);
  await expect(page).toHaveURL(/\/login\?next=/);
  await expectNextParam(page, contextualSessionPath);
});

test("classroom section auth redirects preserve the full next url", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);
  let authMeRequests = 0;
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => {
    authMeRequests += 1;
    if (authMeRequests === 1) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { user: teacherUser } })
      });
    }
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "unauthorized" })
    });
  });
  await page.unroute("**/api/classrooms/cls_shell/weeks");
  await page.route("**/api/classrooms/cls_shell/weeks", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "강의실 인증 만료" })
    })
  );

  const targetPath = "/classrooms/cls_shell?section=files#materials";
  await page.goto(targetPath);
  await expect(page).toHaveURL(/\/login\?next=/);
  await expectNextParam(page, targetPath);
  expect(authMeRequests).toBeGreaterThanOrEqual(2);
});

test("classroom section verification redirects preserve the full next url", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);
  let authMeRequests = 0;
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => {
    authMeRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          user: authMeRequests === 1 ? teacherUser : { ...teacherUser, emailVerified: false }
        }
      })
    });
  });
  await page.unroute("**/api/classrooms/cls_shell/weeks");
  await page.route("**/api/classrooms/cls_shell/weeks", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "이메일 인증이 필요합니다.", code: "EMAIL_NOT_VERIFIED" })
    })
  );

  const targetPath = "/classrooms/cls_shell?section=files#materials";
  await page.goto(targetPath);
  await expect(page).toHaveURL(/\/verify-email\?next=/);
  await expectNextParam(page, targetPath);
  expect(authMeRequests).toBeGreaterThanOrEqual(2);
});

test("contextual session verification redirects preserve the full next url", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { user: { ...teacherUser, emailVerified: false } }
      })
    })
  );

  await page.goto(contextualSessionPath);
  await expect(page).toHaveURL(/\/verify-email\?next=/);
  await expectNextParam(page, contextualSessionPath);
});

test("contextual session bootstrap 401 preserves the full next url", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);
  let authMeRequests = 0;
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => {
    authMeRequests += 1;
    if (authMeRequests === 1) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { user: teacherUser } })
      });
    }
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "unauthorized" })
    });
  });
  await page.unroute("**/api/session/by-lecture/lec_shell");
  await page.route("**/api/session/by-lecture/lec_shell", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "세션 인증 만료" })
    })
  );

  await page.goto(contextualSessionPath);
  await expect(page).toHaveURL(/\/login\?next=/);
  await expectNextParam(page, contextualSessionPath);
  expect(authMeRequests).toBeGreaterThanOrEqual(2);
});

test("contextual session bootstrap email verification preserves the full next url", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);
  let authMeRequests = 0;
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => {
    authMeRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          user: authMeRequests === 1 ? teacherUser : { ...teacherUser, emailVerified: false }
        }
      })
    });
  });
  await page.unroute("**/api/session/by-lecture/lec_shell");
  await page.route("**/api/session/by-lecture/lec_shell", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "이메일 인증이 필요합니다.", code: "EMAIL_NOT_VERIFIED" })
    })
  );

  await page.goto(contextualSessionPath);
  await expect(page).toHaveURL(/\/verify-email\?next=/);
  await expectNextParam(page, contextualSessionPath);
  expect(authMeRequests).toBeGreaterThanOrEqual(2);
});

test("contextual session event 401 preserves the full next url", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);
  await mockShellSessionSuccess(page);
  await mockShellSessionEventFailure(page, 401);

  await page.goto(contextualSessionPath);
  await expect(page.getByLabel("질문 또는 요청")).toBeVisible();
  await page.screenshot({ path: "test-results/session-sidebar-context-active.png", fullPage: true });
  let refreshRequests = 0;
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => {
    refreshRequests += 1;
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "unauthorized" })
    });
  });
  const eventRequest = page.waitForRequest("**/api/session/ses_shell/event/stream");
  await page.getByLabel("질문 또는 요청").fill("다음 설명을 도와줘");
  await page.getByRole("button", { name: "전송" }).click();
  await eventRequest;
  await expect(page).toHaveURL(/\/login\?next=/);
  await expectNextParam(page, contextualSessionPath);
  expect(refreshRequests).toBeGreaterThanOrEqual(1);
});

test("contextual session event email verification preserves the full next url", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);
  await mockShellSessionSuccess(page);
  await mockShellSessionEventFailure(page, 403, "EMAIL_NOT_VERIFIED");

  await page.goto(contextualSessionPath);
  await expect(page.getByLabel("질문 또는 요청")).toBeVisible();
  let refreshRequests = 0;
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => {
    refreshRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { user: { ...teacherUser, emailVerified: false } }
      })
    });
  });
  const eventRequest = page.waitForRequest("**/api/session/ses_shell/event/stream");
  await page.getByLabel("질문 또는 요청").fill("다음 설명을 도와줘");
  await page.getByRole("button", { name: "전송" }).click();
  await eventRequest;
  await expect(page).toHaveURL(/\/verify-email\?next=/);
  await expectNextParam(page, contextualSessionPath);
  expect(refreshRequests).toBeGreaterThanOrEqual(1);
});

test("classroom report exposes report sections under the grades sidebar group", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell/report");
  await expect(page.getByText("학생별 역량 리포트").first()).toBeVisible();
  await expect(page.getByTestId("classroom-section-nav")).toHaveCount(0);
  await expect(page.getByTestId("topbar-nav-classroom")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-grades")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("app-shell-nav").getByTestId("report-section-nav")).toBeVisible();
  await expect(page.getByTestId("app-shell-content").getByTestId("report-section-nav")).toHaveCount(0);
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("report-nav-students").click();
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.locator(".report-student-panel")).toBeVisible();
});

test("student account does not receive teacher report section shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page, studentUser);

  await page.goto("/classrooms/cls_shell/report");
  await expect(page.getByText("이 기능을 사용할 권한이 없습니다.")).toBeVisible();
  await expect(page.getByTestId("topbar-nav-grades")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("report-section-nav")).toHaveCount(0);
  await expect(page.getByTestId("report-nav-students")).toHaveCount(0);
  await expect(page.getByTestId("report-nav-criteria")).toHaveCount(0);
  await expect(page.getByTestId("report-nav-content")).toHaveCount(0);
});

test("exam report keeps the grades sidebar item without classroom subnav", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/exams/exam_shell/report");
  await expect(page.getByTestId("exam-report-page")).toBeVisible();
  await expect(page.getByTestId("topbar-nav-grades")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-tasks")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-section-nav")).toHaveCount(0);
  await expect(page.getByTestId("report-section-nav")).toHaveCount(0);
});

test("modal backdrop layers above sidebar and classroom local navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockShellData(page);

  await page.goto("/classrooms/cls_shell");
  await page.getByTestId("profile-disclosure").click();
  const profileZIndex = await page.getByTestId("profile-popover").evaluate((element) =>
    Number.parseInt(getComputedStyle(element).zIndex, 10)
  );
  await page.keyboard.press("Escape");
  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByRole("button", { name: "1주차. 사용자 경험의 이해" }).click();
  await page.getByRole("button", { name: "세부 강의 추가" }).click();
  await expect(page.getByRole("dialog", { name: "강의 자료 업로드" })).toBeVisible();

  const layers = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-testid='app-shell-nav']");
    const localNav = document.querySelector<HTMLElement>("[data-testid='classroom-section-nav']");
    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop");
    if (!shell || !localNav || !backdrop) {
      throw new Error("layer probes are missing");
    }
    return {
      shell: Number.parseInt(getComputedStyle(shell).zIndex, 10),
      localNav: Number.parseInt(getComputedStyle(localNav).zIndex, 10),
      backdrop: Number.parseInt(getComputedStyle(backdrop).zIndex, 10)
    };
  });

  expect(layers.backdrop).toBeGreaterThan(layers.shell);
  expect(layers.backdrop).toBeGreaterThan(layers.localNav);
  expect(layers.backdrop).toBeGreaterThan(profileZIndex);
});
