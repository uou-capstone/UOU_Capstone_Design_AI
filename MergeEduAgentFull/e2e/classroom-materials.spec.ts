import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const now = "2026-05-03T00:00:00.000Z";
const teacherUser = {
  id: "usr_materials_teacher",
  email: "materials.teacher@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "2468",
  emailVerified: true,
  hasPassword: true
};
const studentUser = {
  id: "usr_materials_student",
  email: "materials.student@example.com",
  displayName: "테스트 학생",
  role: "student",
  inviteCode: "1357",
  emailVerified: true,
  hasPassword: true
};
const weeks = Array.from({ length: 4 }, (_, index) => ({
  id: `wk_materials_${index + 1}`,
  classroomId: "cls_materials",
  weekIndex: index + 1,
  title: `${index + 1}주차`,
  createdAt: now,
  updatedAt: now
}));
const seedLectures = [
  ["lec_materials_1", "wk_materials_1", "MergeAISystem 가이드 테스트 자료", 13, "2024-05-14T00:00:00.000Z"],
  ["lec_materials_2", "wk_materials_1", "또 다른것", 6, "2024-05-14T01:00:00.000Z"],
  ["lec_materials_3", "wk_materials_2", "Transformer 기초 정리", 18, "2024-05-16T00:00:00.000Z"],
  ["lec_materials_4", "wk_materials_2", "선형대수 복습 자료", 11, "2024-05-16T01:00:00.000Z"],
  ["lec_materials_5", "wk_materials_3", "확률과 통계 보충 자료", 14, "2024-05-20T00:00:00.000Z"],
  ["lec_materials_6", "wk_materials_3", "중간고사 대비 요약본", 9, "2024-05-20T01:00:00.000Z"],
  ["lec_materials_7", "wk_materials_4", "생성모델 세미나 자료", 21, "2024-05-27T00:00:00.000Z"],
  ["lec_materials_8", "wk_materials_4", "기말 프로젝트 안내문", 7, "2024-05-27T01:00:00.000Z"]
].map(([id, weekId, title, pages, createdAt]) => ({
  id,
  weekId,
  title,
  pdf: {
    path: `/mock/${id}.pdf`,
    numPages: pages,
    pageIndexPath: `/mock/${id}.pageIndex.json`,
    geminiFile: { fileName: `${id}.pdf`, fileUri: `mock://${id}`, mimeType: "application/pdf" }
  },
  createdAt,
  updatedAt: createdAt
}));

type LectureMock = typeof seedLectures[number];

type MaterialsMockOptions = {
  materialFailuresBeforeSuccess?: number;
  patchFailure?: boolean;
  holdFirstMaterialsRequest?: boolean;
  holdDeleteRequest?: boolean;
};

async function mockMaterialsData(
  page: Page,
  user = teacherUser,
  options: MaterialsMockOptions = {}
) {
  let materialsRequests = 0;
  let releaseFirstMaterialsRequest: (() => void) | undefined;
  let releaseDeleteRequest: (() => void) | undefined;
  const firstMaterialsGate = new Promise<void>((resolve) => {
    releaseFirstMaterialsRequest = resolve;
  });
  const deleteGate = new Promise<void>((resolve) => {
    releaseDeleteRequest = resolve;
  });
  const state = {
    lectures: seedLectures.map((lecture) => ({ ...lecture, pdf: { ...lecture.pdf } }))
  };
  const materialRows = () =>
    weeks.flatMap((week) =>
      state.lectures
        .filter((lecture) => lecture.weekId === week.id)
        .map((lecture) => ({ lecture, week }))
    );

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
  await page.route("**/api/classrooms/cls_materials/weeks", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: weeks })
    })
  );
  await page.route("**/api/classrooms/cls_materials/materials", async (route) => {
    materialsRequests += 1;
    if (options.holdFirstMaterialsRequest && materialsRequests === 1) {
      await firstMaterialsGate;
    }
    if (materialsRequests <= (options.materialFailuresBeforeSuccess ?? 0)) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "자료실 로딩 실패" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: materialRows() })
    });
  });
  await page.route("**/api/classrooms/cls_materials/students", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route("**/api/classrooms/cls_materials/invitations", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  for (const week of weeks) {
    await page.route(`**/api/weeks/${week.id}/lectures`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: state.lectures.filter((lecture) => lecture.weekId === week.id)
        })
      })
    );
    await page.route(`**/api/weeks/${week.id}/exams`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
    );
  }
  await page.route("**/api/lectures/*/download", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "content-disposition": "attachment; filename=\"material.pdf\"" },
      body: "%PDF-1.4\n"
    })
  );
  await page.route("**/api/lectures/*", async (route) => {
    const request = route.request();
    const lectureId = new URL(request.url()).pathname.split("/").at(-1)!;
    if (request.method() === "PATCH") {
      if (user.role !== "teacher") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Teacher role required" })
        });
      }
      const body = request.postDataJSON() as { title?: string };
      const target = state.lectures.find((lecture) => lecture.id === lectureId);
      if (!target) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Lecture not found" })
        });
      }
      if (options.patchFailure) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "자료 이름 수정 실패" })
        });
      }
      target.title = String(body.title ?? target.title);
      target.updatedAt = "2026-05-03T09:00:00.000Z";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: target })
      });
    }
    if (request.method() === "DELETE") {
      if (user.role !== "teacher") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Teacher role required" })
        });
      }
      if (options.holdDeleteRequest) {
        await deleteGate;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "자료 삭제 실패" })
        });
      }
      state.lectures = state.lectures.filter((lecture) => lecture.id !== lectureId);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      });
    }
    return route.continue();
  });

  return {
    state,
    releaseFirstMaterialsRequest: () => releaseFirstMaterialsRequest?.(),
    releaseDeleteRequest: () => releaseDeleteRequest?.()
  };
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

test("teacher opens classroom materials, filters, sorts, renames, deletes, and sees week sync", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockMaterialsData(page);

  await page.goto("/classrooms/cls_materials?section=weeks");
  await page.getByTestId("topbar-nav-files").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_materials\?section=files$/);
  await expect(page.getByTestId("topbar-nav-files")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-classroom")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "자료실" })).toBeVisible();
  await expect(page.getByRole("button", { name: /자료 업로드/ })).toHaveCount(0);
  await expect(page.getByText("전체 자료").locator("..")).toContainText("8개");
  await expect(page.getByText("PDF 파일").locator("..")).toContainText("8개");
  await expect(page.getByTestId("classroom-material-row")).toHaveCount(8);
  await expect(page.getByTestId("classroom-material-row").first()).toContainText("MergeAISystem 가이드 테스트 자료");
  await expectNoHorizontalOverflow(page);
  await finishAnimations(page);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-materials-desktop.png", fullPage: true });

  await page.getByLabel("파일명으로 검색").fill("Transformer");
  await expect(page.getByTestId("classroom-material-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-material-row").first()).toContainText("Transformer 기초 정리");

  await page.getByLabel("파일명으로 검색").fill("");
  await page.getByLabel("주차 필터").selectOption("wk_materials_2");
  await expect(page.getByTestId("classroom-material-row")).toHaveCount(2);
  await expect(page.getByTestId("classroom-material-row").first()).toContainText("Transformer 기초 정리");

  await page.getByLabel("주차 필터").selectOption("all");
  await page.getByLabel("정렬").selectOption("newest");
  await expect(page.getByTestId("classroom-material-row").first()).toContainText("기말 프로젝트 안내문");

  const targetRow = page.getByTestId("classroom-material-row").filter({ hasText: "또 다른것" });
  await targetRow.getByTestId("classroom-material-menu-trigger").click();
  await page.getByRole("button", { name: "자료 이름 수정" }).click();
  await page.getByTestId("classroom-material-rename-dialog").getByRole("textbox").fill("또 다른것 수정본");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByTestId("classroom-material-row").filter({ hasText: "또 다른것 수정본" })).toHaveCount(1);

  const renamedRow = page.getByTestId("classroom-material-row").filter({ hasText: "또 다른것 수정본" });
  await expect(renamedRow.getByLabel("또 다른것 수정본 다운로드")).toHaveAttribute(
    "href",
    /\/api\/lectures\/lec_materials_2\/download$/
  );
  page.once("dialog", (dialog) => dialog.accept());
  await renamedRow.getByTestId("classroom-material-menu-trigger").click();
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByTestId("classroom-material-row").filter({ hasText: "또 다른것 수정본" })).toHaveCount(0);

  await page.getByTestId("classroom-nav-weeks").click();
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await expect(page.locator(".week-card.expanded")).not.toContainText("또 다른것 수정본");
  await expect(page.locator(".week-card.expanded").locator(".lecture-row")).toHaveCount(1);

  await expectNoHorizontalOverflow(page);
});

test("student sees materials read-only and mobile layout stays inside viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMaterialsData(page, studentUser);

  await page.goto("/classrooms/cls_materials?section=files");
  await expect(page.getByTestId("topbar-nav-files")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-material-row")).toHaveCount(8);
  await expect(page.getByTestId("classroom-material-menu-trigger")).toHaveCount(0);
  await expect(page.getByLabel("MergeAISystem 가이드 테스트 자료 다운로드")).toHaveAttribute(
    "href",
    /\/api\/lectures\/lec_materials_1\/download$/
  );
  await expectNoHorizontalOverflow(page);
  await finishAnimations(page);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-materials-mobile.png", fullPage: true });
});

test("materials recovers from load failure and ignores stale responses after leaving the section", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await mockMaterialsData(page, teacherUser, { materialFailuresBeforeSuccess: 1 });

  await page.goto("/classrooms/cls_materials?section=files");
  await expect(page.getByTestId("classroom-materials-error")).toContainText("자료실 로딩 실패");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByTestId("classroom-material-row")).toHaveCount(8);

  await page.unroute("**/api/classrooms/cls_materials/materials");
  const held = await mockMaterialsData(page, teacherUser, { holdFirstMaterialsRequest: true });
  await page.goto("/classrooms/cls_materials?section=files");
  await expect(page.getByTestId("classroom-materials-loading")).toBeVisible();
  await page.getByTestId("classroom-nav-weeks").click();
  await expect(page.getByTestId("classroom-week-timeline")).toBeVisible();
  held.releaseFirstMaterialsRequest();
  await page.waitForTimeout(100);
  await expect(page.getByTestId("classroom-material-row")).toHaveCount(0);
});

test("materials keeps failed rename and delete recoverable without mutating rows", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  const mock = await mockMaterialsData(page, teacherUser, { patchFailure: true, holdDeleteRequest: true });

  await page.goto("/classrooms/cls_materials?section=files");
  const targetRow = page.getByTestId("classroom-material-row").filter({ hasText: "또 다른것" });
  await targetRow.getByTestId("classroom-material-menu-trigger").click();
  await page.getByRole("button", { name: "자료 이름 수정" }).click();
  await page.getByTestId("classroom-material-rename-dialog").getByRole("textbox").fill("실패한 수정명");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByTestId("classroom-material-rename-dialog")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("자료 이름 수정 실패");
  await expect(page.getByTestId("classroom-material-row").filter({ hasText: "실패한 수정명" })).toHaveCount(0);
  await page.getByRole("button", { name: "취소" }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await targetRow.getByTestId("classroom-material-menu-trigger").click();
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByRole("button", { name: "자료 이름 수정" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "삭제" })).toBeDisabled();
  mock.releaseDeleteRequest();
  await expect(page.getByRole("alert")).toContainText("자료 삭제 실패");
  await expect(page.getByTestId("classroom-material-row").filter({ hasText: "또 다른것" })).toHaveCount(1);
});
