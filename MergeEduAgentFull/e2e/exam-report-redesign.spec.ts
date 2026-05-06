import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const now = "2026-05-02T00:00:00.000Z";
const teacherUser = {
  id: "usr_report_teacher",
  email: "report.teacher@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "2026",
  emailVerified: true,
  hasPassword: true
};
const classroom = {
  id: "cls_report",
  title: "시험 리포트 강의실",
  ownerUserId: "usr_report_teacher",
  inviteCode: "9031",
  createdAt: now,
  updatedAt: now
};

function reportResponse(overrides: Record<string, unknown> = {}) {
  return {
    exam: {
      id: "exam_report",
      classroomId: "cls_report",
      weekId: "wk_report",
      status: "PUBLISHED",
      activePublishedVersion: 1,
      publishedRevision: {
        version: 1,
        title: "중간고사",
        descriptionMarkdown: "교사가 배포한 시험입니다.",
        availableFrom: "2026-05-01T01:00:00.000Z",
        availableUntil: "2026-05-03T14:59:00.000Z",
        timeLimitMinutes: 60,
        passScoreRatio: 0.7,
        aiGradingEnabled: false,
        createdAt: now,
        updatedAt: now,
        questions: [
          { id: "q1", type: "OX", promptMarkdown: "Kerberos는 티켓 기반 인증 시스템이다.", points: 1 },
          { id: "q2", type: "MCQ", promptMarkdown: "정보 보안의 3요소가 아닌 것은?", points: 1 },
          { id: "q3", type: "MCQ", promptMarkdown: "가장 적절한 설명을 고르세요.", points: 1 },
          { id: "q4", type: "ESSAY", promptMarkdown: "보안 설계를 서술하세요.", points: 5 }
        ]
      }
    },
    summary: {
      enrolledCount: 4,
      attemptCount: 3,
      submittedCount: 3,
      gradedCount: 2,
      averageScore: 7.8,
      maxScore: 10,
      completionRatio: 0.75
    },
    students: [
      {
        studentUserId: "s01",
        displayName: "시나리오1 학생 01",
        status: "SUBMITTED",
        reportScore: { score: 8, maxScore: 10, scoreRatio: 0.8 },
        attempt: null
      },
      {
        studentUserId: "s02",
        displayName: "시나리오1 학생 02",
        status: "SUBMITTED",
        reportScore: { score: 6, maxScore: 10, scoreRatio: 0.6 },
        attempt: null
      },
      {
        studentUserId: "s03",
        displayName: "시나리오1 학생 03",
        status: "IN_PROGRESS",
        attempt: null
      },
      {
        studentUserId: "s04",
        displayName: "시나리오1 학생 04",
        status: "MISSED",
        attempt: null
      }
    ],
    questionStats: [
      {
        statId: "active:q1",
        questionId: "q1",
        questionNumber: 1,
        type: "OX",
        promptMarkdown: "Kerberos는 티켓 기반 인증 시스템이다.",
        maxScore: 1,
        averageScore: 0.8,
        attempts: 2,
        correctCount: 1,
        incorrectCount: 1,
        partialCount: 0,
        unansweredCount: 0,
        correctAnswerLabel: "O",
        distribution: [
          { key: "true", label: "O", count: 1, ratio: 0.5, isCorrect: true },
          { key: "false", label: "X", count: 1, ratio: 0.5 }
        ],
        respondents: [
          { studentUserId: "s01", displayName: "시나리오1 학생 01", answerLabel: "O", result: "CORRECT", score: 1, maxScore: 1 },
          { studentUserId: "s02", displayName: "시나리오1 학생 02", answerLabel: "X", result: "WRONG", score: 0, maxScore: 1 }
        ]
      },
      {
        statId: "active:q2",
        questionId: "q2",
        questionNumber: 2,
        type: "MCQ",
        promptMarkdown: "정보 보안의 3요소가 아닌 것은 무엇입니까?",
        maxScore: 1,
        averageScore: 0.6,
        attempts: 2,
        correctCount: 1,
        incorrectCount: 1,
        partialCount: 0,
        unansweredCount: 0,
        correctAnswerLabel: "3번",
        distribution: [
          { key: "1", label: "1번", count: 1, ratio: 0.5 },
          { key: "3", label: "3번", count: 1, ratio: 0.5, isCorrect: true }
        ],
        respondents: [
          { studentUserId: "s01", displayName: "시나리오1 학생 01", answerLabel: "3번", result: "CORRECT", score: 1, maxScore: 1 },
          { studentUserId: "s02", displayName: "시나리오1 학생 02", answerLabel: "1번", result: "WRONG", score: 0, maxScore: 1 }
        ]
      },
      {
        statId: "active:q3",
        questionId: "q3",
        questionNumber: 3,
        type: "MCQ",
        promptMarkdown: "가장 적절한 설명을 고르세요.",
        maxScore: 1,
        averageScore: 0.9,
        attempts: 2,
        correctCount: 2,
        incorrectCount: 0,
        partialCount: 0,
        unansweredCount: 0,
        correctAnswerLabel: "3번",
        distribution: [{ key: "3", label: "3번", count: 2, ratio: 1, isCorrect: true }],
        respondents: [
          { studentUserId: "s01", displayName: "시나리오1 학생 01", answerLabel: "3번", result: "CORRECT", score: 1, maxScore: 1 },
          { studentUserId: "s02", displayName: "시나리오1 학생 02", answerLabel: "3번", result: "CORRECT", score: 1, maxScore: 1 }
        ]
      },
      {
        statId: "active:q4",
        questionId: "q4",
        questionNumber: 4,
        type: "ESSAY",
        promptMarkdown: "보안 설계를 서술하세요.",
        maxScore: 5,
        averageScore: 0,
        attempts: 0,
        unsupportedReason: "서술형이라 지원하지 않습니다."
      }
    ],
    ...overrides
  };
}

async function mockReportPage(page: Page, report: Record<string, unknown>) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { user: teacherUser } }) })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "disabled" }) })
  );
  await page.route("**/api/classrooms", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [classroom] }) })
  );
  await page.route("**/api/exams/exam_report/report", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: report }) })
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

test("teacher exam report matches the populated reference layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockReportPage(page, reportResponse());
  await page.goto("/exams/exam_report/report");

  await expect(page.getByTestId("exam-report-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "중간고사" })).toBeVisible();
  await expect(page.getByTestId("exam-report-summary")).toContainText("7.8 / 10");
  await expect(page.getByTestId("exam-report-student-row")).toHaveCount(4);
  await expect(page.getByText("응시중")).toBeVisible();
  await expect(page.getByText("미응시")).toBeVisible();

  const secondQuestion = page.getByTestId("exam-report-question-row").filter({ hasText: "2번" });
  const secondChevron = secondQuestion.getByTestId("exam-report-question-chevron");
  await expect(secondChevron).toHaveCSS("opacity", "0");
  await secondQuestion.hover();
  await expect(secondChevron).toHaveCSS("opacity", "1");
  await secondQuestion.click();
  await expect(page.getByTestId("exam-report-question-detail")).toContainText("2번 문항 상세");
  await expect(page.getByTestId("exam-report-question-detail")).toContainText("시나리오1 학생 01");
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("exam-report-populated-desktop.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/exam-report-populated-desktop.png", fullPage: true });

  for (const [width, height, name] of [
    [1280, 820, "exam-report-populated-shell-breakpoint.png"],
    [1024, 820, "exam-report-populated-midwidth.png"],
    [390, 844, "exam-report-populated-mobile.png"]
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(name, {
      animations: "disabled",
      fullPage: true,
      maxDiffPixelRatio: 0.03
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("exam-report-unsupported-question").click();
  await expect(page.getByTestId("exam-report-question-detail")).toContainText("서술형이라 지원하지 않습니다.");
});

test("teacher exam report shows quiet empty question state before responses", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockReportPage(
    page,
    reportResponse({
      summary: { enrolledCount: 2, attemptCount: 0, submittedCount: 0, gradedCount: 0, averageScore: 0, maxScore: 10, completionRatio: 0 },
      students: [
        { studentUserId: "s01", displayName: "시나리오1 학생 01", status: "NOT_STARTED", attempt: null },
        { studentUserId: "s02", displayName: "시나리오1 학생 02", status: "NOT_STARTED", attempt: null }
      ],
      questionStats: [
        { statId: "active:q1", questionId: "q1", questionNumber: 1, type: "MCQ", promptMarkdown: "1번 문항", maxScore: 5, averageScore: 0, attempts: 0 },
        { statId: "active:q2", questionId: "q2", questionNumber: 2, type: "OX", promptMarkdown: "2번 문항", maxScore: 5, averageScore: 0, attempts: 0 }
      ]
    })
  );
  await page.goto("/exams/exam_report/report");

  await expect(page.getByTestId("exam-report-empty-questions")).toContainText("아직 문항별 응답 데이터가 없습니다.");
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot("exam-report-empty-desktop.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
});

test("teacher exam report keeps all-essay questions visible as unsupported", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockReportPage(
    page,
    reportResponse({
      summary: { enrolledCount: 1, attemptCount: 1, submittedCount: 1, gradedCount: 1, averageScore: 0, maxScore: 0, completionRatio: 1 },
      questionStats: [
        {
          statId: "active:q_essay",
          questionId: "q_essay",
          questionNumber: 1,
          type: "ESSAY",
          promptMarkdown: "학습 내용을 서술하세요.",
          maxScore: 10,
          averageScore: 0,
          attempts: 0,
          unsupportedReason: "서술형이라 지원하지 않습니다."
        }
      ]
    })
  );
  await page.goto("/exams/exam_report/report");

  await expect(page.getByTestId("exam-report-unsupported-question")).toBeVisible();
  await page.getByTestId("exam-report-unsupported-question").click();
  await expect(page.getByTestId("exam-report-question-detail")).toContainText("서술형이라 지원하지 않습니다.");
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot("exam-report-essay-unsupported-desktop.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
});

test("teacher exam report shows AI-scored essay question details", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockReportPage(
    page,
    reportResponse({
      questionStats: [
        {
          statId: "active:q_essay_ai",
          questionId: "q_essay_ai",
          questionNumber: 1,
          type: "ESSAY",
          promptMarkdown: "삼국 통일 과정을 서술하세요.",
          maxScore: 5,
          averageScore: 4,
          attempts: 2,
          correctCount: 1,
          incorrectCount: 0,
          partialCount: 1,
          unansweredCount: 0,
          correctAnswerLabel: "AI 채점",
          distribution: [
            { key: "partial", label: "부분 점수", count: 1, ratio: 0.5 },
            { key: "full", label: "만점", count: 1, ratio: 0.5, isCorrect: true }
          ],
          respondents: [
            { studentUserId: "s01", displayName: "시나리오1 학생 01", answerLabel: "서술형 답안", result: "PARTIAL", score: 3, maxScore: 5 },
            { studentUserId: "s02", displayName: "시나리오1 학생 02", answerLabel: "모범에 가까운 답안", result: "CORRECT", score: 5, maxScore: 5 }
          ]
        }
      ]
    })
  );
  await page.goto("/exams/exam_report/report");

  await expect(page.getByTestId("exam-report-unsupported-question")).toHaveCount(0);
  await page.getByTestId("exam-report-question-row").click();
  await expect(page.getByTestId("exam-report-question-detail")).toContainText("1번 문항 상세");
  await expect(page.getByTestId("exam-report-question-detail")).toContainText("시나리오1 학생 01");
  await expect(page.getByTestId("exam-report-question-detail")).toContainText("3 / 5");
  await expectNoHorizontalOverflow(page);
});
