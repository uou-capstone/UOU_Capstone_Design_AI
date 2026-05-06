import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";

const now = "2026-05-03T10:41:00.000Z";
const editNow = "2026-05-03T10:42:00.000Z";
const teacherUser = {
  id: "usr_discussion_teacher",
  email: "discussion.teacher@example.com",
  displayName: "테스트 선생님",
  role: "teacher",
  inviteCode: "8100",
  emailVerified: true,
  hasPassword: true
};

const studentUser = {
  id: "usr_discussion_student_01",
  email: "discussion.student@example.com",
  displayName: "시나리오1 학생 01",
  role: "student",
  inviteCode: "8101",
  emailVerified: true,
  hasPassword: true
};

const weeks = [
  {
    id: "wk_discussion_1",
    classroomId: "cls_discussion",
    weekIndex: 1,
    title: "1주차",
    createdAt: now,
    updatedAt: now
  }
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type DiscussionCategory = "NOTICE" | "QUESTION" | "FREE" | "RESOURCE";
type DiscussionStatus = "DRAFT" | "PUBLISHED";
type DiscussionPost = {
  id: string;
  classroomId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: "teacher" | "student";
  title: string;
  contentMarkdown: string;
  category: DiscussionCategory;
  visibility: "CLASS";
  pinned: boolean;
  anonymous: boolean;
  allowComments: boolean;
  status: DiscussionStatus;
  attachments: Array<{ id: string; name: string; size: number; mimeType?: string }>;
  viewCount: number;
  commentCount: number;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};
type DiscussionComment = {
  id: string;
  classroomId: string;
  postId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: "teacher" | "student";
  parentCommentId?: string;
  contentMarkdown: string;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
};

type DiscussionMockOptions = {
  discussions?: DiscussionPost[];
  comments?: DiscussionComment[];
  discussionDetailDelayMs?: number;
};

function seedDiscussions(): DiscussionPost[] {
  return [
    {
      id: "disc_pinned",
      classroomId: "cls_discussion",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      title: "2주차 수업 전 준비사항 안내",
      contentMarkdown: "안녕하세요! 2주차 강의를 위해 아래 내용을 확인해 주세요.",
      category: "NOTICE",
      visibility: "CLASS",
      pinned: true,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: [],
      viewCount: 54,
      commentCount: 12,
      canEdit: true,
      canDelete: true,
      canPin: true,
      publishedAt: "2026-05-03T00:30:00.000Z",
      createdAt: "2026-05-03T00:30:00.000Z",
      updatedAt: "2026-05-03T00:30:00.000Z"
    },
    {
      id: "disc_question",
      classroomId: "cls_discussion",
      authorUserId: studentUser.id,
      authorDisplayName: studentUser.displayName,
      authorRole: "student",
      title: "Transformer attention 개념 질문 있습니다",
      contentMarkdown: "self-attention과 multi-head attention의 차이점이 헷갈려요. 예시와 함께 설명해주실 수 있을까요?",
      category: "QUESTION",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: [],
      viewCount: 32,
      commentCount: 0,
      canEdit: true,
      canDelete: true,
      canPin: false,
      publishedAt: "2026-05-03T02:20:00.000Z",
      createdAt: "2026-05-03T02:20:00.000Z",
      updatedAt: "2026-05-03T02:20:00.000Z"
    },
    {
      id: "disc_free",
      classroomId: "cls_discussion",
      authorUserId: "usr_discussion_student_05",
      authorDisplayName: "시나리오1 학생 05",
      authorRole: "student",
      title: "오늘 세션에서 이해한 내용 정리해봤어요",
      contentMarkdown: "핵심 내용을 노션에 정리했습니다. 참고하시면 도움이 될 것 같아요!",
      category: "FREE",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: [],
      viewCount: 28,
      commentCount: 4,
      canEdit: false,
      canDelete: false,
      canPin: false,
      publishedAt: "2026-05-03T01:45:00.000Z",
      createdAt: "2026-05-03T01:45:00.000Z",
      updatedAt: "2026-05-03T01:45:00.000Z"
    },
    {
      id: "disc_resource",
      classroomId: "cls_discussion",
      authorUserId: "usr_discussion_student_03",
      authorDisplayName: "시나리오1 학생 03",
      authorRole: "student",
      title: "선형대수 복습 팁 공유",
      contentMarkdown: "행렬 연산이 어려웠는데 제가 정리한 암기법 공유합니다!",
      category: "RESOURCE",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: [{ id: "disc_att_1", name: "linear_algebra_tip.pdf", size: 842000, mimeType: "application/pdf" }],
      viewCount: 41,
      commentCount: 6,
      canEdit: false,
      canDelete: false,
      canPin: false,
      publishedAt: "2026-05-03T00:10:00.000Z",
      createdAt: "2026-05-03T00:10:00.000Z",
      updatedAt: "2026-05-03T00:10:00.000Z"
    },
    {
      id: "disc_assignment_question",
      classroomId: "cls_discussion",
      authorUserId: studentUser.id,
      authorDisplayName: studentUser.displayName,
      authorRole: "student",
      title: "과제 제출 형식 관련 질문",
      contentMarkdown: "과제 보고서 목차 구성 예시가 궁금합니다. 혹시 샘플 공유 가능할까요?",
      category: "QUESTION",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: [],
      viewCount: 19,
      commentCount: 3,
      canEdit: true,
      canDelete: true,
      canPin: false,
      publishedAt: "2026-05-02T08:35:00.000Z",
      createdAt: "2026-05-02T08:35:00.000Z",
      updatedAt: "2026-05-02T08:35:00.000Z"
    },
    {
      id: "disc_next_topic",
      classroomId: "cls_discussion",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      title: "다음 주 토론 주제 미리 의견 남겨주세요",
      contentMarkdown: "다음 주에는 언어 모델의 한계와 해결 방안에 대해 토론할 예정입니다.",
      category: "FREE",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: [],
      viewCount: 37,
      commentCount: 8,
      canEdit: true,
      canDelete: true,
      canPin: true,
      publishedAt: "2026-05-02T06:20:00.000Z",
      createdAt: "2026-05-02T06:20:00.000Z",
      updatedAt: "2026-05-02T06:20:00.000Z"
    }
  ];
}

function seedComments(): DiscussionComment[] {
  return [
    {
      id: "disc_comment_1",
      classroomId: "cls_discussion",
      postId: "disc_pinned",
      authorUserId: studentUser.id,
      authorDisplayName: studentUser.displayName,
      authorRole: "student",
      contentMarkdown: "확인했습니다. 준비해서 오겠습니다.",
      canEdit: true,
      canDelete: true,
      createdAt: "2026-05-03T01:00:00.000Z",
      updatedAt: "2026-05-03T01:00:00.000Z"
    },
    {
      id: "disc_comment_2",
      classroomId: "cls_discussion",
      postId: "disc_pinned",
      authorUserId: teacherUser.id,
      authorDisplayName: teacherUser.displayName,
      authorRole: "teacher",
      parentCommentId: "disc_comment_1",
      contentMarkdown: "좋습니다. 수업 때 예시도 같이 볼게요.",
      canEdit: true,
      canDelete: true,
      createdAt: "2026-05-03T01:10:00.000Z",
      updatedAt: "2026-05-03T01:10:00.000Z"
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

async function fulfillNdjson(route: Route, events: Array<Record<string, unknown>>, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/x-ndjson",
    body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
  });
}

function stripPermissionFields(post: DiscussionPost): DiscussionPost {
  return { ...post };
}

function applyPostPermissions(post: DiscussionPost, user: typeof teacherUser | typeof studentUser): DiscussionPost {
  const isTeacher = user.role === "teacher";
  const isOwner = post.authorUserId === user.id;
  return {
    ...stripPermissionFields(post),
    canEdit: isTeacher || isOwner,
    canDelete: isTeacher || isOwner,
    canPin: isTeacher
  };
}

function canViewDiscussionPost(post: DiscussionPost, user: typeof teacherUser | typeof studentUser) {
  return user.role === "teacher" || post.status === "PUBLISHED" || post.authorUserId === user.id;
}

function applyCommentPermissions(comment: DiscussionComment, user: typeof teacherUser | typeof studentUser): DiscussionComment {
  const isTeacher = user.role === "teacher";
  const isOwner = comment.authorUserId === user.id;
  return {
    ...comment,
    canEdit: isTeacher || isOwner,
    canDelete: isTeacher || isOwner
  };
}

async function mockDiscussionClassroom(page: Page, role: "teacher" | "student", options: DiscussionMockOptions = {}) {
  const user = role === "teacher" ? teacherUser : studentUser;
  let discussions = options.discussions ? [...options.discussions] : seedDiscussions();
  let comments = options.comments ? [...options.comments] : options.discussions ? [] : seedComments();
  const postPayloads: Array<Partial<DiscussionPost>> = [];
  const postPatchPayloads: Array<Partial<DiscussionPost>> = [];
  const assistantRequests: Array<Record<string, unknown>> = [];
  const viewReceipts = new Map<string, number>();

  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, { ok: true, data: { user } })
  );
  await page.route("**/api/crypto/request-key", (route) =>
    fulfillJson(route, { ok: false, error: "request encryption disabled" }, 500)
  );
  await page.route("**/api/classrooms", (route) =>
    fulfillJson(route, { ok: true, data: [{ id: "cls_discussion", title: "시나리오1 테스트 강의실", teacherId: teacherUser.id }] })
  );
  await page.route("**/api/students/invitations", (route) =>
    fulfillJson(route, { ok: true, data: [] })
  );
  await page.route("**/api/classrooms/cls_discussion/weeks", (route) =>
    fulfillJson(route, { ok: true, data: weeks })
  );
  await page.route("**/api/classrooms/cls_discussion/students", (route) =>
    fulfillJson(route, { ok: true, data: [] })
  );
  await page.route("**/api/weeks/wk_discussion_1/lectures", (route) =>
    fulfillJson(route, { ok: true, data: [] })
  );
  await page.route("**/api/weeks/wk_discussion_1/exams", (route) =>
    fulfillJson(route, { ok: true, data: [] })
  );

  await page.route("**/api/classrooms/cls_discussion/discussions**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const suffix = pathname.split("/api/classrooms/cls_discussion/discussions")[1] ?? "";
    const parts = suffix.split("/").filter(Boolean);

    if (suffix === "") {
      if (request.method() === "GET") {
        const visible = role === "teacher" ? discussions : discussions.filter((post) => post.status === "PUBLISHED" || post.authorUserId === user.id);
        await fulfillJson(route, { ok: true, data: visible.map((post) => applyPostPermissions(post, user)) });
        return;
      }
      if (request.method() === "POST") {
        const input = request.postDataJSON() as Partial<DiscussionPost>;
        postPayloads.push(input);
        if (role !== "teacher" && input.pinned) {
          await fulfillJson(route, { ok: false, error: "상단 고정은 선생님만 설정할 수 있습니다." }, 403);
          return;
        }
        const created: DiscussionPost = {
          id: `disc_created_${postPayloads.length}`,
          classroomId: "cls_discussion",
          authorUserId: user.id,
          authorDisplayName: user.displayName,
          authorRole: user.role as "teacher" | "student",
          title: input.title ?? "새 토론",
          contentMarkdown: input.contentMarkdown ?? "내용",
          category: input.category ?? "FREE",
          visibility: "CLASS",
          pinned: role === "teacher" ? Boolean(input.pinned) : false,
          anonymous: false,
          allowComments: input.allowComments ?? true,
          status: input.status ?? "PUBLISHED",
          attachments: input.attachments ?? [],
          viewCount: 0,
          commentCount: 0,
          canEdit: true,
          canDelete: true,
          canPin: role === "teacher",
          publishedAt: input.status === "DRAFT" ? undefined : now,
          createdAt: now,
          updatedAt: now
        };
        discussions = [created, ...discussions];
        await fulfillJson(route, { ok: true, data: applyPostPermissions(created, user) }, 201);
        return;
      }
    }

    if (suffix === "/assistant/stream") {
      if (request.method() === "POST") {
        const input = request.postDataJSON() as Record<string, unknown>;
        assistantRequests.push(input);
        const prompt = String(input.prompt ?? "");
        const longAnswer = Array.from({ length: 18 }, (_, index) =>
          `${index + 1}. 학생들이 의견을 더 쉽게 남길 수 있도록 질문, 예시, 참여 기준을 함께 제안합니다.`
        ).join("\n\n");
        const answerText = prompt.includes("긴 답변")
          ? `**긴 답변 예시**\n\n${longAnswer}`
          : "**질문형 문장**으로 다듬었습니다.\n\n학생들이 바로 의견을 남길 수 있도록 문장을 정리했어요.";
        await fulfillNdjson(route, [
          { type: "thought_delta", text: "현재 게시글 JSON을 확인하고 있습니다." },
          { type: "answer_delta", text: answerText },
          {
            type: "done",
            answerText,
            thoughtSummary: "현재 게시글 JSON을 확인하고 있습니다.",
            data: {
              messageMarkdown: "학생들이 바로 의견을 남길 수 있도록 질문형 문장으로 다듬었습니다.",
              suggestedTitle: "2주차 토론 주제에 대해 의견을 나눠봅시다",
              suggestedContentMarkdown:
                "이번 주제는 우리 일상 속 데이터 활용 사례와 윤리적 문제를 함께 생각해보는 것입니다.\n\n여러분은 실제 사례에서 어떤 기준이 가장 중요하다고 생각하나요?",
              suggestionLabel: "질문형으로 반영"
            }
          }
        ]);
        return;
      }
    }

    if (suffix === "/assistant") {
      if (request.method() === "POST") {
        const input = request.postDataJSON() as Record<string, unknown>;
        assistantRequests.push(input);
        await fulfillJson(route, {
          ok: true,
          data: {
            messageMarkdown: "학생들이 바로 의견을 남길 수 있도록 질문형 문장으로 다듬었습니다.",
            suggestedTitle: "2주차 토론 주제에 대해 의견을 나눠봅시다",
            suggestedContentMarkdown:
              "이번 주제는 우리 일상 속 데이터 활용 사례와 윤리적 문제를 함께 생각해보는 것입니다.\n\n여러분은 실제 사례에서 어떤 기준이 가장 중요하다고 생각하나요?",
            suggestionLabel: "질문형으로 반영"
          }
        });
        return;
      }
    }

    const postId = parts[0];
    const post = discussions.find((item) => item.id === postId);
    if (!post) {
      await fulfillJson(route, { ok: false, error: "Discussion post not found" }, 404);
      return;
    }
    if (!canViewDiscussionPost(post, user)) {
      await fulfillJson(route, { ok: false, error: "Discussion post not found" }, 404);
      return;
    }

    if (request.method() === "HEAD") {
      await route.fulfill({ status: 200, body: "" });
      return;
    }

    if (parts[1] === "comments") {
      if (parts.length === 2) {
        if (request.method() === "GET") {
          await fulfillJson(route, {
            ok: true,
            data: comments
              .filter((comment) => comment.postId === postId)
              .map((comment) => applyCommentPermissions(comment, user))
          });
          return;
        }
        if (request.method() === "POST") {
          const input = request.postDataJSON() as { contentMarkdown: string; parentCommentId?: string };
          const created: DiscussionComment = {
            id: `disc_comment_${comments.length + 1}`,
            classroomId: "cls_discussion",
            postId,
            authorUserId: user.id,
            authorDisplayName: user.displayName,
            authorRole: user.role as "teacher" | "student",
            parentCommentId: input.parentCommentId,
            contentMarkdown: input.contentMarkdown,
            canEdit: true,
            canDelete: true,
            createdAt: now,
            updatedAt: now
          };
          comments = [...comments, created];
          discussions = discussions.map((item) =>
            item.id === postId
              ? { ...item, commentCount: comments.filter((comment) => comment.postId === postId).length }
              : item
          );
          await fulfillJson(route, { ok: true, data: applyCommentPermissions(created, user) }, 201);
          return;
        }
      }
      if (parts.length === 3) {
        const commentId = parts[2];
        const comment = comments.find((item) => item.id === commentId && item.postId === postId);
        if (!comment) {
          await fulfillJson(route, { ok: false, error: "Discussion comment not found" }, 404);
          return;
        }
        const canManage = role === "teacher" || comment.authorUserId === user.id;
        if (!canManage) {
          await fulfillJson(route, { ok: false, error: "댓글 권한이 없습니다." }, 403);
          return;
        }
        if (request.method() === "PATCH") {
          const input = request.postDataJSON() as { contentMarkdown: string };
          const updated = { ...comment, contentMarkdown: input.contentMarkdown, updatedAt: now };
          comments = comments.map((item) => (item.id === commentId ? updated : item));
          await fulfillJson(route, { ok: true, data: applyCommentPermissions(updated, user) });
          return;
        }
        if (request.method() === "DELETE") {
          comments = comments.filter((item) => item.id !== commentId && item.parentCommentId !== commentId);
          await fulfillJson(route, { ok: true });
          return;
        }
      }
    }

    if (request.method() === "GET") {
      if (options.discussionDetailDelayMs) {
        await sleep(options.discussionDetailDelayMs);
      }
      const receiptKey = `${postId}:${user.id}`;
      const requestTime = Date.now();
      const lastViewedAt = viewReceipts.get(receiptKey);
      const shouldCount = lastViewedAt === undefined || requestTime - lastViewedAt > 10_000;
      if (post.status === "PUBLISHED" && shouldCount) {
        viewReceipts.set(receiptKey, requestTime);
        discussions = discussions.map((item) =>
          item.id === postId ? { ...item, viewCount: item.viewCount + 1 } : item
        );
      }
      const updated = discussions.find((item) => item.id === postId)!;
      await fulfillJson(route, { ok: true, data: applyPostPermissions(updated, user) });
      return;
    }
    if (request.method() === "PATCH") {
      const input = request.postDataJSON() as Partial<DiscussionPost>;
      postPatchPayloads.push(input);
      if (role !== "teacher" && input.pinned !== undefined) {
        await fulfillJson(route, { ok: false, error: "상단 고정은 선생님만 수정할 수 있습니다." }, 403);
        return;
      }
      const canEdit = role === "teacher" || post.authorUserId === user.id;
      if (!canEdit) {
        await fulfillJson(route, { ok: false, error: "게시글 수정 권한이 없습니다." }, 403);
        return;
      }
      const updated: DiscussionPost = {
        ...post,
        ...input,
        pinned: role === "teacher" && input.pinned !== undefined ? Boolean(input.pinned) : post.pinned,
        anonymous: false,
        updatedAt: editNow
      };
      discussions = discussions.map((item) => (item.id === postId ? updated : item));
      await fulfillJson(route, { ok: true, data: applyPostPermissions(updated, user) });
      return;
    }
    if (request.method() === "DELETE") {
      const canDelete = role === "teacher" || post.authorUserId === user.id;
      if (!canDelete) {
        await fulfillJson(route, { ok: false, error: "게시글 삭제 권한이 없습니다." }, 403);
        return;
      }
      discussions = discussions.filter((item) => item.id !== postId);
      comments = comments.filter((comment) => comment.postId !== postId);
      await fulfillJson(route, { ok: true });
      return;
    }

    await fulfillJson(route, { ok: false, error: "unsupported" }, 405);
  });

  return {
    getPostPayloads: () => [...postPayloads],
    getPostPatchPayloads: () => [...postPatchPayloads],
    getAssistantRequests: () => [...assistantRequests],
    getViewCount: (postId: string) => discussions.find((post) => post.id === postId)?.viewCount
  };
}

async function expectCompactDiscussionEmptyState(page: Page, title: string, description: string) {
  const emptyCard = page.locator(".discussion-list-panel > .discussion-empty-card");
  const emptyIcon = page.locator(".discussion-list-panel > .discussion-empty-card > svg");
  await expect(emptyCard).toBeVisible();
  await expect(emptyIcon).toBeVisible();
  await expect(emptyCard.locator("strong")).toHaveText(title);
  await expect(emptyCard.locator("span")).toHaveText(description);
  await expect(page.locator(".discussion-list-head > span")).toHaveText("총 0개");
  await expect(page.getByTestId("discussion-create-action")).toBeVisible();
  await expect(page.getByTestId("discussion-post-card")).toHaveCount(0);

  const iconSize = await emptyIcon.evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  expect(iconSize.width).toBeGreaterThanOrEqual(36);
  expect(iconSize.width).toBeLessThanOrEqual(40);
  expect(iconSize.height).toBeGreaterThanOrEqual(36);
  expect(iconSize.height).toBeLessThanOrEqual(40);
}

async function readDiscussionCommentEditMetrics(form: Locator) {
  return form.evaluate((element) => {
    const input = element.querySelector("input");
    const buttons = Array.from(element.querySelectorAll("button"));
    const save = buttons.find((button) => button.textContent?.trim() === "저장");
    const cancel = buttons.find((button) => button.textContent?.trim() === "취소");
    const comment = element.closest(".discussion-comment");
    const list = element.closest(".discussion-comment-list");
    if (!input || !save || !cancel || !comment || !list) {
      throw new Error("discussion comment edit layout elements are missing");
    }
    const rectOf = (target: Element) => {
      const rect = target.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    };
    const overflowOf = (target: Element) => ({
      clientWidth: (target as HTMLElement).clientWidth,
      scrollWidth: (target as HTMLElement).scrollWidth
    });
    return {
      form: rectOf(element),
      input: rectOf(input),
      save: rectOf(save),
      cancel: rectOf(cancel),
      comment: overflowOf(comment),
      list: overflowOf(list),
      formOverflow: overflowOf(element)
    };
  });
}

function expectDiscussionCommentEditDesktopLayout(metrics: Awaited<ReturnType<typeof readDiscussionCommentEditMetrics>>) {
  expect(metrics.input.width).toBeGreaterThan(metrics.save.width + 80);
  expect(metrics.save.width).toBeGreaterThanOrEqual(112);
  expect(metrics.save.width).toBeLessThanOrEqual(180);
  expect(metrics.cancel.width).toBeGreaterThanOrEqual(112);
  expect(metrics.cancel.width).toBeLessThanOrEqual(180);
  expect(Math.abs(metrics.save.width - metrics.cancel.width)).toBeLessThanOrEqual(32);
  expect(Math.abs(metrics.save.height - metrics.cancel.height)).toBeLessThanOrEqual(1);
  expect(metrics.save.height).toBeGreaterThanOrEqual(46);
  expect(metrics.cancel.height).toBeGreaterThanOrEqual(46);
  expect(metrics.input.right).toBeLessThanOrEqual(metrics.save.left);
  expect(metrics.save.right).toBeLessThanOrEqual(metrics.cancel.left);
  expect(metrics.formOverflow.scrollWidth).toBeLessThanOrEqual(metrics.formOverflow.clientWidth + 1);
  expect(metrics.comment.scrollWidth).toBeLessThanOrEqual(metrics.comment.clientWidth + 1);
  expect(metrics.list.scrollWidth).toBeLessThanOrEqual(metrics.list.clientWidth + 1);
}

function expectDiscussionCommentEditMobileLayout(metrics: Awaited<ReturnType<typeof readDiscussionCommentEditMetrics>>) {
  expect(Math.abs(metrics.input.width - metrics.form.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.save.width - metrics.form.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.cancel.width - metrics.form.width)).toBeLessThanOrEqual(1);
  expect(metrics.input.bottom).toBeLessThanOrEqual(metrics.save.top);
  expect(metrics.save.bottom).toBeLessThanOrEqual(metrics.cancel.top);
  expect(Math.abs(metrics.save.height - metrics.cancel.height)).toBeLessThanOrEqual(1);
  expect(metrics.save.height).toBeGreaterThanOrEqual(46);
  expect(metrics.formOverflow.scrollWidth).toBeLessThanOrEqual(metrics.formOverflow.clientWidth + 1);
  expect(metrics.comment.scrollWidth).toBeLessThanOrEqual(metrics.comment.clientWidth + 1);
  expect(metrics.list.scrollWidth).toBeLessThanOrEqual(metrics.list.clientWidth + 1);
}

function directCommentActions(comment: Locator) {
  return comment.locator(".discussion-comment-actions").first();
}

async function optionLabels(select: Locator) {
  return (await select.locator("option").allTextContents()).map((label) => label.trim());
}

async function expectDiscussionListNoticeControlsHidden(page: Page) {
  const toolbarTypeSelect = page.locator(".discussion-toolbar").getByLabel("토론 유형");
  await expect(toolbarTypeSelect).toBeVisible();
  expect(await optionLabels(toolbarTypeSelect)).toEqual(["전체 유형", "질문", "자유 토론", "자료 공유"]);

  const tabs = page.locator(".discussion-category-tabs");
  await expect(tabs.getByRole("button")).toHaveText(["전체", "질문", "자유 토론", "자료 공유"]);
  await expect(tabs.getByRole("button", { name: "공지", exact: true })).toHaveCount(0);
}

async function expectDiscussionComposeNoticeControlsHidden(page: Page) {
  const categorySelect = page.getByLabel("토론 글 유형");
  await expect(categorySelect).toBeVisible();
  await expect(categorySelect).toHaveValue("FREE");
  expect(await optionLabels(categorySelect)).toEqual(["질문", "자유 토론", "자료 공유"]);
}

async function expectNoNoticeCopyInDiscussionSurface(surface: Locator) {
  await expect(surface.getByText(/공지/)).toHaveCount(0);
}

async function installControlledAssistantStream(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    type StreamController = ReadableStreamDefaultController<Uint8Array>;
    (window as typeof window & {
      __discussionAssistantStreamControllers?: StreamController[];
      __discussionAssistantRequests?: unknown[];
    }).__discussionAssistantStreamControllers = [];
    (window as typeof window & {
      __discussionAssistantStreamControllers?: StreamController[];
      __discussionAssistantRequests?: unknown[];
    }).__discussionAssistantRequests = [];

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (!url.includes("/api/classrooms/cls_discussion/discussions/assistant/stream")) {
        return originalFetch(input, init);
      }

      let bodyText = "";
      if (typeof init?.body === "string") {
        bodyText = init.body;
      } else if (input instanceof Request) {
        bodyText = await input.clone().text();
      }
      try {
        (window as typeof window & { __discussionAssistantRequests?: unknown[] }).__discussionAssistantRequests?.push(
          bodyText ? JSON.parse(bodyText) : {}
        );
      } catch {
        (window as typeof window & { __discussionAssistantRequests?: unknown[] }).__discussionAssistantRequests?.push({});
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          (window as typeof window & { __discussionAssistantStreamControllers?: StreamController[] })
            .__discussionAssistantStreamControllers?.push(controller);
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" }
      });
    };

    (window as typeof window & {
      __discussionAssistantPushEvent?: (index: number, event: Record<string, unknown>) => void;
      __discussionAssistantCloseStream?: (index: number) => void;
    }).__discussionAssistantPushEvent = (index, event) => {
      const controller = (window as typeof window & { __discussionAssistantStreamControllers?: StreamController[] })
        .__discussionAssistantStreamControllers?.[index];
      if (!controller) throw new Error(`assistant stream ${index} is not ready`);
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    };
    (window as typeof window & {
      __discussionAssistantCloseStream?: (index: number) => void;
    }).__discussionAssistantCloseStream = (index) => {
      const controller = (window as typeof window & { __discussionAssistantStreamControllers?: StreamController[] })
        .__discussionAssistantStreamControllers?.[index];
      if (!controller) throw new Error(`assistant stream ${index} is not ready`);
      controller.close();
    };
  });
}

async function waitForAssistantStream(page: Page, index: number) {
  await expect.poll(() =>
    page.evaluate((streamIndex) =>
      ((window as typeof window & { __discussionAssistantStreamControllers?: unknown[] })
        .__discussionAssistantStreamControllers?.length ?? 0) > streamIndex,
      index
    )
  ).toBe(true);
}

async function pushAssistantStreamEvent(page: Page, index: number, event: Record<string, unknown>) {
  await page.evaluate(
    ({ streamIndex, streamEvent }) => {
      (window as typeof window & {
        __discussionAssistantPushEvent?: (index: number, event: Record<string, unknown>) => void;
      }).__discussionAssistantPushEvent?.(streamIndex, streamEvent);
    },
    { streamIndex: index, streamEvent: event }
  );
}

async function closeAssistantStream(page: Page, index: number) {
  await page.evaluate((streamIndex) => {
    (window as typeof window & { __discussionAssistantCloseStream?: (index: number) => void })
      .__discussionAssistantCloseStream?.(streamIndex);
  }, index);
}

async function getControlledAssistantRequests(page: Page) {
  return page.evaluate(() =>
    ((window as typeof window & { __discussionAssistantRequests?: unknown[] }).__discussionAssistantRequests ?? [])
  );
}

function assistantThoughtToggle(message: Locator) {
  return message.getByRole("button", { name: /사고 요약/ });
}

function latestAssistantMessage(page: Page) {
  return page.locator(".discussion-assistant-message.assistant").last();
}

async function sendControlledAssistantPrompt(page: Page, prompt: string, streamIndex: number) {
  const input = page.getByPlaceholder("AI에게 작성 도움 요청하기");
  await input.fill(prompt);
  await input.press("Enter");
  await waitForAssistantStream(page, streamIndex);
}

async function expectAssistantThoughtCollapsedAndReveal(page: Page, text: string) {
  const thought = page.getByTestId("discussion-assistant-thought").last();
  await expect(thought).toBeVisible();
  const toggle = assistantThoughtToggle(thought);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(thought.getByText(text)).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(thought.getByText(text)).toBeVisible();
}

async function readAssistantThreadMetrics(page: Page) {
  return page.evaluate(() => {
    const thread = document.querySelector("[data-testid='discussion-assistant-thread']") as HTMLElement | null;
    if (!thread) throw new Error("discussion assistant thread is missing");
    const documentScrollY = window.scrollY || document.documentElement.scrollTop;
    return {
      scrollTop: thread.scrollTop,
      clientHeight: thread.clientHeight,
      scrollHeight: thread.scrollHeight,
      documentScrollY,
      atBottom: thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 2
    };
  });
}

async function expectAssistantThreadAtBottom(page: Page) {
  await expect.poll(async () => (await readAssistantThreadMetrics(page)).atBottom).toBe(true);
}

async function expectAssistantThreadOverflow(page: Page) {
  await expect.poll(async () => {
    const metrics = await readAssistantThreadMetrics(page);
    return metrics.scrollHeight > metrics.clientHeight;
  }).toBe(true);
}

async function expectDocumentScrollY(page: Page, expectedScrollY: number) {
  await expect.poll(async () => Math.abs((await readAssistantThreadMetrics(page)).documentScrollY - expectedScrollY) <= 1)
    .toBe(true);
}

async function setAssistantThreadScrollTop(page: Page, scrollTop: number) {
  await page.evaluate((nextScrollTop) => {
    const thread = document.querySelector("[data-testid='discussion-assistant-thread']") as HTMLElement | null;
    if (!thread) throw new Error("discussion assistant thread is missing");
    thread.scrollTop = nextScrollTop;
  }, scrollTop);
}

function longAssistantMarkdown(label: string, count = 10) {
  return Array.from(
    { length: count },
    (_, index) =>
      `${index + 1}. ${label} - 학생들이 답변 흐름을 계속 볼 수 있도록 자동 스크롤 검증 문장을 충분히 길게 작성합니다. 핵심 내용과 예시를 함께 이어갑니다.`
  ).join("\n\n");
}

test("teacher discussion board list, compose assistant, and detail match the reference flow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const mock = await mockDiscussionClassroom(page, "teacher");
  mkdirSync("test-results", { recursive: true });

  await page.goto("/classrooms/cls_discussion?section=weeks");
  await page.getByTestId("topbar-nav-chat").click();
  await expect(page).toHaveURL(/\/classrooms\/cls_discussion\?section=discussion$/);
  const panel = page.getByTestId("classroom-discussions-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("topbar-nav-chat")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("topbar-nav-classroom")).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator(".classroom-hero")).toHaveCount(0);
  await expect(page.getByTestId("discussion-list-shell")).toBeVisible();
  await expect(page.getByText("토론 게시판")).toBeVisible();
  await expect(page.locator(".discussion-hero-metrics > span")).toHaveCount(3);
  await expect(page.getByPlaceholder("제목 또는 작성자로 검색")).toBeVisible();
  await expectDiscussionListNoticeControlsHidden(page);
  await expect(page.getByTestId("discussion-post-card")).toHaveCount(6);
  const legacyNoticeCard = page.getByTestId("discussion-post-card").filter({ hasText: "2주차 수업 전 준비사항 안내" });
  await expect(legacyNoticeCard).toHaveCount(1);
  await expect(legacyNoticeCard.locator("h3")).toHaveText("2주차 수업 전 준비사항 안내");
  await expect(legacyNoticeCard.getByText("상단 고정", { exact: true })).toBeVisible();
  await expect(legacyNoticeCard.getByText("[공지]")).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBe(true);
  await panel.screenshot({ path: "test-results/classroom-discussions-list.png" });

  await page.getByPlaceholder("제목 또는 작성자로 검색").fill("준비사항");
  await expect(page.getByTestId("discussion-post-card")).toHaveCount(1);
  await expect(page.getByText("2주차 수업 전 준비사항 안내")).toBeVisible();
  await page.getByPlaceholder("제목 또는 작성자로 검색").fill("Transformer");
  await expect(page.getByTestId("discussion-post-card")).toHaveCount(1);
  await page.getByPlaceholder("제목 또는 작성자로 검색").fill("검색결과없음-토론-빈상태");
  await expectCompactDiscussionEmptyState(
    page,
    "조건에 맞는 게시글이 없습니다.",
    "검색어나 유형 필터를 바꿔 다시 확인해 보세요."
  );
  await page.getByPlaceholder("제목 또는 작성자로 검색").fill("");
  await expect(page.getByTestId("discussion-post-card")).toHaveCount(6);

  await page.getByTestId("discussion-create-action").click();
  await expect(page).toHaveURL(/discussionMode=create/);
  await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();
  await expectDiscussionComposeNoticeControlsHidden(page);
  await page.getByPlaceholder("2주차 토론 주제 미리 의견 남겨주세요").fill("2주차 토론 주제 미리 의견 남겨주세요");
  await page.locator(".discussion-editor-card textarea").fill(
    "이번 주제는 우리 일상 속 데이터 활용 사례와 윤리적 문제를 함께 생각해보는 것입니다."
  );
  await page.getByTestId("discussion-pin-option").locator("input").check();
  await page.getByPlaceholder("AI에게 작성 도움 요청하기").fill("학생들이 의견을 남기기 쉽게 질문형 문장으로 다듬어줘");
  await page.locator(".discussion-send-btn").click();
  await expect.poll(() => mock.getAssistantRequests().length).toBe(1);
  expect(mock.getAssistantRequests()[0].draft).toMatchObject({
    title: "2주차 토론 주제 미리 의견 남겨주세요",
    contentMarkdown: "이번 주제는 우리 일상 속 데이터 활용 사례와 윤리적 문제를 함께 생각해보는 것입니다.",
    category: "FREE",
    visibility: "CLASS",
    pinned: true,
    anonymous: false,
    allowComments: true,
    status: "DRAFT",
    attachments: []
  });
  await expectAssistantThoughtCollapsedAndReveal(page, "현재 게시글 JSON을 확인하고 있습니다.");
  await expect(page.getByTestId("discussion-assistant-thread").getByText("질문형 문장", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "질문형으로 반영" }).click();
  await expect(page.locator(".discussion-editor-card textarea")).toHaveValue(/여러분은 실제 사례에서/);
  const assistantInput = page.getByPlaceholder("AI에게 작성 도움 요청하기");
  await assistantInput.fill("핵심만");
  await assistantInput.press("Shift+Enter");
  await assistantInput.type("요약해줘");
  await assistantInput.press("Enter");
  await expect.poll(() => mock.getAssistantRequests().length).toBe(2);
  expect(mock.getAssistantRequests()[1].prompt).toBe("핵심만\n요약해줘");
  await expect(page.getByRole("button", { name: "말투 다듬기" })).toBeEnabled();
  await page.getByRole("button", { name: "말투 다듬기" }).click();
  await expect.poll(() => mock.getAssistantRequests().length).toBe(3);
  expect(String(mock.getAssistantRequests()[2].prompt)).toContain("자연스러운 토론 톤");
  await expect(page.getByRole("button", { name: "참여 안내문 추천" })).toBeEnabled();
  await page.getByRole("button", { name: "참여 안내문 추천" }).click();
  await expect.poll(() => mock.getAssistantRequests().length).toBe(4);
  const guidePresetPrompt = String(mock.getAssistantRequests()[3].prompt);
  expect(guidePresetPrompt).toContain("토론 안내");
  expect(guidePresetPrompt).not.toContain("공지");
  await page.getByTestId("discussion-compose-shell").screenshot({
    path: "test-results/classroom-discussions-compose.png"
  });

  await page.getByRole("button", { name: "게시하기" }).click();
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  await expect(page).toHaveURL(/discussionId=disc_created_1/);
  expect(mock.getPostPayloads().at(-1)?.pinned).toBe(true);
  await expect(page.getByText("2주차 토론 주제에 대해 의견을 나눠봅시다")).toBeVisible();

  await page.getByTestId("discussion-comment-input").fill("토론 참여하겠습니다.");
  await page.getByRole("button", { name: "등록" }).first().click();
  await expect(page.getByText("토론 참여하겠습니다.")).toBeVisible();
  await page.getByText("답글").first().click();
  await page.getByTestId("discussion-reply-input").fill("좋습니다. 다음 수업에서 함께 보겠습니다.");
  await page.getByRole("button", { name: "등록" }).last().click();
  await expect(page.getByText("좋습니다. 다음 수업에서 함께 보겠습니다.")).toBeVisible();
  await page.getByTestId("discussion-detail-shell").screenshot({
    path: "test-results/classroom-discussions-detail.png"
  });
});

test("discussion assistant thought summary collapses when the answer starts and keeps user toggles", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await installControlledAssistantStream(page);
  await mockDiscussionClassroom(page, "teacher");
  mkdirSync("test-results", { recursive: true });

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionMode=create");
  await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();

  await sendControlledAssistantPrompt(page, "초안을 요약해줘", 0);
  await pushAssistantStreamEvent(page, 0, { type: "thought_delta", text: "사고 1" });
  const message = latestAssistantMessage(page);
  const thought = message.getByTestId("discussion-assistant-thought");
  const toggle = assistantThoughtToggle(message);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(thought.getByText("사고 1")).toBeVisible();

  await pushAssistantStreamEvent(page, 0, { type: "answer_delta", text: "답변 1" });
  await expect(message.getByText("답변 1")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(thought.getByText("사고 1")).toBeHidden();
  await page.getByTestId("discussion-compose-shell").screenshot({
    path: "test-results/classroom-discussions-assistant-thought-collapsed.png"
  });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(thought.getByText("사고 1")).toBeVisible();
  await page.getByTestId("discussion-compose-shell").screenshot({
    path: "test-results/classroom-discussions-assistant-thought-open.png"
  });
  await pushAssistantStreamEvent(page, 0, { type: "answer_delta", text: " 답변 2" });
  await expect(message.getByText("답변 1 답변 2")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(thought.getByText("사고 1")).toBeVisible();

  await pushAssistantStreamEvent(page, 0, {
    type: "done",
    answerText: "답변 1 답변 2",
    thoughtSummary: "사고 1",
    data: {
      messageMarkdown: "답변 1 답변 2",
      suggestedTitle: "요약된 토론",
      suggestedContentMarkdown: "답변 1 답변 2",
      suggestionLabel: "반영"
    }
  });
  await closeAssistantStream(page, 0);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(thought.getByText("사고 1")).toBeHidden();
});

test("discussion assistant collapses done-only answers and overrides pre-answer manual state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await installControlledAssistantStream(page);
  await mockDiscussionClassroom(page, "teacher");

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionMode=create");
  await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();

  await sendControlledAssistantPrompt(page, "마무리에서만 답변이 오는 경우", 0);
  await pushAssistantStreamEvent(page, 0, { type: "thought_delta", text: "초기 사고" });
  const firstMessage = latestAssistantMessage(page);
  const firstThought = firstMessage.getByTestId("discussion-assistant-thought");
  const firstToggle = assistantThoughtToggle(firstMessage);
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");

  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
  await pushAssistantStreamEvent(page, 0, { type: "thought_delta", text: " 추가 사고" });
  await expect(firstThought.getByText("초기 사고 추가 사고")).toBeHidden();

  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await pushAssistantStreamEvent(page, 0, {
    type: "done",
    answerText: "최종 답변",
    thoughtSummary: "최종 사고",
    data: {
      messageMarkdown: "최종 답변",
      suggestedTitle: "최종 제목",
      suggestedContentMarkdown: "최종 답변",
      suggestionLabel: "반영"
    }
  });
  await closeAssistantStream(page, 0);
  await expect(firstMessage.getByText("최종 답변")).toBeVisible();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
  await expect(firstThought.getByText("최종 사고")).toBeHidden();

  await sendControlledAssistantPrompt(page, "done 하나로 사고와 답변이 같이 오는 경우", 1);
  await pushAssistantStreamEvent(page, 1, {
    type: "done",
    answerText: "한 번에 온 답변",
    thoughtSummary: "한 번에 온 사고",
    data: {
      messageMarkdown: "한 번에 온 답변",
      suggestedTitle: "한 번 제목",
      suggestedContentMarkdown: "한 번에 온 답변",
      suggestionLabel: "반영"
    }
  });
  await closeAssistantStream(page, 1);
  const secondMessage = latestAssistantMessage(page);
  const secondThought = secondMessage.getByTestId("discussion-assistant-thought");
  const secondToggle = assistantThoughtToggle(secondMessage);
  await expect(secondMessage.getByText("한 번에 온 답변")).toBeVisible();
  await expect(secondToggle).toHaveAttribute("aria-expanded", "false");
  await expect(secondThought.getByText("한 번에 온 사고")).toBeHidden();
});

test("discussion assistant keeps late thoughts isolated and sends clean history", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await installControlledAssistantStream(page);
  await mockDiscussionClassroom(page, "teacher");

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionMode=create");
  await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();

  await sendControlledAssistantPrompt(page, "답변이 먼저 시작되는 경우", 0);
  await pushAssistantStreamEvent(page, 0, { type: "answer_delta", text: "첫 답변" });
  await pushAssistantStreamEvent(page, 0, { type: "thought_delta", text: "늦은 사고" });
  const firstMessage = latestAssistantMessage(page);
  const firstThought = firstMessage.getByTestId("discussion-assistant-thought");
  const firstToggle = assistantThoughtToggle(firstMessage);
  await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
  await expect(firstThought.getByText("늦은 사고")).toBeHidden();
  await firstToggle.click();
  await pushAssistantStreamEvent(page, 0, { type: "thought_delta", text: " 추가" });
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await expect(firstThought.getByText("늦은 사고 추가")).toBeVisible();
  await pushAssistantStreamEvent(page, 0, {
    type: "done",
    answerText: "첫 답변",
    thoughtSummary: "늦은 사고 추가",
    data: {
      messageMarkdown: "첫 답변",
      suggestedTitle: "첫 제목",
      suggestedContentMarkdown: "첫 답변",
      suggestionLabel: "반영"
    }
  });
  await closeAssistantStream(page, 0);

  await sendControlledAssistantPrompt(page, "두 번째 답변", 1);
  const requests = (await getControlledAssistantRequests(page)) as Array<Record<string, unknown>>;
  const history = requests[1].history as Array<Record<string, unknown>>;
  expect(history).toEqual([
    { role: "user", contentMarkdown: "답변이 먼저 시작되는 경우" },
    { role: "assistant", contentMarkdown: "첫 답변" }
  ]);
  expect(JSON.stringify(history)).not.toContain("thoughtMarkdown");
  expect(JSON.stringify(history)).not.toContain("thoughtOpen");
  expect(JSON.stringify(history)).not.toContain("answerStarted");
  expect(JSON.stringify(history)).not.toContain("thoughtManuallyToggled");
  await pushAssistantStreamEvent(page, 1, { type: "thought_delta", text: "두 번째 사고" });
  await pushAssistantStreamEvent(page, 1, { type: "answer_delta", text: "두 번째 답변" });
  await pushAssistantStreamEvent(page, 1, {
    type: "done",
    answerText: "두 번째 답변",
    thoughtSummary: "두 번째 사고",
    data: {
      messageMarkdown: "두 번째 답변",
      suggestedTitle: "두 번째 제목",
      suggestedContentMarkdown: "두 번째 답변",
      suggestionLabel: "반영"
    }
  });
  await closeAssistantStream(page, 1);

  const assistantMessages = page.locator(".discussion-assistant-message.assistant");
  const firstAssistant = assistantMessages.nth(0);
  const secondAssistant = assistantMessages.nth(1);
  await expect(assistantThoughtToggle(firstAssistant)).toHaveAttribute("aria-expanded", "true");
  await expect(assistantThoughtToggle(secondAssistant)).toHaveAttribute("aria-expanded", "false");
  await assistantThoughtToggle(secondAssistant).click();
  await expect(assistantThoughtToggle(firstAssistant)).toHaveAttribute("aria-expanded", "true");
  await expect(assistantThoughtToggle(secondAssistant)).toHaveAttribute("aria-expanded", "true");

  await sendControlledAssistantPrompt(page, "사고 없는 답변", 2);
  await pushAssistantStreamEvent(page, 2, { type: "answer_delta", text: "사고 없이 바로 답변" });
  await pushAssistantStreamEvent(page, 2, { type: "done", answerText: "사고 없이 바로 답변" });
  await closeAssistantStream(page, 2);
  const answerOnlyMessage = latestAssistantMessage(page);
  await expect(answerOnlyMessage.getByText("사고 없이 바로 답변")).toBeVisible();
  await expect(answerOnlyMessage.getByTestId("discussion-assistant-thought")).toHaveCount(0);

  await sendControlledAssistantPrompt(page, "최종 필드가 생략되어도 스트림 내용 보존", 3);
  await pushAssistantStreamEvent(page, 3, { type: "thought_delta", text: "보존 사고" });
  await pushAssistantStreamEvent(page, 3, { type: "answer_delta", text: "보존 답변" });
  await pushAssistantStreamEvent(page, 3, { type: "done" });
  await closeAssistantStream(page, 3);
  const preservedMessage = latestAssistantMessage(page);
  const preservedThought = preservedMessage.getByTestId("discussion-assistant-thought");
  const preservedToggle = assistantThoughtToggle(preservedMessage);
  await expect(preservedMessage.getByText("보존 답변")).toBeVisible();
  await expect(preservedToggle).toHaveAttribute("aria-expanded", "false");
  await preservedToggle.click();
  await expect(preservedThought.getByText("보존 사고")).toBeVisible();

  await sendControlledAssistantPrompt(page, "공백 사고는 표시하지 않기", 4);
  await pushAssistantStreamEvent(page, 4, { type: "thought_delta", text: "   \n  " });
  await pushAssistantStreamEvent(page, 4, { type: "answer_delta", text: "공백 사고 답변" });
  await pushAssistantStreamEvent(page, 4, { type: "done", answerText: "공백 사고 답변", thoughtSummary: "   " });
  await closeAssistantStream(page, 4);
  const whitespaceThoughtMessage = latestAssistantMessage(page);
  await expect(whitespaceThoughtMessage.getByText("공백 사고 답변")).toBeVisible();
  await expect(whitespaceThoughtMessage.getByTestId("discussion-assistant-thought")).toHaveCount(0);

  await sendControlledAssistantPrompt(page, "오류 응답", 5);
  await pushAssistantStreamEvent(page, 5, { type: "error", error: "테스트 오류" });
  await closeAssistantStream(page, 5);
  const errorMessage = latestAssistantMessage(page);
  await expect(errorMessage.getByText("테스트 오류")).toBeVisible();
  await expect(errorMessage.getByTestId("discussion-assistant-thought")).toHaveCount(0);
});

for (const role of ["teacher", "student"] as const) {
  test(`discussion assistant autoscroll follows streaming output for ${role}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await installControlledAssistantStream(page);
    await mockDiscussionClassroom(page, role);
    mkdirSync("test-results", { recursive: true });

    await page.goto("/classrooms/cls_discussion?section=discussion&discussionMode=create");
    await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));

    await sendControlledAssistantPrompt(page, `${role} 자동 스크롤 확인`, 0);
    await expectAssistantThreadAtBottom(page);
    const streamDocumentScrollY = (await readAssistantThreadMetrics(page)).documentScrollY;

    await pushAssistantStreamEvent(page, 0, { type: "thought_delta", text: longAssistantMarkdown("사고 요약", 14) });
    await expectAssistantThreadOverflow(page);
    await expectAssistantThreadAtBottom(page);
    await expectDocumentScrollY(page, streamDocumentScrollY);

    const firstMessage = latestAssistantMessage(page);
    const firstToggle = assistantThoughtToggle(firstMessage);
    await pushAssistantStreamEvent(page, 0, { type: "answer_delta", text: longAssistantMarkdown("첫 답변", 10) });
    await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
    await expectAssistantThreadOverflow(page);
    await expectAssistantThreadAtBottom(page);
    await expectDocumentScrollY(page, streamDocumentScrollY);

    for (let index = 1; index <= 3; index += 1) {
      await pushAssistantStreamEvent(page, 0, {
        type: "answer_delta",
        text: `\n\n${longAssistantMarkdown(`추가 답변 ${index}`, 7)}`
      });
      await expectAssistantThreadOverflow(page);
      await expectAssistantThreadAtBottom(page);
      await expectDocumentScrollY(page, streamDocumentScrollY);
    }

    const finalAnswer = longAssistantMarkdown("최종 답변", 22);
    await pushAssistantStreamEvent(page, 0, {
      type: "done",
      answerText: finalAnswer,
      thoughtSummary: "사고 요약 최종 정리",
      data: {
        messageMarkdown: finalAnswer,
        suggestedTitle: "자동 스크롤 토론",
        suggestedContentMarkdown: finalAnswer,
        suggestionLabel: "자동 반영"
      }
    });
    await closeAssistantStream(page, 0);
    await expect(firstMessage.getByRole("button", { name: "자동 반영" })).toBeVisible();
    await expectAssistantThreadAtBottom(page);
    await expectDocumentScrollY(page, streamDocumentScrollY);
    await page.getByTestId("discussion-compose-shell").screenshot({
      path: `test-results/classroom-discussions-assistant-autoscroll-${role}.png`
    });

    await setAssistantThreadScrollTop(page, 0);
    await expect.poll(async () => (await readAssistantThreadMetrics(page)).atBottom).toBe(false);
    const beforeToggleMetrics = await readAssistantThreadMetrics(page);
    await page.evaluate(() => {
      const toggle = document.querySelector(".discussion-assistant-thought-toggle") as HTMLButtonElement | null;
      toggle?.click();
    });
    const afterToggleMetrics = await readAssistantThreadMetrics(page);
    expect(afterToggleMetrics.atBottom).toBe(false);
    expect(afterToggleMetrics.scrollTop).toBeLessThanOrEqual(beforeToggleMetrics.scrollTop + 2);

    await sendControlledAssistantPrompt(page, `${role} 오류 자동 스크롤`, 1);
    const errorDocumentScrollY = (await readAssistantThreadMetrics(page)).documentScrollY;
    await pushAssistantStreamEvent(page, 1, { type: "error", error: "자동 스크롤 오류" });
    await closeAssistantStream(page, 1);
    await expect(latestAssistantMessage(page).getByText("자동 스크롤 오류")).toBeVisible();
    await expectAssistantThreadAtBottom(page);
    await expectDocumentScrollY(page, errorDocumentScrollY);

    await page.setViewportSize({ width: 1050, height: 860 });
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
    ).toBe(true);
    await expectAssistantThreadAtBottom(page);
  });
}

test("discussion assistant aborts in-flight autoscroll streams on compose exit without stale UI", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await installControlledAssistantStream(page);
  await mockDiscussionClassroom(page, "teacher");

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionMode=create");
  await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();

  await sendControlledAssistantPrompt(page, "중단될 자동 스크롤 프롬프트", 0);
  await pushAssistantStreamEvent(page, 0, { type: "thought_delta", text: "중단 전 사고" });
  await expect(page.getByTestId("discussion-assistant-thread").getByText("중단 전 사고")).toBeVisible();

  await page.locator(".discussion-compose-footer").getByRole("button", { name: "취소" }).click();
  await expect(page.getByTestId("discussion-list-shell")).toBeVisible();
  await pushAssistantStreamEvent(page, 0, { type: "answer_delta", text: "늦은 자동 스크롤 답변" });
  await pushAssistantStreamEvent(page, 0, { type: "error", error: "늦은 자동 스크롤 오류" });
  await closeAssistantStream(page, 0);

  await page.getByTestId("discussion-edit-action").first().click();
  await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();
  const editThread = page.getByTestId("discussion-assistant-thread");
  await expect(editThread.getByText("중단될 자동 스크롤 프롬프트")).toHaveCount(0);
  await expect(editThread.getByText("중단 전 사고")).toHaveCount(0);
  await expect(editThread.getByText("늦은 자동 스크롤 답변")).toHaveCount(0);
  await expect(editThread.getByText("늦은 자동 스크롤 오류")).toHaveCount(0);
  await expect(editThread.getByText("응답을 작성하고 있습니다...")).toHaveCount(0);

  await page.locator(".discussion-compose-footer").getByRole("button", { name: "취소" }).click();
  await page.getByTestId("discussion-create-action").click();
  const createThread = page.getByTestId("discussion-assistant-thread");
  await expect(createThread.getByText("중단될 자동 스크롤 프롬프트")).toHaveCount(0);
  await expect(createThread.getByText("늦은 자동 스크롤 답변")).toHaveCount(0);
  await expect(createThread.getByText("늦은 자동 스크롤 오류")).toHaveCount(0);
});

test("teacher direct edit of legacy notice waits for loaded form and preserves category", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const mock = await mockDiscussionClassroom(page, "teacher", { discussionDetailDelayMs: 500 });

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionMode=edit&discussionId=disc_pinned");
  await expect(page.getByTestId("discussion-edit-loading")).toBeVisible();
  await expect(page.getByRole("button", { name: "수정하기" })).toHaveCount(0);
  expect(mock.getPostPatchPayloads()).toHaveLength(0);

  await expect(page.getByPlaceholder("2주차 토론 주제 미리 의견 남겨주세요")).toHaveValue("2주차 수업 전 준비사항 안내");
  await expect(page.getByLabel("토론 글 유형")).toHaveCount(0);
  expect(mock.getPostPatchPayloads()).toHaveLength(0);

  await page.getByPlaceholder("2주차 토론 주제 미리 의견 남겨주세요").fill("2주차 수업 전 준비사항 안내 수정");
  await page.getByRole("button", { name: "수정하기" }).click();
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  expect(mock.getPostPatchPayloads()).toHaveLength(1);
  expect(mock.getPostPatchPayloads()[0]).toMatchObject({
    title: "2주차 수업 전 준비사항 안내 수정",
    category: "NOTICE",
    pinned: true
  });
});

test("student-owned legacy notice edit hides category selector and preserves category", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const studentLegacyNotice: DiscussionPost = {
    ...seedDiscussions()[0],
    id: "disc_student_legacy_notice",
    authorUserId: studentUser.id,
    authorDisplayName: studentUser.displayName,
    authorRole: "student",
    title: "학생이 예전에 작성한 안내형 토론",
    pinned: false,
    canPin: false
  };
  const mock = await mockDiscussionClassroom(page, "student", {
    discussions: [studentLegacyNotice]
  });

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionMode=edit&discussionId=disc_student_legacy_notice");
  await expect(page.getByPlaceholder("2주차 토론 주제 미리 의견 남겨주세요")).toHaveValue("학생이 예전에 작성한 안내형 토론");
  await expect(page.getByLabel("토론 글 유형")).toHaveCount(0);

  await page.getByPlaceholder("2주차 토론 주제 미리 의견 남겨주세요").fill("학생이 수정한 예전 안내형 토론");
  await page.getByRole("button", { name: "수정하기" }).click();
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  expect(mock.getPostPatchPayloads()).toHaveLength(1);
  expect(mock.getPostPatchPayloads()[0]).toMatchObject({
    title: "학생이 수정한 예전 안내형 토론",
    category: "NOTICE"
  });
  expect(mock.getPostPatchPayloads()[0]).not.toHaveProperty("pinned");
});

test("teacher discussion comment edit actions stay compact on root and reply comments", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDiscussionClassroom(page, "teacher");
  mkdirSync("test-results", { recursive: true });

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionId=disc_pinned");
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();

  const rootComment = page.getByTestId("discussion-comment").filter({ hasText: "확인했습니다. 준비해서 오겠습니다." });
  await expect(rootComment).toHaveCount(1);
  await directCommentActions(rootComment).getByRole("button", { name: "수정" }).click();
  const rootEditForm = page.locator(".discussion-comment-edit").first();
  await expect(rootEditForm).toBeVisible();
  expectDiscussionCommentEditDesktopLayout(await readDiscussionCommentEditMetrics(rootEditForm));
  await page.getByTestId("discussion-detail-shell").screenshot({
    path: "test-results/classroom-discussions-comment-edit-teacher-desktop.png"
  });

  const longMixedComment =
    "수정된 댓글입니다. 매우긴한국어문장과MixedToken_ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890_반복반복반복도 자연스럽게 줄바꿈됩니다.";
  await rootEditForm.locator("input").fill(longMixedComment);
  await rootEditForm.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText(longMixedComment)).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => {
      const list = document.querySelector(".discussion-comment-list") as HTMLElement | null;
      const root = Array.from(document.querySelectorAll(".discussion-comment"))
        .find((comment) => comment.textContent?.includes("수정된 댓글입니다.")) as HTMLElement | undefined;
      return Boolean(
        list &&
          root &&
          document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 &&
          list.scrollWidth <= list.clientWidth + 1 &&
          root.scrollWidth <= root.clientWidth + 1
      );
    })
  ).toBe(true);

  const replyComment = page.locator(".discussion-comment.reply").filter({ hasText: "좋습니다. 수업 때 예시도 같이 볼게요." });
  await expect(replyComment).toHaveCount(1);
  await directCommentActions(replyComment).getByRole("button", { name: "수정" }).click();
  const replyEditForm = page.locator(".discussion-comment.reply .discussion-comment-edit").first();
  await expect(replyEditForm).toBeVisible();
  expectDiscussionCommentEditDesktopLayout(await readDiscussionCommentEditMetrics(replyEditForm));
  await page.getByTestId("discussion-detail-shell").screenshot({
    path: "test-results/classroom-discussions-comment-edit-reply-desktop.png"
  });
});

test("student owner discussion comment edit actions stack naturally on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 860 });
  await mockDiscussionClassroom(page, "student");
  mkdirSync("test-results", { recursive: true });

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionId=disc_pinned");
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();

  const ownerComment = page.getByTestId("discussion-comment").filter({ hasText: "확인했습니다. 준비해서 오겠습니다." });
  await expect(ownerComment).toHaveCount(1);
  await directCommentActions(ownerComment).getByRole("button", { name: "수정" }).click();
  const editForm = page.locator(".discussion-comment-edit").first();
  await expect(editForm).toBeVisible();
  expectDiscussionCommentEditMobileLayout(await readDiscussionCommentEditMetrics(editForm));
  await page.getByTestId("discussion-detail-shell").screenshot({
    path: "test-results/classroom-discussions-comment-edit-student-mobile.png"
  });

  await editForm.locator("input").fill("학생이 모바일에서 댓글을 자연스럽게 수정합니다.");
  await editForm.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("학생이 모바일에서 댓글을 자연스럽게 수정합니다.")).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBe(true);
});

test("discussion board hides notice entry points when no legacy notice posts exist", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await mockDiscussionClassroom(page, "teacher", {
    discussions: seedDiscussions().filter((post) => post.category !== "NOTICE")
  });

  await page.goto("/classrooms/cls_discussion?section=discussion");
  const listPanel = page.getByTestId("discussion-list-shell");
  await expect(listPanel).toBeVisible();
  await expectDiscussionListNoticeControlsHidden(page);
  await expectNoNoticeCopyInDiscussionSurface(listPanel);

  await page.getByTestId("discussion-create-action").click();
  const composeShell = page.getByTestId("discussion-compose-shell");
  await expect(composeShell).toBeVisible();
  await expectDiscussionComposeNoticeControlsHidden(page);
  await expectNoNoticeCopyInDiscussionSurface(composeShell);
});

test("discussion empty board state stays compact and keeps create path", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await mockDiscussionClassroom(page, "teacher", { discussions: [] });

  await page.goto("/classrooms/cls_discussion?section=discussion");
  await expect(page.getByTestId("discussion-list-shell")).toBeVisible();
  await expectCompactDiscussionEmptyState(
    page,
    "아직 표시할 게시글이 없습니다.",
    "첫 토론 글을 작성해 수업 흐름을 열어보세요."
  );
});

test("discussion category filtered empty state stays compact", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await mockDiscussionClassroom(page, "teacher", {
    discussions: seedDiscussions().filter((post) => post.category !== "RESOURCE")
  });

  await page.goto("/classrooms/cls_discussion?section=discussion");
  await expect(page.getByTestId("discussion-post-card")).toHaveCount(5);
  await page.locator(".discussion-category-tabs").getByRole("button", { name: "자료 공유" }).click();
  await expectCompactDiscussionEmptyState(
    page,
    "조건에 맞는 게시글이 없습니다.",
    "검색어나 유형 필터를 바꿔 다시 확인해 보세요."
  );
});

test("student viewer-visible empty state stays compact when only hidden drafts exist", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const hiddenDraft: DiscussionPost = {
    ...seedDiscussions()[0],
    id: "disc_hidden_teacher_draft",
    authorUserId: teacherUser.id,
    authorDisplayName: teacherUser.displayName,
    authorRole: "teacher",
    title: "학생에게 보이지 않는 임시 게시글",
    status: "DRAFT",
    pinned: false,
    publishedAt: undefined,
    canEdit: false,
    canDelete: false,
    canPin: false,
    createdAt: now,
    updatedAt: now
  };
  await mockDiscussionClassroom(page, "student", { discussions: [hiddenDraft] });

  await page.goto("/classrooms/cls_discussion?section=discussion");
  await expectCompactDiscussionEmptyState(
    page,
    "아직 표시할 게시글이 없습니다.",
    "첫 토론 글을 작성해 수업 흐름을 열어보세요."
  );
});

test("discussion cards do not overflow on narrow mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await mockDiscussionClassroom(page, "teacher");

  await page.goto("/classrooms/cls_discussion?section=discussion");
  await expect(page.getByTestId("discussion-post-card")).toHaveCount(6);
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBe(true);
});

test("discussion detail attachments stay compact with long filenames", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  mkdirSync("test-results", { recursive: true });
  const longAttachmentName =
    "ChatGPT_Image_2026년_4월_30일_오후_02_17_01_수업_자료_참고용_아주_긴_파일명_버전_final_really_long_filename_for_layout_regression_check.png";
  await mockDiscussionClassroom(page, "student", {
    discussions: seedDiscussions().map((post) =>
      post.id === "disc_resource"
        ? {
            ...post,
            attachments: [
              {
                id: "disc_att_long",
                name: longAttachmentName,
                size: 974944,
                mimeType: "image/png"
              }
            ]
          }
        : post
    ),
    comments: []
  });

  await page.goto("/classrooms/cls_discussion?section=discussion");
  await page.getByText("선형대수 복습 팁 공유").click();
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  await expect(page.locator(".discussion-detail-files")).toBeVisible();
  await expect(page.locator(".discussion-detail-file-row")).toHaveCount(1);
  await expect(page.locator(".discussion-detail-file-row small")).toHaveText("952.1 KB");

  const assertCompactAttachment = async () => {
    const metrics = await page.locator(".discussion-detail-file-row").first().evaluate((row) => {
      const rowEl = row as HTMLElement;
      const rowRect = rowEl.getBoundingClientRect();
      const svg = rowEl.querySelector("svg");
      const name = rowEl.querySelector(".discussion-detail-file-name") as HTMLElement | null;
      const size = rowEl.querySelector("small") as HTMLElement | null;
      const svgRect = svg?.getBoundingClientRect();
      const sizeRect = size?.getBoundingClientRect();
      return {
        rowHeight: rowRect.height,
        rowClientWidth: rowEl.clientWidth,
        rowScrollWidth: rowEl.scrollWidth,
        svgWidth: svgRect?.width ?? 0,
        svgHeight: svgRect?.height ?? 0,
        nameClientWidth: name?.clientWidth ?? 0,
        nameScrollWidth: name?.scrollWidth ?? 0,
        sizeWidth: sizeRect?.width ?? 0,
        sizeHeight: sizeRect?.height ?? 0
      };
    });

    expect(metrics.rowHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.rowHeight).toBeLessThanOrEqual(58);
    expect(metrics.rowScrollWidth).toBeLessThanOrEqual(metrics.rowClientWidth + 1);
    expect(metrics.svgWidth).toBeGreaterThanOrEqual(18);
    expect(metrics.svgWidth).toBeLessThanOrEqual(20);
    expect(metrics.svgHeight).toBeGreaterThanOrEqual(18);
    expect(metrics.svgHeight).toBeLessThanOrEqual(20);
    expect(metrics.nameScrollWidth).toBeGreaterThan(metrics.nameClientWidth);
    expect(metrics.sizeWidth).toBeGreaterThan(30);
    expect(metrics.sizeHeight).toBeGreaterThan(10);
  };

  await assertCompactAttachment();
  await page.getByTestId("discussion-detail-shell").screenshot({
    path: "test-results/classroom-discussions-detail-attachment-compact.png"
  });

  await page.setViewportSize({ width: 360, height: 760 });
  await assertCompactAttachment();
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBe(true);
});

test("student can write discussions but cannot pin or edit others", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const mock = await mockDiscussionClassroom(page, "student");

  await page.goto("/classrooms/cls_discussion?section=discussion");
  await expect(page.getByTestId("discussion-create-action")).toBeVisible();
  await expectDiscussionListNoticeControlsHidden(page);

  await page.getByTestId("discussion-create-action").click();
  await expectDiscussionComposeNoticeControlsHidden(page);
  await expect(page.getByTestId("discussion-pin-option").locator("input")).toBeDisabled();
  await page.getByPlaceholder("2주차 토론 주제 미리 의견 남겨주세요").fill("학생이 직접 올린 토론");
  await page.locator(".discussion-editor-card textarea").fill("수업에서 궁금했던 점을 공유합니다.");
  await page.getByPlaceholder("AI에게 작성 도움 요청하기").fill("학생 말투를 조금 더 자연스럽게 다듬어줘");
  await page.getByPlaceholder("AI에게 작성 도움 요청하기").press("Enter");
  await expect.poll(() => mock.getAssistantRequests().length).toBe(1);
  expect(mock.getAssistantRequests()[0].draft).toMatchObject({
    title: "학생이 직접 올린 토론",
    contentMarkdown: "수업에서 궁금했던 점을 공유합니다.",
    pinned: false,
    status: "DRAFT"
  });
  await expectAssistantThoughtCollapsedAndReveal(page, "현재 게시글 JSON을 확인하고 있습니다.");
  const getAssistantLayoutMetrics = async () =>
    page.evaluate(() => {
      const editor = document.querySelector(".discussion-editor-card");
      const assistant = document.querySelector(".discussion-assistant-card");
      const thread = document.querySelector(".discussion-assistant-thread");
      if (!editor || !assistant || !thread) {
        throw new Error("discussion compose layout elements are missing");
      }
      const editorRect = editor.getBoundingClientRect();
      const assistantRect = assistant.getBoundingClientRect();
      return {
        editorHeight: editorRect.height,
        assistantHeight: assistantRect.height,
        threadClientHeight: (thread as HTMLElement).clientHeight,
        threadScrollHeight: (thread as HTMLElement).scrollHeight
      };
    });
  const layoutBeforeLongAnswer = await getAssistantLayoutMetrics();
  expect(Math.abs(layoutBeforeLongAnswer.editorHeight - layoutBeforeLongAnswer.assistantHeight)).toBeLessThanOrEqual(4);
  await page.getByPlaceholder("AI에게 작성 도움 요청하기").fill("긴 답변으로 스크롤을 확인해줘");
  await page.getByPlaceholder("AI에게 작성 도움 요청하기").press("Enter");
  await expect.poll(() => mock.getAssistantRequests().length).toBe(2);
  await expect(page.getByTestId("discussion-assistant-thread").getByText("긴 답변 예시")).toBeVisible();
  const layoutAfterLongAnswer = await getAssistantLayoutMetrics();
  expect(Math.abs(layoutAfterLongAnswer.editorHeight - layoutAfterLongAnswer.assistantHeight)).toBeLessThanOrEqual(4);
  expect(Math.abs(layoutAfterLongAnswer.assistantHeight - layoutBeforeLongAnswer.assistantHeight)).toBeLessThanOrEqual(4);
  expect(layoutAfterLongAnswer.threadScrollHeight).toBeGreaterThan(layoutAfterLongAnswer.threadClientHeight);
  await page.getByRole("button", { name: "초기화" }).click();
  await expect(page.getByTestId("discussion-assistant-thread").getByText("작성 중인 내용을 기반으로 더 정확한 도움을 드려요.")).toBeVisible();
  await expect(page.getByTestId("discussion-assistant-thread").getByText("긴 답변 예시")).toHaveCount(0);
  await page.getByTestId("discussion-compose-shell").screenshot({
    path: "test-results/classroom-discussions-student-compose-assistant.png"
  });
  await page.setViewportSize({ width: 1050, height: 860 });
  await expect.poll(() =>
    page.evaluate(() => (document.querySelector(".discussion-assistant-card") as HTMLElement | null)?.style.height ?? "")
  ).toBe("");
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.getByRole("button", { name: "게시하기" }).click();
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  expect(mock.getPostPayloads().at(-1)?.pinned).toBe(false);
  await page.locator(".discussion-detail-actions").getByRole("button", { name: /수정/ }).click();
  await expect(page.getByTestId("discussion-compose-shell")).toBeVisible();
  await page.getByPlaceholder("2주차 토론 주제 미리 의견 남겨주세요").fill("학생이 수정한 토론");
  await page.getByRole("button", { name: "수정하기" }).click();
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  expect(mock.getPostPatchPayloads().at(-1)).not.toHaveProperty("pinned");
  await expect(page.getByText("학생이 수정한 토론")).toBeVisible();
  await expect(page.getByText("수정됨")).toBeVisible();

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionId=disc_pinned");
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  await expect(page.locator(".discussion-detail-actions").getByRole("button", { name: /수정/ })).toHaveCount(0);
  await expect(page.locator(".discussion-detail-actions").getByRole("button", { name: /삭제/ })).toHaveCount(0);
  await page.getByTestId("discussion-comment-input").fill("학생 댓글도 정상 등록됩니다.");
  await page.getByRole("button", { name: "등록" }).first().click();
  await expect(page.getByText("학생 댓글도 정상 등록됩니다.")).toBeVisible();
});

test("student discussion detail view count is throttled and HEAD does not count", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const mock = await mockDiscussionClassroom(page, "student");

  await page.goto("/classrooms/cls_discussion?section=discussion&discussionId=disc_pinned");
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  expect(mock.getViewCount("disc_pinned")).toBe(55);

  await page.goto("/classrooms/cls_discussion?section=discussion");
  await page.goto("/classrooms/cls_discussion?section=discussion&discussionId=disc_pinned");
  await expect(page.getByTestId("discussion-detail-shell")).toBeVisible();
  expect(mock.getViewCount("disc_pinned")).toBe(55);

  const headStatus = await page.evaluate(async () => {
    const response = await fetch("/api/classrooms/cls_discussion/discussions/disc_pinned", {
      method: "HEAD",
      credentials: "include"
    });
    return response.status;
  });
  expect(headStatus).toBe(200);
  expect(mock.getViewCount("disc_pinned")).toBe(55);
});

test("discussion sidebar without a selected classroom stays on classroom selection", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await mockDiscussionClassroom(page, "teacher");

  await page.goto("/");
  await page.getByTestId("topbar-nav-chat").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("classroom-discussions-panel")).toHaveCount(0);
});
