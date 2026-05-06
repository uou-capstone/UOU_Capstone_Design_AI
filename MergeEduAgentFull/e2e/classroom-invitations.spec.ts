import { expect, test, type Page } from "@playwright/test";

const teacherUser = {
  id: "usr_teacher_invite_visual",
  email: "teacher.invite.visual@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "1111",
  emailVerified: true,
  hasPassword: true
};

const studentUser = {
  id: "usr_student_invite_visual",
  email: "student.invite.visual@example.com",
  displayName: "테스트 학생",
  role: "student",
  inviteCode: "2468",
  emailVerified: true,
  hasPassword: true
};

const acceptedStudents = [
  ["stu_1", "김민준", "1234", "2026-05-02T10:40:00.000Z"],
  ["stu_2", "이서연", "2048", "2026-05-02T10:33:00.000Z"],
  ["stu_3", "박지후", "7781", "2026-05-01T09:22:00.000Z"]
].map(([id, displayName, inviteCode, enrolledAt]) => ({
  id,
  displayName,
  inviteCode,
  maskedEmail: `${displayName.slice(0, 1)}***@example.com`,
  enrolledAt
}));

const invitations = [
  ...acceptedStudents.map((student, index) => ({
    id: `inv_accepted_${index}`,
    classroomId: "cls_invite_visual",
    classroomTitle: "UX/UI 디자인 입문",
    teacherDisplayName: "테스트 선생님",
    student: {
      id: student.id,
      displayName: student.displayName,
      inviteCode: student.inviteCode,
      maskedEmail: student.maskedEmail
    },
    status: "ACCEPTED",
    invitedAt: "2026-05-02T10:18:00.000Z",
    updatedAt: student.enrolledAt,
    acceptedAt: student.enrolledAt
  })),
  {
    id: "inv_pending_1",
    classroomId: "cls_invite_visual",
    classroomTitle: "UX/UI 디자인 입문",
    teacherDisplayName: "테스트 선생님",
    student: {
      id: "stu_pending_1",
      displayName: "한예린",
      inviteCode: "4482",
      maskedEmail: "한***@example.com"
    },
    status: "PENDING",
    invitedAt: "2026-05-02T11:05:00.000Z",
    updatedAt: "2026-05-02T11:05:00.000Z"
  }
];

async function mockTeacherInvitePage(page: Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { user: teacherUser } })
    })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "mocked" })
    })
  );
  await page.route("**/api/classrooms/cls_invite_visual/weeks", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route("**/api/classrooms/cls_invite_visual/students", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: acceptedStudents }) })
  );
  await page.route("**/api/classrooms/cls_invite_visual/invitations", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: invitations }) })
  );
}

test("teacher invite section matches the EduPilot invitation layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await mockTeacherInvitePage(page);

  await page.goto("/classrooms/cls_invite_visual");
  const panel = page.getByTestId("classroom-invite-panel");
  await expect(page.getByTestId("classroom-hero").getByRole("heading", { name: "학생 초대" })).toBeVisible();
  await expect(page.getByTestId("invite-form-card")).toBeVisible();
  await expect(page.getByTestId("joined-students-card")).toBeVisible();
  await expect(page.getByTestId("invitation-history-table")).toBeVisible();
  await panel.screenshot({ path: "test-results/classroom-invite-redesign.png" });

  await page.getByTestId("joined-students-card").getByRole("button", { name: "전체 보기" }).click();
  await expect(page.getByTestId("joined-students-full-view")).toBeVisible();
  await expect(page.getByTestId("joined-students-full-view").getByText("김민준")).toBeVisible();
  await page.getByRole("button", { name: "돌아가기" }).click();

  await page.getByTestId("invitation-history-card").getByRole("button", { name: "전체 보기" }).click();
  await expect(page.getByTestId("invitation-history-full-view")).toBeVisible();
  await expect(page.getByTestId("invitation-history-full-view").getByText("초대 완료")).toBeVisible();
  await page.getByRole("button", { name: "돌아가기" }).click();
});

test("teacher invite section expands across a wide classroom workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1980, height: 1120 });
  await mockTeacherInvitePage(page);

  await page.goto("/classrooms/cls_invite_visual");
  const panel = page.getByTestId("classroom-invite-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("invite-form-card")).toBeVisible();
  await expect(page.getByTestId("joined-students-card")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);

  const panelBox = await panel.boundingBox();
  const formBox = await page.getByTestId("invite-form-card").boundingBox();
  const joinedBox = await page.getByTestId("joined-students-card").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(joinedBox).not.toBeNull();

  const viewportWidth = page.viewportSize()?.width ?? 1980;
  const availableWorkspaceWidth = viewportWidth - 230;
  expect(panelBox!.x + panelBox!.width).toBeGreaterThanOrEqual(viewportWidth - 80);
  expect(panelBox!.width).toBeGreaterThanOrEqual(availableWorkspaceWidth * 0.85);
  expect(Math.abs(formBox!.y - joinedBox!.y)).toBeLessThanOrEqual(24);
  expect(formBox!.width).toBeGreaterThanOrEqual(420);
  expect(joinedBox!.width).toBeGreaterThanOrEqual(420);

  await panel.screenshot({ path: "test-results/classroom-invite-wide.png" });
});

test("teacher invite section stays contained in the narrow desktop sidebar range", async ({ page }) => {
  await page.setViewportSize({ width: 1060, height: 900 });
  await mockTeacherInvitePage(page);

  await page.goto("/classrooms/cls_invite_visual");
  const panel = page.getByTestId("classroom-invite-panel");
  const hero = page.getByTestId("classroom-hero");
  const historyCard = page.getByTestId("invitation-history-card");
  const historyTable = page.getByTestId("invitation-history-table");
  await expect(panel).toBeVisible();
  await expect(historyTable).toBeVisible();
  await expect(page.locator(".invitation-history-head")).toBeHidden();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);

  const heroBox = await hero.boundingBox();
  const metricsBox = await page.locator(".invite-hero-metrics").boundingBox();
  const historyBox = await historyCard.boundingBox();
  const tableBox = await historyTable.boundingBox();
  expect(heroBox).not.toBeNull();
  expect(metricsBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(tableBox).not.toBeNull();

  expect(metricsBox!.x + metricsBox!.width).toBeLessThanOrEqual(heroBox!.x + heroBox!.width + 2);
  expect(metricsBox!.width).toBeLessThanOrEqual(heroBox!.width);
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(historyBox!.x + historyBox!.width + 2);

  await panel.screenshot({ path: "test-results/classroom-invite-narrow-desktop.png" });
});

test("teacher invite history stays compact at the desktop sidebar edge", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 900 });
  await mockTeacherInvitePage(page);

  await page.goto("/classrooms/cls_invite_visual");
  const historyCard = page.getByTestId("invitation-history-card");
  const historyTable = page.getByTestId("invitation-history-table");
  await expect(historyCard).toBeVisible();
  await expect(historyTable).toBeVisible();
  await expect(page.locator(".invitation-history-head")).toBeHidden();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);

  const historyBox = await historyCard.boundingBox();
  const tableBox = await historyTable.boundingBox();
  expect(historyBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(historyBox!.x + historyBox!.width + 2);

  await page.getByTestId("classroom-invite-panel").screenshot({ path: "test-results/classroom-invite-sidebar-edge.png" });
});

test("student dashboard keeps invitation acceptance inside the classroom selection panel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let accepted = false;
  const pendingInvitation = {
    id: "inv_student_pending",
    classroomId: "cls_student_pending",
    classroomTitle: "UX/UI 디자인 입문",
    teacherDisplayName: "테스트 선생님",
    student: {
      id: studentUser.id,
      displayName: studentUser.displayName,
      inviteCode: studentUser.inviteCode,
      maskedEmail: "st***@example.com"
    },
    status: "PENDING",
    invitedAt: "2026-05-02T11:20:00.000Z",
    updatedAt: "2026-05-02T11:20:00.000Z"
  };
  const acceptedClassroom = {
    id: "cls_student_pending",
    title: "UX/UI 디자인 입문",
    ownerUserId: teacherUser.id,
    inviteCode: "9753",
    createdAt: "2026-05-02T11:20:00.000Z",
    updatedAt: "2026-05-02T11:20:00.000Z"
  };
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
      body: JSON.stringify({ ok: false, error: "mocked" })
    })
  );
  await page.route("**/api/classrooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: accepted ? [acceptedClassroom] : [] })
    })
  );
  await page.route("**/api/students/invitations", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: accepted ? [] : [pendingInvitation]
      })
    })
  );
  await page.route("**/api/students/invitations/inv_student_pending/accept", (route) => {
    accepted = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          ...pendingInvitation,
          status: "ACCEPTED",
          acceptedAt: "2026-05-02T11:25:00.000Z",
          updatedAt: "2026-05-02T11:25:00.000Z"
        }
      })
    });
  });

  await page.goto("/");
  const panel = page.getByTestId("dashboard-classroom-panel");
  const inbox = page.getByTestId("student-invitation-inbox");
  const list = page.getByTestId("dashboard-classroom-list");
  await expect(panel).toContainText("강의실 목록");
  await expect(panel.getByTestId("student-invitation-inbox")).toBeVisible();
  await expect(panel.getByTestId("dashboard-classroom-list")).toHaveCount(1);
  await expect(inbox.getByText("UX/UI 디자인 입문")).toBeVisible();
  await expect(inbox.getByRole("button", { name: "수락" })).toBeVisible();
  const inboxBox = await inbox.boundingBox();
  const listBox = await list.boundingBox();
  expect(inboxBox).toBeTruthy();
  expect(listBox).toBeTruthy();
  expect(inboxBox!.y + inboxBox!.height).toBeLessThanOrEqual(listBox!.y + 2);
  await inbox.getByRole("button", { name: "수락" }).click();
  await expect(inbox.getByText("대기 중인 초대가 없습니다.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "UX/UI 디자인 입문" })).toBeVisible();
  await inbox.screenshot({ path: "test-results/student-invitation-inbox.png" });
});
