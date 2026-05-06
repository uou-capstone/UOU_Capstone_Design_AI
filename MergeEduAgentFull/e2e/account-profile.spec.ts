import { expect, test } from "@playwright/test";

async function signupAndVerify(page: import("@playwright/test").Page, input: {
  role: "teacher" | "student";
  displayName: string;
  email: string;
  password: string;
}) {
  await page.goto("/signup");
  await page.locator(".role-segment").getByText(input.role === "teacher" ? "선생님" : "학생", { exact: true }).click();
  await page.getByLabel("이름").fill(input.displayName);
  await page.getByLabel("이메일").fill(input.email);
  await page.getByLabel("비밀번호").fill(input.password);
  await page.getByRole("button", { name: "가입하고 인증하기" }).click();
  await expect(page.getByRole("heading", { name: "이메일 인증" })).toBeVisible();
  const devCodeText = (await page.locator(".dev-code").textContent()) ?? "";
  const code = devCodeText.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  await page.getByLabel("인증 코드").fill(code!);
  await page.getByRole("button", { name: "인증 완료" }).click();
  await expect(
    page.getByRole("heading", {
      name: input.role === "teacher" ? "내 강의실" : "초대받은 강의실"
    })
  ).toBeVisible();
}

async function openProfileMenu(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", { name: "회원 메뉴" });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("aria-controls", /topbar-profile-menu/);
  await expect(page.locator("#topbar-profile-menu")).toBeVisible();
  return trigger;
}

async function logout(page: import("@playwright/test").Page) {
  await openProfileMenu(page);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

test("profile menu opens a separate account settings page and updates credentials", async ({ page }) => {
  const suffix = Date.now();
  const oldEmail = `profile-${suffix}@example.com`;
  const newEmail = `profile-updated-${suffix}@example.com`;
  const oldPassword = "password123";
  const intermediatePassword = "middlepassword123";
  const newPassword = "newpassword123";

  await signupAndVerify(page, {
    role: "teacher",
    displayName: "Profile Teacher",
    email: oldEmail,
    password: oldPassword
  });

  await expect(page.getByRole("heading", { name: "내 강의실" })).toBeVisible();
  await expect(page.locator(".account-profile-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  const dashboardMenuButtonBox = await page.getByRole("button", { name: "회원 메뉴" }).boundingBox();
  expect(dashboardMenuButtonBox?.width).toBeGreaterThanOrEqual(42);
  expect(dashboardMenuButtonBox?.height).toBeGreaterThanOrEqual(42);
  await expect(page.getByRole("button", { name: "회원 메뉴" })).toContainText("P");

  await page.goto("/verify-email?next=https://evil.example");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/verify-email?next=/%5Cevil.example");
  await expect(page).toHaveURL(/\/$/);

  const profileTrigger = await openProfileMenu(page);
  await expect(page.getByRole("button", { name: "회원 정보 수정" })).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#topbar-profile-menu")).toHaveCount(0);
  await expect(profileTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(profileTrigger).toBeFocused();

  await openProfileMenu(page);
  await page.getByRole("heading", { name: "내 강의실" }).click();
  await expect(page.locator("#topbar-profile-menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "회원 메뉴" })).toHaveAttribute("aria-expanded", "false");

  await openProfileMenu(page);
  await page.getByRole("button", { name: "회원 정보 수정" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "회원 정보 수정" })).toBeVisible();
  const accountPanel = page.locator(".account-profile-panel");
  await expect(accountPanel.getByText(oldEmail)).toBeVisible();
  const accountPanelBox = await accountPanel.boundingBox();
  expect(accountPanelBox?.width).toBeGreaterThanOrEqual(960);

  await openProfileMenu(page);
  await page.getByRole("button", { name: "EduPilot" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#topbar-profile-menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "회원 메뉴" })).toHaveAttribute("aria-expanded", "false");

  await openProfileMenu(page);
  await page.getByRole("button", { name: "회원 정보 수정" }).click();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page).toHaveURL(/\/$/);

  await openProfileMenu(page);
  await page.getByRole("button", { name: "회원 정보 수정" }).click();
  const panel = page.locator(".account-profile-panel");
  await panel.getByLabel("현재 비밀번호").fill("wrong-password");
  await panel.locator("#account-new-password").fill(intermediatePassword);
  await panel.locator("#account-new-password-confirm").fill(intermediatePassword);
  await panel.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(panel.getByText("현재 비밀번호를 확인해 주세요.")).toBeVisible();

  await panel.getByLabel("현재 비밀번호").fill(oldPassword);
  await panel.locator("#account-new-password").fill(intermediatePassword);
  await panel.locator("#account-new-password-confirm").fill(intermediatePassword);
  await panel.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(panel.getByText("회원 정보가 저장되었습니다.")).toBeVisible();

  await panel.getByLabel("아이디").fill(newEmail);
  await panel.getByLabel("현재 비밀번호").fill(intermediatePassword);
  await panel.locator("#account-new-password").fill(newPassword);
  await panel.locator("#account-new-password-confirm").fill(newPassword);
  await panel.getByRole("button", { name: "저장" }).click();

  await expect(page).toHaveURL(/\/verify-email\?.*next=%2Faccount/);
  const devCodeText = (await page.locator(".dev-code").textContent()) ?? "";
  const code = devCodeText.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "이메일 인증" })).toBeVisible();
  await page.getByLabel("인증 코드").fill(code!);
  await page.getByRole("button", { name: "인증 완료" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator(".account-profile-panel").getByText(newEmail)).toBeVisible();
  await logout(page);

  await login(page, oldEmail, oldPassword);
  await expect(page.getByText("이메일 또는 비밀번호를 확인해 주세요.")).toBeVisible();

  await login(page, newEmail, oldPassword);
  await expect(page.getByText("이메일 또는 비밀번호를 확인해 주세요.")).toBeVisible();

  await login(page, newEmail, intermediatePassword);
  await expect(page.getByText("이메일 또는 비밀번호를 확인해 주세요.")).toBeVisible();

  await login(page, newEmail, newPassword);
  await expect(page.getByRole("heading", { name: "내 강의실" })).toBeVisible();
  await expect(page.locator(".account-profile-panel")).toHaveCount(0);

  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "forced logout failure" })
    });
  });
  await openProfileMenu(page);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
});

test("student can use the account page from a compact top bar", async ({ page }) => {
  const suffix = Date.now();
  await page.setViewportSize({ width: 320, height: 820 });

  await signupAndVerify(page, {
    role: "student",
    displayName: `긴 이름 학생 프로필 메뉴 검증 ${suffix}`,
    email: `student-profile-${suffix}@example.com`,
    password: "password123"
  });

  await expect(page.getByRole("heading", { name: "초대받은 강의실" })).toBeVisible();
  const trigger = page.getByRole("button", { name: "회원 메뉴" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("긴");
  await openProfileMenu(page);
  const menuBox = await page.locator("#topbar-profile-menu").boundingBox();
  expect(menuBox?.x).toBeGreaterThanOrEqual(0);
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "회원 정보 수정" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "회원 정보 수정" })).toBeVisible();
  await expect(page.locator(".account-profile-panel").getByText("학생")).toBeVisible();
});
