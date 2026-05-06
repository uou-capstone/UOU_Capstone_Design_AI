import { expect, Locator, Page, test } from "@playwright/test";

const builtInReportCriteria = [
  {
    name: "개념 이해도",
    description: "핵심 개념을 정확히 파악하고 연결해서 이해하는 힘"
  },
  {
    name: "질문 구체성",
    description: "수업 중 질문이 구체적이고 학습 병목을 잘 드러내는 정도"
  },
  {
    name: "문제 해결력",
    description: "퀴즈와 문항 풀이에서 답을 구성해내는 능력"
  },
  {
    name: "응용·전이력",
    description: "배운 내용을 새로운 문제나 문맥에 연결하는 능력"
  },
  {
    name: "퀴즈 정확도",
    description: "시험·퀴즈에서 실제 정답률로 드러난 성취도"
  },
  {
    name: "학습 지속성",
    description: "페이지 이동, 누적 세션, 반복 학습에서 보이는 꾸준함"
  },
  {
    name: "오답 성찰력",
    description: "피드백과 약점 메모를 바탕으로 스스로 보완하는 힘"
  },
  {
    name: "수업 참여도",
    description: "질문, 응답, 세션 활동량으로 확인되는 참여 수준"
  },
  {
    name: "학습 자신감",
    description: "학습자 모델 confidence와 반응 흐름에서 보이는 자신감"
  },
  {
    name: "성장 모멘텀",
    description: "최근 흐름이 좋아지고 있는지, 다음 상승 여지가 있는지"
  }
];

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
      teacherExamResultCount: 0,
      teacherExamAverageScore: 0,
      feedbackCount: 1,
      memoryRefreshCount: 1
    },
    dataQualityNote: "테스트 데이터"
  };
}

function makeReportSummary(report: ReturnType<typeof makeReport>) {
  return {
    generatedAt: report.generatedAt,
    overallScore: report.overallScore,
    overallLevel: report.overallLevel,
    generationMode: report.generationMode,
    analysisStatus: report.analysisStatus,
    sourceStats: report.sourceStats
  };
}

async function mockReportPage(
  page: Page,
  options: {
    criteriaFailure?: boolean;
    criteriaGetDelayMs?: number;
    criteriaPostDelayMs?: number;
    criteriaPostFailure?: boolean;
    criteriaPatchFailure?: boolean;
    criteriaDeleteFailure?: boolean;
    emptyStudents?: boolean;
    studentReportDelayMs?: Partial<Record<"stu_1" | "stu_2" | "stu_3", number>>;
    reportAOverride?: ReturnType<typeof makeReport>;
    initialCriteria?: Array<{
      id?: string;
      name: string;
      description: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
  } = {}
) {
  const reportA = options.reportAOverride ?? makeReport("stu_1", "민수");
  const reportB = makeReport("stu_2", "지아");
  let reportAResponse = reportA;
  let studentRows = [
    {
      id: "stu_1",
      displayName: "민수",
      inviteCode: "1111",
      maskedEmail: "mi***@example.com",
      enrolledAt: "2026-04-30T00:00:00.000Z",
      reportSummary: makeReportSummary(reportA)
    },
    {
      id: "stu_2",
      displayName: "지아",
      inviteCode: "2222",
      maskedEmail: "ji***@example.com",
      enrolledAt: "2026-04-30T00:00:00.000Z",
      reportSummary: makeReportSummary(reportB)
    },
    {
      id: "stu_3",
      displayName: "도윤",
      inviteCode: "3333",
      maskedEmail: "do***@example.com",
      enrolledAt: "2026-04-30T00:00:00.000Z",
      reportSummary: null
    }
  ];
  let studentListRequestCount = 0;
  const studentReportRequestCounts: Record<string, number> = {
    stu_1: 0,
    stu_2: 0,
    stu_3: 0
  };
  const criteria = new Map<string, {
    id: string;
    classroomId: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  }>();
  for (const [index, criterion] of (options.initialCriteria ?? []).entries()) {
    const id = criterion.id ?? `crit_initial_${index + 1}`;
    criteria.set(id, {
      id,
      classroomId: "cls_chat",
      name: criterion.name,
      description: criterion.description,
      createdAt: criterion.createdAt ?? "2026-04-29T00:00:00.000Z",
      updatedAt: criterion.updatedAt ?? "2026-04-29T00:00:00.000Z"
    });
  }
  let criteriaFailure = Boolean(options.criteriaFailure);
  let criteriaPostFailure = Boolean(options.criteriaPostFailure);
  let criteriaPatchFailure = Boolean(options.criteriaPatchFailure);
  let criteriaDeleteFailure = Boolean(options.criteriaDeleteFailure);
  let analyzeRequestCount = 0;
  const criteriaRequestCounts = {
    GET: 0,
    POST: 0,
    PATCH: 0,
    DELETE: 0
  };
  const criteriaWriteBodies: Array<{
    method: "POST" | "PATCH" | "DELETE";
    body: Record<string, unknown>;
  }> = [];

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

  await page.route("**/api/classrooms/cls_chat/report/students", (route) => {
    studentListRequestCount += 1;
    return route.fulfill({
      json: {
        ok: true,
        data: options.emptyStudents ? [] : studentRows
      }
    });
  });

  await page.route("**/api/classrooms/cls_chat/report/students/stu_1", (route) => {
    studentReportRequestCounts.stu_1 += 1;
    const delayMs = options.studentReportDelayMs?.stu_1;
    if (delayMs) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            route.fulfill({
              json: {
                ok: true,
                data: reportAResponse
              }
            })
          );
        }, delayMs);
      });
    }
    return route.fulfill({
      json: {
        ok: true,
        data: reportAResponse
      }
    });
  });

  await page.route("**/api/classrooms/cls_chat/report/students/stu_2", (route) => {
    studentReportRequestCounts.stu_2 += 1;
    const delayMs = options.studentReportDelayMs?.stu_2;
    if (delayMs) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            route.fulfill({
              json: {
                ok: true,
                data: reportB
              }
            })
          );
        }, delayMs);
      });
    }
    return route.fulfill({
      json: {
        ok: true,
        data: reportB
      }
    });
  });

  await page.route("**/api/classrooms/cls_chat/report/students/stu_3", (route) => {
    studentReportRequestCounts.stu_3 += 1;
    const delayMs = options.studentReportDelayMs?.stu_3;
    if (delayMs) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            route.fulfill({
              json: {
                ok: true,
                data: null
              }
            })
          );
        }, delayMs);
      });
    }
    return route.fulfill({
      json: {
        ok: true,
        data: null
      }
    });
  });

  await page.route("**/api/classrooms/cls_chat/report/criteria**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/report/criteria/assistant/stream")) {
      await route.fallback();
      return;
    }
    const parts = url.pathname.split("/");
    const criterionId = parts.at(-1) ?? "";
    const now = "2026-04-30T00:00:00.000Z";

    if (request.method() === "GET") {
      criteriaRequestCounts.GET += 1;
      if (options.criteriaGetDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.criteriaGetDelayMs));
      }
      if (criteriaFailure) {
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
      criteriaRequestCounts.POST += 1;
      const body = JSON.parse(request.postData() || "{}") as {
        name: string;
        description: string;
      };
      criteriaWriteBodies.push({ method: "POST", body });
      if (options.criteriaPostDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.criteriaPostDelayMs));
      }
      if (criteriaPostFailure) {
        await route.fulfill({
          status: 500,
          json: { ok: false, error: "criteria create failed" }
        });
        return;
      }
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
      criteriaRequestCounts.PATCH += 1;
      const current = criteria.get(criterionId);
      const body = JSON.parse(request.postData() || "{}") as {
        name?: string;
        description?: string;
      };
      criteriaWriteBodies.push({ method: "PATCH", body });
      if (!current) {
        await route.fulfill({
          status: 404,
          json: { ok: false, error: "criterion not found" }
        });
        return;
      }
      if (criteriaPatchFailure) {
        await route.fulfill({
          status: 500,
          json: { ok: false, error: "criteria update failed" }
        });
        return;
      }
      const item = {
        ...current,
        ...body,
        updatedAt: now
      };
      criteria.set(criterionId, item);
      await route.fulfill({ json: { ok: true, data: item } });
      return;
    }

    if (request.method() === "DELETE") {
      criteriaRequestCounts.DELETE += 1;
      criteriaWriteBodies.push({ method: "DELETE", body: { id: criterionId } });
      if (!criteria.has(criterionId)) {
        await route.fulfill({
          status: 404,
          json: { ok: false, error: "criterion not found" }
        });
        return;
      }
      if (criteriaDeleteFailure) {
        await route.fulfill({
          status: 500,
          json: { ok: false, error: "criteria delete failed" }
        });
        return;
      }
      criteria.delete(criterionId);
      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/analyze/stream", async (route) => {
    analyzeRequestCount += 1;
    const finalReport = {
      ...makeReport("stu_1", "민수", [
        {
          key: "CUSTOM_crit_1",
          label: "발표 구조화",
          score: 77,
          trend: "UP",
          summary: "주장과 근거를 연결하는 흐름이 좋아지고 있습니다.",
          evidence: ["교사 추가 기준 반영"]
        }
      ]),
      generatedAt: "2026-05-01T00:00:00.000Z"
    };
    reportAResponse = finalReport;
    studentRows = studentRows.map((student) =>
      student.id === "stu_1" ? { ...student, reportSummary: makeReportSummary(finalReport) } : student
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "final", data: finalReport })
    });
  });

  return {
    getAnalyzeRequestCount: () => analyzeRequestCount,
    getCriteriaRequestCounts: () => ({ ...criteriaRequestCounts }),
    getCriteriaWriteBodies: () => [...criteriaWriteBodies],
    getStudentListRequestCount: () => studentListRequestCount,
    getStudentReportRequestCounts: () => ({ ...studentReportRequestCounts }),
    setStudentReportSummary: (
      studentId: string,
      reportSummary: ReturnType<typeof makeReportSummary> | null
    ) => {
      studentRows = studentRows.map((student) =>
        student.id === studentId ? { ...student, reportSummary } : student
      );
    },
    setCriteriaFailure: (next: boolean) => {
      criteriaFailure = next;
    },
    setCriteriaPostFailure: (next: boolean) => {
      criteriaPostFailure = next;
    },
    setCriteriaPatchFailure: (next: boolean) => {
      criteriaPatchFailure = next;
    },
    setCriteriaDeleteFailure: (next: boolean) => {
      criteriaDeleteFailure = next;
    },
    mutateCriterion: (
      criterionId: string,
      patch: Partial<{
        name: string;
        description: string;
        updatedAt: string;
      }>
    ) => {
      const current = criteria.get(criterionId);
      if (!current) return;
      criteria.set(criterionId, {
        ...current,
        ...patch
      });
    },
    removeCriterion: (criterionId: string) => {
      criteria.delete(criterionId);
    },
    getCriteria: () => [...criteria.values()]
  };
}

async function mockCriteriaAssistantStream(
  page: Page,
  options: {
    name?: string;
    description?: string;
    method?: "messageOnly" | "draftCriterion" | "createCriterion" | "updateCriterion" | "deleteCriterion";
    targetCriterionId?: string;
    targetCriterionName?: string;
    targetCriterionDescription?: string;
    targetCriterionUpdatedAt?: string;
    delayMs?: number;
  } = {}
) {
  const name = options.name ?? "발표 논리력";
  const description =
    options.description ?? "발표 내용의 구조화, 논리 전개, 근거 제시의 명확성을 평가합니다.";
  const method = options.method ?? "draftCriterion";
  const targetCriterion = {
    targetCriterionId: options.targetCriterionId ?? "crit_initial_1",
    targetCriterionName: options.targetCriterionName ?? "발표 논리력",
    targetCriterionDescription:
      options.targetCriterionDescription ?? "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: options.targetCriterionUpdatedAt ?? "2026-04-29T00:00:00.000Z"
  };
  const proposalParams =
    method === "messageOnly"
      ? {
          rationale: "아직 평가 항목 초안으로 확정하지 않고 교사의 의도를 더 확인합니다.",
          summaryCards: [
            { title: "요청 확인", body: "추가 질문이 필요한 상태입니다." },
            { title: "항목 보류", body: "이전 제안을 자동 반영하지 않습니다." },
            { title: "다음 단계", body: "구체 행동 근거를 더 알려 주세요." }
          ]
        }
      : method === "deleteCriterion"
        ? {
            ...targetCriterion,
            rationale: "교사가 요청한 추가 평가 항목 제거 대상을 확인했습니다.",
            summaryCards: [
              { title: "대상 확인", body: "추가 평가 항목 중 하나를 정확히 찾았습니다." },
              { title: "기본 항목 보호", body: "기본 항목은 삭제 대상에서 제외했습니다." },
              { title: "제거 준비", body: "확인 버튼을 누르면 항목 관리에서 제거됩니다." }
            ]
          }
      : {
          ...(method === "updateCriterion" ? targetCriterion : {}),
          criterion: { name, description },
          rationale:
            method === "updateCriterion"
              ? "기존 추가 평가 항목을 교사의 요청에 맞게 수정합니다."
              : "기본 항목에 없는 개인화 관점을 보강합니다.",
          summaryCards: [
            { title: "중복 항목 확인", body: "기본 항목과 직접 겹치지 않습니다." },
            { title: "의도 파악", body: "학생 개인의 표현 흐름을 평가합니다." },
            { title: "평가 설명 생성", body: "리포트 분석 기준 문장으로 정리했습니다." }
          ]
        };
  await page.route("**/api/classrooms/cls_chat/report/criteria/assistant/stream", async (route) => {
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({
          type: "stage",
          stage: "UNDERSTANDING_REQUEST",
          label: "요청 이해",
          progress: 0.12,
          detail: "교사가 원하는 평가 관점을 정리하고 있습니다."
        }),
        JSON.stringify({
          type: "stage",
          stage: "CHECKING_CRITERIA",
          label: "기본/추가 항목 검토",
          progress: 0.32,
          detail: "현재 평가 기준과 겹치지 않는지 확인합니다."
        }),
        JSON.stringify({
          type: "stage",
          stage: "GENERATING_CRITERION",
          label:
            method === "deleteCriterion"
              ? "제거 확인 준비"
              : method === "updateCriterion"
                ? "수정 초안 생성"
                : "새 항목 초안 생성",
          progress: 0.56,
          detail:
            method === "deleteCriterion"
              ? "삭제해도 되는 추가 항목인지 확인합니다."
              : "리포트 분석에 넣을 항목 이름과 설명을 작성합니다."
        }),
        JSON.stringify({
          type: "thought_delta",
          text: "AI가 평가 항목 요청과 현재 분석 기준을 안전한 JSON 구조로 정리하고 있습니다."
        }),
        JSON.stringify({
          type: "stage",
          stage: "VALIDATING_APPLICABILITY",
          label: "적용 가능성 확인",
          progress: 0.76,
          detail: "중복, 길이, 분석 기준 적합성을 검토합니다."
        }),
        JSON.stringify({
          type: "proposal",
          data: {
            replyMarkdown:
              method === "messageOnly"
                ? "조금 더 구체적인 평가 장면을 알려 주시면 항목으로 정리하겠습니다."
                : method === "deleteCriterion"
                  ? `${targetCriterion.targetCriterionName} 항목 제거 확인을 준비했습니다.`
                  : method === "updateCriterion"
                    ? `${targetCriterion.targetCriterionName} 항목 수정 초안을 만들었습니다.`
                : `${name} 항목 초안을 만들었습니다.`,
            operation: {
              method,
              params: proposalParams
            },
            source: "AI"
          },
          thoughtSummary: "AI가 평가 항목 제안과 적용 가능성을 JSON으로 정리했습니다."
        }),
        JSON.stringify({
          type: "stage",
          stage: "READY_TO_APPLY",
          label:
            method === "deleteCriterion"
              ? "항목 제거 준비 완료"
              : method === "updateCriterion"
                ? "항목 수정 준비 완료"
                : "항목 추가 준비 완료",
          progress: 0.9,
          detail: "검토 후 항목에 반영할 수 있습니다."
        }),
        JSON.stringify({ type: "stage", stage: "COMPLETE", label: "완료", progress: 1 }),
        JSON.stringify({ type: "done" })
      ].join("\n")
    });
  });
}

async function expectInsideViewport(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  options: { minWidth?: number; minHeight?: number } = {}
) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(options.minWidth ?? 24);
  expect(box!.height).toBeGreaterThanOrEqual(options.minHeight ?? 24);
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function assertStudentSelectorFits(page: Page) {
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    elements: Array.from(
      document.querySelectorAll<HTMLElement>(
        ".report-student-panel, .report-student-controls, .report-student-option, .report-student-row-main, .report-student-detail"
      )
    )
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({
        className: element.className,
        overflow: element.scrollWidth - element.clientWidth
      }))
      .filter((entry) => entry.overflow > 2)
  }));
  expect(overflow.page).toBeLessThanOrEqual(1);
  expect(overflow.elements).toEqual([]);
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    page: (() => {
      const shell = document.querySelector<HTMLElement>(".report-page");
      return shell ? shell.scrollWidth - shell.clientWidth : document.documentElement.scrollWidth - document.documentElement.clientWidth;
    })(),
    wideElements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => element.offsetParent !== null)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: element.textContent?.trim().slice(0, 80) ?? "",
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollOverflow: Math.round(element.scrollWidth - element.clientWidth)
        };
      })
      .filter((entry) => entry.right > document.documentElement.clientWidth + 2 || entry.scrollOverflow > 2)
      .slice(0, 12),
    resultElements: Array.from(
      document.querySelectorAll<HTMLElement>(
        ".report-result-hero, .report-result-meta-strip, .report-result-card, .report-result-competency-panel, .report-result-competency-item, .report-result-side-card, .report-result-lecture-panel, .report-result-lecture-row"
      )
    )
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({
        className: element.className,
        overflow: element.scrollWidth - element.clientWidth
      }))
      .filter((entry) => entry.overflow > 2)
  }));
  expect(overflow.page, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(1);
  expect(overflow.resultElements, JSON.stringify(overflow, null, 2)).toEqual([]);
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

type OverlayLayoutSnapshot = Record<string, {
  x: number;
  y: number;
  width: number;
  height: number;
}>;

async function captureReportOverlayLayout(
  page: Page,
  extras: Record<string, Locator> = {}
): Promise<OverlayLayoutSnapshot> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {
        // Ignore animations that cannot be finished, such as browser-managed effects.
      }
    }
  });
  const targets: Record<string, Locator> = {
    shell: page.getByTestId("app-shell-content"),
    hero: page.locator("[data-testid='report-setup-hero'], [data-testid='report-criteria-page-head']").first(),
    sectionPanel: page.getByTestId("report-section-panel"),
    ...extras
  };
  const entries = await Promise.all(
    Object.entries(targets).map(async ([name, locator]) => {
      const box = await locator.boundingBox();
      expect(box, `${name} box`).toBeTruthy();
      return [name, {
        x: Math.round(box!.x),
        y: Math.round(box!.y),
        width: Math.round(box!.width),
        height: Math.round(box!.height)
      }] as const;
    })
  );
  return Object.fromEntries(entries);
}

function expectReportLayoutStable(before: OverlayLayoutSnapshot, after: OverlayLayoutSnapshot) {
  for (const key of Object.keys(before)) {
    expect(Math.abs(after[key].x - before[key].x), `${key} x shifted`).toBeLessThanOrEqual(2);
    expect(Math.abs(after[key].y - before[key].y), `${key} y shifted`).toBeLessThanOrEqual(2);
    expect(Math.abs(after[key].width - before[key].width), `${key} width changed`).toBeLessThanOrEqual(2);
    expect(Math.abs(after[key].height - before[key].height), `${key} height changed`).toBeLessThanOrEqual(2);
  }
}

async function expectFloatingOverlay(page: Page, drawer: Locator, shellBox?: OverlayLayoutSnapshot[string]) {
  await expectInsideViewport(page, drawer, { minWidth: 320, minHeight: 420 });
  const position = await drawer.evaluate((element) => getComputedStyle(element).position);
  expect(position).toBe("fixed");

  const drawerBox = await drawer.boundingBox();
  const currentShellBox =
    shellBox ?? (await captureReportOverlayLayout(page)).shell;
  expect(drawerBox).toBeTruthy();
  expect(drawerBox!.x).toBeLessThan(currentShellBox.x + currentShellBox.width - 24);
  expect(drawerBox!.x + drawerBox!.width).toBeGreaterThan(currentShellBox.x + 24);

  const ownsHitPoint = await drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.min(rect.right - 8, Math.max(rect.left + 8, rect.left + rect.width / 2));
    const y = Math.min(rect.bottom - 8, rect.top + 28);
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && element.contains(hit));
  });
  expect(ownsHitPoint).toBe(true);

  const noHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(noHorizontalOverflow).toBe(true);
}

async function expectReportChatToggleClearance(page: Page, drawer: Locator) {
  await expect(page.locator(".report-chat-toggle")).toBeVisible();
  const clearance = await page.evaluate(() => {
    const drawerElement = document.querySelector<HTMLElement>("[data-testid='report-chat-drawer']");
    const toggleElement = document.querySelector<HTMLElement>(".report-chat-toggle");
    const inputElement = document.querySelector<HTMLElement>("[data-testid='report-chat-input']");
    const sendElement = document.querySelector<HTMLElement>("[data-testid='report-chat-send']");

    if (!drawerElement || !toggleElement || !inputElement || !sendElement) {
      return null;
    }

    const drawerRect = drawerElement.getBoundingClientRect();
    const toggleRect = toggleElement.getBoundingClientRect();
    const inputRect = inputElement.getBoundingClientRect();
    const sendRect = sendElement.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    return {
      drawerBottomGap: toggleRect.top - drawerRect.bottom,
      overlapsInput: overlaps(toggleRect, inputRect),
      overlapsSend: overlaps(toggleRect, sendRect)
    };
  });

  expect(clearance, "report chat toggle clearance").toBeTruthy();
  expect(clearance!.drawerBottomGap).toBeGreaterThanOrEqual(8);
  expect(clearance!.overlapsInput).toBe(false);
  expect(clearance!.overlapsSend).toBe(false);
  await expectInsideViewport(page, drawer);
}

async function expectOverlayBoundsAcrossViewports(page: Page, drawer: Locator) {
  for (const size of [
    { width: 1600, height: 900 },
    { width: 1440, height: 900 },
    { width: 1366, height: 640 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(size);
    await expectFloatingOverlay(page, drawer);
  }
}

test("student report chatbot opens, uses text only, and renders fake stream", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockReportPage(page);
  const chatRequestBodies: Array<{
    message: string;
    history?: Array<{ role: "user" | "assistant"; contentMarkdown: string }>;
  }> = [];
  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/chat/stream", async (route) => {
    const requestBody = JSON.parse(route.request().postData() || "{}") as {
      message: string;
      history?: Array<{ role: "user" | "assistant"; contentMarkdown: string }>;
    };
    chatRequestBodies.push(requestBody);
    const requestIndex = chatRequestBodies.length;
    if (requestIndex <= 2) {
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
    const answerText =
      requestIndex === 1
        ? JSON.stringify({
            report:
              "### 학습 상태 요약\n\n- **정의 설명**을 먼저 짧게 말하게 해보세요.\n- 다음 행동: 짧은 예시를 붙여 확인합니다."
          })
        : requestIndex === 2
          ? "### 새 채팅 답변\n\n- 새 세션에는 이전 대화가 섞이지 않습니다."
          : "### 이전 세션 후속 답변\n\n- 앞선 학습 상태 요약을 이어서 봅니다.";
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "answer_delta", text: answerText }),
        JSON.stringify({ type: "done", answerText })
      ].join("\n")
    });
  });

  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByTestId("topbar-nav-grades")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("app-shell-nav").getByTestId("report-section-nav")).toBeVisible();
  await expect(page.getByTestId("app-shell-content").getByTestId("report-section-nav")).toHaveCount(0);
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);
  const beforeOverlay = await captureReportOverlayLayout(page, {
    contentPanel: page.locator(".report-meta-strip").first()
  });
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();

  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await expect(drawer).toBeVisible();
  const afterOverlay = await captureReportOverlayLayout(page, {
    contentPanel: page.locator(".report-meta-strip").first()
  });
  expectReportLayoutStable(beforeOverlay, afterOverlay);
  await expectFloatingOverlay(page, drawer, beforeOverlay.shell);
  await expectOverlayBoundsAcrossViewports(page, drawer);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(drawer.getByTestId("report-chat-coach-title")).toHaveText("AI 학습 코치");
  await expect(drawer.getByTestId("report-chat-coach-avatar")).toBeVisible();
  await expect(drawer.getByTestId("report-chat-coach-subtitle")).toContainText("민수");
  await expect(drawer.getByTestId("report-chat-welcome")).toBeVisible();
  await expect(drawer.getByTestId("report-chat-welcome-bubble")).toContainText(
    "민수 학생에 대한 질문을 기다리고 있습니다."
  );
  await expect(drawer.getByTestId("report-chat-advisory")).toContainText("AI 답변은 참고용");
  const drawerVisualMetrics = await drawer.evaluate((element) => {
    const drawerRect = element.getBoundingClientRect();
    const drawerStyle = window.getComputedStyle(element);
    const header = element.querySelector(".report-chat-header");
    const headerStyle = header ? window.getComputedStyle(header) : null;
    const bubble = element.querySelector("[data-testid='report-chat-welcome-bubble']");
    const bubbleStyle = bubble ? window.getComputedStyle(bubble) : null;
    const select = element.querySelector(".report-chat-session-select");
    const close = element.querySelector(".report-chat-close");
    const selectRect = select?.getBoundingClientRect();
    const closeRect = close?.getBoundingClientRect();

    return {
      width: drawerRect.width,
      height: drawerRect.height,
      radius: Number.parseFloat(drawerStyle.borderRadius),
      position: drawerStyle.position,
      drawerBackgroundImage: drawerStyle.backgroundImage,
      headerBackgroundImage: headerStyle?.backgroundImage ?? "",
      bubbleBackgroundImage: bubbleStyle?.backgroundImage ?? "",
      actionTopDelta: selectRect && closeRect ? Math.abs(selectRect.top - closeRect.top) : 0
    };
  });
  expect(drawerVisualMetrics.width).toBeGreaterThanOrEqual(470);
  expect(drawerVisualMetrics.width).toBeLessThanOrEqual(540);
  expect(drawerVisualMetrics.height).toBeGreaterThanOrEqual(470);
  expect(drawerVisualMetrics.height).toBeLessThanOrEqual(620);
  expect(drawerVisualMetrics.radius).toBeGreaterThanOrEqual(20);
  expect(drawerVisualMetrics.radius).toBeLessThanOrEqual(28);
  expect(drawerVisualMetrics.position).toBe("fixed");
  expect(drawerVisualMetrics.drawerBackgroundImage).toContain("gradient");
  expect(drawerVisualMetrics.headerBackgroundImage).toContain("gradient");
  expect(drawerVisualMetrics.bubbleBackgroundImage).toContain("gradient");
  expect(drawerVisualMetrics.actionTopDelta).toBeLessThanOrEqual(8);
  await expectReportChatToggleClearance(page, drawer);
  await page.screenshot({
    path: "test-results/report-chat-coach-empty-desktop.png",
    fullPage: false,
    animations: "disabled"
  });
  await page.screenshot({
    path: "test-results/report-chatbot-overlay-desktop.png",
    fullPage: false,
    animations: "disabled"
  });
  await expect(drawer.locator("input[type='file']")).toHaveCount(0);
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("정의 설명을 어떻게 보강할까요?");
  await drawer.getByRole("button", { name: "전송" }).click();
  await expect(drawer.getByRole("button", { name: "새 채팅" })).toBeDisabled();

  await expect(drawer.locator(".report-chat-markdown h3", { hasText: "학습 상태 요약" })).toBeVisible();
  await expect(drawer.locator(".report-chat-markdown strong", { hasText: "정의 설명" })).toBeVisible();
  await expect(drawer.locator(".report-chat-message.assistant").last()).not.toContainText('{"report"');
  await expect(drawer.getByTestId("report-chat-assistant-avatar").first()).toBeVisible();
  await expect(drawer.getByTestId("report-chat-message-bubble").last()).toBeVisible();
  await page.screenshot({
    path: "test-results/report-chat-coach-answer-desktop.png",
    fullPage: false,
    animations: "disabled"
  });
  await page.screenshot({
    path: "test-results/report-chatbot-markdown-session-desktop.png",
    fullPage: false,
    animations: "disabled"
  });

  const sessionSelect = drawer.getByLabel("리포트 챗봇 대화 세션");
  await expect(sessionSelect.locator("option")).toHaveCount(1);
  const firstSessionValue = await sessionSelect.locator("option").first().getAttribute("value");
  expect(firstSessionValue).toBeTruthy();
  await drawer.getByRole("button", { name: "새 채팅" }).click();
  await expect(drawer.getByText("민수 학생에 대한 질문을 기다리고 있습니다.")).toBeVisible();
  await expect(drawer.locator(".report-chat-markdown h3", { hasText: "학습 상태 요약" })).toHaveCount(0);
  await expect(sessionSelect.locator("option")).toHaveCount(2);
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("새 채팅에서 질문할게요");
  await drawer.getByRole("button", { name: "전송" }).click();
  await expect(sessionSelect).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "새 채팅" })).toBeDisabled();
  await expect(drawer.locator(".report-chat-markdown h3", { hasText: "새 채팅 답변" })).toBeVisible();
  expect(chatRequestBodies[1]?.history ?? []).toEqual([]);

  await sessionSelect.selectOption(firstSessionValue!);
  await expect(drawer.locator(".report-chat-markdown h3", { hasText: "학습 상태 요약" })).toBeVisible();
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("이전 세션에서 이어서 질문합니다");
  await drawer.getByRole("button", { name: "전송" }).click();
  await expect(drawer.locator(".report-chat-markdown h3", { hasText: "이전 세션 후속 답변" })).toBeVisible();
  const previousSessionHistory = JSON.stringify(chatRequestBodies[2]?.history ?? []);
  expect(previousSessionHistory).toContain("### 학습 상태 요약");
  expect(previousSessionHistory).not.toContain('{"report"');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectFloatingOverlay(page, drawer);
  await expectInsideViewport(page, drawer.locator(".report-chat-header-actions"), {
    minWidth: 250,
    minHeight: 34
  });
  const mobileNoOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(mobileNoOverflow).toBe(true);
  await expect(drawer.getByTestId("report-chat-send")).toBeVisible();
  await expectReportChatToggleClearance(page, drawer);
  await page.screenshot({
    path: "test-results/report-chat-coach-mobile.png",
    fullPage: false,
    animations: "disabled"
  });
  await page.screenshot({
    path: "test-results/report-chatbot-markdown-session-mobile.png",
    fullPage: false,
    animations: "disabled"
  });
});

test("student report surfaces teacher-created exam stats separately from session quizzes", async ({ page }) => {
  const reportWithTeacherExam = makeReport("stu_1", "민수");
  reportWithTeacherExam.sourceStats = {
    ...reportWithTeacherExam.sourceStats,
    gradedQuizCount: 0,
    averageQuizScore: 0,
    teacherExamResultCount: 1,
    teacherExamAverageScore: 88
  };
  reportWithTeacherExam.summaryMarkdown =
    "- 교사 배포 시험 결과 **1건**, 평균 **88점**을 함께 반영했습니다.";

  await mockReportPage(page, { reportAOverride: reportWithTeacherExam });
  await page.goto("/classrooms/cls_chat/report?reportSection=students");

  const selectedStudent = page
    .getByTestId("report-student-option")
    .filter({ hasText: "민수" })
    .first();
  await expect(selectedStudent.getByTestId("report-student-detail")).toContainText("교사 시험");
  await expect(selectedStudent.getByTestId("report-student-detail")).toContainText("1건 · 88점");

  await page.getByTestId("report-nav-content").click();
  const statRow = page.locator(".report-result-stat-row");
  await expect(statRow.locator(".report-result-stat-chip", { hasText: "채점 퀴즈" })).toContainText("0건");
  await expect(statRow.locator(".report-result-stat-chip", { hasText: "평균 점수" })).toContainText("0점");
  await expect(statRow.locator(".report-result-stat-chip", { hasText: "교사 시험" })).toContainText("1건 · 88점");
});

test("student report keeps legacy teacher exam count from looking like zero average", async ({ page }) => {
  const legacyReport = makeReport("stu_1", "민수");
  legacyReport.sourceStats = {
    ...legacyReport.sourceStats,
    teacherExamResultCount: 1
  };
  delete (legacyReport.sourceStats as Record<string, unknown>).teacherExamAverageScore;

  await mockReportPage(page, { reportAOverride: legacyReport });
  await page.goto("/classrooms/cls_chat/report?reportSection=students");

  const selectedStudent = page
    .getByTestId("report-student-option")
    .filter({ hasText: "민수" })
    .first();
  await expect(selectedStudent.getByTestId("report-student-detail")).toContainText("교사 시험");
  await expect(selectedStudent.getByTestId("report-student-detail")).toContainText("1건 · -");

  await page.getByTestId("report-nav-content").click();
  await expect(
    page.locator(".report-result-stat-chip", { hasText: "교사 시험" })
  ).toContainText("1건 · -");
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
  await expect(drawer.getByTestId("report-chat-coach-title")).toHaveText("AI 학습 코치");
  await expect(drawer.getByTestId("report-chat-welcome-bubble")).toContainText(
    "민수 학생에 대한 질문을 기다리고 있습니다."
  );
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("질문");
  await drawer.getByRole("button", { name: "전송" }).click();

  await expect(drawer.getByRole("alert")).toContainText("학생 리포트를 먼저 생성");
});

test("student report chatbot keeps partial answer when a stream fails after deltas", async ({ page }) => {
  await mockReportPage(page);
  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/chat/stream", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({
          type: "answer_delta",
          text: "### 부분 답변\n\n- 먼저 남아야 하는 조언입니다."
        })
      ].join("\n")
    })
  );

  await page.goto("/classrooms/cls_chat/report");
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("중간에 실패해도 남나요?");
  await drawer.getByRole("button", { name: "전송" }).click();

  await expect(drawer.locator(".report-chat-markdown h3", { hasText: "부분 답변" })).toBeVisible();
  await expect(drawer.getByRole("alert")).toContainText("최종 결과");
  await expect(drawer.getByTestId("report-chat-input")).toBeEnabled();
  await expect(drawer.getByTestId("report-chat-send")).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "학생 리포트 챗봇 닫기" })).toBeEnabled();
});

test("student report selector hides chatbot entrypoint and restores it on content section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockReportPage(page);

  await page.goto("/classrooms/cls_chat/report?reportSection=students");
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "학생 리포트 챗봇 열기" })).toHaveCount(0);
  await expect(page.locator(".report-chat-toggle")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "리포트 챗봇" })).toHaveCount(0);

  await assertStudentSelectorFits(page);
  await page.screenshot({
    path: "test-results/report-student-selector-no-ai-toggle-desktop.png",
    fullPage: false,
    animations: "disabled"
  });

  await page.getByTestId("report-nav-content").click();
  await expect(page).toHaveURL(/reportSection=content/);
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await expect(drawer).toBeVisible();
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
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "학생 리포트 챗봇 열기" })).toHaveCount(0);
  await expect(page.locator(".report-chat-toggle")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "리포트 챗봇" })).toHaveCount(0);
  await page.waitForTimeout(650);
  await expect(page.getByText("늦은 답변")).toHaveCount(0);

  await page.getByTestId("report-nav-content").click();
  await expect(page).toHaveURL(/reportSection=content/);
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "리포트 챗봇" })).toHaveCount(0);
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const reopenedDrawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await expect(reopenedDrawer.getByText("민수 학생에 대한 질문을 기다리고 있습니다.")).toBeVisible();
  await expect(reopenedDrawer.getByText("늦은 답변")).toHaveCount(0);
});

test("student report chatbot floating close aborts active stream", async ({ page }) => {
  await mockReportPage(page);
  await page.route("**/api/classrooms/cls_chat/report/students/stu_1/chat/stream", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "answer_delta", text: "닫힌 뒤 늦은 답변" }),
        JSON.stringify({ type: "done", answerText: "닫힌 뒤 늦은 답변" })
      ].join("\n")
    });
  });

  await page.goto("/classrooms/cls_chat/report");
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await drawer.getByLabel("학생 리포트 챗봇 질문").fill("늦은 응답 테스트");
  await drawer.getByRole("button", { name: "전송" }).click();
  await page.locator(".report-chat-toggle").click();
  await expect(page.getByRole("dialog", { name: "리포트 챗봇" })).toHaveCount(0);
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  await expect(page.getByText("닫힌 뒤 늦은 답변")).toHaveCount(0);
});

test("criteria assistant opens, renders staged proposal, and applies to criteria list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageState = await mockReportPage(page);
  await mockCriteriaAssistantStream(page);

  await page.goto("/classrooms/cls_chat/report");
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  await expect(page.getByRole("dialog", { name: "리포트 챗봇" })).toBeVisible();
  await page.getByTestId("report-nav-criteria").click();
  await expect(page.getByRole("dialog", { name: "리포트 챗봇" })).toHaveCount(0);
  const beforeOverlay = await captureReportOverlayLayout(page, {
    hero: page.getByTestId("report-criteria-page-head"),
    criteriaPanel: page.locator(".report-criteria-panel")
  });

  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await expect(drawer).toBeVisible();
  const afterOverlay = await captureReportOverlayLayout(page, {
    hero: page.getByTestId("report-criteria-page-head"),
    criteriaPanel: page.locator(".report-criteria-panel")
  });
  expectReportLayoutStable(beforeOverlay, afterOverlay);
  await expectFloatingOverlay(page, page.getByTestId("report-criteria-ai-drawer"), beforeOverlay.shell);
  await expectOverlayBoundsAcrossViewports(page, page.getByTestId("report-criteria-ai-drawer"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력을 평가하는 항목을 써줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();

  await expect(page.getByTestId("report-criteria-ai-progress")).toBeVisible();
  for (const stage of [
    "UNDERSTANDING_REQUEST",
    "CHECKING_CRITERIA",
    "GENERATING_CRITERION",
    "VALIDATING_APPLICABILITY",
    "READY_TO_APPLY",
    "COMPLETE"
  ]) {
    await expect(page.getByTestId(`report-criteria-ai-stage-${stage}`)).toContainText("완료");
  }
  await expect(page.getByTestId("report-criteria-ai-summary-card")).toHaveCount(3);
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("추천 새 항목");
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 논리력");
  await expect(page.getByTestId("report-criteria-ai-apply")).toBeEnabled();
  await expectInsideViewport(page, page.getByTestId("report-criteria-ai-drawer"), {
    minWidth: 360,
    minHeight: 520
  });
  await expectInsideViewport(page, page.getByTestId("report-criteria-ai-composer"), {
    minWidth: 320,
    minHeight: 60
  });
  await page.getByTestId("report-criteria-ai-progress").scrollIntoViewIfNeeded();
  await expectInsideViewport(page, page.getByTestId("report-criteria-ai-progress"), {
    minWidth: 320,
    minHeight: 120
  });
  await page.getByTestId("report-criteria-ai-proposal-card").scrollIntoViewIfNeeded();
  await expectInsideViewport(page, page.getByTestId("report-criteria-ai-proposal-card"), {
    minWidth: 320,
    minHeight: 120
  });
  await page.screenshot({ path: "test-results/report-criteria-ai-assistant-desktop.png", fullPage: false });

  const beforeCounts = pageState.getCriteriaRequestCounts();
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 1개");
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "발표 논리력" })).toBeVisible();
  await expect(drawer).toContainText("발표 논리력 항목을 평가 항목 관리에 반영했습니다.");
  const afterCounts = pageState.getCriteriaRequestCounts();
  expect(afterCounts.POST - beforeCounts.POST).toBe(1);
  expect(afterCounts.GET).toBeGreaterThan(beforeCounts.GET);
});

test("criteria assistant mobile visual fit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockReportPage(page);
  await mockCriteriaAssistantStream(page);

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 항목을 써줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 논리력");
  const fitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(fitsViewport).toBe(true);
  const drawerBox = await page.getByTestId("report-criteria-ai-drawer").boundingBox();
  expect(drawerBox).toBeTruthy();
  expect(drawerBox!.x).toBeGreaterThanOrEqual(-1);
  expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(391);
  expect(drawerBox!.y).toBeGreaterThanOrEqual(-1);
  expect(drawerBox!.y + drawerBox!.height).toBeLessThanOrEqual(845);
  await expectInsideViewport(page, page.getByTestId("report-criteria-ai-composer"), {
    minWidth: 320,
    minHeight: 58
  });
  await expectInsideViewport(page, page.getByTestId("report-criteria-ai-proposal-card"), {
    minWidth: 300,
    minHeight: 110
  });
  await page.screenshot({ path: "test-results/report-criteria-ai-assistant-mobile.png", fullPage: false });
});

test("criteria assistant auto-applies explicit create proposal exactly once", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const pageState = await mockReportPage(page);
  await mockCriteriaAssistantStream(page, {
    name: "자료 연결력",
    description: "수업 자료와 자기 답변을 연결해 근거 있는 설명으로 확장하는 정도를 평가합니다.",
    method: "createCriterion"
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("자료 연결력 항목에 반영해줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();

  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 1개");
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "자료 연결력" })).toBeVisible();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toHaveCount(0);
  await expect(drawer).toContainText("자료 연결력 항목을 평가 항목 관리에 반영했습니다.");
  expect(pageState.getCriteriaRequestCounts().POST).toBe(1);
  expect(pageState.getCriteriaWriteBodies()).toHaveLength(1);
});

test("criteria assistant edits and deletes existing custom criteria only after confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const initialCriteria = [
    {
      id: "crit_presentation",
      name: "발표 논리력",
      description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
      updatedAt: "2026-04-29T00:00:00.000Z"
    },
    {
      id: "crit_collaboration",
      name: "협업 태도",
      description: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다.",
      updatedAt: "2026-04-29T00:00:00.000Z"
    }
  ];
  const pageState = await mockReportPage(page, { initialCriteria });
  await mockCriteriaAssistantStream(page, {
    method: "updateCriterion",
    targetCriterionId: "crit_presentation",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z",
    name: "발표 구조화",
    description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 내용을 발표 구조화 중심으로 고쳐줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();

  const updateCard = page.getByTestId("report-criteria-ai-proposal-card");
  await expect(updateCard).toContainText("기존 항목 수정");
  await expect(updateCard).toContainText("현재 항목");
  await expect(updateCard).toContainText("발표 논리력");
  await expect(updateCard).toContainText("수정 후");
  await expect(updateCard).toContainText("발표 구조화");
  await expect(page.getByTestId("report-criteria-ai-apply")).toHaveText("수정하기");
  await page.screenshot({
    path: "test-results/report-criteria-ai-assistant-update.png",
    fullPage: false,
    animations: "disabled"
  });
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(0);
  expect(pageState.getCriteriaRequestCounts().POST).toBe(0);
  await page.getByTestId("report-criteria-add-toggle").click();
  const criteriaAddForm = page.getByTestId("report-criteria-form");
  await criteriaAddForm.getByRole("textbox", { name: "항목 이름", exact: true }).fill("작성 중 항목");
  await criteriaAddForm.getByRole("textbox", { name: "세부 설명", exact: true }).fill("AI 제안 적용 중에도 보존되어야 하는 입력값");

  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "발표 구조화" })).toBeVisible();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "발표 논리력" })).toHaveCount(0);
  await expect(criteriaAddForm.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("작성 중 항목");
  await expect(criteriaAddForm.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue(
    "AI 제안 적용 중에도 보존되어야 하는 입력값"
  );
  await expect(drawer).toContainText("발표 구조화 항목 수정 사항을 평가 항목 관리에 반영했습니다.");
  let counts = pageState.getCriteriaRequestCounts();
  expect(counts.PATCH).toBe(1);
  expect(counts.POST).toBe(0);
  expect(counts.DELETE).toBe(0);

  await page.unroute("**/api/classrooms/cls_chat/report/criteria/assistant/stream");
  await mockCriteriaAssistantStream(page, {
    method: "deleteCriterion",
    targetCriterionId: "crit_collaboration",
    targetCriterionName: "협업 태도",
    targetCriterionDescription: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z"
  });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("협업 태도 제거해줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();

  const deleteCard = page.getByTestId("report-criteria-ai-proposal-card");
  await expect(deleteCard).toContainText("기존 항목 제거 확인");
  await expect(deleteCard).toContainText("삭제 대상");
  await expect(deleteCard).toContainText("협업 태도");
  await expect(page.getByTestId("report-criteria-ai-apply")).toHaveText("제거하기");
  await page.screenshot({
    path: "test-results/report-criteria-ai-assistant-delete.png",
    fullPage: false,
    animations: "disabled"
  });
  counts = pageState.getCriteriaRequestCounts();
  expect(counts.DELETE).toBe(0);

  await page.getByTestId("report-criteria-ai-apply").evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error("apply button missing");
    button.click();
    button.click();
  });
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "협업 태도" })).toHaveCount(0);
  await expect(drawer).toContainText("협업 태도 항목을 평가 항목 관리에서 제거했습니다.");
  counts = pageState.getCriteriaRequestCounts();
  expect(counts.PATCH).toBe(1);
  expect(counts.POST).toBe(0);
  expect(counts.DELETE).toBe(1);
});

test("criteria assistant blocks stale update proposals and retries failed delete", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const pageState = await mockReportPage(page, {
    initialCriteria: [
      {
        id: "crit_presentation",
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ]
  });
  await mockCriteriaAssistantStream(page, {
    method: "updateCriterion",
    targetCriterionId: "crit_presentation",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z",
    name: "발표 구조화",
    description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 내용을 고쳐줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 구조화");

  await page.getByRole("button", { name: "발표 논리력 수정" }).click();
  const manualEditRow = page.getByTestId("report-criterion-custom").filter({ hasText: "발표 논리력" });
  const manualEditForm = manualEditRow.getByTestId("report-criterion-edit-form");
  await expect(manualEditForm).toBeVisible();
  await manualEditForm.getByRole("textbox", { name: "수정할 평가 항목 이름" }).fill("발표 논리력");
  await manualEditForm.getByRole("textbox", { name: "수정할 세부 내용" }).fill(
    "교사가 직접 먼저 다듬은 설명입니다."
  );
  await manualEditForm.getByRole("button", { name: "저장" }).click();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "교사가 직접 먼저 다듬은 설명입니다." })).toBeVisible();
  const afterManualEditCounts = pageState.getCriteriaRequestCounts();

  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(drawer.getByRole("alert")).toContainText("대상 평가 항목이 변경되었습니다.");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(afterManualEditCounts.PATCH);
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 구조화");

  await page.unroute("**/api/classrooms/cls_chat/report/criteria/assistant/stream");
  pageState.setCriteriaDeleteFailure(true);
  await mockCriteriaAssistantStream(page, {
    method: "deleteCriterion",
    targetCriterionId: "crit_presentation",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "교사가 직접 먼저 다듬은 설명입니다.",
    targetCriterionUpdatedAt: "2026-04-30T00:00:00.000Z"
  });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 제거해줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("기존 항목 제거 확인");
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(drawer.getByRole("alert")).toContainText("criteria delete failed");
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 논리력");
  expect(pageState.getCriteriaRequestCounts().DELETE).toBe(1);

  pageState.setCriteriaDeleteFailure(false);
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "발표 논리력" })).toHaveCount(0);
  expect(pageState.getCriteriaRequestCounts().DELETE).toBe(2);
});

test("criteria assistant retries failed update and locks double update apply", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const pageState = await mockReportPage(page, {
    criteriaPatchFailure: true,
    initialCriteria: [
      {
        id: "crit_presentation",
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ]
  });
  await mockCriteriaAssistantStream(page, {
    method: "updateCriterion",
    targetCriterionId: "crit_presentation",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z",
    name: "발표 구조화",
    description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 내용을 고쳐줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("기존 항목 수정");

  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(drawer.getByRole("alert")).toContainText("criteria update failed");
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 구조화");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(1);

  pageState.setCriteriaPatchFailure(false);
  await page.getByTestId("report-criteria-ai-apply").evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error("apply button missing");
    button.click();
    button.click();
  });
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "발표 구조화" })).toBeVisible();
  await expect(drawer).toContainText("발표 구조화 항목 수정 사항을 평가 항목 관리에 반영했습니다.");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(2);
});

test("criteria assistant blocks missing targets and criteria load failure before update delete apply", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const pageState = await mockReportPage(page, {
    initialCriteria: [
      {
        id: "crit_presentation",
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ]
  });
  await mockCriteriaAssistantStream(page, {
    method: "deleteCriterion",
    targetCriterionId: "crit_presentation",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z"
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 제거해줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("기존 항목 제거 확인");

  await page.getByRole("button", { name: "발표 논리력 삭제" }).click();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "발표 논리력" })).toHaveCount(0);
  const afterDirectDeleteCounts = pageState.getCriteriaRequestCounts();
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(drawer.getByRole("alert")).toContainText("대상 평가 항목을 찾을 수 없습니다.");
  expect(pageState.getCriteriaRequestCounts().DELETE).toBe(afterDirectDeleteCounts.DELETE);
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 논리력");

  await page.unroute("**/api/classrooms/cls_chat/report/criteria/assistant/stream");
  const loadFailureState = await mockReportPage(page, { criteriaFailure: true });
  await mockCriteriaAssistantStream(page, {
    method: "updateCriterion",
    targetCriterionId: "crit_missing_in_ui",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z",
    name: "발표 구조화",
    description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
  });
  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const loadFailureDrawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await loadFailureDrawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 내용을 고쳐줘");
  await loadFailureDrawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("기존 항목 수정");
  await expect(page.getByTestId("report-criteria-ai-apply")).toBeDisabled();
  expect(loadFailureState.getCriteriaRequestCounts().PATCH).toBe(0);
  expect(loadFailureState.getCriteriaRequestCounts().DELETE).toBe(0);
});

test("criteria assistant blocks duplicate names on update but allows self-name updates", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const pageState = await mockReportPage(page, {
    initialCriteria: [
      {
        id: "crit_presentation",
        name: "발표 논리력",
        description: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      },
      {
        id: "crit_collaboration",
        name: "협업 태도",
        description: "모둠 활동에서 맡은 역할과 상호작용을 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ]
  });
  await mockCriteriaAssistantStream(page, {
    method: "updateCriterion",
    targetCriterionId: "crit_presentation",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z",
    name: "협업 태도",
    description: "다른 추가 항목과 같은 이름으로 바꾸려는 수정안입니다."
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 이름을 협업 태도로 바꿔줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("협업 태도");
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(drawer.getByRole("alert")).toContainText("이미 사용 중인 평가 항목 이름입니다.");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(0);
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("협업 태도");

  await page.unroute("**/api/classrooms/cls_chat/report/criteria/assistant/stream");
  await mockCriteriaAssistantStream(page, {
    method: "updateCriterion",
    targetCriterionId: "crit_presentation",
    targetCriterionName: "발표 논리력",
    targetCriterionDescription: "발표에서 주장과 근거를 연결하는 정도를 평가합니다.",
    targetCriterionUpdatedAt: "2026-04-29T00:00:00.000Z",
    name: "발표 논리력",
    description: "같은 이름을 유지하되 설명만 더 구체적으로 다듬습니다."
  });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 설명만 고쳐줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("설명만 더 구체적으로");
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "설명만 더 구체적으로 다듬습니다." })).toBeVisible();
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(1);
});

test("criteria assistant does not render apply card for downgraded message-only criterion payload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const pageState = await mockReportPage(page);
  await page.route("**/api/classrooms/cls_chat/report/criteria/assistant/stream", async (route) => {
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({
          type: "proposal",
          data: {
            replyMarkdown: "기본 평가 항목은 수정하거나 삭제할 수 없습니다.",
            operation: {
              method: "messageOnly",
              params: {
                criterion: {
                  name: "개념 이해도 수정안",
                  description: "기본 항목을 잘못 새 항목처럼 되살리면 안 됩니다."
                }
              }
            },
            source: "AI",
            downgradeReason: "built_in_target"
          }
        }),
        JSON.stringify({ type: "done" })
      ].join("\n")
    });
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("개념 이해도 내용을 고쳐줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();

  await expect(drawer).toContainText("기본 평가 항목은 수정하거나 삭제할 수 없습니다.");
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toHaveCount(0);
  expect(pageState.getCriteriaRequestCounts().POST).toBe(0);
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(0);
  expect(pageState.getCriteriaRequestCounts().DELETE).toBe(0);
});

test("criteria assistant clears stale proposal and locks double manual apply", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const pageState = await mockReportPage(page);
  await mockCriteriaAssistantStream(page, { name: "발표 논리력" });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("발표 논리력 항목을 써줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("발표 논리력");

  await page.unroute("**/api/classrooms/cls_chat/report/criteria/assistant/stream");
  await mockCriteriaAssistantStream(page, { method: "messageOnly" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("잠깐, 더 물어볼게");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(drawer).toContainText("조금 더 구체적인 평가 장면을 알려 주시면");
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toHaveCount(0);
  expect(pageState.getCriteriaRequestCounts().POST).toBe(0);

  await page.unroute("**/api/classrooms/cls_chat/report/criteria/assistant/stream");
  await mockCriteriaAssistantStream(page, { name: "협업 책임감" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("협업 책임감 항목을 써줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("협업 책임감");
  await page.getByTestId("report-criteria-ai-apply").evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error("apply button missing");
    button.click();
    button.click();
  });
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 1개");
  expect(pageState.getCriteriaRequestCounts().POST).toBe(1);
});

test("criteria assistant floating toggle close aborts active request", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await mockReportPage(page);
  await mockCriteriaAssistantStream(page, { name: "지연 항목", delayMs: 450 });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await drawer.getByLabel("AI 리포트 도우미 메시지").fill("지연 항목을 써줘");
  await drawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await page.locator(".report-chat-toggle").click();
  await expect(page.getByRole("dialog", { name: "AI 리포트 도우미" })).toHaveCount(0);
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toHaveCount(0);
  await expect(page.getByText("지연 항목 항목 초안을 만들었습니다.")).toHaveCount(0);
});

test("criteria assistant blocks duplicate apply and keeps failed proposal visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const duplicateState = await mockReportPage(page);
  await mockCriteriaAssistantStream(page, {
    name: "개념 이해도",
    description: "이미 있는 기본 항목과 같은 이름입니다."
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const duplicateDrawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await duplicateDrawer.getByLabel("AI 리포트 도우미 메시지").fill("개념 이해도 항목을 추가해줘");
  await duplicateDrawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("개념 이해도");
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(duplicateDrawer.getByRole("alert")).toContainText("이미 사용 중인 평가 항목 이름입니다.");
  expect(duplicateState.getCriteriaRequestCounts().POST).toBe(0);

  await page.unroute("**/api/classrooms/cls_chat/report/criteria/assistant/stream");
  duplicateState.setCriteriaPostFailure(true);
  await mockCriteriaAssistantStream(page, { name: "협업 태도" });
  await page.reload();
  await page.getByRole("button", { name: "AI 리포트 도우미 열기" }).click();
  const failingDrawer = page.getByRole("dialog", { name: "AI 리포트 도우미" });
  await failingDrawer.getByLabel("AI 리포트 도우미 메시지").fill("협업 태도 항목을 써줘");
  await failingDrawer.getByRole("button", { name: "AI 도우미 전송" }).click();
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("협업 태도");
  await page.getByTestId("report-criteria-ai-apply").click();
  await expect(failingDrawer.getByRole("alert")).toContainText("criteria create failed");
  await expect(page.getByTestId("report-criteria-ai-proposal-card")).toContainText("협업 태도");
  expect(duplicateState.getCriteriaRequestCounts().POST).toBe(1);
});

test("student report internal navigation separates sections and fits layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockReportPage(page);

  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByTestId("topbar-nav-grades")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("app-shell-nav").getByTestId("report-section-nav")).toBeVisible();
  await expect(page.getByTestId("app-shell-content").getByTestId("report-section-nav")).toHaveCount(0);
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);

  const desktopNavBox = await page
    .getByTestId("app-shell-nav")
    .getByTestId("report-section-nav")
    .boundingBox();
  const desktopPanelBox = await page.getByTestId("report-section-panel").boundingBox();
  expect(desktopNavBox).toBeTruthy();
  expect(desktopPanelBox).toBeTruthy();
  expect(desktopNavBox!.x + desktopNavBox!.width).toBeLessThanOrEqual(desktopPanelBox!.x + 1);
  const desktopFitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(desktopFitsViewport).toBe(true);

  await page.getByTestId("report-nav-students").click();
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.getByTestId("report-nav-students")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);
  await expect(page.getByTestId("report-content-section")).toHaveCount(0);

  await page.getByTestId("report-nav-criteria").click();
  await expect(page).toHaveURL(/reportSection=criteria/);
  await expect(page.getByTestId("report-nav-criteria")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".report-criteria-panel")).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.getByTestId("report-content-section")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classrooms/cls_chat/report?reportSection=unknown");
  await expect(page.getByTestId("mobile-topbar-title")).toHaveText("성적");
  await page.getByTestId("mobile-nav-open").click();
  await expect(page.getByTestId("mobile-report-nav-content")).toHaveAttribute("aria-current", "page");
  const mobileNavBox = await page
    .getByTestId("app-shell-nav")
    .getByTestId("mobile-report-section-nav")
    .boundingBox();
  const mobilePanelBox = await page.getByTestId("report-section-panel").boundingBox();
  expect(mobileNavBox).toBeTruthy();
  expect(mobilePanelBox).toBeTruthy();
  expect(mobileNavBox!.x).toBeGreaterThanOrEqual(-1);
  expect(mobileNavBox!.x).toBeLessThanOrEqual(391);
  expect(mobilePanelBox!.x).toBeGreaterThanOrEqual(-1);
  expect(mobilePanelBox!.x + mobilePanelBox!.width).toBeLessThanOrEqual(391);
  const mobileFitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(mobileFitsViewport).toBe(true);
});

test("student report content result visual layout matches redesigned reference", async ({ page }) => {
  const visualScores = [0, 38, 0, 0, 0, 44, 42, 42, 38, 42];
  const visualReport = {
    ...makeReport("stu_1", "시나리오1 학생 01"),
    classroomTitle: "시나리오1 테스트 강의실",
    generatedAt: "2026-05-03T11:38:20.000Z",
    analysisStatus: "SPARSE_DATA",
    generationMode: "AI_ANALYZED",
    overallScore: 25,
    overallLevel: "EMERGING",
    headline: "기초 체력을 올리면서 약점 개념을 좁혀가야 하는 구간입니다.",
    summaryMarkdown:
      "- 누적 강의 2개, 세션 0개를 기준으로 분석했습니다.\n- 채점된 퀴즈 평균은 0점이고, 페이지 커버리지는 **0%**입니다.\n- 아직 뚜렷한 약점 메모는 많지 않으며, 더 많은 응시 데이터가 들어오면 정밀도가 올라갑니다.",
    competencies: builtInReportCriteria.map((criterion, index) => ({
      key: `VISUAL_${index}`,
      label: criterion.name,
      score: visualScores[index] ?? 0,
      trend: "STEADY",
      summary: index === 1
        ? "아직 질문 데이터가 많지 않아, 막히는 지점을 문장으로 남기면 분석 정확도가 높아집니다."
        : criterion.description,
      evidence:
        index === 1
          ? ["질문 수 0건"]
          : index === 5
            ? ["세션 0개", "완료 페이지 0개"]
            : ["평균 퀴즈 점수 0점"]
    })),
    strengths: [],
    growthAreas: [],
    coachingInsights: [
      "질문을 한 줄이라도 남기게 유도하면 병목 파악 속도가 빨라집니다.",
      "짧은 복습 퀴즈를 자주 넣어 정답 경험을 먼저 쌓는 편이 유리합니다.",
      "설명 선호 데이터가 더 쌓이면 코칭 톤도 더 정밀하게 맞출 수 있습니다."
    ],
    recommendedActions: [
      {
        title: "약점 개념 1개 집중 복습",
        description: "최근 오답 개념"
      },
      {
        title: "짧은 퀴즈 재투입",
        description: "MCQ/OX 위주로 즉시 피드백을 주고 성공 경험을 늘려 주세요."
      },
      {
        title: "질문 로그 유지",
        description: "학생이 막힌 문장을 그대로 남기게 하면 다음 리포트의 정밀도가 크게 올라갑니다."
      }
    ],
    lectureInsights: [
      {
        lectureId: "lec_1",
        lectureTitle: "MergeAISystem 가이드 테스트 자료",
        weekTitle: "1주차",
        questionCount: 0,
        quizCount: 0,
        averageQuizScore: 0,
        masteryLabel: "관찰 데이터 축적 중"
      },
      {
        lectureId: "lec_2",
        lectureTitle: "또 다른것",
        weekTitle: "1주차",
        questionCount: 0,
        quizCount: 0,
        averageQuizScore: 0,
        masteryLabel: "관찰 데이터 축적 중"
      }
    ],
    sourceStats: {
      ...makeReport("stu_1", "시나리오1 학생 01").sourceStats,
      lectureCount: 2,
      sessionCount: 0,
      completedPageCount: 0,
      pageCoverageRatio: 0,
      progressPageCount: 0,
      progressCoverageRatio: 0,
      questionCount: 0,
      quizCount: 0,
      gradedQuizCount: 0,
      averageQuizScore: 0
    },
    dataQualityNote:
      "현재는 데이터가 적어 보수적으로 추정한 임시 리포트입니다. 질문/퀴즈/피드백이 더 쌓이면 정확도가 올라갑니다."
  } as ReturnType<typeof makeReport>;

  await page.setViewportSize({ width: 1440, height: 900 });
  await mockReportPage(page, { reportAOverride: visualReport });
  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(visualReport.headline)).toBeVisible();
  await expect(page.getByText("25")).toBeVisible();
  await expect(page.getByText("기초 형성")).toBeVisible();
  await expect(page.getByText("Gemini 분석")).toBeVisible();
  await expect(page.getByText("데이터 적음")).toBeVisible();
  await expect(page.getByText("10개 역량 체크리스트")).toBeVisible();
  await expect(page.getByText("코칭 인사이트")).toBeVisible();
  await expect(page.getByText("MergeAISystem 가이드 테스트 자료")).toBeVisible();

  const hero = page.locator(".report-result-hero");
  const heroBox = await hero.boundingBox();
  const ringBox = await page.locator(".report-result-hero .report-score-ring").boundingBox();
  expect(heroBox).toBeTruthy();
  expect(ringBox).toBeTruthy();
  expect(heroBox!.height).toBeGreaterThanOrEqual(230);
  expect(ringBox!.width).toBeGreaterThanOrEqual(140);
  expect(ringBox!.width).toBeLessThanOrEqual(190);
  expect(ringBox!.x).toBeGreaterThan(heroBox!.x + heroBox!.width * 0.62);

  const chipRects = await page.locator(".report-result-stat-chip").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: Math.round(rect.top), width: Math.round(rect.width) };
    })
  );
  expect(chipRects).toHaveLength(6);
  expect(Math.max(...chipRects.map((rect) => rect.top)) - Math.min(...chipRects.map((rect) => rect.top))).toBeLessThanOrEqual(2);
  expect(Math.min(...chipRects.map((rect) => rect.width))).toBeGreaterThan(120);

  const summaryRects = await page.locator(".report-result-summary-card").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    })
  );
  expect(summaryRects).toHaveLength(2);
  expect(Math.abs(summaryRects[0].y - summaryRects[1].y)).toBeLessThanOrEqual(2);
  expect(summaryRects[1].x).toBeGreaterThan(summaryRects[0].x + summaryRects[0].width * 0.75);

  await expect(page.locator(".report-result-competency-item")).toHaveCount(10);
  const firstCompetencyBox = await page.locator(".report-result-competency-item").first().boundingBox();
  const firstCompetencyScoreBox = await page.locator(".report-result-competency-item .report-competency-meta").first().boundingBox();
  const firstTrackBox = await page.locator(".report-result-competency-item .report-score-track").first().boundingBox();
  await expect(page.locator(".report-result-competency-item .report-evidence-pill").first()).toBeVisible();
  expect(firstCompetencyBox).toBeTruthy();
  expect(firstCompetencyScoreBox).toBeTruthy();
  expect(firstTrackBox).toBeTruthy();
  expect(firstCompetencyScoreBox!.x).toBeGreaterThan(firstCompetencyBox!.x + firstCompetencyBox!.width * 0.78);
  expect(firstTrackBox!.height).toBeGreaterThanOrEqual(8);

  const insightRects = await page.locator(".report-result-side-card").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    })
  );
  expect(insightRects).toHaveLength(4);
  expect(Math.abs(insightRects[0].y - insightRects[1].y)).toBeLessThanOrEqual(2);
  expect(insightRects[1].x).toBeGreaterThan(insightRects[0].x + insightRects[0].width * 0.75);
  await expectNoHorizontalPageOverflow(page);

  await page.screenshot({
    path: "test-results/report-result-first-viewport-desktop.png",
    fullPage: false,
    animations: "disabled"
  });

  await page.evaluate(() => {
    document.querySelector(".report-result-competency-panel")?.scrollIntoView({ block: "start" });
  });
  await expect(page.locator(".report-result-competency-panel")).toBeVisible();
  await page.screenshot({
    path: "test-results/report-result-checklist-desktop.png",
    fullPage: false,
    animations: "disabled"
  });

  await page.evaluate(() => {
    document.querySelector(".report-result-insight-grid")?.scrollIntoView({ block: "start" });
  });
  await expect(page.locator(".report-result-insight-grid")).toBeVisible();
  await page.screenshot({
    path: "test-results/report-result-insights-desktop.png",
    fullPage: false,
    animations: "disabled"
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByText(visualReport.headline)).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
  const mobileSummaryRects = await page.locator(".report-result-summary-card").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { y: Math.round(rect.y), height: Math.round(rect.height) };
    })
  );
  expect(mobileSummaryRects[1].y).toBeGreaterThan(mobileSummaryRects[0].y + mobileSummaryRects[0].height * 0.75);
  await page.screenshot({
    path: "test-results/report-result-mobile.png",
    fullPage: false,
    animations: "disabled"
  });

  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await expect(drawer).toBeVisible();
  const toggle = page.locator(".report-chat-toggle");
  const textarea = drawer.getByLabel("학생 리포트 챗봇 질문");
  const sendButton = drawer.getByRole("button", { name: "전송" });
  await expectInsideViewport(page, textarea, { minWidth: 260, minHeight: 40 });
  await expectInsideViewport(page, sendButton, { minWidth: 38, minHeight: 38 });
  if (await toggle.isVisible()) {
    const toggleBox = await toggle.boundingBox();
    const textareaBox = await textarea.boundingBox();
    const sendBox = await sendButton.boundingBox();
    expect(toggleBox).toBeTruthy();
    expect(textareaBox).toBeTruthy();
    expect(sendBox).toBeTruthy();
    expect(boxesOverlap(toggleBox!, textareaBox!)).toBe(false);
    expect(boxesOverlap(toggleBox!, sendBox!)).toBe(false);
  }
});

test("student report content result clamps visual scores and wraps long text", async ({ page }) => {
  const longToken = "LongEnglishTokenWithoutNaturalBreaksForVisualOverflowRegressionChecks0123456789";
  const stressReport = {
    ...makeReport("stu_1", "매우 긴 이름의 학생"),
    headline: `매우 긴 리포트 제목에서도 화면을 밀어내지 않아야 합니다 ${longToken}`,
    summaryMarkdown:
      [
        `- 매우 긴 한국어 문장이 들어와도 결과 카드가 가로로 벌어지지 않아야 합니다. ${longToken}`,
        "- 표와 코드가 들어와도 카드 내부에서 처리합니다.",
        "",
        `| 항목 | ${longToken} |`,
        "| --- | --- |",
        `| 긴 셀 | ${longToken} |`,
        "",
        "```txt",
        longToken,
        "```"
      ].join("\n"),
    overallScore: -5,
    competencies: builtInReportCriteria.map((criterion, index) => ({
      key: `STRESS_${index}`,
      label: `${criterion.name} ${longToken}`,
      score: index % 2 === 0 ? 130 : -5,
      trend: "STEADY",
      summary: `${criterion.description} ${longToken}`,
      evidence: [`긴 근거 ${index} ${longToken}`]
    })),
    recommendedActions: [
      {
        title: `긴 액션 제목 ${longToken}`,
        description: `긴 액션 설명도 카드 안에서 줄바꿈되어야 합니다. ${longToken}`
      }
    ],
    lectureInsights: [
      {
        lectureId: "lec_stress",
        lectureTitle: `긴 강의 제목 ${longToken}`,
        weekTitle: `긴 주차 이름 ${longToken}`,
        questionCount: 1,
        quizCount: 1,
        averageQuizScore: 130,
        masteryLabel: `긴 숙련도 ${longToken}`
      }
    ],
    dataQualityNote: `긴 품질 설명 ${longToken}`
  } as ReturnType<typeof makeReport>;

  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ colorScheme: "dark" });
  await mockReportPage(page, { reportAOverride: stressReport });
  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByText(stressReport.headline)).toBeVisible();
  await expect(page.locator(".report-result-card .report-markdown table")).toBeVisible();
  await expect(page.locator(".report-result-card .report-markdown pre")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const fillWidths = await page.locator(".report-result-competency-item .report-score-fill").evaluateAll((elements) =>
    elements.map((element) => Number.parseFloat((element as HTMLElement).style.width))
  );
  expect(Math.min(...fillWidths)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...fillWidths)).toBeLessThanOrEqual(100);
  const ringBackground = await page.locator(".report-result-hero .report-score-ring").evaluate(
    (element) => getComputedStyle(element).backgroundImage
  );
  expect(ringBackground).toContain("conic-gradient");
  expect(ringBackground).toContain("0deg");
  const resultVisualStyles = await page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>(".report-result-hero");
    const card = document.querySelector<HTMLElement>(".report-result-summary-card");
    const fill = document.querySelector<HTMLElement>(".report-result-competency-item .report-score-fill");
    const pre = document.querySelector<HTMLElement>(".report-result-card .report-markdown pre");
    const table = document.querySelector<HTMLElement>(".report-result-card .report-markdown table");
    if (!hero || !card || !fill || !pre || !table) {
      throw new Error("result visual style probes are missing");
    }
    const heroStyle = getComputedStyle(hero);
    const cardStyle = getComputedStyle(card);
    const fillStyle = getComputedStyle(fill);
    const preStyle = getComputedStyle(pre);
    const tableStyle = getComputedStyle(table);
    return {
      heroBackgroundImage: heroStyle.backgroundImage,
      cardBackgroundImage: cardStyle.backgroundImage,
      fillBackgroundImage: fillStyle.backgroundImage,
      preOverflowX: preStyle.overflowX,
      tableOverflowX: tableStyle.overflowX,
      preRight: Math.round(pre.getBoundingClientRect().right),
      tableRight: Math.round(table.getBoundingClientRect().right),
      viewportWidth: window.innerWidth
    };
  });
  expect(resultVisualStyles.heroBackgroundImage).toContain("gradient");
  expect(resultVisualStyles.cardBackgroundImage).not.toBe("none");
  expect(resultVisualStyles.fillBackgroundImage).toContain("linear-gradient");
  expect(["auto", "scroll"]).toContain(resultVisualStyles.preOverflowX);
  expect(["auto", "scroll"]).toContain(resultVisualStyles.tableOverflowX);
  expect(resultVisualStyles.preRight).toBeLessThanOrEqual(resultVisualStyles.viewportWidth + 1);
  expect(resultVisualStyles.tableRight).toBeLessThanOrEqual(resultVisualStyles.viewportWidth + 1);
});

test("student report selector searches filters expands and selects students", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const pageState = await mockReportPage(page);

  await page.goto("/classrooms/cls_chat/report?reportSection=students");
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await expect(page.getByTestId("report-setup-stat-students-total")).toContainText("참여 학생");
  await expect(page.getByTestId("report-setup-stat-students-total")).toContainText("3명");
  await expect(page.getByTestId("report-setup-stat-students-selected")).toContainText("1명");
  await expect(page.getByTestId("report-setup-stat-students-missing")).toContainText("리포트 없음");
  await expect(page.getByTestId("report-setup-stat-students-missing")).toContainText("1명");
  await expect(page.getByLabel("참여 학생 검색")).toBeVisible();
  await expect(page.getByLabel("리포트 상태 필터")).toBeVisible();
  await expect(page.getByLabel("리포트 상태 필터")).toHaveCount(1);
  await expect(page.getByTestId("report-student-option")).toHaveCount(3);
  await expect(page.getByTestId("report-student-status-counts")).toContainText("리포트 생성됨 2명");
  await expect(page.getByTestId("report-student-status-counts")).toContainText("리포트 없음 1명");
  await expect(page.getByTestId("app-shell-content")).not.toContainText("생성 대기");
  await page.getByLabel("참여 학생 검색").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("리포트 상태 필터")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "민수", exact: true })).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({
    path: "test-results/report-student-selector-desktop-collapsed.png",
    fullPage: true,
    animations: "disabled"
  });
  await assertStudentSelectorFits(page);

  const reportCountsAfterLoad = pageState.getStudentReportRequestCounts();
  const listCountAfterLoad = pageState.getStudentListRequestCount();
  const jiaRow = page.getByTestId("report-student-option").filter({ hasText: "지아" });
  const jiaNameButton = jiaRow.getByRole("button", { name: "지아", exact: true });
  await expect(jiaNameButton).toHaveAttribute("aria-expanded", "false");
  const jiaDetailId = await jiaNameButton.getAttribute("aria-controls");
  expect(jiaDetailId).toBeTruthy();
  await jiaNameButton.click();
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(jiaNameButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`#${jiaDetailId!}`)).toBeVisible();
  await expect(jiaRow.getByTestId("report-student-detail")).toBeVisible();
  expect(pageState.getStudentReportRequestCounts()).toEqual(reportCountsAfterLoad);
  await page.screenshot({
    path: "test-results/report-student-selector-desktop-expanded.png",
    fullPage: true,
    animations: "disabled"
  });

  const selectedAfterContent = await page.locator(".report-student-option.active").first().evaluate((row) => {
    const content = getComputedStyle(row, "::after").content;
    return content === "none" || content === '""' || content === "";
  });
  expect(selectedAfterContent).toBe(true);
  await expect(page.getByTestId("report-student-selected-pill")).toHaveCount(1);
  await expect(page.locator(".report-student-option.active")).toHaveAttribute("aria-current", "true");

  await page.getByLabel("리포트 상태 필터").selectOption("MISSING");
  await expect(page.getByTestId("report-student-option")).toHaveCount(1);
  await expect(page.getByTestId("report-student-option")).toContainText("도윤");
  await expect(page.getByTestId("report-student-option")).toContainText("리포트 없음");
  await expect(page.getByTestId("report-student-hidden-selected")).toBeVisible();
  await page.screenshot({
    path: "test-results/report-student-selector-filter-missing.png",
    fullPage: true,
    animations: "disabled"
  });

  await page.getByLabel("참여 학생 검색").fill("없는학생");
  await expect(page.getByTestId("report-student-filter-empty")).toBeVisible();
  await page.screenshot({
    path: "test-results/report-student-selector-filter-empty.png",
    fullPage: true,
    animations: "disabled"
  });

  await page.getByRole("button", { name: "필터 초기화" }).first().click();
  await expect(page.getByTestId("report-student-option")).toHaveCount(3);
  await page.getByLabel("참여 학생 검색").fill("  지아 ");
  await expect(page.getByTestId("report-student-option")).toHaveCount(1);
  await expect(page.getByTestId("report-student-option")).toContainText("지아");
  await page.getByLabel("참여 학생 검색").fill("3333");
  await expect(page.getByTestId("report-student-option")).toHaveCount(1);
  await expect(page.getByTestId("report-student-option")).toContainText("도윤");
  await page.getByLabel("참여 학생 검색").fill("33 33");
  await expect(page.getByTestId("report-student-option")).toHaveCount(1);
  await expect(page.getByTestId("report-student-option")).toContainText("도윤");
  await page.getByLabel("참여 학생 검색").fill("DO***");
  await expect(page.getByTestId("report-student-option")).toHaveCount(1);
  await expect(page.getByTestId("report-student-option")).toContainText("도윤");
  await page.getByLabel("리포트 상태 필터").selectOption("GENERATED");
  await expect(page.getByTestId("report-student-filter-empty")).toBeVisible();
  expect(pageState.getStudentListRequestCount()).toBe(listCountAfterLoad);

  await page.getByRole("button", { name: "필터 초기화" }).first().click();
  await expect(page.getByTestId("report-student-option")).toHaveCount(3);
  await page.getByLabel("리포트 상태 필터").selectOption("GENERATED");
  await expect(page.getByTestId("report-student-option")).toHaveCount(2);
  await expect(page.getByTestId("report-student-option").filter({ hasText: "민수" })).toHaveCount(1);
  await expect(page.getByTestId("report-student-option").filter({ hasText: "지아" })).toHaveCount(1);
  await expect(page.getByTestId("report-student-option").filter({ hasText: "도윤" })).toHaveCount(0);
  await page.getByLabel("리포트 상태 필터").selectOption("ALL");
  await page.getByRole("button", { name: "도윤", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("report-student-option").filter({ hasText: "도윤" }).getByTestId("report-student-detail")).toBeVisible();
  await page.getByRole("button", { name: "도윤 상세 접기" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("report-student-option").filter({ hasText: "도윤" }).getByTestId("report-student-detail")).toHaveCount(0);

  await page.setViewportSize({ width: 430, height: 900 });
  await page.getByRole("button", { name: "민수", exact: true }).click();
  await expect(page.getByTestId("report-student-option").filter({ hasText: "민수" }).getByTestId("report-student-detail")).toBeVisible();
  await page.screenshot({
    path: "test-results/report-student-selector-mobile-selected-expanded-initial.png",
    fullPage: true,
    animations: "disabled"
  });
  await page.getByRole("button", { name: "민수 상세 접기" }).click();
  await page.screenshot({
    path: "test-results/report-student-selector-mobile-collapsed.png",
    fullPage: true,
    animations: "disabled"
  });
  await page.getByRole("button", { name: "도윤", exact: true }).click();
  await page.screenshot({
    path: "test-results/report-student-selector-mobile-expanded.png",
    fullPage: true,
    animations: "disabled"
  });
  await assertStudentSelectorFits(page);

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByLabel("참여 학생 검색").fill("지아");
  await expect(page.getByTestId("report-student-option")).toHaveCount(1);
  await page.getByRole("button", { name: "지아 선택하기" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.getByTestId("report-nav-students")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await expect(page.getByTestId("report-content-section")).toHaveCount(0);
  const selectedJiaRow = page.getByTestId("report-student-option").filter({ hasText: "지아" });
  await expect(selectedJiaRow).toHaveAttribute("aria-current", "true");
  await expect(selectedJiaRow.getByTestId("report-student-selected-pill")).toBeVisible();
  await page.screenshot({
    path: "test-results/report-student-selector-selected-stays-desktop.png",
    fullPage: true,
    animations: "disabled"
  });
  await expect.poll(() => pageState.getStudentReportRequestCounts().stu_2).toBeGreaterThan(
    reportCountsAfterLoad.stu_2
  );

  await page.getByLabel("리포트 상태 필터").selectOption("MISSING");
  await expect(page.getByTestId("report-student-hidden-selected")).toContainText("지아");
  await page.getByTestId("report-nav-content").click();
  await expect(page).toHaveURL(/reportSection=content/);
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("지아 학생 리포트")).toBeVisible();
});

test("student report selector ignores delayed stale report preload after quick reselection", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const pageState = await mockReportPage(page, {
    studentReportDelayMs: { stu_2: 450 }
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=students");
  await expect(page.locator(".report-student-panel")).toBeVisible();
  const countsAfterLoad = pageState.getStudentReportRequestCounts();

  await page.getByRole("button", { name: "지아 선택하기" }).click();
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.getByTestId("report-student-option").filter({ hasText: "지아" })).toHaveAttribute(
    "aria-current",
    "true"
  );

  await page.getByRole("button", { name: "민수 선택하기" }).click();
  await expect(page).toHaveURL(/reportSection=students/);
  const minsuRow = page.getByTestId("report-student-option").filter({ hasText: "민수" });
  await expect(minsuRow).toHaveAttribute("aria-current", "true");
  await expect(minsuRow.getByTestId("report-student-selected-pill")).toBeVisible();

  await expect.poll(() => pageState.getStudentReportRequestCounts().stu_2).toBeGreaterThan(
    countsAfterLoad.stu_2
  );
  await expect.poll(() => pageState.getStudentReportRequestCounts().stu_1).toBeGreaterThan(
    countsAfterLoad.stu_1
  );
  await page.waitForTimeout(650);

  await page.getByTestId("report-nav-content").click();
  await expect(page).toHaveURL(/reportSection=content/);
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await expect(page.getByText("지아 학생 리포트")).toHaveCount(0);
});

test("student report selector handles empty and stale report states", async ({ page }) => {
  await mockReportPage(page, { emptyStudents: true });

  await page.goto("/classrooms/cls_chat/report");
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const noStudentDrawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await expect(noStudentDrawer.getByTestId("report-chat-welcome-bubble")).toContainText(
    "학생을 선택하면 대화를 시작할 수 있습니다."
  );
  await expect(noStudentDrawer.getByTestId("report-chat-input")).toBeDisabled();
  await expect(noStudentDrawer.getByTestId("report-chat-send")).toBeDisabled();
  await expect(noStudentDrawer.getByRole("button", { name: "학생 리포트 챗봇 닫기" })).toBeEnabled();
  await noStudentDrawer.getByRole("button", { name: "학생 리포트 챗봇 닫기" }).click();

  await page.goto("/classrooms/cls_chat/report?reportSection=students");
  await expect(page.locator(".report-student-panel")).toBeVisible();
  await expect(page.getByTestId("report-student-total-badge")).toHaveText("총 0명");
  await expect(page.getByText("아직 참여 학생이 없습니다.")).toBeVisible();
  await expect(page.getByTestId("report-student-filter-empty")).toHaveCount(0);

  await page.unrouteAll();
  const pageState = await mockReportPage(page);
  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  pageState.setStudentReportSummary("stu_1", null);
  await page.getByTestId("report-nav-students").click();
  await page.getByRole("button", { name: "학생 목록 새로고침" }).click();
  const minsuRow = page.getByTestId("report-student-option").filter({ hasText: "민수" });
  await expect(minsuRow).toContainText("리포트 없음");
  await page.getByTestId("report-nav-content").click();
  await expect(page.getByText("민수 학생 리포트")).toHaveCount(0);
  await expect(page.getByText("민수 학생의 저장된 역량 리포트가 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: "학생 리포트 챗봇 열기" }).click();
  const noReportDrawer = page.getByRole("dialog", { name: "리포트 챗봇" });
  await expect(noReportDrawer.getByTestId("report-chat-welcome-bubble")).toContainText(
    "민수 학생의 리포트를 먼저 생성해 주세요."
  );
  await expect(noReportDrawer.getByTestId("report-chat-input")).toBeDisabled();
  await expect(noReportDrawer.getByTestId("report-chat-send")).toBeDisabled();
  await expect(noReportDrawer.getByRole("button", { name: "학생 리포트 챗봇 닫기" })).toBeEnabled();
});

test("teacher manages custom report criteria without auto analysis and sees regenerated custom competency", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  const pageState = await mockReportPage(page);

  await page.goto("/classrooms/cls_chat/report");
  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await page.getByTestId("report-nav-criteria").click();
  await expect(page).toHaveURL(/reportSection=criteria/);
  const criteriaPanel = page.locator(".report-criteria-panel");
  await expect(criteriaPanel).toBeVisible();
  await expect(page.locator(".report-student-panel")).toHaveCount(0);
  await expect(page.getByText("민수 학생 리포트")).toHaveCount(0);
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 0개");
  await expect(page.getByTestId("report-setup-hero")).toHaveCount(0);
  await expect(page.getByTestId("report-setup-actions")).toHaveCount(0);
  const pageHead = page.getByTestId("report-criteria-page-head");
  await expect(pageHead).toBeVisible();
  await expect(pageHead).toContainText("평가 항목 분석 기준");
  await expect(page.getByTestId("report-criteria-custom-card")).toBeVisible();
  await expect(page.getByTestId("report-criteria-built-in-card")).toBeVisible();
  await expect(page.getByTestId("report-criteria-custom-count")).toHaveText("추가 0개");
  const splitGeometry = await criteriaPanel.evaluate((element) => {
    const customCard = element.querySelector<HTMLElement>("[data-testid='report-criteria-custom-card']");
    const builtInCard = element.querySelector<HTMLElement>("[data-testid='report-criteria-built-in-card']");
    const addButton = element.querySelector<HTMLElement>("[data-testid='report-criteria-add-toggle']");
    const emptyState = element.querySelector<HTMLElement>("[data-testid='report-criteria-empty-state']");
    if (!customCard || !builtInCard || !addButton || !emptyState) {
      throw new Error("criteria split probes are missing");
    }
    const customRect = customCard.getBoundingClientRect();
    const builtInRect = builtInCard.getBoundingClientRect();
    const addRect = addButton.getBoundingClientRect();
    const customStyle = getComputedStyle(customCard);
    const builtInStyle = getComputedStyle(builtInCard);
    const emptyStyle = getComputedStyle(emptyState);
    const emptyRect = emptyState.getBoundingClientRect();
    const emptyCta = emptyState.querySelector<HTMLElement>("[data-testid='report-criteria-empty-add']");
    const emptyCtaRect = emptyCta?.getBoundingClientRect();
    return {
      customAboveBuiltIn: customRect.bottom < builtInRect.top,
      cardBorderVisible:
        Number.parseFloat(customStyle.borderTopWidth) >= 1 &&
        Number.parseFloat(builtInStyle.borderTopWidth) >= 1 &&
        customStyle.borderTopColor !== "rgba(0, 0, 0, 0)" &&
        builtInStyle.borderTopColor !== "rgba(0, 0, 0, 0)",
      cardRadius: Math.min(
        Number.parseFloat(customStyle.borderTopLeftRadius),
        Number.parseFloat(builtInStyle.borderTopLeftRadius)
      ),
      addRightAligned: Math.abs(addRect.right - (customRect.right - Number.parseFloat(customStyle.paddingRight))) <= 3,
      emptyDashed: emptyStyle.borderTopStyle === "dashed",
      emptyTallEnough: emptyState.getBoundingClientRect().height >= 170,
      emptyCtaCentered: emptyCtaRect
        ? Math.abs((emptyCtaRect.left + emptyCtaRect.right) / 2 - (emptyRect.left + emptyRect.right) / 2) < emptyRect.width * 0.18
        : false,
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    };
  });
  expect(splitGeometry.customAboveBuiltIn).toBe(true);
  expect(splitGeometry.cardBorderVisible).toBe(true);
  expect(splitGeometry.cardRadius).toBeGreaterThanOrEqual(8);
  expect(splitGeometry.addRightAligned).toBe(true);
  expect(splitGeometry.emptyDashed).toBe(true);
  expect(splitGeometry.emptyTallEnough).toBe(true);
  expect(splitGeometry.emptyCtaCentered).toBe(true);
  expect(splitGeometry.pageFits).toBe(true);
  await page.screenshot({
    path: "test-results/report-criteria-split-empty.png",
    animations: "disabled"
  });
  await expect(page.getByTestId("report-criteria-custom-list")).toHaveCount(0);
  await expect(page.getByTestId("report-criterion-built-in")).toHaveCount(
    builtInReportCriteria.length
  );
  for (const criterion of builtInReportCriteria) {
    const builtInRow = page
      .getByTestId("report-criterion-built-in")
      .filter({ hasText: criterion.name });
    await expect(builtInRow).toContainText(criterion.description);
    await expect(builtInRow.getByTestId("report-criterion-source-badge")).toHaveText("기본");
    await expect(builtInRow.getByTestId("report-criterion-fixed-status")).toHaveText("삭제 불가");
    await expect(builtInRow.getByRole("button", { name: /수정|삭제/ })).toHaveCount(0);
  }
  await expect(page.getByText("아직 추가된 평가 항목이 없습니다.")).toBeVisible();
  await expect(page.getByTestId("report-criteria-form")).toHaveCount(0);

  await page.getByTestId("report-criteria-add-toggle").click();

  const composer = page.getByTestId("report-criteria-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("textbox", { name: "항목 이름", exact: true }).fill("취소할 초안");
  await composer.getByRole("textbox", { name: "세부 설명", exact: true }).fill("취소 후 사라져야 하는 설명");
  await page.getByTestId("report-criteria-create-cancel").click();
  await expect(page.getByTestId("report-criteria-form")).toHaveCount(0);
  await page.getByTestId("report-criteria-add-toggle").click();
  await expect(composer.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("");
  await expect(composer.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue("");
  await expect(composer.getByTestId("report-criteria-preset")).toHaveCount(3);
  const presetNames = ["피드백 수용력", "자료 탐색력", "학습 계획성"];
  const screenshotExampleNames = ["발표 논리력", "협업 태도", "문제 접근 방식"];
  for (const presetName of presetNames) {
    expect(builtInReportCriteria.map((criterion) => criterion.name)).not.toContain(presetName);
    expect(screenshotExampleNames).not.toContain(presetName);
    const presetButton = composer.getByRole("button", { name: `${presetName} 프리셋 적용` });
    await expect(presetButton).toBeVisible();
    await expect(presetButton).toHaveAttribute("type", "button");
  }
  const composerGeometry = await composer.evaluate((element) => {
    const presetRow = element.querySelector<HTMLElement>("[data-testid='report-criteria-presets']");
    const firstInput = element.querySelector<HTMLElement>("input");
    const helper = element.querySelector<HTMLElement>("[data-testid='report-criteria-helper']");
    const actions = element.querySelector<HTMLElement>("[data-testid='report-criteria-form-actions']");
    if (!presetRow || !firstInput || !helper || !actions) {
      throw new Error("criteria composer probes are missing");
    }
    const composerRect = element.getBoundingClientRect();
    const presetRect = presetRow.getBoundingClientRect();
    const inputRect = firstInput.getBoundingClientRect();
    const helperRect = helper.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const style = getComputedStyle(element);
    const contentRight = composerRect.right - Number.parseFloat(style.paddingRight);
    return {
      borderTopWidth: Number.parseFloat(style.borderTopWidth),
      borderTopColor: style.borderTopColor,
      borderRadius: Number.parseFloat(style.borderTopLeftRadius),
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      presetBottom: presetRect.bottom,
      inputTop: inputRect.top,
      helperTop: helperRect.top,
      actionsRightDelta: Math.abs(contentRight - actionsRect.right),
      fits: element.scrollWidth <= element.clientWidth + 1
    };
  });
  expect(composerGeometry.borderTopWidth).toBeGreaterThanOrEqual(1);
  expect(composerGeometry.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(composerGeometry.borderRadius).toBeGreaterThanOrEqual(14);
  expect(composerGeometry.borderRadius).toBeLessThanOrEqual(16);
  expect(
    composerGeometry.backgroundImage !== "none" ||
      !["rgba(0, 0, 0, 0)", "transparent"].includes(composerGeometry.backgroundColor)
  ).toBe(true);
  expect(composerGeometry.presetBottom).toBeLessThan(composerGeometry.inputTop);
  expect(composerGeometry.helperTop).toBeGreaterThan(composerGeometry.inputTop);
  expect(composerGeometry.actionsRightDelta).toBeLessThanOrEqual(2);
  expect(composerGeometry.fits).toBe(true);
  await composer.screenshot({
    path: "test-results/report-criteria-presets.png",
    animations: "disabled"
  });
  await page.screenshot({
    path: "test-results/report-criteria-split-add-open.png",
    animations: "disabled"
  });

  const countsAfterLoad = pageState.getCriteriaRequestCounts();
  await composer.getByRole("button", { name: "피드백 수용력 프리셋 적용" }).click();
  await expect(criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("피드백 수용력");
  await expect(criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue(
    "교사와 AI 피드백 이후 설명 방식, 풀이 전략, 학습 태도를 조정하는 정도를 평가합니다."
  );
  expect(pageState.getCriteriaRequestCounts()).toEqual(countsAfterLoad);
  expect(pageState.getAnalyzeRequestCount()).toBe(0);
  await expect(page.getByTestId("report-criterion-custom")).toHaveCount(0);

  await criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true }).fill("개념 이해도");
  await criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true }).fill("기본 항목 이름과 중복되는지 확인");
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이미 사용 중인 평가 항목 이름입니다.");
  expect(pageState.getCriteriaRequestCounts().POST).toBe(countsAfterLoad.POST);

  await composer.getByRole("button", { name: "피드백 수용력 프리셋 적용" }).click();
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 1개");
  await expect(page.getByTestId("report-criteria-custom-count")).toHaveText("추가 1개");
  await expect(page.getByTestId("report-criteria-form")).toHaveCount(0);
  const firstCustomCriterion = page.getByTestId("report-criterion-custom").filter({
    hasText: "피드백 수용력"
  });
  await expect(firstCustomCriterion).toBeVisible();
  await expect(firstCustomCriterion.getByTestId("report-criterion-source-badge")).toHaveText("추가 항목");
  await expect(firstCustomCriterion.getByRole("button", { name: "피드백 수용력 수정" })).toBeVisible();
  await expect(firstCustomCriterion.getByRole("button", { name: "피드백 수용력 삭제" })).toBeVisible();
  await expect(page.getByTestId("report-criteria-custom-list").getByTestId("report-criterion-custom")).toHaveCount(1);
  await expect(page.getByTestId("report-criteria-built-in-list").getByTestId("report-criterion-built-in")).toHaveCount(
    builtInReportCriteria.length
  );
  const populatedGeometry = await criteriaPanel.evaluate((element) => {
    const aiToggle = document.querySelector<HTMLElement>(".report-chat-toggle");
    const customActions = element.querySelector<HTMLElement>("[data-testid='report-criterion-custom'] .report-criteria-actions");
    const builtInActions = element.querySelector<HTMLElement>("[data-testid='report-criterion-built-in'] .report-criteria-actions");
    if (!aiToggle || !customActions || !builtInActions) throw new Error("populated probes are missing");
    const aiRect = aiToggle.getBoundingClientRect();
    const actionsRect = customActions.getBoundingClientRect();
    const builtInActionsRect = builtInActions.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      aiAwayFromActions: !overlaps(aiRect, actionsRect),
      aiAwayFromBuiltInActions: !overlaps(aiRect, builtInActionsRect),
      customListInsideCustomCard:
        Boolean(element.querySelector("[data-testid='report-criteria-custom-card'] [data-testid='report-criteria-custom-list']")) &&
        !element.querySelector("[data-testid='report-criteria-built-in-card'] [data-testid='report-criteria-custom-list']"),
      builtInListInsideBuiltInCard:
        Boolean(element.querySelector("[data-testid='report-criteria-built-in-card'] [data-testid='report-criteria-built-in-list']")) &&
        !element.querySelector("[data-testid='report-criteria-custom-card'] [data-testid='report-criteria-built-in-list']")
    };
  });
  expect(populatedGeometry.aiAwayFromActions).toBe(true);
  expect(populatedGeometry.aiAwayFromBuiltInActions).toBe(true);
  expect(populatedGeometry.customListInsideCustomCard).toBe(true);
  expect(populatedGeometry.builtInListInsideBuiltInCard).toBe(true);
  await page.screenshot({
    path: "test-results/report-criteria-split-populated.png",
    animations: "disabled"
  });
  expect(pageState.getCriteriaRequestCounts().POST).toBe(countsAfterLoad.POST + 1);
  expect(pageState.getCriteriaWriteBodies().at(-1)).toEqual({
    method: "POST",
    body: {
      name: "피드백 수용력",
      description: "교사와 AI 피드백 이후 설명 방식, 풀이 전략, 학습 태도를 조정하는 정도를 평가합니다."
    }
  });
  expect(pageState.getAnalyzeRequestCount()).toBe(0);

  await page.getByTestId("report-criteria-add-toggle").click();
  await criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true }).fill("피드백 수용력");
  await criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true }).fill("이미 추가한 커스텀 항목 이름");
  const countsAfterFirstCreate = pageState.getCriteriaRequestCounts();
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이미 사용 중인 평가 항목 이름입니다.");
  expect(pageState.getCriteriaRequestCounts()).toEqual(countsAfterFirstCreate);
  await criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true }).fill("  피드백   수용력 ");
  await criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true }).fill("공백 정규화 중복 이름");
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이미 사용 중인 평가 항목 이름입니다.");
  expect(pageState.getCriteriaRequestCounts()).toEqual(countsAfterFirstCreate);

  await firstCustomCriterion.getByRole("button", { name: "피드백 수용력 수정" }).click();
  const firstEditForm = firstCustomCriterion.getByTestId("report-criterion-edit-form");
  await expect(firstEditForm).toBeVisible();
  await expect(page.getByTestId("report-criterion-edit-form")).toHaveCount(1);
  await expect(page.locator(".report-chat-toggle")).toBeHidden();
  await expect(firstEditForm.getByRole("textbox", { name: "수정할 평가 항목 이름" })).toHaveValue("피드백 수용력");
  await expect(firstEditForm.getByRole("textbox", { name: "수정할 세부 내용" })).toHaveValue(
    "교사와 AI 피드백 이후 설명 방식, 풀이 전략, 학습 태도를 조정하는 정도를 평가합니다."
  );
  await expect(page.getByTestId("report-criteria-form")).toHaveCount(0);
  await page.getByTestId("report-nav-content").click();
  await expect(page).toHaveURL(/reportSection=content/);
  await expect(page.locator(".report-chat-toggle")).toBeVisible();
  await page.getByTestId("report-nav-criteria").click();
  await expect(page).toHaveURL(/reportSection=criteria/);
  await expect(firstEditForm).toBeVisible();
  await expect(page.locator(".report-chat-toggle")).toBeHidden();
  const inlineEditGeometry = await firstCustomCriterion.evaluate((row) => {
    const summary = row.querySelector<HTMLElement>("[data-testid='report-criterion-summary']");
    const form = row.querySelector<HTMLElement>("[data-testid='report-criterion-edit-form']");
    const firstField = row.querySelector<HTMLElement>(".report-criterion-edit-field");
    const label = firstField?.querySelector<HTMLElement>("span");
    const input = firstField?.querySelector<HTMLElement>("input");
    const textarea = row.querySelector<HTMLElement>("textarea");
    const actions = row.querySelector<HTMLElement>("[data-testid='report-criterion-edit-actions']");
    const buttons = actions ? [...actions.querySelectorAll<HTMLButtonElement>("button")] : [];
    if (!summary || !form || !label || !input || !textarea || !actions || buttons.length < 2) {
      throw new Error("inline edit probes are missing");
    }
    const summaryRect = summary.getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const style = getComputedStyle(form);
    const contentRight = formRect.right - Number.parseFloat(style.paddingRight);
    const buttonHeights = buttons.map((button) => button.getBoundingClientRect().height);
    return {
      formBelowHeader: formRect.top >= summaryRect.bottom - 1,
      labelLeftOfInput: labelRect.right < inputRect.left,
      labelAligned: Math.abs(labelRect.top - inputRect.top) <= 8,
      inputInside: inputRect.right <= contentRight + 1 && textareaRect.right <= contentRight + 1,
      actionsRightDelta: Math.abs(actionsRect.right - contentRight),
      buttonHeightDelta: Math.abs(buttonHeights[0] - buttonHeights[1]),
      rowFits: row.scrollWidth <= row.clientWidth + 1,
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    };
  });
  expect(inlineEditGeometry.formBelowHeader).toBe(true);
  expect(inlineEditGeometry.labelLeftOfInput).toBe(true);
  expect(inlineEditGeometry.labelAligned).toBe(true);
  expect(inlineEditGeometry.inputInside).toBe(true);
  expect(inlineEditGeometry.actionsRightDelta).toBeLessThanOrEqual(2);
  expect(inlineEditGeometry.buttonHeightDelta).toBeLessThanOrEqual(2);
  expect(inlineEditGeometry.rowFits).toBe(true);
  expect(inlineEditGeometry.pageFits).toBe(true);
  await firstCustomCriterion.screenshot({
    path: "test-results/report-criteria-inline-edit.png",
    animations: "disabled"
  });
  const patchCountBeforePreset = pageState.getCriteriaRequestCounts().PATCH;
  await page.getByTestId("report-criteria-add-toggle").click();
  await page.getByTestId("report-criteria-composer").getByRole("button", { name: "자료 탐색력 프리셋 적용" }).click();
  await expect(page.getByTestId("report-criterion-edit-form")).toHaveCount(0);
  await expect(page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true })).toBeVisible();
  await expect(criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("자료 탐색력");
  await expect(criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue(
    "학습 자료와 대화 기록에서 필요한 근거를 찾아 답변이나 질문에 연결하는 능력을 봅니다."
  );
  await expect(firstCustomCriterion).toContainText("피드백 수용력");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(patchCountBeforePreset);
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 2개");
  const secondCustomCriterion = page.getByTestId("report-criterion-custom").filter({
    hasText: "자료 탐색력"
  });
  await expect(secondCustomCriterion).toBeVisible();
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(patchCountBeforePreset);
  expect(pageState.getCriteriaWriteBodies().at(-1)?.method).toBe("POST");

  await firstCustomCriterion.getByRole("button", { name: "피드백 수용력 수정" }).click();
  const updateEditForm = firstCustomCriterion.getByTestId("report-criterion-edit-form");
  await updateEditForm.getByRole("textbox", { name: "수정할 평가 항목 이름" }).fill("발표 구조화");
  await updateEditForm.getByRole("textbox", { name: "수정할 세부 내용" }).fill(
    "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
  );
  await updateEditForm.getByRole("button", { name: "저장" }).click();
  const updatedCriterion = page.getByTestId("report-criterion-custom").filter({
    hasText: "발표 구조화"
  });
  await expect(updatedCriterion).toBeVisible();
  await expect(updatedCriterion).toContainText(
    "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
  );
  await expect(secondCustomCriterion).toContainText("자료 탐색력");
  expect(pageState.getCriteriaWriteBodies().at(-1)).toEqual({
    method: "PATCH",
    body: {
      name: "발표 구조화",
      description: "발표에서 주장, 근거, 예시를 연결하고 흐름을 분명하게 구성하는 정도를 평가합니다."
    }
  });
  expect(pageState.getAnalyzeRequestCount()).toBe(0);

  await page.getByTestId("report-nav-content").click();
  await expect(page).toHaveURL(/reportSection=content/);
  await page.getByRole("button", { name: "선택 학생 다시 분석" }).click();
  await expect(page).toHaveURL(/reportSection=content/);
  await expect(page.getByTestId("report-nav-content")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("학생별 역량 리포트 분석 진행 상황")).toBeVisible();
  const analysisButton = page.getByRole("button", { name: "Gemini 분석 중..." });
  await expect(analysisButton).toBeDisabled();
  await page.getByTestId("report-nav-students").click();
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.getByLabel("참여 학생 검색")).toBeDisabled();
  await expect(page.getByLabel("리포트 상태 필터")).toBeDisabled();
  await expect(page.getByRole("button", { name: "지아", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "지아 선택하기" })).toBeDisabled();
  await page.getByTestId("report-nav-criteria").click();
  await expect(page).toHaveURL(/reportSection=criteria/);
  await expect(page.getByTestId("report-criteria-form")).toHaveCount(0);
  await expect(page.getByTestId("report-criteria-add-toggle")).toBeDisabled();
  await expect(updatedCriterion.getByRole("button", { name: "발표 구조화 수정" })).toBeDisabled();
  await expect(updatedCriterion.getByRole("button", { name: "발표 구조화 삭제" })).toBeDisabled();
  await page.getByTestId("report-nav-content").click();
  await expect(page.getByText("주장과 근거를 연결하는 흐름이 좋아지고 있습니다.")).toBeVisible();
  await expect(page.getByText("학생별 역량 리포트 분석 진행 상황")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "선택 학생 다시 분석" })).toBeEnabled();
  expect(pageState.getAnalyzeRequestCount()).toBe(1);

  await page.getByTestId("report-nav-students").click();
  await expect(page).toHaveURL(/reportSection=students/);
  await page.locator(".report-student-option").filter({ hasText: "지아" }).click();
  await expect(page).toHaveURL(/reportSection=students/);
  await expect(page.getByTestId("report-nav-students")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("report-student-option").filter({ hasText: "지아" })).toHaveAttribute(
    "aria-current",
    "true"
  );
  await expect(page.getByText("학생별 역량 리포트 분석 진행 상황")).toHaveCount(0);

  await page.getByTestId("report-nav-criteria").click();
  await expect(page).toHaveURL(/reportSection=criteria/);
  await expect(page.getByTestId("report-criterion-custom")).toHaveCount(2);
  await updatedCriterion.getByRole("button", { name: "발표 구조화 삭제" }).click();
  await expect(page.getByTestId("report-criterion-custom")).toHaveCount(1);
  await secondCustomCriterion.getByRole("button", { name: "자료 탐색력 삭제" }).click();
  await expect(page.getByTestId("report-criterion-custom")).toHaveCount(0);
  await expect(page.getByText("아직 추가된 평가 항목이 없습니다.")).toBeVisible();
  await expect(page.getByTestId("report-criterion-built-in")).toHaveCount(
    builtInReportCriteria.length
  );
  expect(pageState.getAnalyzeRequestCount()).toBe(1);
});

test("criteria inline edit keeps drafts on failed save and delete", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  const pageState = await mockReportPage(page, {
    criteriaPatchFailure: true,
    initialCriteria: [
      {
        id: "crit_plan",
        name: "학습 계획성",
        description: "복습과 질문을 스스로 계획하는 정도를 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ]
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  await page.getByTestId("report-criteria-add-toggle").click();
  const addForm = page.getByTestId("report-criteria-form");
  await addForm.getByRole("textbox", { name: "항목 이름", exact: true }).fill("보존할 추가 초안");
  await addForm.getByRole("textbox", { name: "세부 설명", exact: true }).fill("인라인 편집 중에도 지워지면 안 되는 설명");
  const row = page.getByTestId("report-criterion-custom").filter({ hasText: "학습 계획성" });
  await row.getByRole("button", { name: "학습 계획성 수정" }).click();
  let editForm = row.getByTestId("report-criterion-edit-form");
  await editForm.getByRole("button", { name: "취소" }).click();
  await expect(page.getByTestId("report-criterion-edit-form")).toHaveCount(0);
  await page.getByTestId("report-criteria-add-toggle").click();
  await expect(addForm.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("보존할 추가 초안");
  await expect(addForm.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue(
    "인라인 편집 중에도 지워지면 안 되는 설명"
  );

  await row.getByRole("button", { name: "학습 계획성 수정" }).click();
  editForm = row.getByTestId("report-criterion-edit-form");
  await editForm.getByRole("textbox", { name: "수정할 평가 항목 이름" }).fill("학습 계획력");
  await editForm.getByRole("textbox", { name: "수정할 세부 내용" }).fill(
    "복습, 질문, 과제 수행을 계획하고 다음 학습 행동으로 연결하는 정도를 평가합니다."
  );
  await editForm.getByRole("button", { name: "저장" }).click();

  await expect(editForm.getByRole("alert")).toContainText("criteria update failed");
  await expect(editForm.getByRole("textbox", { name: "수정할 평가 항목 이름" })).toHaveValue("학습 계획력");
  await expect(row).toContainText("학습 계획성");
  await expect(row).not.toContainText("학습 계획력");
  await expect(editForm.getByRole("button", { name: "저장" })).toBeEnabled();
  await row.screenshot({
    path: "test-results/report-criteria-inline-edit-patch-failure.png",
    animations: "disabled"
  });
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(1);

  pageState.setCriteriaPatchFailure(false);
  await editForm.getByRole("button", { name: "저장" }).click();
  const updatedRow = page.getByTestId("report-criterion-custom").filter({ hasText: "학습 계획력" });
  await expect(updatedRow).toBeVisible();
  await expect(page.getByTestId("report-criterion-edit-form")).toHaveCount(0);
  await page.getByTestId("report-criteria-add-toggle").click();
  await expect(addForm.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("보존할 추가 초안");
  await expect(addForm.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue(
    "인라인 편집 중에도 지워지면 안 되는 설명"
  );
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(2);

  pageState.setCriteriaDeleteFailure(true);
  await updatedRow.getByRole("button", { name: "학습 계획력 수정" }).click();
  editForm = updatedRow.getByTestId("report-criterion-edit-form");
  await updatedRow.getByRole("button", { name: "학습 계획력 삭제" }).click();
  await expect(editForm.getByRole("alert")).toContainText("criteria delete failed");
  await expect(updatedRow).toBeVisible();
  await updatedRow.screenshot({
    path: "test-results/report-criteria-inline-edit-delete-failure.png",
    animations: "disabled"
  });
  expect(pageState.getCriteriaRequestCounts().DELETE).toBe(1);

  pageState.setCriteriaDeleteFailure(false);
  await updatedRow.getByRole("button", { name: "학습 계획력 삭제" }).click();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "학습 계획력" })).toHaveCount(0);
  await expect(page.getByTestId("report-criterion-edit-form")).toHaveCount(0);
  await page.getByTestId("report-criteria-add-toggle").click();
  await expect(addForm.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("보존할 추가 초안");
  await expect(addForm.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue(
    "인라인 편집 중에도 지워지면 안 되는 설명"
  );
  expect(pageState.getCriteriaRequestCounts().DELETE).toBe(2);
});

test("criteria inline edit validates duplicate names and stale targets", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  const pageState = await mockReportPage(page, {
    initialCriteria: [
      {
        id: "crit_plan",
        name: "학습 계획성",
        description: "복습과 질문을 스스로 계획하는 정도를 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      },
      {
        id: "crit_collab",
        name: "협업 태도",
        description: "모둠 안에서 역할과 의견 조율을 이어가는 정도를 평가합니다.",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ]
  });

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  const planRow = page.getByTestId("report-criterion-custom").filter({ hasText: "학습 계획성" });
  await planRow.getByRole("button", { name: "학습 계획성 수정" }).click();
  let editForm = planRow.getByTestId("report-criterion-edit-form");

  await editForm.getByRole("textbox", { name: "수정할 평가 항목 이름" }).fill("개념 이해도");
  await editForm.getByRole("button", { name: "저장" }).click();
  await expect(editForm.getByRole("alert")).toContainText("이미 사용 중인 평가 항목 이름입니다.");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(0);

  await editForm.getByRole("textbox", { name: "수정할 평가 항목 이름" }).fill("협업 태도");
  await editForm.getByRole("button", { name: "저장" }).click();
  await expect(editForm.getByRole("alert")).toContainText("이미 사용 중인 평가 항목 이름입니다.");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(0);

  await editForm.getByRole("textbox", { name: "수정할 평가 항목 이름" }).fill("학습 계획성");
  await editForm.getByRole("textbox", { name: "수정할 세부 내용" }).fill(
    "같은 이름을 유지하면서 세부 설명만 다듬습니다."
  );
  await editForm.getByRole("button", { name: "저장" }).click();
  await expect(page.getByTestId("report-criterion-custom").filter({ hasText: "같은 이름을 유지하면서 세부 설명만 다듬습니다." })).toBeVisible();
  await expect(page.getByTestId("report-criterion-edit-form")).toHaveCount(0);
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(1);

  const collabRow = page.getByTestId("report-criterion-custom").filter({ hasText: "협업 태도" });
  await collabRow.getByRole("button", { name: "협업 태도 수정" }).click();
  editForm = collabRow.getByTestId("report-criterion-edit-form");
  pageState.removeCriterion("crit_collab");
  await editForm.getByRole("textbox", { name: "수정할 세부 내용" }).fill(
    "서버에서 이미 사라진 항목을 저장하려는 상황입니다."
  );
  await editForm.getByRole("button", { name: "저장" }).click();
  await expect(editForm.getByRole("alert")).toContainText("criterion not found");
  await expect(editForm.getByRole("textbox", { name: "수정할 세부 내용" })).toHaveValue(
    "서버에서 이미 사라진 항목을 저장하려는 상황입니다."
  );
  await expect(collabRow).toContainText("협업 태도");
  expect(pageState.getCriteriaRequestCounts().PATCH).toBe(2);
});

test("criteria management handles loading, failed refresh, retry, and responsive rows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const pageState = await mockReportPage(page, { criteriaGetDelayMs: 300, criteriaPostDelayMs: 200 });
  const longDescription = "매우긴설명".repeat(48);

  await page.goto("/classrooms/cls_chat/report?reportSection=criteria");
  const criteriaPanel = page.locator(".report-criteria-panel");
  await expect(criteriaPanel).toBeVisible();
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 항목 불러오는 중");
  await expect(page.getByTestId("report-criteria-form")).toHaveCount(0);
  await expect(page.getByTestId("report-criteria-add-toggle")).toBeDisabled();
  await expect(page.getByTestId("report-criteria-loading-state")).toBeVisible();
  const countsWhileLoading = pageState.getCriteriaRequestCounts();
  expect(pageState.getCriteriaRequestCounts()).toEqual(countsWhileLoading);
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 0개");

  await page.getByTestId("report-criteria-add-toggle").click();
  await criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true }).fill("긴 설명 항목");
  await criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true }).fill(longDescription);
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByTestId("report-criteria-preset").first()).toBeDisabled();
  await expect(criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true })).toBeDisabled();
  await expect(criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true })).toBeDisabled();
  await expect(criteriaPanel.getByRole("button", { name: "저장 중..." })).toBeDisabled();
  const longCustomRow = page.getByTestId("report-criterion-custom").filter({
    hasText: "긴 설명 항목"
  });
  await expect(longCustomRow).toBeVisible();
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 1개");

  pageState.setCriteriaPostFailure(true);
  await page.getByTestId("report-criteria-add-toggle").click();
  await criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true }).fill("실패 보존 항목");
  await criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true }).fill("생성 실패 후에도 남아야 하는 설명입니다.");
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("criteria create failed");
  await expect(criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("실패 보존 항목");
  await expect(criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true })).toHaveValue(
    "생성 실패 후에도 남아야 하는 설명입니다."
  );
  pageState.setCriteriaPostFailure(false);
  await page.getByTestId("report-criteria-create-cancel").click();

  pageState.setCriteriaDeleteFailure(true);
  await longCustomRow.getByRole("button", { name: "긴 설명 항목 삭제" }).click();
  await expect(page.getByTestId("report-criteria-action-error")).toContainText("criteria delete failed");
  await expect(longCustomRow).toBeVisible();
  pageState.setCriteriaDeleteFailure(false);

  pageState.setCriteriaFailure(true);
  await page.getByTestId("report-criteria-add-toggle").click();
  await criteriaPanel.getByRole("textbox", { name: "항목 이름", exact: true }).fill("재조회 실패 항목");
  await criteriaPanel.getByRole("textbox", { name: "세부 설명", exact: true }).fill("재조회 실패 뒤 stale row를 숨기는지 확인합니다.");
  await page.getByTestId("report-criteria-form").getByRole("button", { name: "항목 추가", exact: true }).click();
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 항목 불러오기 실패");
  await expect(page.getByTestId("report-criterion-built-in")).toHaveCount(
    builtInReportCriteria.length
  );
  await expect(page.getByTestId("report-criterion-custom")).toHaveCount(0);
  await expect(page.getByText("아직 추가된 평가 항목이 없습니다.")).toHaveCount(0);
  await expect(page.getByTestId("report-criteria-retry")).toBeVisible();
  await expect(page.getByTestId("report-criteria-form")).toHaveCount(0);
  await expect(page.getByTestId("report-criteria-add-toggle")).toBeDisabled();
  const countsWhileFailed = pageState.getCriteriaRequestCounts();
  expect(pageState.getCriteriaRequestCounts()).toEqual(countsWhileFailed);

  pageState.setCriteriaFailure(false);
  await page.getByTestId("report-criteria-retry").click();
  await expect(page.getByTestId("report-criteria-status")).toHaveText("추가 2개");
  await expect(page.getByTestId("report-criterion-custom")).toHaveCount(2);
  await expect(longCustomRow).toBeVisible();
  await expect(
    longCustomRow.getByRole("button", { name: "긴 설명 항목 수정" })
  ).toBeVisible();
  await expect(
    longCustomRow.getByRole("button", { name: "긴 설명 항목 삭제" })
  ).toBeVisible();

  const desktopFitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(desktopFitsViewport).toBe(true);
  const desktopRowFits = await longCustomRow.evaluate((row) => row.scrollWidth <= row.clientWidth + 1);
  expect(desktopRowFits).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(longCustomRow).toBeVisible();
  const mobileHeaderGeometry = await page.getByTestId("report-criteria-page-head").evaluate((element) => {
    const title = element.querySelector<HTMLElement>("#report-criteria-page-title");
    const guide = element.querySelector<HTMLElement>("[data-testid='report-criteria-guide-pill']");
    if (!title || !guide) throw new Error("mobile criteria header probes are missing");
    const titleRect = title.getBoundingClientRect();
    const guideRect = guide.getBoundingClientRect();
    return {
      guideBelowTitle: guideRect.top > titleRect.top,
      fits: element.scrollWidth <= element.clientWidth + 1
    };
  });
  expect(mobileHeaderGeometry.guideBelowTitle).toBe(true);
  expect(mobileHeaderGeometry.fits).toBe(true);
  const mobileFitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ));
  expect(mobileFitsViewport).toBe(true);
  await page.screenshot({
    path: "test-results/report-criteria-split-mobile.png",
    animations: "disabled"
  });
  const mobileRowFits = await longCustomRow.evaluate((row) => row.scrollWidth <= row.clientWidth + 1);
  expect(mobileRowFits).toBe(true);
  await longCustomRow.getByRole("button", { name: "긴 설명 항목 수정" }).click();
  const mobileInlineForm = longCustomRow.getByTestId("report-criterion-edit-form");
  await expect(mobileInlineForm).toBeVisible();
  const mobileInlineGeometry = await longCustomRow.evaluate((row) => {
    const field = row.querySelector<HTMLElement>(".report-criterion-edit-field");
    const label = field?.querySelector<HTMLElement>("span");
    const input = field?.querySelector<HTMLElement>("input");
    const helper = row.querySelector<HTMLElement>(".report-criterion-edit-helper");
    const actions = row.querySelector<HTMLElement>("[data-testid='report-criterion-edit-actions']");
    if (!field || !label || !input || !helper || !actions) {
      throw new Error("mobile inline edit probes are missing");
    }
    const labelRect = label.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const helperRect = helper.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      labelAboveInput: labelRect.bottom <= inputRect.top,
      actionsBelowHelper: actionsRect.top >= helperRect.bottom,
      rowFits: row.scrollWidth <= row.clientWidth + 1,
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    };
  });
  expect(mobileInlineGeometry.labelAboveInput).toBe(true);
  expect(mobileInlineGeometry.actionsBelowHelper).toBe(true);
  expect(mobileInlineGeometry.rowFits).toBe(true);
  expect(mobileInlineGeometry.pageFits).toBe(true);
  await longCustomRow.screenshot({
    path: "test-results/report-criteria-inline-edit-mobile.png",
    animations: "disabled"
  });
  await mobileInlineForm.getByRole("button", { name: "취소" }).click();
  await page.getByTestId("report-criteria-add-toggle").click();
  const mobileComposerGeometry = await page.getByTestId("report-criteria-composer").evaluate((element) => {
    const helper = element.querySelector<HTMLElement>("[data-testid='report-criteria-helper']");
    const actions = element.querySelector<HTMLElement>("[data-testid='report-criteria-form-actions']");
    if (!helper || !actions) throw new Error("mobile composer probes are missing");
    const helperRect = helper.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      actionsBelowHelper: actionsRect.top >= helperRect.bottom,
      fits: element.scrollWidth <= element.clientWidth + 1
    };
  });
  expect(mobileComposerGeometry.actionsBelowHelper).toBe(true);
  expect(mobileComposerGeometry.fits).toBe(true);
});

test("criteria load failure keeps the existing saved report visible", async ({ page }) => {
  await mockReportPage(page, { criteriaFailure: true });

  await page.goto("/classrooms/cls_chat/report");

  await expect(page.getByText("민수 학생 리포트")).toBeVisible();
  await expect(page.locator(".report-criteria-panel")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("criteria unavailable");
});
