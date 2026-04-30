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
  await expect(page.getByText(input.displayName)).toBeVisible();
}

async function logout(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

test("member information panel updates account email and password", async ({ page }) => {
  const suffix = Date.now();
  const oldEmail = `profile-${suffix}@example.com`;
  const newEmail = `profile-updated-${suffix}@example.com`;
  const oldPassword = "password123";
  const newPassword = "newpassword123";

  await signupAndVerify(page, {
    role: "teacher",
    displayName: "Profile Teacher",
    email: oldEmail,
    password: oldPassword
  });

  const panel = page.locator(".account-profile-panel");
  await expect(panel.getByRole("heading", { name: "회원 정보" })).toBeVisible();
  await expect(panel.getByText(oldEmail)).toBeVisible();
  await expect(panel.getByText("********")).toBeVisible();

  await panel.getByRole("button", { name: "회원 정보 수정" }).click();
  await panel.getByLabel("아이디").fill(newEmail);
  await panel.getByLabel("현재 비밀번호").fill(oldPassword);
  await panel.locator("#account-new-password").fill(newPassword);
  await panel.locator("#account-new-password-confirm").fill(newPassword);
  await panel.getByRole("button", { name: "저장" }).click();

  await expect(page.getByRole("heading", { name: "이메일 인증" })).toBeVisible();
  const devCodeText = (await page.locator(".dev-code").textContent()) ?? "";
  const code = devCodeText.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  await page.getByLabel("인증 코드").fill(code!);
  await page.getByRole("button", { name: "인증 완료" }).click();

  await expect(page.locator(".account-profile-panel").getByText(newEmail)).toBeVisible();
  await logout(page);

  await login(page, oldEmail, oldPassword);
  await expect(page.getByText("이메일 또는 비밀번호를 확인해 주세요.")).toBeVisible();

  await login(page, newEmail, oldPassword);
  await expect(page.getByText("이메일 또는 비밀번호를 확인해 주세요.")).toBeVisible();

  await login(page, newEmail, newPassword);
  await expect(page.getByRole("heading", { name: "내 강의실" })).toBeVisible();
  await expect(page.locator(".account-profile-panel").getByText(newEmail)).toBeVisible();
});
