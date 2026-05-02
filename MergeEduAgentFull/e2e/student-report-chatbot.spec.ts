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

function makeReport(
  studentUserId: string,
  studentLabel: string,
  extraCompetencies: Array<Record<string, unknown>> = []
) {
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
      ...[
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
      ...extraCompetencies
    ],
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

async function mockReportPage(
  page: Page,
  options: { criteriaFailure?: boolean } = {}
) {
  const reportA = makeReport("stu_1", "민수");
  const reportB = makeReport("stu_2", "지아");
  let reportAResponse = reportA;
  const criteria = new Map<string, {
    id: string;
    classroomId: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  }>();
  let analyzeRequestCount = 0;

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

  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({
      status: 500,
      json: {
        ok: false,
        error: "request encryption disabled in mocked e2e"
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
        data: reportAResponse
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

  await page.route("**/api/classrooms/cls_chat/report/criteria**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/");
    const criterionId = parts.at(-1) ?? "";
    const now = "2026-04-30T00:00:00.000Z";

    if (request.method() === "GET") {
      if (options.criteriaFailure) {
        await route.fulfill({
          status: 500,
          json: { ok: false, error: "criteria unavailable" }
        });
        return;
      }
      await route.fulfill({
        json: { ok: true, data: [...criteria.values()] }
      });
      return;
    }

    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}") as {
        name: string;
        description: string;
      };
      const item = {
        id: `crit_${criteria.size + 1}`,
        classroomId: "cls_chat",
        name: body.name,
        description: body.description,
        createdAt: now,
        updatedAt: now
      };
      criteria.set(item.id, item);
      await route.fulfill({ status: 201, json: { ok: true, data: item } });
      return;
    }

    if (request.method() === "PATCH") {
      const current = criteria.get(criterionId);
      const body = JSON.parse(request.postData() || "{}") as {
        name?: string;
        description?: string;
      };
      const item = {
        ...current!,
        ...body,
        updatedAt: now
      };
      criteria.set(criterionId, item);
      await route.fulfill({ json: { ok: true, data: item } });
      return;
    }

    if (request.method() === "DELETE") {
      criteria.delete(criterionId);
      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/analyze/stream", async (route) => {
    analyzeRequestCount += 1;
    const finalReport = makeReport("stu_1", "민수", [
      {
        key: "CUSTOM_crit_1",
        label: "발표 구조화",
        score: 77,
        trend: "UP",
        summary: "주장과 근거를 연결하는 흐름이 좋아지고 있습니다.",
        evidence: ["교사 추가 기준 반영"]
      }
    ]);
    reportAResponse = finalReport;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "final", data: finalReport })
    });
  });

  return {
    getAnalyzeRequestCount: () => analyzeRequestCount
  };
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
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);
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
  await page.getByTestId("report-nav-students").click();
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await page.locator(".report-student-option").filter({ hasText: "지아" }).click({
    position: { x: 12, y: 12 }
  });

  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(drawer.getByText("지아 학생에 대한 질문을 기다리고 있습니다.")).toBeVisible();
  await expect(drawer.getByText("늦은 답변")).toHaveCount(0);
});

test("student report internal navigation separates sections and fits layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockReportPage(page);

  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);

  const desktopNavBox = await page.getByTestId("report-section-nav").boundingBox();
  const desktopPanelBox = await page.getByTestId("report-section-panel").boundingBox();
  expect(desktopNavBox).toBeTruthy();
  expect(desktopPanelBox).toBeTruthy();
  expect(desktopNavBox!.x + desktopNavBox!.width).toBeLessThanOrEqual(desktopPanelBox!.x + 1);
  expect(Math.abs(desktopNavBox!.y - desktopPanelBox!.y)).toBeLessThanOrEqual(2);
  const desktopFitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(desktopFitsViewport).toBe(true);

  await page.getByTestId("report-nav-students").click();
  await expect(page.getByTestId("report-nav-students")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);
  await expect(page.getByTestId("report-content-section")).toHaveCount(0);

  await page.getByTestId("report-nav-criteria").click();
  await expect(page.getByTestId("report-nav-criteria")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".report-criteria-panel")).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.getByTestId("report-content-section")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classrooms/cls_chat/report");
  const mobileNavBox = await page.getByTestId("report-section-nav").boundingBox();
  const mobilePanelBox = await page.getByTestId("report-section-panel").boundingBox();
  expect(mobileNavBox).toBeTruthy();
  expect(mobilePanelBox).toBeTruthy();
  expect(mobileNavBox!.y + mobileNavBox!.height).toBeLessThanOrEqual(mobilePanelBox!.y + 1);
  for (const box of [mobileNavBox!, mobilePanelBox!]) {
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
  const mobileFitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(mobileFitsViewport).toBe(true);
});

test("teacher manages custom report criteria without auto analysis and sees regenerated custom competency", async ({ page }) => {
  const pageState = await mockReportPage(page);

  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await page.getByTestId("report-nav-criteria").click();
  const criteriaPanel = page.locator(".report-criteria-panel");
  await expect(criteriaPanel).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.getByText("민수 학생 리포트")).toHaveCount(0);
  await criteriaPanel.getByLabel("항목 이름").fill("발표 논리력");
  await criteriaPanel.getByLabel("세부 설명").fill("주장과 근거가 연결되는지 평가");
  await criteriaPanel.getByRole("button", { name: "항목 추가" }).click();
  await expect(page.getByText("발표 논리력")).toBeVisible();
  expect(pageState.getAnalyzeRequestCount()).toBe(0);

  await criteriaPanel.getByRole("button", { name: "수정" }).click();
  await criteriaPanel.getByLabel("항목 이름").fill("발표 구조화");
  await criteriaPanel.getByRole("button", { name: "항목 수정" }).click();
  await expect(page.getByText("발표 구조화")).toBeVisible();
  expect(pageState.getAnalyzeRequestCount()).toBe(0);

  await page.getByRole("button", { name: "선택 학생 다시 분석" }).click();
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("학생별 역량 리포트 분석 진행 상황")).toBeVisible();
  const analysisButton = page.getByRole("button", { name: "Gemini 분석 중..." });
  await expect(analysisButton).toBeDisabled();
  await page.getByTestId("report-nav-criteria").click();
  await expect(criteriaPanel.getByLabel("항목 이름")).toBeDisabled();
  await expect(criteriaPanel.getByRole("button", { name: "항목 추가" })).toBeDisabled();
  const updatedCriterion = page.locator(".report-criteria-item").filter({ hasText: "발표 구조화" });
  await expect(updatedCriterion.getByRole("button", { name: "발표 구조화 수정" })).toBeDisabled();
  await expect(updatedCriterion.getByRole("button", { name: "발표 구조화 삭제" })).toBeDisabled();
  await analysisButton.click({ force: true });
  await page.getByTestId("report-nav-content").click();
  await expect(page.getByText("주장과 근거를 연결하는 흐름이 좋아지고 있습니다.")).toBeVisible();
  expect(pageState.getAnalyzeRequestCount()).toBe(1);

  await page.getByTestId("report-nav-students").click();
  await page.locator(".report-student-option").filter({ hasText: "지아" }).click();
  await expect(page.getByText("학생별 역량 리포트 분석 진행 상황")).toHaveCount(0);

  await page.getByTestId("report-nav-criteria").click();
  await criteriaPanel.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("추가된 평가 항목이 없습니다.")).toBeVisible();
  expect(pageState.getAnalyzeRequestCount()).toBe(1);
});

test("criteria load failure keeps the existing saved report visible", async ({ page }) => {
  await mockReportPage(page, { criteriaFailure: true });

  await page.goto("/classrooms/cls_chat/report");

  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("criteria unavailable");
});
