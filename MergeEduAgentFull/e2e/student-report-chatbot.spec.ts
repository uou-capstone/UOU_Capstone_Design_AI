import { expect, Page, test } from "@playwright/test";

const teacher = {
  id: "teacher_1",
  email: "teacher@example.com",
  displayName: "리포트 선생님",
  role: "teacher",
  inviteCode: "9001",
  emailVerified: true,
  hasPassword: true
};

function makeReport(studentUserId: string, studentLabel: string) {
  return {
    schemaVersion: "1.0",
    classroomId: "cls_chat",
    reportScope: "STUDENT",
    studentUserId,
    classroomTitle: "챗봇 테스트 강의실",
    studentLabel,
    generatedAt: "2026-04-30T00:00:00.000Z",
    analysisStatus: "READY",
    generationMode: "AI_ANALYZED",
    headline: `${studentLabel} 학생 리포트`,
    summaryMarkdown: `- ${studentLabel} 학생은 정의 설명을 보완하면 좋습니다.`,
    overallScore: 82,
    overallLevel: "PROFICIENT",
    competencies: [
      "CONCEPT_UNDERSTANDING",
      "QUESTION_QUALITY",
      "PROBLEM_SOLVING",
      "APPLICATION_TRANSFER",
      "QUIZ_ACCURACY",
      "LEARNING_PERSISTENCE",
      "SELF_REFLECTION",
      "CLASS_PARTICIPATION",
      "CONFIDENCE_GROWTH",
      "IMPROVEMENT_MOMENTUM"
    ].map((key, index) => ({
      key,
      label: `역량 ${index + 1}`,
      score: 80,
      trend: "STEADY",
      summary: "요약",
      evidence: ["근거"]
    })),
    strengths: ["함수 연결"],
    growthAreas: ["정의 설명"],
    coachingInsights: ["정의-예시 순서로 말하게 합니다."],
    recommendedActions: [
      {
        title: "정의 설명 보강",
        description: "짧은 서술형으로 확인합니다."
      }
    ],
    lectureInsights: [
      {
        lectureId: "lec_1",
        lectureTitle: "1강",
        weekTitle: "1주차",
        questionCount: 1,
        quizCount: 1,
        averageQuizScore: 82,
        masteryLabel: "성장세"
      }
    ],
    sourceStats: {
      lectureCount: 1,
      sessionCount: 1,
      completedPageCount: 2,
      pageCoverageRatio: 0.5,
      progressPageCount: 3,
      progressCoverageRatio: 0.75,
      questionCount: 1,
      quizCount: 1,
      gradedQuizCount: 1,
      averageQuizScore: 82,
      feedbackCount: 1,
      memoryRefreshCount: 1
    },
    dataQualityNote: "테스트 데이터"
  };
}

async function mockReportPage(page: Page) {
  const reportA = makeReport("stu_1", "민수");
  const reportB = makeReport("stu_2", "지아");

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          user: teacher
        }
      }
    })
  );

  await page.route("**/api/classrooms/cls_chat/report/students", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: [
          {
            id: "stu_1",
            displayName: "민수",
            inviteCode: "1111",
            maskedEmail: "mi***@example.com",
            enrolledAt: "2026-04-30T00:00:00.000Z",
            reportSummary: {
              generatedAt: reportA.generatedAt,
              overallScore: reportA.overallScore,
              overallLevel: reportA.overallLevel,
              generationMode: reportA.generationMode,
              analysisStatus: reportA.analysisStatus,
              sourceStats: reportA.sourceStats
            }
          },
          {
            id: "stu_2",
            displayName: "지아",
            inviteCode: "2222",
            maskedEmail: "ji***@example.com",
            enrolledAt: "2026-04-30T00:00:00.000Z",
            reportSummary: {
              generatedAt: reportB.generatedAt,
              overallScore: reportB.overallScore,
              overallLevel: reportB.overallLevel,
              generationMode: reportB.generationMode,
              analysisStatus: reportB.analysisStatus,
              sourceStats: reportB.sourceStats
            }
          }
        ]
      }
    })
  );

  await page.route("**/api/classrooms/cls_chat/report/students/stu_1", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: reportA
      }
    })
  );

  await page.route("**/api/classrooms/cls_chat/report/students/stu_2", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: reportB
      }
    })
  );
}

test("student report chatbot opens, uses text only, and renders fake stream", async ({ page }) => {
  await mockReportPage(page);
  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/chat/stream", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "answer_delta", text: "정의 설명을 먼저 " }),
        JSON.stringify({ type: "answer_delta", text: "짧게 말하게 해보세요." }),
        JSON.stringify({ type: "done", answerText: "정의 설명을 먼저 짧게 말하게 해보세요." })
      ].join("\n")
    })
  );

  await page.goto("/classrooms/cls_chat/report");
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();

  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("input[type='file']")).toHaveCount(0);
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("정의 설명을 어떻게 보강할까요?");
  await drawer.getByRole("button", { name: "전송" }).click();

  await expect(drawer.getByText("정의 설명을 먼저 짧게 말하게 해보세요.")).toBeVisible();
});

test("student report chatbot shows no-report guidance on 409", async ({ page }) => {
  await mockReportPage(page);
  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/chat/stream", (route) =>
    route.fulfill({
      status: 409,
      json: {
        ok: false,
        error: "Generate the selected student's report before chatting"
      }
    })
  );

  await page.goto("/classrooms/cls_chat/report");
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("질문");
  await drawer.getByRole("button", { name: "전송" }).click();

  await expect(drawer.getByRole("alert")).toContainText("학생 리포트를 먼저 생성");
});

test("student report chatbot ignores stale stream after student switch", async ({ page }) => {
  await mockReportPage(page);
  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/chat/stream", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "answer_delta", text: "늦은 답변" }),
        JSON.stringify({ type: "done", answerText: "늦은 답변" })
      ].join("\n")
    });
  });

  await page.goto("/classrooms/cls_chat/report");
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("민수 질문");
  await drawer.getByRole("button", { name: "전송" }).click();
  await page.locator(".report-student-option").filter({ hasText: "지아" }).click();

  await expect(drawer.getByText("지아 학생에 대한 질문을 기다리고 있습니다.")).toBeVisible();
  await expect(drawer.getByText("늦은 답변")).toHaveCount(0);
});
