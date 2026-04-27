import { expect, test } from "@playwright/test";

async function signupAndVerify(page: import("@playwright/test").Page, input: {
  role: "teacher" | "student";
  displayName: string;
  email: string;
  password: string;
}) {
  await page.goto("/signup");
  await page.getByRole("button", { name: input.role === "teacher" ? "선생님" : "학생" }).click();
  await page.getByPlaceholder("이름").fill(input.displayName);
  await page.getByPlaceholder("이메일").fill(input.email);
  await page.getByPlaceholder("비밀번호 8자 이상").fill(input.password);
  await page.getByRole("button", { name: "가입하고 인증하기" }).click();
  await expect(page.getByRole("heading", { name: "이메일 인증" })).toBeVisible();
  const devCodeText = (await page.locator(".dev-code").textContent()) ?? "";
  const code = devCodeText.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  await page.getByPlaceholder("인증 코드").fill(code!);
  await page.getByRole("button", { name: "인증 완료" }).click();
  await expect(page.getByText(input.displayName)).toBeVisible();
}

async function logout(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("이메일").fill(email);
  await page.getByPlaceholder("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

function classroomCard(page: import("@playwright/test").Page, title: string) {
  return page.locator(".classroom-card").filter({
    has: page.getByRole("heading", { name: title })
  });
}

test("teacher invites a verified student and student stays read-only", async ({ page }) => {
  const suffix = Date.now();
  const password = "password123";
  const teacherEmail = `teacher-${suffix}@example.com`;
  const studentEmail = `student-${suffix}@example.com`;
  const classroomTitle = `0426 권한 테스트 ${suffix}`;

  await signupAndVerify(page, {
    role: "teacher",
    displayName: "E2E Teacher",
    email: teacherEmail,
    password
  });
  await expect(page.getByRole("heading", { name: "내 강의실" })).toBeVisible();
  await page.getByText("강의실 추가").click();
  await page.getByPlaceholder("새 강의실 이름").fill(classroomTitle);
  await page.getByRole("button", { name: "생성" }).click();
  await expect(page.getByText(classroomTitle)).toBeVisible();
  await logout(page);

  await signupAndVerify(page, {
    role: "student",
    displayName: "E2E Student",
    email: studentEmail,
    password
  });
  await expect(page.getByRole("heading", { name: "초대받은 강의실" })).toBeVisible();
  await expect(page.getByText("강의실 추가")).toHaveCount(0);
  const inviteCodeText = (await page.locator(".topbar-invite").textContent()) ?? "";
  const inviteCode = inviteCodeText.match(/\d{4}/)?.[0];
  expect(inviteCode).toBeTruthy();
  await logout(page);

  await login(page, teacherEmail, password);
  await expect(page.getByRole("heading", { name: "내 강의실" })).toBeVisible();
  await classroomCard(page, classroomTitle).getByRole("link", { name: "입장" }).click();
  await expect(page.getByRole("heading", { name: "강의실 주차" })).toBeVisible();
  await page.getByPlaceholder("학생 이름").fill("E2E Student");
  await page.getByPlaceholder("1234").fill(inviteCode!);
  await page.getByRole("button", { name: "검색" }).click();
  await expect(page.getByText(`E2E Student #${inviteCode}`)).toBeVisible();
  await page.getByRole("button", { name: "초대" }).click();
  await expect(page.getByText("학생을 초대했습니다.")).toBeVisible();
  await logout(page);

  await login(page, studentEmail, password);
  await expect(page.getByRole("heading", { name: "초대받은 강의실" })).toBeVisible();
  await expect(page.getByText(classroomTitle)).toBeVisible();
  await expect(page.getByText("강의실 추가")).toHaveCount(0);
  await expect(classroomCard(page, classroomTitle).getByRole("button", { name: "삭제" })).toHaveCount(0);
  await classroomCard(page, classroomTitle).getByRole("link", { name: "입장" }).click();
  await expect(page.getByRole("heading", { name: "강의실 주차" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 주차 추가" })).toHaveCount(0);
  await expect(page.getByText("학생 초대")).toHaveCount(0);
});
