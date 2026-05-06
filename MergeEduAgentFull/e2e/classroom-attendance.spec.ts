import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const teacherUser = {
  id: "usr_attendance_teacher",
  email: "attendance.teacher@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "2468",
  emailVerified: true,
  hasPassword: true
};

const studentUser = {
  id: "usr_attendance_student",
  email: "attendance.student@example.com",
  displayName: "테스트 학생",
  role: "student",
  inviteCode: "1357",
  emailVerified: true,
  hasPassword: true
};

const weeks = [
  { id: "wk_attendance_1", classroomId: "cls_attendance", weekIndex: 1, title: "1주차", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" },
  { id: "wk_attendance_2", classroomId: "cls_attendance", weekIndex: 2, title: "2주차", createdAt: "2026-05-02T00:00:00.000Z", updatedAt: "2026-05-02T00:00:00.000Z" }
];

const baseLectures = [
  {
    lectureId: "lec_attendance_1",
    lectureTitle: "MergeAISystem 가이드 테스트 자료",
    weekId: "wk_attendance_1",
    weekTitle: "1주차",
    weekIndex: 1,
    totalPages: 13
  },
  {
    lectureId: "lec_attendance_2",
    lectureTitle: "또 다른것",
    weekId: "wk_attendance_1",
    weekTitle: "1주차",
    weekIndex: 1,
    totalPages: 6
  },
  {
    lectureId: "lec_attendance_3",
    lectureTitle: "Transformer 기초 정리",
    weekId: "wk_attendance_2",
    weekTitle: "2주차",
    weekIndex: 2,
    totalPages: 18
  }
];

function makeStudent(input: {
  index: number;
  code: string;
  reached: [number, number, number];
  touched?: [string | undefined, string | undefined, string | undefined];
}) {
  const lectures = baseLectures.map((lecture, index) => {
    const maxReachedPage = input.reached[index];
    const lastTouchedAt = input.touched?.[index];
    return {
      ...lecture,
      maxReachedPage,
      completed: lecture.totalPages > 0 && maxReachedPage >= lecture.totalPages,
      ...(lastTouchedAt ? { lastTouchedAt } : {})
    };
  });
  const completedLectureCount = lectures.filter((lecture) => lecture.completed).length;
  const totalReachedPages = lectures.reduce((sum, lecture) => sum + lecture.maxReachedPage, 0);
  const totalPages = lectures.reduce((sum, lecture) => sum + lecture.totalPages, 0);
  const latestLecture = lectures
    .filter((lecture) => lecture.lastTouchedAt)
    .sort((a, b) => Date.parse(b.lastTouchedAt!) - Date.parse(a.lastTouchedAt!))[0];
  const completionRatio = completedLectureCount / lectures.length;
  const status =
    totalReachedPages === 0
      ? "notStarted"
      : completedLectureCount === lectures.length
        ? "completed"
        : completionRatio < 0.4
          ? "needsAttention"
          : "active";

  return {
    studentUserId: `usr_attendance_student_${input.index}`,
    displayName: `시나리오1 학생 ${String(input.index).padStart(2, "0")}`,
    inviteCode: input.code,
    maskedEmail: `st***${input.index}@mergeedu.local`,
    enrolledAt: `2026-05-0${input.index}T00:00:00.000Z`,
    status,
    completedLectureCount,
    totalLectureCount: lectures.length,
    totalReachedPages,
    totalPages,
    completionRatio,
    pageCoverageRatio: totalPages > 0 ? totalReachedPages / totalPages : 0,
    ...(latestLecture?.weekTitle ? { currentWeekTitle: latestLecture.weekTitle } : {}),
    ...(latestLecture?.lastTouchedAt ? { lastTouchedAt: latestLecture.lastTouchedAt } : {}),
    lectures
  };
}

function attendancePayload(classroomId = "cls_attendance", suffix = "") {
  const normalizedWeeks = weeks.map((week) => ({ ...week, classroomId }));
  const students = [
    makeStudent({
      index: 1,
      code: "8101",
      reached: [8, 6, 12],
      touched: ["2026-05-03T12:20:00.000Z", "2026-05-03T13:00:00.000Z", "2026-05-03T15:20:00.000Z"]
    }),
    makeStudent({
      index: 2,
      code: "8102",
      reached: [5, 0, 0],
      touched: ["2026-05-03T10:20:00.000Z", undefined, undefined]
    }),
    makeStudent({
      index: 3,
      code: "8103",
      reached: [13, 6, 18],
      touched: ["2026-05-03T09:20:00.000Z", "2026-05-03T09:40:00.000Z", "2026-05-03T10:00:00.000Z"]
    }),
    makeStudent({
      index: 4,
      code: "8104",
      reached: [0, 0, 0]
    }),
    makeStudent({
      index: 5,
      code: "8105",
      reached: [2, 0, 0],
      touched: ["2026-05-03T08:10:00.000Z", undefined, undefined]
    }),
    makeStudent({
      index: 6,
      code: "8106",
      reached: [13, 6, 1],
      touched: ["2026-05-03T11:00:00.000Z", "2026-05-03T11:20:00.000Z", "2026-05-03T17:00:00.000Z"]
    })
  ].map((student) => ({
    ...student,
    displayName: `${student.displayName}${suffix}`,
    lectures: student.lectures.map((lecture) => ({ ...lecture, weekId: lecture.weekId.replace("cls_attendance", classroomId) }))
  }));

  return {
    totalStudents: students.length,
    activeStudentCount: students.filter((student) => student.totalReachedPages > 0).length,
    attentionStudentCount: students.filter((student) => student.status === "notStarted" || student.status === "needsAttention").length,
    totalLectureCount: baseLectures.length,
    totalPages: baseLectures.reduce((sum, lecture) => sum + lecture.totalPages, 0),
    weeks: normalizedWeeks,
    students
  };
}

function noMaterialsAttendancePayload() {
  const students = [
    {
      studentUserId: "usr_attendance_empty_1",
      displayName: "자료 대기 학생 01",
      inviteCode: "9001",
      maskedEmail: "em***1@mergeedu.local",
      enrolledAt: "2026-05-01T00:00:00.000Z",
      status: "noMaterials",
      completedLectureCount: 0,
      totalLectureCount: 0,
      totalReachedPages: 0,
      totalPages: 0,
      completionRatio: 0,
      pageCoverageRatio: 0,
      lectures: []
    }
  ];

  return {
    totalStudents: students.length,
    activeStudentCount: 0,
    attentionStudentCount: 0,
    totalLectureCount: 0,
    totalPages: 0,
    weeks,
    students
  };
}

function studentAttendancePayload(classroomId = "cls_attendance") {
  return {
    classroomId,
    studentUserId: studentUser.id,
    totalWeeks: 4,
    totalLectureCount: 8,
    completedLectureCount: 7,
    overallAttendanceRatio: 0.82,
    totalExamCount: 2,
    completedExamCount: 2,
    weeks: [
      {
        weekId: "wk_attendance_1",
        weekTitle: "1주차",
        weekIndex: 1,
        lectureCount: 2,
        completedLectureCount: 1,
        lectureAttendanceRatio: 0.83,
        lectures: [
          {
            ...baseLectures[0],
            maxReachedPage: 13,
            completed: true,
            lastTouchedAt: "2026-05-05T00:00:00.000Z"
          },
          {
            ...baseLectures[1],
            maxReachedPage: 4,
            completed: false,
            lastTouchedAt: "2026-05-05T01:00:00.000Z"
          }
        ],
        examCount: 1,
        completedExamCount: 1,
        inProgressExamCount: 0,
        missedExamCount: 0,
        examStatusLabel: "시험 응시 완료",
        examStatusTone: "complete",
        exams: [
          {
            examId: "exam_student_midterm",
            weekId: "wk_attendance_1",
            title: "중간고사",
            availableFrom: "2026-05-01T00:00:00.000Z",
            availableUntil: "2026-05-06T00:00:00.000Z",
            timeLimitMinutes: 60,
            totalPoints: 10,
            questionCount: 4,
            participationStatus: "graded",
            statusLabel: "응시 완료",
            statusTone: "complete",
            action: { kind: "result", label: "결과 보기", to: "/exams/exam_student_midterm" },
            attempt: {
              status: "GRADED",
              startedAt: "2026-05-05T00:00:00.000Z",
              submittedAt: "2026-05-05T00:20:00.000Z",
              gradedAt: "2026-05-05T00:20:03.000Z",
              hasGrading: true
            }
          }
        ]
      },
      {
        weekId: "wk_attendance_2",
        weekTitle: "2주차",
        weekIndex: 2,
        lectureCount: 2,
        completedLectureCount: 2,
        lectureAttendanceRatio: 1,
        lectures: [
          {
            lectureId: "lec_attendance_student_2_1",
            lectureTitle: "인증 프로토콜 심화",
            weekId: "wk_attendance_2",
            weekTitle: "2주차",
            weekIndex: 2,
            totalPages: 9,
            maxReachedPage: 9,
            completed: true
          },
          {
            lectureId: "lec_attendance_student_2_2",
            lectureTitle: "티켓 기반 인증",
            weekId: "wk_attendance_2",
            weekTitle: "2주차",
            weekIndex: 2,
            totalPages: 8,
            maxReachedPage: 8,
            completed: true
          }
        ],
        examCount: 1,
        completedExamCount: 1,
        inProgressExamCount: 0,
        missedExamCount: 0,
        examStatusLabel: "시험 응시 완료",
        examStatusTone: "complete",
        exams: [
          {
            examId: "exam_student_quiz",
            weekId: "wk_attendance_2",
            title: "보안 퀴즈",
            availableFrom: "2026-05-02T00:00:00.000Z",
            availableUntil: "2026-05-06T00:00:00.000Z",
            timeLimitMinutes: 20,
            totalPoints: 5,
            questionCount: 2,
            participationStatus: "submitted",
            statusLabel: "채점 중",
            statusTone: "progress",
            action: { kind: "disabled", label: "채점 중" },
            attempt: {
              status: "GRADING",
              startedAt: "2026-05-05T02:00:00.000Z",
              submittedAt: "2026-05-05T02:12:00.000Z",
              hasGrading: false
            }
          }
        ]
      },
      {
        weekId: "wk_attendance_3",
        weekTitle: "3주차",
        weekIndex: 3,
        lectureCount: 2,
        completedLectureCount: 1,
        lectureAttendanceRatio: 0.5,
        lectures: [
          {
            lectureId: "lec_attendance_student_3_1",
            lectureTitle: "접근 제어 개요",
            weekId: "wk_attendance_3",
            weekTitle: "3주차",
            weekIndex: 3,
            totalPages: 12,
            maxReachedPage: 12,
            completed: true
          },
          {
            lectureId: "lec_attendance_student_3_2",
            lectureTitle: "권한 모델",
            weekId: "wk_attendance_3",
            weekTitle: "3주차",
            weekIndex: 3,
            totalPages: 12,
            maxReachedPage: 0,
            completed: false
          }
        ],
        examCount: 1,
        completedExamCount: 0,
        inProgressExamCount: 0,
        missedExamCount: 1,
        examStatusLabel: "시험 미응시",
        examStatusTone: "missed",
        exams: [
          {
            examId: "exam_student_missed",
            weekId: "wk_attendance_3",
            title: "3주차 확인 시험",
            availableFrom: "2026-05-01T00:00:00.000Z",
            availableUntil: "2026-05-02T00:00:00.000Z",
            timeLimitMinutes: 20,
            totalPoints: 5,
            questionCount: 2,
            participationStatus: "missed",
            statusLabel: "시험 미응시",
            statusTone: "missed",
            action: { kind: "disabled", label: "시험 종료" }
          }
        ]
      },
      {
        weekId: "wk_attendance_4",
        weekTitle: "4주차",
        weekIndex: 4,
        lectureCount: 2,
        completedLectureCount: 0,
        lectureAttendanceRatio: 0,
        lectures: [
          {
            lectureId: "lec_attendance_student_4_1",
            lectureTitle: "최종 정리",
            weekId: "wk_attendance_4",
            weekTitle: "4주차",
            weekIndex: 4,
            totalPages: 10,
            maxReachedPage: 0,
            completed: false
          },
          {
            lectureId: "lec_attendance_student_4_2",
            lectureTitle: "프로젝트 안내",
            weekId: "wk_attendance_4",
            weekTitle: "4주차",
            weekIndex: 4,
            totalPages: 10,
            maxReachedPage: 0,
            completed: false
          }
        ],
        examCount: 0,
        completedExamCount: 0,
        inProgressExamCount: 0,
        missedExamCount: 0,
        examStatusLabel: "시험 없음",
        examStatusTone: "none",
        exams: []
      }
    ]
  };
}

type MockOptions = {
  user?: typeof teacherUser | typeof studentUser;
  attendanceFailuresBeforeSuccess?: number;
  attendanceStatus?: number;
  holdAttendanceRequest?: boolean;
};

async function mockAttendanceData(page: Page, options: MockOptions = {}) {
  const user = options.user ?? teacherUser;
  let attendanceRequests = 0;
  let studentAttendanceRequests = 0;
  let releaseAttendanceRequest: (() => void) | undefined;
  let pendingAttendanceResponses = 0;
  const attendanceResponseWaiters: Array<() => void> = [];
  const attendanceGate = new Promise<void>((resolve) => {
    releaseAttendanceRequest = resolve;
  });

  function notifyAttendanceSettled() {
    if (pendingAttendanceResponses > 0) return;
    while (attendanceResponseWaiters.length > 0) {
      attendanceResponseWaiters.shift()?.();
    }
  }

  async function fulfillAttendance(route: Route, data = attendancePayload()) {
    attendanceRequests += 1;
    pendingAttendanceResponses += 1;
    if (options.holdAttendanceRequest) {
      await attendanceGate;
    }
    try {
      if (options.attendanceStatus) {
        await route.fulfill({
          status: options.attendanceStatus,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: options.attendanceStatus === 404 ? "Classroom not found" : "Forbidden" })
        });
        return;
      }
      if (attendanceRequests <= (options.attendanceFailuresBeforeSuccess ?? 0)) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "출석 현황 실패" })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data })
      });
    } finally {
      pendingAttendanceResponses -= 1;
      notifyAttendanceSettled();
    }
  }

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { user } })
    })
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "request encryption disabled in mocked e2e" })
    })
  );
  await page.route("**/api/classrooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    })
  );
  await page.route("**/api/classrooms/cls_attendance/weeks", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: weeks })
    })
  );
  await page.route("**/api/classrooms/cls_attendance/materials", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
  );
  await page.route("**/api/classrooms/cls_attendance/attendance/me", (route) =>
    {
      studentAttendanceRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: studentAttendancePayload() })
      });
    }
  );
  await page.route("**/api/classrooms/cls_attendance/attendance", (route) => fulfillAttendance(route));
  for (const week of weeks) {
    await page.route(`**/api/weeks/${week.id}/lectures`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
    );
    await page.route(`**/api/weeks/${week.id}/exams`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) })
    );
  }

  return {
    releaseAttendanceRequest: () => releaseAttendanceRequest?.(),
    waitForAttendanceSettled: () => new Promise<void>((resolve) => {
      if (pendingAttendanceResponses === 0) {
        resolve();
        return;
      }
      attendanceResponseWaiters.push(resolve);
    }),
    getAttendanceRequests: () => attendanceRequests,
    getStudentAttendanceRequests: () => studentAttendanceRequests
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

async function expectVisualStructure(page: Page) {
  const visual = await page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>(".attendance-hero");
    const metrics = Array.from(document.querySelectorAll<HTMLElement>(".attendance-hero-metrics span"));
    const toolbar = document.querySelector<HTMLElement>(".attendance-toolbar");
    const expanded = document.querySelector<HTMLElement>(".attendance-row.expanded");
    const mobileStacked = window.innerWidth < 700
      ? getComputedStyle(document.querySelector<HTMLElement>(".attendance-toolbar")!).gridTemplateColumns.split(" ").length === 1
      : true;
    return {
      heroBackground: hero ? getComputedStyle(hero).backgroundImage : "",
      metricCount: metrics.length,
      toolbarHeight: toolbar?.getBoundingClientRect().height ?? 0,
      expandedHeight: expanded?.getBoundingClientRect().height ?? 0,
      mobileStacked
    };
  });
  expect(visual.heroBackground).toContain("linear-gradient");
  expect(visual.metricCount).toBe(3);
  expect(visual.toolbarHeight).toBeGreaterThan(44);
  expect(visual.expandedHeight).toBeGreaterThan(180);
  expect(visual.mobileStacked).toBe(true);
}

async function expectVisibleAttendanceProgressTracks(page: Page) {
  const tracks = await page.locator(".attendance-row .attendance-progress-track").evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width)
  );
  expect(tracks.length).toBeGreaterThan(0);
  for (const width of tracks) {
    expect(width).toBeGreaterThan(24);
  }
}

async function expectTopbarHeroSeparated(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const layout = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>(".app-topbar")?.getBoundingClientRect();
    const hero = document.querySelector<HTMLElement>(".attendance-hero")?.getBoundingClientRect();
    return {
      topbarBottom: topbar?.bottom ?? 0,
      heroTop: hero?.top ?? 0
    };
  });
  expect(layout.heroTop).toBeGreaterThanOrEqual(layout.topbarBottom - 1);
}

test("teacher opens classroom attendance, filters, sorts, expands, and sees scoped progress", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAttendanceData(page);

  await page.goto("/classrooms/cls_attendance?section=weeks");
  await page.getByTestId("topbar-nav-calendar").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_attendance\?section=attendance$/);
  await expect(page.getByTestId("topbar-nav-calendar")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-classroom")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "학생별 출석 현황" })).toBeVisible();
  await expect(page.getByText("전체 학생").locator("..")).toContainText("6명");
  await expect(page.getByText("출석 중").locator("..")).toContainText("5명");
  await expect(page.getByText("진도 확인 필요").locator("..")).toContainText("4명");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(6);
  await expect(page.getByTestId("classroom-attendance-detail")).toBeVisible();
  await expect(page.getByTestId("classroom-attendance-detail")).toContainText("MergeAISystem 가이드 테스트 자료");
  await expect(page.getByTestId("classroom-attendance-detail")).toContainText("8 / 13 page");
  await finishAnimations(page);
  await expectNoHorizontalOverflow(page);
  await expectVisualStructure(page);
  await expect(page.getByTestId("app-shell-content")).toHaveScreenshot("classroom-attendance-desktop-main.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.03
  });
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-attendance-desktop.png", fullPage: true });

  await page.getByLabel("학생 이름 또는 코드로 검색").fill("학생 03");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 03");
  await page.getByLabel("학생 이름 또는 코드로 검색").fill("8106");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 06");
  await page.getByLabel("학생 이름 또는 코드로 검색").fill("");

  const weekOptions = await page.getByLabel("출석 주차 필터").locator("option").allTextContents();
  expect(weekOptions).toEqual(["전체 주차", "1주차", "2주차"]);
  await page.getByLabel("출석 주차 필터").selectOption("wk_attendance_1");
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("완료 1 / 2 자료");
  await expect(page.getByTestId("classroom-attendance-detail").first()).toContainText("현재 학습 주차");
  await expect(page.getByTestId("classroom-attendance-detail").first()).toContainText("1주차");

  await page.getByLabel("참여 상태").selectOption("completed");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(2);
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 03");
  await expect(page.getByTestId("classroom-attendance-row").last()).toContainText("시나리오1 학생 06");
  await page.getByLabel("참여 상태").selectOption("all");
  await page.getByLabel("출석 주차 필터").selectOption("all");

  await page.getByLabel("참여 상태").selectOption("active");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 06");
  await page.getByLabel("참여 상태").selectOption("completed");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 03");
  await page.getByLabel("참여 상태").selectOption("notStarted");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(1);
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 04");
  await page.getByLabel("참여 상태").selectOption("needsAttention");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(3);
  await page.getByLabel("참여 상태").selectOption("all");

  await page.getByLabel("출석 정렬").selectOption("progressAsc");
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 02");
  await page.getByLabel("출석 주차 필터").selectOption("wk_attendance_1");
  await page.getByLabel("출석 정렬").selectOption("recentDesc");
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 01");
  await page.getByLabel("출석 주차 필터").selectOption("all");
  await page.getByLabel("출석 정렬").selectOption("recentDesc");
  await expect(page.getByTestId("classroom-attendance-row").first()).toContainText("시나리오1 학생 06");

  await page.getByText("시나리오1 학생 02").click();
  await expect(page.getByTestId("classroom-attendance-detail")).toContainText("5 / 13 page");
});

test("student opens own attendance summary with weekly lecture and exam status", async ({ page }) => {
  mkdirSync("test-results", { recursive: true });
  const mocks = await mockAttendanceData(page, { user: studentUser });
  await page.goto("/classrooms/cls_attendance?section=weeks");
  await page.getByTestId("topbar-nav-calendar").click();

  await expect(page).toHaveURL(/\/classrooms\/cls_attendance\?section=attendance$/);
  await expect(page.getByTestId("student-attendance-hero")).toContainText("학습 참여 현황");
  await expect(page.getByTestId("student-attendance-hero")).toContainText("82%");
  await expect(page.getByTestId("student-attendance-section")).toBeVisible();
  await expect(page.getByTestId("student-attendance-week")).toHaveCount(4);
  await expect(page.getByTestId("student-attendance-week").first()).toContainText("1주차");
  await expect(page.getByTestId("student-attendance-week-detail")).toBeVisible();
  await expect(page.getByTestId("student-attendance-week-detail")).toContainText("MergeAISystem 가이드 테스트 자료");
  await expect(page.getByTestId("student-attendance-week-detail")).toContainText("중간고사");
  const resultButton = page.getByTestId("student-attendance-exam-result");
  await expect(resultButton).toContainText("결과 보기");
  await expect(resultButton).toHaveAttribute("href", "/exams/exam_student_midterm");
  await expect(resultButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(resultButton).toHaveCSS("border-top-color", /rgba?\(103,\s*92,\s*255/);
  const examTitle = page.locator(".student-attendance-exam-main strong", { hasText: "중간고사" }).first();
  await expect(examTitle).toHaveText("중간고사");
  expect(await examTitle.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(page.getByTestId("classroom-attendance-toolbar")).toHaveCount(0);
  await expect(page.getByText("시나리오1 학생 03")).toHaveCount(0);
  await expect(page.getByText("#8103")).toHaveCount(0);
  expect(mocks.getStudentAttendanceRequests()).toBe(1);
  expect(mocks.getAttendanceRequests()).toBe(0);
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: "test-results/student-attendance-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByTestId("student-attendance-section")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/student-attendance-mobile.png", fullPage: true });
});

test("attendance handles errors, retry, stale responses, and unauthorized views", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAttendanceData(page);
  await page.unroute("**/api/classrooms/cls_attendance/attendance");
  let attendanceShouldFail = true;
  await page.route("**/api/classrooms/cls_attendance/attendance", (route) => {
    if (attendanceShouldFail) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "출석 현황 실패" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: attendancePayload() })
    });
  });
  await page.goto("/classrooms/cls_attendance?section=attendance");
  await expect(page.getByTestId("classroom-attendance-error")).toContainText("출석 현황 실패");
  attendanceShouldFail = false;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(6);

  await page.unroute("**/api/classrooms/cls_attendance/attendance");
  await page.route("**/api/classrooms/cls_attendance/attendance", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Forbidden" }) })
  );
  await page.reload();
  await expect(page.getByTestId("classroom-attendance-error")).toContainText("이 출석 현황에 접근할 권한이 없습니다.");

  await page.unroute("**/api/classrooms/cls_attendance/attendance");
  await page.route("**/api/classrooms/cls_attendance/attendance", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Classroom not found" }) })
  );
  await page.reload();
  await expect(page.getByTestId("classroom-attendance-error")).toContainText("강의실을 찾을 수 없습니다.");

  await page.unroute("**/api/classrooms/cls_attendance/attendance");
  const staleMock = await mockAttendanceData(page, { holdAttendanceRequest: true });
  await page.goto("/classrooms/cls_attendance?section=attendance");
  await expect(page.getByTestId("classroom-attendance-loading")).toBeVisible();
  await page.getByTestId("topbar-nav-files").click();
  staleMock.releaseAttendanceRequest();
  await staleMock.waitForAttendanceSettled();
  await expect(page.getByTestId("classroom-attendance-section")).toHaveCount(0);

  await page.goto("/classrooms/cls_attendance?section=attendance");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(6);
  await page.getByLabel("학생 이름 또는 코드로 검색").fill("학생 03");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(1);
  await page.getByTestId("topbar-nav-files").click();
  await page.getByTestId("topbar-nav-calendar").click();
  await expect(page.getByLabel("학생 이름 또는 코드로 검색")).toHaveValue("");
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(6);

  const switchPage = await page.context().newPage();
  const staleSwitchMock = await mockAttendanceData(switchPage, { holdAttendanceRequest: true });
  await switchPage.route("**/api/classrooms/cls_attendance_b/weeks", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: weeks.map((week) => ({ ...week, classroomId: "cls_attendance_b" }))
      })
    })
  );
  await switchPage.route("**/api/classrooms/cls_attendance_b/attendance", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: attendancePayload("cls_attendance_b", " B") })
    })
  );
  await switchPage.goto("/classrooms/cls_attendance?section=attendance");
  await expect(switchPage.getByTestId("classroom-attendance-loading")).toBeVisible();
  await switchPage.goto("/classrooms/cls_attendance_b?section=attendance");
  staleSwitchMock.releaseAttendanceRequest();
  await staleSwitchMock.waitForAttendanceSettled();
  await expect(switchPage.getByTestId("classroom-attendance-row")).toHaveCount(6);
  await expect(switchPage.getByTestId("classroom-attendance-row").first()).toContainText("B");
  await expect(switchPage.getByTestId("classroom-attendance-row").first()).not.toContainText("시나리오1 학생 01#8101");
  await switchPage.close();

  const logoutPage = await page.context().newPage();
  await mockAttendanceData(logoutPage);
  await logoutPage.unroute("**/api/classrooms/cls_attendance/attendance");
  let releaseLogoutAttendance: (() => void) | undefined;
  let logoutAttendanceSettled: (() => void) | undefined;
  const logoutAttendanceGate = new Promise<void>((resolve) => {
    releaseLogoutAttendance = resolve;
  });
  const logoutAttendanceSettledPromise = new Promise<void>((resolve) => {
    logoutAttendanceSettled = resolve;
  });
  await logoutPage.route("**/api/classrooms/cls_attendance/attendance", async (route) => {
    await logoutAttendanceGate;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: attendancePayload() })
      });
    } finally {
      logoutAttendanceSettled?.();
    }
  });
  await logoutPage.goto("/classrooms/cls_attendance?section=attendance");
  await expect(logoutPage.getByTestId("classroom-attendance-loading")).toBeVisible();
  await logoutPage.getByTestId("profile-disclosure").click();
  await logoutPage.getByTestId("profile-logout-action").click();
  releaseLogoutAttendance?.();
  await logoutAttendanceSettledPromise;
  await expect(logoutPage).toHaveURL(/\/login(?:\?|$)/);
  await expect(logoutPage.getByTestId("classroom-attendance-section")).toHaveCount(0);
  await logoutPage.close();

  const authPage = await page.context().newPage();
  await mockAttendanceData(authPage);
  await authPage.unroute("**/api/classrooms/cls_attendance/attendance");
  await authPage.route("**/api/classrooms/cls_attendance/attendance", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unauthorized" }) })
  );
  await authPage.goto("/classrooms/cls_attendance?section=attendance");
  await expect(authPage).toHaveURL(/\/login\?next=/);
  await authPage.close();

  const verifyPage = await page.context().newPage();
  await mockAttendanceData(verifyPage, { user: { ...teacherUser, emailVerified: false } });
  await verifyPage.goto("/classrooms/cls_attendance?section=attendance");
  await expect(verifyPage).toHaveURL(/\/verify-email\?next=/);
  await verifyPage.close();

  const noMaterialsPage = await page.context().newPage();
  await mockAttendanceData(noMaterialsPage);
  await noMaterialsPage.unroute("**/api/classrooms/cls_attendance/attendance");
  await noMaterialsPage.route("**/api/classrooms/cls_attendance/attendance", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: noMaterialsAttendancePayload() })
    })
  );
  await noMaterialsPage.goto("/classrooms/cls_attendance?section=attendance");
  await expect(noMaterialsPage.getByTestId("classroom-attendance-row")).toHaveCount(1);
  await noMaterialsPage.getByLabel("참여 상태").selectOption("noMaterials");
  await expect(noMaterialsPage.getByTestId("classroom-attendance-row")).toContainText("자료 없음");
  await expect(noMaterialsPage.getByTestId("classroom-attendance-row")).toContainText("완료 0 / 0 자료");
  await noMaterialsPage.getByLabel("참여 상태").selectOption("notStarted");
  await expect(noMaterialsPage.getByTestId("classroom-attendance-row")).toHaveCount(0);
  await expect(noMaterialsPage.getByText("조건에 맞는 학생이 없습니다.")).toBeVisible();
  await noMaterialsPage.getByLabel("참여 상태").selectOption("needsAttention");
  await expect(noMaterialsPage.getByTestId("classroom-attendance-row")).toHaveCount(0);
  await noMaterialsPage.close();

  const studentPage = await page.context().newPage();
  await mockAttendanceData(studentPage, { user: studentUser });
  await studentPage.goto("/classrooms/cls_attendance?section=attendance");
  await expect(studentPage.getByTestId("student-attendance-section")).toBeVisible();
  await expect(studentPage.getByTestId("student-attendance-week")).toHaveCount(4);
  await expect(studentPage.getByTestId("topbar-nav-calendar")).toHaveAttribute("aria-current", "page");
  await studentPage.close();

  const dashboardPage = await page.context().newPage();
  await mockAttendanceData(dashboardPage);
  await dashboardPage.goto("/");
  await dashboardPage.getByTestId("topbar-nav-calendar").click();
  await expect(dashboardPage).toHaveURL(/\/$/);
  await expect(dashboardPage.getByTestId("classroom-attendance-section")).toHaveCount(0);
  await dashboardPage.close();
});

test("attendance renders responsively without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mockAttendanceData(page);

  await page.goto("/classrooms/cls_attendance?section=attendance");
  await expect(page.getByRole("heading", { name: "학생별 출석 현황" })).toBeVisible();
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(6);
  await finishAnimations(page);
  await expectNoHorizontalOverflow(page);
  await expectVisualStructure(page);
  await expectVisibleAttendanceProgressTracks(page);
  await expect(page).toHaveScreenshot("classroom-attendance-mobile-full.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-attendance-mobile.png", fullPage: true });
});

test("attendance tablet layout keeps hero and progress tracks visible", async ({ page }) => {
  await page.setViewportSize({ width: 940, height: 900 });
  await mockAttendanceData(page);

  await page.goto("/classrooms/cls_attendance?section=attendance");
  await expect(page.getByRole("heading", { name: "학생별 출석 현황" })).toBeVisible();
  await expect(page.getByTestId("classroom-attendance-row")).toHaveCount(6);
  await finishAnimations(page);
  await expectNoHorizontalOverflow(page);
  await expectVisualStructure(page);
  await expectVisibleAttendanceProgressTracks(page);
  await expectTopbarHeroSeparated(page);
  await expect(page).toHaveScreenshot("classroom-attendance-tablet-full.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.03
  });
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/classroom-attendance-tablet.png", fullPage: true });
});
