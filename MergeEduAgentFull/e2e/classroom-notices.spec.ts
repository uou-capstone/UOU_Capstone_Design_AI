import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const now = "2026-05-02T10:00:00.000Z";
const scheduledFuture = "2099-05-02T10:00:00.000Z";
const teacherUser = {
  id: "usr_notice_teacher",
  email: "notice.teacher@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "1357",
  emailVerified: true,
  hasPassword: true
};

const studentUser = {
  id: "usr_notice_student",
  email: "notice.student@example.com",
  displayName: "김서연",
  role: "student",
  inviteCode: "2468",
  emailVerified: true,
  hasPassword: true
};

const weeks = [
  {
    id: "wk_notice_1",
    classroomId: "cls_notice",
    weekIndex: 1,
    title: "1주차",
    createdAt: now,
    updatedAt: now
  }
];

type Notice = {
  id: string;
  classroomId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: "teacher" | "student";
  title: string;
  contentMarkdown: string;
  category: "GENERAL" | "EXAM" | "MATERIAL" | "DISCUSSION" | "ASSIGNMENT";
  priority: "NORMAL" | "IMPORTANT";
  target: "CLASS";
  pinned: boolean;
  status: "DRAFT" | "PUBLISHED";
  publishAt?: string;
  publishedAt?: string;
  attachments: Array<{ id: string; name: string; size: number; mimeType?: string }>;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};

type Comment = {
  id: string;
  classroomId: string;
  noticeId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: "teacher" | "student";
  parentCommentId?: string;
  contentMarkdown: string;
  createdAt: string;
  updatedAt: string;
  canEdit?: boolean;
  canDelete?: boolean;
};

type CommentPostPayload = {
  noticeId: string;
  input: { contentMarkdown: string; parentCommentId?: string };
};

type CommentPatchPayload = {
  noticeId: string;
  commentId: string;
  input: { contentMarkdown: string };
};

type NoticeMockOptions = {
  beforeCommentPostFulfill?: (payload: CommentPostPayload) => Promise<void> | void;
  shouldFailCommentList?: (noticeId: string) => boolean;
  rejectReplyParentIds?: Set<string>;
};

function seedNotices(): Notice[] {
  return [
    {
      id: "notice_important",
      classroomId: "cls_notice",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      title: "기말고사 일정 및 범위 안내",
      contentMarkdown:
        "안녕하세요, 3주차 강의를 수강하고 있는 학생 여러분.\n\n### 시험 일정\n- 시험 일시: 2026년 6월 20일 10:00 ~ 12:00\n- 시험 범위: 1주차 ~ 12주차 강의 내용\n\n첨부된 시험 범위 요약 자료를 확인해 주세요.",
      category: "EXAM",
      priority: "IMPORTANT",
      target: "CLASS",
      pinned: true,
      status: "PUBLISHED",
      publishedAt: "2026-05-02T09:15:00.000Z",
      attachments: [
        { id: "att_notice_1", name: "기말고사 범위 요약.pdf", size: 1200000, mimeType: "application/pdf" },
        { id: "att_notice_2", name: "기말고사 모의문제.pdf", size: 2400000, mimeType: "application/pdf" }
      ],
      commentCount: 3,
      createdAt: "2026-05-02T09:15:00.000Z",
      updatedAt: "2026-05-02T09:20:00.000Z"
    },
    {
      id: "notice_material",
      classroomId: "cls_notice",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      title: "3주차 강의 자료 업로드 안내",
      contentMarkdown: "3주차 강의 자료를 업로드했습니다. 수업 전 미리 다운로드하여 예습해 주세요.",
      category: "MATERIAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "PUBLISHED",
      publishedAt: "2026-05-02T01:32:00.000Z",
      attachments: [{ id: "att_notice_3", name: "3주차_강의자료.pdf", size: 980000, mimeType: "application/pdf" }],
      commentCount: 1,
      createdAt: "2026-05-02T01:32:00.000Z",
      updatedAt: "2026-05-02T01:32:00.000Z"
    },
    {
      id: "notice_draft",
      classroomId: "cls_notice",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      title: "임시 저장 공지",
      contentMarkdown: "학생에게는 보이지 않는 임시 공지입니다.",
      category: "GENERAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "DRAFT",
      attachments: [],
      commentCount: 0,
      createdAt: "2026-05-01T08:30:00.000Z",
      updatedAt: "2026-05-01T08:30:00.000Z"
    },
    {
      id: "notice_scheduled",
      classroomId: "cls_notice",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      title: "다음 주 보충 공지 예약",
      contentMarkdown: "학생에게 아직 공개되면 안 되는 예약 공지입니다.",
      category: "GENERAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "PUBLISHED",
      publishAt: scheduledFuture,
      attachments: [],
      commentCount: 0,
      createdAt: "2026-05-01T09:30:00.000Z",
      updatedAt: "2026-05-01T09:30:00.000Z"
    }
  ];
}

function seedComments(): Comment[] {
  return [
    {
      id: "comment_1",
      classroomId: "cls_notice",
      noticeId: "notice_important",
      authorUserId: "usr_student_a",
      authorDisplayName: "김서연",
      authorRole: "student",
      contentMarkdown: "시험 범위 요약 자료 도움됩니다. 감사합니다.",
      createdAt: "2026-05-02T10:03:00.000Z",
      updatedAt: "2026-05-02T10:03:00.000Z"
    },
    {
      id: "comment_2",
      classroomId: "cls_notice",
      noticeId: "notice_important",
      authorUserId: "usr_student_b",
      authorDisplayName: "이준호",
      authorRole: "student",
      contentMarkdown: "주관식 비중이 40%라면 서술형 연습을 더 해야겠네요.",
      createdAt: "2026-05-02T10:18:00.000Z",
      updatedAt: "2026-05-02T10:18:00.000Z"
    },
    {
      id: "comment_3",
      classroomId: "cls_notice",
      noticeId: "notice_important",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      parentCommentId: "comment_2",
      contentMarkdown: "네, 다음 수업에서 예시 문제를 더 다뤄보겠습니다.",
      createdAt: "2026-05-02T10:25:00.000Z",
      updatedAt: "2026-05-02T10:25:00.000Z"
    }
  ];
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data)
  });
}

function noticeIdFromUrl(url: string): string {
  return new URL(url).pathname.split("/").at(-1) ?? "";
}

function noticeCommentPathParts(url: string): string[] {
  return new URL(url).pathname.split("/");
}

function withCommentPermissions(comment: Comment, user: typeof teacherUser | typeof studentUser): Comment {
  const canManage = user.role === "teacher" || comment.authorUserId === user.id;
  return {
    ...comment,
    canEdit: canManage,
    canDelete: canManage
  };
}

function isNoticeVisibleToStudent(notice: Notice, atIso = new Date().toISOString()): boolean {
  return notice.status === "PUBLISHED" && (!notice.publishAt || notice.publishAt <= atIso);
}

function isNoticeVisibleToViewer(notice: Notice, role: "teacher" | "student"): boolean {
  return role === "teacher" || isNoticeVisibleToStudent(notice);
}

function collectCommentDescendantIds(comments: Comment[], targetId: string): Set<string> {
  const removed = new Set<string>([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const comment of comments) {
      if (comment.parentCommentId && removed.has(comment.parentCommentId) && !removed.has(comment.id)) {
        removed.add(comment.id);
        changed = true;
      }
    }
  }
  return removed;
}

async function mockNoticeClassroom(page: Page, role: "teacher" | "student", options: NoticeMockOptions = {}) {
  let notices = seedNotices();
  let comments = seedComments();
  const user = role === "teacher" ? teacherUser : studentUser;
  const noticePostPayloads: Array<Partial<Notice>> = [];
  const commentPostPayloads: CommentPostPayload[] = [];
  const commentPatchPayloads: CommentPatchPayload[] = [];

  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, { ok: true, data: { user } })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    fulfillJson(route, { ok: false, error: "request encryption disabled" }, 500)
  );
  await page.route("**/api/classrooms/cls_notice/weeks", (route) =>
    fulfillJson(route, { ok: true, data: weeks })
  );
  await page.route("**/api/classrooms/cls_notice/students", (route) =>
    fulfillJson(route, { ok: true, data: [] })
  );
  await page.route("**/api/weeks/wk_notice_1/lectures", (route) =>
    fulfillJson(route, { ok: true, data: [] })
  );
  await page.route("**/api/weeks/wk_notice_1/exams", (route) =>
    fulfillJson(route, { ok: true, data: [] })
  );

  await page.route("**/api/classrooms/cls_notice/notices/*/comments/*", async (route) => {
    const request = route.request();
    const parts = noticeCommentPathParts(request.url());
    const commentId = parts.at(-1) ?? "";
    const noticeId = parts.at(-3) ?? "";
    const visibleNotice = notices.find((notice) => notice.id === noticeId);
    if (!visibleNotice || !isNoticeVisibleToViewer(visibleNotice, role)) {
      await fulfillJson(route, { ok: false, error: "Notice not found" }, 404);
      return;
    }
    const comment = comments.find(
      (item) => item.noticeId === noticeId && item.id === commentId
    );
    if (!comment) {
      await fulfillJson(route, { ok: false, error: "Notice comment not found" }, 404);
      return;
    }
    const canManage = role === "teacher" || comment.authorUserId === user.id;
    if (!canManage) {
      await fulfillJson(route, { ok: false, error: "댓글 권한이 없습니다." }, 403);
      return;
    }
    if (request.method() === "PATCH") {
      const input = request.postDataJSON() as { contentMarkdown: string };
      commentPatchPayloads.push({ noticeId, commentId, input });
      const updated: Comment = {
        ...comment,
        contentMarkdown: input.contentMarkdown,
        updatedAt: "2026-05-02T10:39:00.000Z"
      };
      comments = comments.map((item) => (item.id === comment.id ? updated : item));
      await fulfillJson(route, { ok: true, data: withCommentPermissions(updated, user) });
      return;
    }
    if (request.method() === "DELETE") {
      const removedIds = collectCommentDescendantIds(
        comments.filter((item) => item.noticeId === noticeId),
        comment.id
      );
      comments = comments.filter((item) => !removedIds.has(item.id));
      notices = notices.map((notice) =>
        notice.id === noticeId
          ? { ...notice, commentCount: comments.filter((item) => item.noticeId === noticeId).length }
          : notice
      );
      await fulfillJson(route, { ok: true });
      return;
    }
    await fulfillJson(route, { ok: false, error: "unsupported" }, 405);
  });

  await page.route("**/api/classrooms/cls_notice/notices/*/comments", async (route) => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split("/");
    const noticeId = parts[parts.length - 2];
    const visibleNotice = notices.find((notice) => notice.id === noticeId);
    if (!visibleNotice || !isNoticeVisibleToViewer(visibleNotice, role)) {
      await fulfillJson(route, { ok: false, error: "Notice not found" }, 404);
      return;
    }
    if (request.method() === "GET") {
      if (options.shouldFailCommentList?.(noticeId)) {
        await fulfillJson(route, { ok: false, error: "댓글 목록을 새로고침하지 못했습니다." }, 500);
        return;
      }
      await fulfillJson(route, {
        ok: true,
        data: comments
          .filter((comment) => comment.noticeId === noticeId)
          .map((comment) => withCommentPermissions(comment, user))
      });
      return;
    }
    if (request.method() === "POST") {
      const input = request.postDataJSON() as { contentMarkdown: string; parentCommentId?: string };
      if (input.parentCommentId && options.rejectReplyParentIds?.has(input.parentCommentId)) {
        await options.beforeCommentPostFulfill?.({ noticeId, input });
        await fulfillJson(route, { ok: false, error: "답글 대상 댓글을 찾을 수 없습니다." }, 400);
        return;
      }
      if (input.parentCommentId) {
        const parent = comments.find(
          (comment) => comment.noticeId === noticeId && comment.id === input.parentCommentId
        );
        if (!parent) {
          await fulfillJson(route, { ok: false, error: "답글 대상 댓글을 찾을 수 없습니다." }, 400);
          return;
        }
        if (parent.parentCommentId) {
          await fulfillJson(route, { ok: false, error: "답글에는 다시 답글을 남길 수 없습니다." }, 400);
          return;
        }
      }
      const payload = { noticeId, input };
      commentPostPayloads.push(payload);
      await options.beforeCommentPostFulfill?.(payload);
      const created: Comment = {
        id: `comment_${comments.length + 1}`,
        classroomId: "cls_notice",
        noticeId,
        authorUserId: user.id,
        authorDisplayName: user.displayName,
        authorRole: user.role as "teacher" | "student",
        parentCommentId: input.parentCommentId,
        contentMarkdown: input.contentMarkdown,
        createdAt: now,
        updatedAt: now
      };
      comments = [...comments, created];
      notices = notices.map((notice) =>
        notice.id === noticeId
          ? { ...notice, commentCount: comments.filter((comment) => comment.noticeId === noticeId).length }
          : notice
      );
      await fulfillJson(route, { ok: true, data: withCommentPermissions(created, user) }, 201);
      return;
    }
    await fulfillJson(route, { ok: false, error: "unsupported" }, 405);
  });

  await page.route("**/api/classrooms/cls_notice/notices/*", async (route) => {
    const request = route.request();
    const id = noticeIdFromUrl(request.url());
    const visibleNotice = notices.find((notice) => notice.id === id);
    if (!visibleNotice || !isNoticeVisibleToViewer(visibleNotice, role)) {
      await fulfillJson(route, { ok: false, error: "Notice not found" }, 404);
      return;
    }
    if (request.method() === "GET") {
      await fulfillJson(route, { ok: true, data: visibleNotice });
      return;
    }
    if (request.method() === "PATCH") {
      if (role !== "teacher") {
        await fulfillJson(route, { ok: false, error: "Teacher role required" }, 403);
        return;
      }
      const input = request.postDataJSON() as Partial<Notice>;
      const updated = { ...visibleNotice, ...input, updatedAt: now };
      notices = notices.map((notice) => (notice.id === id ? updated : notice));
      await fulfillJson(route, { ok: true, data: updated });
      return;
    }
    if (request.method() === "DELETE") {
      if (role !== "teacher") {
        await fulfillJson(route, { ok: false, error: "Teacher role required" }, 403);
        return;
      }
      notices = notices.filter((notice) => notice.id !== id);
      comments = comments.filter((comment) => comment.noticeId !== id);
      await fulfillJson(route, { ok: true });
      return;
    }
    await fulfillJson(route, { ok: false, error: "unsupported" }, 405);
  });

  await page.route("**/api/classrooms/cls_notice/notices", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const data = notices.filter((notice) => isNoticeVisibleToViewer(notice, role));
      await fulfillJson(route, { ok: true, data });
      return;
    }
    if (request.method() === "POST") {
      if (role !== "teacher") {
        await fulfillJson(route, { ok: false, error: "Teacher role required" }, 403);
        return;
      }
      const input = request.postDataJSON() as Partial<Notice>;
      noticePostPayloads.push(input);
      const created: Notice = {
        id: `notice_${notices.length + 1}`,
        classroomId: "cls_notice",
        authorUserId: teacherUser.id,
        authorDisplayName: teacherUser.displayName,
        authorRole: "teacher",
        title: input.title ?? "새 공지",
        contentMarkdown: input.contentMarkdown ?? "내용",
        category: input.category ?? "GENERAL",
        priority: input.priority ?? "NORMAL",
        target: "CLASS",
        pinned: Boolean(input.pinned),
        status: input.status ?? "DRAFT",
        publishAt: input.publishAt,
        publishedAt: input.status === "PUBLISHED" ? now : undefined,
        attachments: input.attachments ?? [],
        commentCount: 0,
        createdAt: now,
        updatedAt: now
      };
      notices = [created, ...notices];
      await fulfillJson(route, { ok: true, data: created }, 201);
      return;
    }
    await fulfillJson(route, { ok: false, error: "unsupported" }, 405);
  });

  return {
    getNoticePostPayloads: () => [...noticePostPayloads],
    getCommentPostPayloads: () => commentPostPayloads.map((payload) => ({
      noticeId: payload.noticeId,
      input: { ...payload.input }
    })),
    getCommentPatchPayloads: () => commentPatchPayloads.map((payload) => ({
      noticeId: payload.noticeId,
      commentId: payload.commentId,
      input: { ...payload.input }
    }))
  };
}

test("teacher notice list compose and detail match the classroom reference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const mock = await mockNoticeClassroom(page, "teacher");
  mkdirSync("test-results", { recursive: true });

  await page.goto("/classrooms/cls_notice?section=notices");
  const panel = page.getByTestId("classroom-notices-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("notice-list-shell")).toBeVisible();
  await expect(page.getByTestId("notice-create-action")).toBeVisible();
  await expect(page.getByText("기말고사 일정 및 범위 안내")).toBeVisible();
  await expect(page.getByText("다음 주 보충 공지 예약")).toBeVisible();
  await expect(panel.locator(".notice-stat-card")).toHaveCount(4);
  await expect(panel.locator(".notice-stat-card").filter({ hasText: "예약된 공지" }).locator("strong")).toHaveText("1");
  await expect(page.getByPlaceholder("공지 제목, 내용 검색")).toBeVisible();
  await expect(page.getByRole("button", { name: "전체" })).toBeVisible();
  await expect(page.getByRole("button", { name: "중요" })).toBeVisible();
  await expect(page.locator(".notice-filter-chips").getByRole("button", { name: "예약" })).toBeVisible();
  await expect(page.getByLabel("공지사항 정렬")).toBeVisible();
  await expect(page.getByTestId("notice-card")).toHaveCount(4);
  await expect(page.getByTestId("notice-edit-action")).toHaveCount(4);
  await expect(page.getByTestId("notice-delete-action")).toHaveCount(4);
  await page.locator(".notice-filter-chips").getByRole("button", { name: "예약" }).click();
  await expect(page.getByTestId("notice-card")).toHaveCount(1);
  await expect(page.getByText("다음 주 보충 공지 예약")).toBeVisible();
  await page.locator(".notice-filter-chips").getByRole("button", { name: "전체" }).click();
  await expect(page.getByTestId("notice-card")).toHaveCount(4);
  await panel.screenshot({ path: "test-results/classroom-notices-list.png" });

  await page.getByTestId("notice-create-action").click();
  await expect(page.getByTestId("notice-compose-shell")).toBeVisible();
  await expect(page.getByTestId("notice-preview-panel")).toHaveCount(0);
  await page.getByPlaceholder("예: 3주차 강의 자료 업로드 및 과제 안내").fill("3주차 강의 자료 업로드 및 과제 안내");
  await page.getByPlaceholder(/안녕하세요/).fill(
    "안녕하세요, 여러분!\n이번 주 3주차 강의 자료를 업로드했습니다.\n\n- 자료실에서 PDF를 확인하세요.\n- 과제 제출 마감은 6월 4일입니다."
  );
  await page.getByRole("button", { name: "미리보기" }).click();
  await expect(page.getByTestId("notice-preview-panel")).toBeVisible();
  await page.getByTestId("notice-compose-shell").screenshot({
    path: "test-results/classroom-notices-compose.png"
  });

  await page.getByRole("button", { name: "임시 저장" }).click();
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await expect(page.getByText("3주차 강의 자료 업로드 및 과제 안내")).toBeVisible();
  expect(mock.getNoticePostPayloads().at(-1)?.status).toBe("DRAFT");
  expect(mock.getNoticePostPayloads().at(-1)?.title).toBe("3주차 강의 자료 업로드 및 과제 안내");

  await page.goto("/classrooms/cls_notice?section=notices&mode=create");
  await expect(page.getByTestId("notice-preview-panel")).toHaveCount(0);
  await page.getByPlaceholder("예: 3주차 강의 자료 업로드 및 과제 안내").fill("토론 주제 안내");
  await page.getByPlaceholder(/안녕하세요/).fill("이번 주 토론 주제는 인터페이스 평가입니다.");
  await page.getByRole("button", { name: "공지 발행" }).click();
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  expect(mock.getNoticePostPayloads().at(-1)?.status).toBe("PUBLISHED");
  expect(mock.getNoticePostPayloads().at(-1)?.title).toBe("토론 주제 안내");

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await expect(page.getByText("기말고사 일정 및 범위 안내")).toBeVisible();
  await page.getByTestId("notice-comment-input").fill("확인했습니다. 감사합니다.");
  await page.getByTestId("notice-comment-submit").click();
  await expect(page.getByText("확인했습니다. 감사합니다.")).toBeVisible();
  await page.getByTestId("notice-reply-action").first().click();
  await page.getByTestId("notice-reply-input").fill("선생님 답글 확인했습니다.");
  await page.getByTestId("notice-reply-submit").click();
  await expect(page.getByText("선생님 답글 확인했습니다.")).toBeVisible();
  await expect(page.getByTestId("notice-comment")).toHaveCount(5);
  await expect(page.getByTestId("notice-reply-action")).toHaveCount(3);
  await expect(page.getByTestId("notice-comment-edit-action")).toHaveCount(5);
  await expect(page.getByTestId("notice-comment-delete-action")).toHaveCount(5);
  const firstActionRow = page.getByTestId("notice-comment-actions").first();
  await expect(firstActionRow.locator("button")).toHaveText(["답글", "수정", "삭제"]);
  await expect(firstActionRow.locator("button svg")).toHaveCount(3);
  await expect(firstActionRow.getByRole("button", { name: "답글" })).toBeVisible();
  await expect(firstActionRow.getByRole("button", { name: "수정" })).toBeVisible();
  await expect(firstActionRow.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(firstActionRow.locator(".notice-comment-action-divider")).toHaveCount(2);
  await expect(page.getByTestId("notice-comment-delete-action").first()).toHaveCSS("color", "rgb(239, 63, 63)");
  await page.getByTestId("notice-detail-shell").screenshot({
    path: "test-results/classroom-notices-detail.png"
  });
});

test("student notices are read-only but comments remain available", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await mockNoticeClassroom(page, "student");

  await page.goto("/classrooms/cls_notice?section=notices");
  await expect(page.getByTestId("notice-list-shell")).toBeVisible();
  await expect(page.getByTestId("notice-create-action")).toHaveCount(0);
  await expect(page.getByTestId("notice-edit-action")).toHaveCount(0);
  await expect(page.getByTestId("notice-delete-action")).toHaveCount(0);
  await expect(page.getByText("임시 저장 공지")).toHaveCount(0);
  await expect(page.getByText("다음 주 보충 공지 예약")).toHaveCount(0);
  await expect(page.locator(".notice-filter-chips").getByRole("button", { name: "예약" })).toHaveCount(0);
  await expect(page.locator(".notice-stat-card")).toHaveCount(3);
  await expect(page.locator(".notice-stat-card").filter({ hasText: "예약된 공지" })).toHaveCount(0);
  await page.getByTestId("notice-list-shell").screenshot({
    path: "test-results/classroom-notices-student-no-scheduled-controls.png"
  });

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_scheduled");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await expect(page.getByText("다음 주 보충 공지 예약")).toHaveCount(0);
  await expect(page.getByTestId("notice-comment")).toHaveCount(0);

  await page.goto("/classrooms/cls_notice?section=notices&mode=create");
  await expect(page.getByTestId("notice-compose-shell")).toHaveCount(0);
  await expect(page.getByText("공지사항 작성 권한이 없습니다.")).toBeVisible();

  await page.goto("/classrooms/cls_notice?section=notices&mode=edit&noticeId=notice_important");
  await expect(page.getByTestId("notice-compose-shell")).toHaveCount(0);
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await expect(page.getByText("공지사항 작성 권한이 없습니다.")).toBeVisible();

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await expect(page.getByTestId("notice-edit-action")).toHaveCount(0);
  await expect(page.getByTestId("notice-delete-action")).toHaveCount(0);
  await page.getByTestId("notice-comment-input").fill("학생 댓글도 정상 등록됩니다.");
  await page.getByTestId("notice-comment-submit").click();
  await expect(page.getByText("학생 댓글도 정상 등록됩니다.")).toBeVisible();
  await expect(page.getByTestId("notice-reply-action")).toHaveCount(3);
  await expect(page.getByTestId("notice-comment-edit-action")).toHaveCount(1);
  await expect(page.getByTestId("notice-comment-delete-action")).toHaveCount(1);
  await page.getByTestId("notice-comment-edit-action").click();
  await page.getByTestId("notice-comment-edit-input").fill("학생 본인 댓글은 수정됩니다.");
  await page.getByTestId("notice-comment-edit-save").click();
  await expect(page.getByText("학생 본인 댓글은 수정됩니다.")).toBeVisible();
  await expect(page.getByText("수정됨")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("notice-comment-delete-action").click();
  await expect(page.getByText("학생 본인 댓글은 수정됩니다.")).toHaveCount(0);
  await expect(page.getByTestId("notice-comment-edit-action")).toHaveCount(0);
  await expect(page.getByTestId("notice-comment-delete-action")).toHaveCount(0);
});

test("student notice comments require button submission and preserve newlines", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  mkdirSync("test-results", { recursive: true });
  const mock = await mockNoticeClassroom(page, "student");

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await expect(page.getByTestId("notice-comment")).toHaveCount(3);

  const commentInput = page.getByTestId("notice-comment-input");
  await expect(commentInput).toHaveJSProperty("tagName", "TEXTAREA");
  await commentInput.fill("새 댓글 첫 줄");
  await commentInput.press("Enter");
  await commentInput.type("새 댓글 둘째 줄");
  await expect(commentInput).toHaveValue("새 댓글 첫 줄\n새 댓글 둘째 줄");
  expect(mock.getCommentPostPayloads()).toHaveLength(0);
  await expect(page.getByTestId("notice-comment")).toHaveCount(3);

  await page.getByTestId("notice-comment-submit").click();
  await expect(page.getByTestId("notice-comment")).toHaveCount(4);
  expect(mock.getCommentPostPayloads()).toHaveLength(1);
  expect(mock.getCommentPostPayloads()[0]).toMatchObject({
    noticeId: "notice_important",
    input: { contentMarkdown: "새 댓글 첫 줄\n새 댓글 둘째 줄" }
  });

  const createdComment = page.getByTestId("notice-comment").filter({ hasText: "새 댓글 첫 줄" });
  await expect(createdComment).toHaveCount(1);
  const createdCommentText = createdComment.locator("p").first();
  await expect(createdCommentText).toHaveCSS("white-space", "pre-wrap");
  await expect.poll(async () => createdCommentText.evaluate((node) => node.textContent)).toBe("새 댓글 첫 줄\n새 댓글 둘째 줄");

  await page.getByTestId("notice-reply-action").first().click();
  const replyInput = page.getByTestId("notice-reply-input");
  await expect(replyInput).toHaveJSProperty("tagName", "TEXTAREA");
  await replyInput.fill("답변 첫 줄");
  await replyInput.press("Enter");
  await replyInput.type("답변 둘째 줄");
  await expect(replyInput).toHaveValue("답변 첫 줄\n답변 둘째 줄");
  expect(mock.getCommentPostPayloads()).toHaveLength(1);
  await page.getByTestId("notice-reply-submit").click();
  await expect(page.getByText("답변 첫 줄")).toBeVisible();
  expect(mock.getCommentPostPayloads()).toHaveLength(2);
  expect(mock.getCommentPostPayloads()[1].input.contentMarkdown).toBe("답변 첫 줄\n답변 둘째 줄");
  expect(mock.getCommentPostPayloads()[1].input.parentCommentId).toBeTruthy();

  await createdComment.getByTestId("notice-comment-edit-action").click();
  const editInput = page.getByTestId("notice-comment-edit-input");
  await expect(editInput).toHaveJSProperty("tagName", "TEXTAREA");
  await editInput.fill("수정 첫 줄");
  await editInput.press("Enter");
  await editInput.type("수정 둘째 줄");
  await expect(editInput).toHaveValue("수정 첫 줄\n수정 둘째 줄");
  expect(mock.getCommentPatchPayloads()).toHaveLength(0);
  await page.getByTestId("notice-comment-edit-save").click();
  await expect(page.getByText("수정 첫 줄")).toBeVisible();
  expect(mock.getCommentPatchPayloads()).toHaveLength(1);
  expect(mock.getCommentPatchPayloads()[0].input.contentMarkdown).toBe("수정 첫 줄\n수정 둘째 줄");

  await page.locator(".notice-comments-section").screenshot({
    path: "test-results/classroom-notice-student-comment-textarea.png"
  });
});

test("student notice comment submit ignores duplicate clicks while pending", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  let releaseCommentPost!: () => void;
  let shouldHoldFirstPost = true;
  const firstPostGate = new Promise<void>((resolve) => {
    releaseCommentPost = resolve;
  });
  const mock = await mockNoticeClassroom(page, "student", {
    beforeCommentPostFulfill: async () => {
      if (!shouldHoldFirstPost) return;
      shouldHoldFirstPost = false;
      await firstPostGate;
    }
  });

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await page.getByTestId("notice-comment-input").fill("중복 방지 댓글");

  const submitButton = page.getByTestId("notice-comment-submit");
  await submitButton.click();
  await expect(submitButton).toBeDisabled();
  await submitButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => mock.getCommentPostPayloads().length).toBe(1);

  releaseCommentPost();
  await expect(page.getByText("중복 방지 댓글")).toBeVisible();
  expect(mock.getCommentPostPayloads()).toHaveLength(1);
  await expect(page.getByTestId("notice-comment").filter({ hasText: "중복 방지 댓글" })).toHaveCount(1);
});

test("pending notice comment responses do not pollute another notice detail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  let releaseCommentPost!: () => void;
  let shouldHoldFirstPost = true;
  const firstPostGate = new Promise<void>((resolve) => {
    releaseCommentPost = resolve;
  });
  const mock = await mockNoticeClassroom(page, "student", {
    beforeCommentPostFulfill: async () => {
      if (!shouldHoldFirstPost) return;
      shouldHoldFirstPost = false;
      await firstPostGate;
    }
  });

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await page.getByTestId("notice-comment-input").fill("이전 공지 pending 댓글");
  await page.getByTestId("notice-comment-submit").click();
  await expect.poll(() => mock.getCommentPostPayloads().length).toBe(1);

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_material");
  await expect(page.getByText("3주차 강의 자료 업로드 안내")).toBeVisible();
  releaseCommentPost();
  await page.waitForTimeout(250);

  await expect(page.getByText("3주차 강의 자료 업로드 안내")).toBeVisible();
  await expect(page.getByText("이전 공지 pending 댓글")).toHaveCount(0);
  await expect(page.getByText("댓글은 등록됐지만")).toHaveCount(0);
});

test("created notice comment remains visible when refresh fails after submit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  let failCommentList = false;
  const mock = await mockNoticeClassroom(page, "student", {
    shouldFailCommentList: (noticeId) => failCommentList && noticeId === "notice_important"
  });

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await page.getByTestId("notice-comment-input").fill("새로고침 실패 후 유지되는 댓글");
  failCommentList = true;
  await page.getByTestId("notice-comment-submit").click();

  await expect(page.getByText("새로고침 실패 후 유지되는 댓글")).toBeVisible();
  await expect(page.getByText(/댓글은 등록됐지만 최신 댓글 목록/)).toBeVisible();
  await expect(page.getByTestId("notice-comment-input")).toHaveValue("");
  await expect(page.getByTestId("notice-comment-submit")).toBeDisabled();
  expect(mock.getCommentPostPayloads()).toHaveLength(1);
});

test("stale reply failure does not close a newer reply editor", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  let releaseRejectedReply!: () => void;
  let shouldHoldRejectedReply = true;
  const rejectedReplyGate = new Promise<void>((resolve) => {
    releaseRejectedReply = resolve;
  });
  await mockNoticeClassroom(page, "student", {
    rejectReplyParentIds: new Set(["comment_1"]),
    beforeCommentPostFulfill: async (payload) => {
      if (payload.input.parentCommentId !== "comment_1" || !shouldHoldRejectedReply) return;
      shouldHoldRejectedReply = false;
      await rejectedReplyGate;
    }
  });

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await page.getByTestId("notice-reply-action").first().click();
  await page.getByTestId("notice-reply-input").fill("곧 실패할 답글");
  await page.getByTestId("notice-reply-submit").click();
  await page.getByTestId("notice-reply-action").nth(1).click();
  await page.getByTestId("notice-reply-input").fill("새 답글 입력 유지");

  releaseRejectedReply();
  await expect(page.getByTestId("notice-reply-input")).toHaveValue("새 답글 입력 유지");
  await expect(page.getByText("답글 대상 댓글을 찾을 수 없습니다.")).toHaveCount(0);
});

test("active stale reply failure closes editor and shows an error", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await mockNoticeClassroom(page, "student", {
    rejectReplyParentIds: new Set(["comment_1"])
  });

  await page.goto("/classrooms/cls_notice?section=notices&noticeId=notice_important");
  await expect(page.getByTestId("notice-detail-shell")).toBeVisible();
  await page.getByTestId("notice-reply-action").first().click();
  await page.getByTestId("notice-reply-input").fill("실패할 현재 답글");
  await page.getByTestId("notice-reply-submit").click();

  await expect(page.getByTestId("notice-reply-input")).toHaveCount(0);
  await expect(page.getByText("답글 대상 댓글을 찾을 수 없습니다.")).toBeVisible();
});
