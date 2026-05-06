import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const teacherUser = {
  id: "usr_teacher_nav",
  email: "teacher.nav@example.com",
  displayName: "Navigation Teacher",
  role: "teacher",
  inviteCode: "1234",
  emailVerified: true,
  hasPassword: true
};

const studentUser = {
  id: "usr_student_nav",
  email: "student.nav@example.com",
  displayName: "Navigation Student",
  role: "student",
  inviteCode: "5678",
  emailVerified: true,
  hasPassword: true
};

const weeks = [
  {
    id: "wk_nav_1",
    classroomId: "cls_nav",
    weekIndex: 1,
    title: "1주차",
    createdAt: new Date().toISOString()
  }
];

async function mockClassroomPage(
  page: Page,
  role: "teacher" | "student",
  options?: { studentsShouldFail?: boolean }
) {
  let studentsRequestCount = 0;
  let studentsShouldFail = Boolean(options?.studentsShouldFail);

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          user: role === "teacher" ? teacherUser : studentUser
        }
      })
    });
  });

  await page.route("**/api/classrooms/cls_nav/weeks", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: weeks })
    });
  });

  await page.route("**/api/classrooms/cls_nav/students", async (route) => {
    studentsRequestCount += 1;
    if (studentsShouldFail) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "학생 목록 실패" })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          {
            id: "usr_invited_1",
            displayName: "초대 학생",
            inviteCode: "2468",
            maskedEmail: "student***@example.com",
            enrolledAt: "2026-05-02T10:40:00.000Z"
          }
        ]
      })
    });
  });

  await page.route("**/api/classrooms/cls_nav/invitations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          {
            id: "inv_nav_1",
            classroomId: "cls_nav",
            classroomTitle: "Navigation Class",
            teacherDisplayName: "Navigation Teacher",
            student: {
              id: "usr_invited_1",
              displayName: "초대 학생",
              inviteCode: "2468",
              maskedEmail: "student***@example.com"
            },
            status: "ACCEPTED",
            invitedAt: "2026-05-02T10:32:00.000Z",
            updatedAt: "2026-05-02T10:40:00.000Z",
            acceptedAt: "2026-05-02T10:40:00.000Z"
          }
        ]
      })
    });
  });

  await page.route("**/api/weeks/wk_nav_1/lectures", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    });
  });

  await page.route("**/api/weeks/wk_nav_1/exams", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    });
  });

  await page.route("**/api/classrooms/cls_nav/report/students", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    });
  });

  await page.route("**/api/classrooms/cls_nav/report/criteria**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    });
  });

  return {
    getStudentsRequestCount: () => studentsRequestCount,
    allowStudents: () => {
      studentsShouldFail = false;
    }
  };
}

test("teacher classroom uses local navigation sections", async ({ page }) => {
  const state = await mockClassroomPage(page, "teacher");

  await page.goto("/classrooms/cls_nav");
  await expect(page.getByTestId("classroom-hero").getByRole("heading", { name: "학생 초대" })).toBeVisible();

  const inviteNav = page.getByTestId("classroom-nav-invite");
  const weeksNav = page.getByTestId("classroom-nav-weeks");

  await expect(inviteNav).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-nav-report")).toHaveCount(0);
  await expect(page.getByTestId("classroom-invite-panel")).toBeVisible();
  await expect(page.getByLabel("4자리 코드")).toBeVisible();
  await expect(page.getByTestId("classroom-week-timeline")).toHaveCount(0);
  await expect(page.getByTestId("classroom-report-entry")).toHaveCount(0);
  await expect(page.getByTestId("joined-students-card").getByText("초대 학생")).toBeVisible();
  await expect(page.getByTestId("invitation-history-table").getByText("2468")).toBeVisible();
  const studentsRequestCountOnInvite = state.getStudentsRequestCount();
  expect(studentsRequestCountOnInvite).toBeGreaterThanOrEqual(1);

  await weeksNav.click();
  await expect(weeksNav).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-invite-panel")).toHaveCount(0);
  await expect(page.getByTestId("classroom-week-timeline")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 주차 추가" })).toBeVisible();
  expect(state.getStudentsRequestCount()).toBe(studentsRequestCountOnInvite);

  await page.getByTestId("classroom-week-menu-trigger").click();
  await expect(page.getByTestId("classroom-week-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("classroom-week-menu")).toHaveCount(0);

  await page.getByTestId("classroom-week-menu-trigger").click();
  await expect(page.getByTestId("classroom-week-menu")).toBeVisible();
  await page.getByTestId("classroom-section-panel").click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("classroom-week-menu")).toHaveCount(0);

  await page.getByRole("button", { name: "선택 주차 삭제" }).click();
  await expect(page.getByTestId("classroom-selection-banner")).toBeVisible();

  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByRole("button", { name: "세부 강의 추가" }).click();
  await expect(page.getByRole("dialog", { name: "강의 자료 업로드" })).toBeVisible();
  await page.getByLabel("강의 이름").fill("임시 자료");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "강의 자료 업로드" })).toHaveCount(0);

  await page.getByTestId("topbar-nav-grades").click();
  await expect(page.getByRole("dialog", { name: "강의 자료 업로드" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/classrooms\/cls_nav\/report$/);
  await expect(page.getByTestId("topbar-nav-grades")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("학생별 역량 리포트").first()).toBeVisible();
  await expect(page.getByTestId("classroom-week-timeline")).toHaveCount(0);
  await expect(page.getByTestId("classroom-invite-panel")).toHaveCount(0);
  expect(state.getStudentsRequestCount()).toBe(studentsRequestCountOnInvite);

  await page.getByRole("link", { name: "강의실로 돌아가기" }).click();
  await weeksNav.click();
  await expect(page).toHaveURL(/\/classrooms\/cls_nav\?section=weeks$/);
  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByRole("button", { name: "세부 강의 추가" }).click();
  await expect(page.getByLabel("강의 이름")).toHaveValue("");
});

test("invite list failure shows retry instead of empty state", async ({ page }) => {
  const state = await mockClassroomPage(page, "teacher", { studentsShouldFail: true });

  await page.goto("/classrooms/cls_nav");
  await expect(page.getByTestId("classroom-invite-panel")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("학생 목록 실패");
  await expect(page.getByText("아직 초대된 학생이 없습니다.")).toHaveCount(0);

  state.allowStudents();
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByTestId("joined-students-card").getByText("초대 학생")).toBeVisible();
  expect(state.getStudentsRequestCount()).toBeGreaterThanOrEqual(2);
});

test("student classroom stays focused on weeks and hides teacher sections", async ({ page }) => {
  await mockClassroomPage(page, "student");

  await page.goto("/classrooms/cls_nav");
  await expect(page.getByRole("heading", { name: "강의실 학습 공간" })).toBeVisible();
  await expect(page.getByTestId("classroom-nav-weeks")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("classroom-nav-invite")).toHaveCount(0);
  await expect(page.getByTestId("classroom-nav-report")).toHaveCount(0);
  await expect(page.getByTestId("classroom-week-timeline")).toBeVisible();
  await expect(page.getByText("학생 초대")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ 주차 추가" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "선택 주차 삭제" })).toHaveCount(0);
});

test("classroom local navigation fits mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockClassroomPage(page, "teacher");

  await page.goto("/classrooms/cls_nav");
  await expect(page.getByTestId("classroom-section-nav")).toBeHidden();
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-classroom-section-nav")).toBeVisible();
  await page.getByTestId("mobile-classroom-nav-weeks").click();
  await expect(page.getByTestId("classroom-week-timeline")).toBeVisible();

  await page.getByTestId("classroom-week-timeline").getByRole("button", { name: "1주차" }).click();
  await page.getByRole("button", { name: "세부 강의 추가" }).click();
  await expect(page.getByRole("dialog", { name: "강의 자료 업로드" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "강의 자료 업로드" })).toHaveCount(0);
  await page.getByTestId("mobile-nav-open").click();
  await page.getByTestId("mobile-nav-grades").click();
  await expect(page.getByRole("dialog", { name: "강의 자료 업로드" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/classrooms\/cls_nav\/report$/);
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-report-nav-content")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "강의실로 돌아가기" }).click();
  await page.getByTestId("mobile-nav-open").click();
  await page.getByTestId("mobile-classroom-nav-weeks").click();
  await expect(page.getByTestId("classroom-week-timeline")).toBeVisible();

  const fitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(fitsViewport).toBe(true);

  await page.getByTestId("mobile-nav-open").click();
  for (const testId of ["mobile-classroom-section-nav", "classroom-section-panel"]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
});
