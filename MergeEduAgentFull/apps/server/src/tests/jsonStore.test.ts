import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectRoot = process.cwd().endsWith(path.join("apps", "server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();
const dataDirPrefix = path.join(projectRoot, "apps/server/data-test-");
const uploadDirPrefix = path.join(projectRoot, "apps/server/uploads-test-");
let testDir = "";
let uploadDir = "";

beforeEach(async () => {
  testDir = await fs.mkdtemp(dataDirPrefix);
  uploadDir = await fs.mkdtemp(uploadDirPrefix);
  process.env.PORT = "4000";
  process.env.MODEL_NAME = "gemini-1.5-pro";
  process.env.GOOGLE_API_KEY = "test-key";
  process.env.PASS_SCORE_RATIO = "0.7";
  process.env.CONTEXT_MAX_CHARS = "12000";
  process.env.RECENT_MESSAGES_N = "12";
  process.env.AI_BRIDGE_URL = "http://127.0.0.1:8001";
  process.env.DATA_DIR = testDir;
  process.env.UPLOAD_DIR = uploadDir;
});

afterEach(async () => {
  if (testDir) await fs.rm(testDir, { recursive: true, force: true });
  if (uploadDir) await fs.rm(uploadDir, { recursive: true, force: true });
});

describe.sequential("JsonStore", () => {
  it("initializes and normalizes learning progress on session storage paths", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const session = await store.createSession("lec_progress_store", "usr_progress_store");
    expect(session.learningProgressPage).toBe(0);

    await fs.writeFile(
      store.sessionPath(session.sessionId),
      JSON.stringify(
        {
          ...session,
          learningProgressPage: 2.8
        },
        null,
        2
      )
    );

    const loaded = await store.getSession(session.sessionId);
    expect(loaded?.learningProgressPage).toBe(2);

    await fs.writeFile(
      store.sessionPath(session.sessionId),
      JSON.stringify(
        {
          ...session,
          learningProgressPage: "bad"
        },
        null,
        2
      )
    );

    const listed = await store.listSessions();
    expect(listed[0]?.learningProgressPage).toBeUndefined();
  });

  it("serializes same-key locks and continues the queue after rejection", async () => {
    const { FileLock } = await import("../services/storage/FileLock.js");
    const lock = new FileLock();
    const secondLock = new FileLock();
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        lock.withLock("same-key", async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        })
      )
    );

    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const first = lock.withLock("reject-key", async () => {
      order.push("first-start");
      await firstCanFinish;
      order.push("first-fail");
      throw new Error("first failed");
    });
    const second = secondLock.withLock("reject-key", async () => {
      order.push("second-ran");
      return "second ok";
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();

    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second ok");
    expect(maxActive).toBe(1);
    expect(order).toEqual(["first-start", "first-fail", "second-ran"]);
  });

  it("locks discussion posts before discussion comments for parent comment cascade deletion", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("discussion lock order", "teacher_lock_order");
    const post = await store.createClassroomDiscussion({
      classroomId: classroom.id,
      authorUserId: "teacher_lock_order",
      title: "락 순서 테스트",
      contentMarkdown: "댓글 삭제 cascade가 post lock 후 comment lock을 잡아야 합니다.",
      category: "FREE",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: []
    });
    const rootResult = await store.createClassroomDiscussionComment({
      classroomId: classroom.id,
      postId: post.id,
      authorUserId: "student_lock_order",
      contentMarkdown: "부모 댓글",
      viewerOptions: { includeAllForTeacher: true }
    });
    expect(rootResult.ok).toBe(true);
    if (!rootResult.ok) return;
    const replyResult = await store.createClassroomDiscussionComment({
      classroomId: classroom.id,
      postId: post.id,
      authorUserId: "teacher_lock_order",
      contentMarkdown: "답글",
      parentCommentId: rootResult.comment.id,
      viewerOptions: { includeAllForTeacher: true }
    });
    expect(replyResult.ok).toBe(true);

    const unsafeStore = store as unknown as {
      paths: { classroomDiscussions: string; classroomDiscussionComments: string };
      withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T>;
    };
    const originalWithFileLock = unsafeStore.withFileLock.bind(store);
    const lockOrder: string[] = [];
    unsafeStore.withFileLock = async <T>(filePath: string, fn: () => Promise<T>): Promise<T> => {
      const label =
        filePath === unsafeStore.paths.classroomDiscussions
          ? "posts"
          : filePath === unsafeStore.paths.classroomDiscussionComments
            ? "comments"
            : path.basename(filePath);
      lockOrder.push(`enter:${label}`);
      try {
        return await originalWithFileLock(filePath, fn);
      } finally {
        lockOrder.push(`exit:${label}`);
      }
    };

    await expect(store.deleteClassroomDiscussionComment(classroom.id, post.id, rootResult.comment.id))
      .resolves.toBe(true);
    expect(lockOrder).toEqual(["enter:posts", "enter:comments", "exit:comments", "exit:posts"]);
    expect(await store.listClassroomDiscussionComments(classroom.id, post.id)).toHaveLength(0);
  });

  it("throttles classroom discussion views per viewer with receipt edge cases", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const unsafeStore = store as unknown as {
      paths: { classroomDiscussions: string; classroomDiscussionViews: string };
      getAndTouchClassroomDiscussion(
        classroomId: string,
        postId: string,
        options: { includeAllForTeacher?: boolean; viewerUserId?: string }
      ): Promise<{ viewCount: number; createdAt: string; updatedAt: string; publishedAt?: string } | null>;
    };
    expect(JSON.parse(await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8"))).toEqual([]);

    const base = new Date("2026-05-05T00:00:00.000Z");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(base);
      const classroom = await store.createClassroom("discussion views", "teacher_views");
      const post = await store.createClassroomDiscussion({
        classroomId: classroom.id,
        authorUserId: "student_views",
        title: "조회수 테스트",
        contentMarkdown: "조회수는 사용자별로 10초 throttle 됩니다.",
        category: "FREE",
        visibility: "CLASS",
        pinned: false,
        anonymous: false,
        allowComments: true,
        status: "PUBLISHED",
        attachments: []
      });

      await expect(
        unsafeStore.getAndTouchClassroomDiscussion(classroom.id, post.id, { includeAllForTeacher: true })
      ).rejects.toThrow("viewerUserId");

      const first = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "student_views"
      });
      expect(first?.viewCount).toBe(1);
      expect(first?.createdAt).toBe(post.createdAt);
      expect(first?.updatedAt).toBe(post.updatedAt);
      expect(first?.publishedAt).toBe(post.publishedAt);

      vi.setSystemTime(new Date(base.getTime() + 10_000));
      const exactBoundary = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "student_views"
      });
      expect(exactBoundary?.viewCount).toBe(1);
      const boundaryReceipts = JSON.parse(
        await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
      ) as Array<{ lastViewedAt: string }>;
      expect(boundaryReceipts).toHaveLength(1);
      expect(boundaryReceipts[0]?.lastViewedAt).toBe(base.toISOString());

      vi.setSystemTime(new Date(base.getTime() + 5_000));
      await fs.writeFile(
        unsafeStore.paths.classroomDiscussionViews,
        JSON.stringify(
          [
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: new Date(base.getTime() + 1_000).toISOString()
            },
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: new Date(base.getTime() + 2_000).toISOString()
            }
          ],
          null,
          2
        )
      );
      const freshDuplicate = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "student_views"
      });
      expect(freshDuplicate?.viewCount).toBe(1);
      const freshCollapsed = JSON.parse(
        await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
      ) as Array<{ viewerUserId: string; lastViewedAt: string }>;
      expect(freshCollapsed.filter((receipt) => receipt.viewerUserId === "student_views")).toHaveLength(1);
      expect(freshCollapsed.find((receipt) => receipt.viewerUserId === "student_views")?.lastViewedAt)
        .toBe(new Date(base.getTime() + 2_000).toISOString());

      vi.setSystemTime(new Date(base.getTime() + 12_001));
      const stale = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "student_views"
      });
      expect(stale?.viewCount).toBe(2);

      const otherUser = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "other_student_views"
      });
      expect(otherUser?.viewCount).toBe(3);
      await Promise.all([
        store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
          viewerUserId: "concurrent_student_views_1"
        }),
        store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
          viewerUserId: "concurrent_student_views_2"
        })
      ]);
      expect((await store.getClassroomDiscussion(classroom.id, post.id))?.viewCount).toBe(5);

      vi.setSystemTime(new Date(base.getTime() + 20_000));
      await fs.writeFile(
        unsafeStore.paths.classroomDiscussionViews,
        JSON.stringify(
          [
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: null
            },
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: new Date(base.getTime() + 1).toISOString()
            }
          ],
          null,
          2
        )
      );
      const malformedRow = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "student_views"
      });
      expect(malformedRow?.viewCount).toBe(5);
      const normalized = JSON.parse(
        await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
      ) as Array<{ viewerUserId: string; lastViewedAt: string }>;
      const normalizedStudentReceipts = normalized.filter(
        (receipt) => receipt.viewerUserId === "student_views"
      );
      expect(normalizedStudentReceipts).toHaveLength(1);
      expect(normalizedStudentReceipts[0]?.lastViewedAt)
        .toBe(new Date(base.getTime() + 20_000).toISOString());

      vi.setSystemTime(new Date(base.getTime() + 40_000));
      await fs.writeFile(
        unsafeStore.paths.classroomDiscussionViews,
        JSON.stringify(
          [
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: new Date(base.getTime() + 60_000).toISOString()
            },
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: new Date(base.getTime() + 1_000).toISOString()
            }
          ],
          null,
          2
        )
      );
      const futureRow = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "student_views"
      });
      expect(futureRow?.viewCount).toBe(5);
      const futureNormalized = JSON.parse(
        await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
      ) as Array<{ viewerUserId: string; lastViewedAt: string }>;
      expect(futureNormalized.filter((receipt) => receipt.viewerUserId === "student_views")).toHaveLength(1);
      expect(futureNormalized.find((receipt) => receipt.viewerUserId === "student_views")?.lastViewedAt)
        .toBe(new Date(base.getTime() + 40_000).toISOString());

      vi.setSystemTime(new Date(base.getTime() + 80_000));
      await fs.writeFile(
        unsafeStore.paths.classroomDiscussionViews,
        JSON.stringify(
          [
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: new Date(base.getTime() + 1_000).toISOString()
            },
            {
              classroomId: classroom.id,
              postId: post.id,
              viewerUserId: "student_views",
              lastViewedAt: new Date(base.getTime() + 2_000).toISOString()
            }
          ],
          null,
          2
        )
      );
      const allStale = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
        viewerUserId: "student_views"
      });
      expect(allStale?.viewCount).toBe(6);
      const collapsed = JSON.parse(
        await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
      ) as Array<{ viewerUserId: string; lastViewedAt: string }>;
      expect(collapsed.filter((receipt) => receipt.viewerUserId === "student_views")).toHaveLength(1);
      expect(collapsed.find((receipt) => receipt.viewerUserId === "student_views")?.lastViewedAt)
        .toBe(new Date(base.getTime() + 80_000).toISOString());

      await fs.writeFile(unsafeStore.paths.classroomDiscussionViews, "{bad json", "utf-8");
      await expect(
        store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
          viewerUserId: "student_views"
        })
      ).rejects.toThrow();
      expect((await store.getClassroomDiscussion(classroom.id, post.id))?.viewCount).toBe(6);

      await fs.writeFile(unsafeStore.paths.classroomDiscussionViews, "[]", "utf-8");
      await fs.rm(unsafeStore.paths.classroomDiscussionViews, { force: true });
      await expect(
        store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
          viewerUserId: "student_views"
        })
      ).rejects.toThrow();
      expect((await store.getClassroomDiscussion(classroom.id, post.id))?.viewCount).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls back discussion view receipts when the post write fails", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("discussion view rollback", "teacher_view_rollback");
    const post = await store.createClassroomDiscussion({
      classroomId: classroom.id,
      authorUserId: "teacher_view_rollback",
      title: "rollback",
      contentMarkdown: "receipt rollback",
      category: "FREE",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: []
    });
    const unsafeStore = store as unknown as {
      paths: { classroomDiscussions: string; classroomDiscussionViews: string };
    };
    const originalRename = fs.rename;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(
      async (oldPath: Parameters<typeof fs.rename>[0], newPath: Parameters<typeof fs.rename>[1]) => {
        if (String(newPath) === unsafeStore.paths.classroomDiscussions) {
          throw new Error("post write failed");
        }
        return originalRename(oldPath, newPath);
      }
    );

    try {
      await expect(
        store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
          viewerUserId: "rollback_viewer"
        })
      ).rejects.toThrow("post write failed");
    } finally {
      renameSpy.mockRestore();
    }

    expect((await store.getClassroomDiscussion(classroom.id, post.id))?.viewCount).toBe(0);
    const receiptsAfterRollback = JSON.parse(
      await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
    ) as Array<{ viewerUserId: string }>;
    expect(receiptsAfterRollback.some((receipt) => receipt.viewerUserId === "rollback_viewer"))
      .toBe(false);

    const retry = await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
      viewerUserId: "rollback_viewer"
    });
    expect(retry?.viewCount).toBe(1);
  });

  it("uses stable discussion view lock order and cleans receipts on deletion", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("discussion view locks", "teacher_view_locks");
    const post = await store.createClassroomDiscussion({
      classroomId: classroom.id,
      authorUserId: "teacher_view_locks",
      title: "락 순서",
      contentMarkdown: "조회수 receipt 락 순서를 확인합니다.",
      category: "FREE",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: []
    });
    await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
      viewerUserId: "student_view_locks"
    });

    const unsafeStore = store as unknown as {
      paths: {
        classroomDiscussions: string;
        classroomDiscussionComments: string;
        classroomDiscussionViews: string;
      };
      withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T>;
    };
    const originalWithFileLock = unsafeStore.withFileLock.bind(store);
    const labelFor = (filePath: string) =>
      filePath === unsafeStore.paths.classroomDiscussions
        ? "posts"
        : filePath === unsafeStore.paths.classroomDiscussionComments
          ? "comments"
          : filePath === unsafeStore.paths.classroomDiscussionViews
            ? "views"
            : path.basename(filePath);
    const lockOrder: string[] = [];
    unsafeStore.withFileLock = async <T>(filePath: string, fn: () => Promise<T>): Promise<T> => {
      const label = labelFor(filePath);
      lockOrder.push(`enter:${label}`);
      try {
        return await originalWithFileLock(filePath, fn);
      } finally {
        lockOrder.push(`exit:${label}`);
      }
    };

    await store.getAndTouchClassroomDiscussion(classroom.id, post.id, {
      viewerUserId: "student_view_locks_2"
    });
    expect(lockOrder).toEqual(["enter:posts", "enter:views", "exit:views", "exit:posts"]);

    lockOrder.length = 0;
    await expect(store.deleteClassroomDiscussion(classroom.id, post.id)).resolves.toBe(true);
    expect(lockOrder).toEqual([
      "enter:posts",
      "enter:comments",
      "enter:views",
      "exit:views",
      "exit:comments",
      "exit:posts"
    ]);
    const receipts = JSON.parse(
      await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
    ) as Array<{ postId: string }>;
    expect(receipts.some((receipt) => receipt.postId === post.id)).toBe(false);

    await fs.writeFile(
      unsafeStore.paths.classroomDiscussionViews,
      JSON.stringify(
        [
          {
            classroomId: classroom.id,
            postId: "already_removed_post",
            viewerUserId: "student_view_locks",
            lastViewedAt: "2026-05-05T00:00:00.000Z"
          }
        ],
        null,
        2
      )
    );
    await store.deleteClassroomDiscussionsByClassroom(classroom.id);
    const afterClassroomCleanup = JSON.parse(
      await fs.readFile(unsafeStore.paths.classroomDiscussionViews, "utf-8")
    ) as Array<{ classroomId: string }>;
    expect(afterClassroomCleanup.some((receipt) => receipt.classroomId === classroom.id)).toBe(false);
  });

  it("guards notice comment visibility, reply depth, and cascade deletion", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("notice comments", "teacher_notice_store");
    const notice = await store.createClassroomNotice({
      classroomId: classroom.id,
      authorUserId: "teacher_notice_store",
      title: "공지 댓글",
      contentMarkdown: "공지 댓글 테스트",
      category: "GENERAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "PUBLISHED",
      attachments: []
    });

    const root = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: notice.id,
      authorUserId: "student_notice_store",
      contentMarkdown: "root",
      visibility: { includeHidden: false }
    });
    expect(root.ok).toBe(true);
    if (!root.ok) throw new Error("root notice comment should be created");

    const reply = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: notice.id,
      authorUserId: "teacher_notice_store",
      parentCommentId: root.comment.id,
      contentMarkdown: "reply",
      visibility: { includeHidden: false }
    });
    expect(reply.ok).toBe(true);
    if (!reply.ok) throw new Error("reply notice comment should be created");

    const nested = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: notice.id,
      authorUserId: "student_notice_store",
      parentCommentId: reply.comment.id,
      contentMarkdown: "nested",
      visibility: { includeHidden: false }
    });
    expect(nested).toEqual({ ok: false, reason: "REPLY_DEPTH" });

    await store.updateClassroomNotice(classroom.id, notice.id, { status: "DRAFT" });
    const hiddenStudentCreate = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: notice.id,
      authorUserId: "student_notice_store",
      contentMarkdown: "hidden student",
      visibility: { includeHidden: false }
    });
    expect(hiddenStudentCreate).toEqual({ ok: false, reason: "NOTICE_NOT_FOUND_OR_HIDDEN" });
    await expect(
      store.updateClassroomNoticeComment(
        classroom.id,
        notice.id,
        root.comment.id,
        { contentMarkdown: "student hidden edit" },
        { includeHidden: false }
      )
    ).resolves.toBeNull();

    const teacherHiddenEdit = await store.updateClassroomNoticeComment(
      classroom.id,
      notice.id,
      root.comment.id,
      { contentMarkdown: "teacher hidden edit" },
      { includeHidden: true }
    );
    expect(teacherHiddenEdit?.contentMarkdown).toBe("teacher hidden edit");

    const teacherHiddenCreate = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: notice.id,
      authorUserId: "teacher_notice_store",
      contentMarkdown: "teacher hidden comment",
      visibility: { includeHidden: true }
    });
    expect(teacherHiddenCreate.ok).toBe(true);
    if (!teacherHiddenCreate.ok) throw new Error("teacher hidden comment should be created");

    await expect(
      store.deleteClassroomNoticeComment(
        classroom.id,
        notice.id,
        teacherHiddenCreate.comment.id,
        { includeHidden: false }
      )
    ).resolves.toBe(false);
    expect(
      (await store.listClassroomNoticeComments(classroom.id, notice.id)).map((comment) => comment.id)
    ).toContain(teacherHiddenCreate.comment.id);
    await expect(
      store.deleteClassroomNoticeComment(
        classroom.id,
        notice.id,
        teacherHiddenCreate.comment.id,
        { includeHidden: true }
      )
    ).resolves.toBe(true);
    expect(
      (await store.listClassroomNoticeComments(classroom.id, notice.id)).map((comment) => comment.id)
    ).not.toContain(teacherHiddenCreate.comment.id);

    await store.updateClassroomNotice(classroom.id, notice.id, { status: "PUBLISHED" });
    const cascadeRoot = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: notice.id,
      authorUserId: "student_notice_store",
      contentMarkdown: "cascade root",
      visibility: { includeHidden: false }
    });
    expect(cascadeRoot.ok).toBe(true);
    if (!cascadeRoot.ok) throw new Error("cascade root should be created");
    const cascadeReply = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: notice.id,
      authorUserId: "teacher_notice_store",
      parentCommentId: cascadeRoot.comment.id,
      contentMarkdown: "cascade reply",
      visibility: { includeHidden: false }
    });
    expect(cascadeReply.ok).toBe(true);
    if (!cascadeReply.ok) throw new Error("cascade reply should be created");

    const otherNotice = await store.createClassroomNotice({
      classroomId: classroom.id,
      authorUserId: "teacher_notice_store",
      title: "다른 공지",
      contentMarkdown: "삭제 scope 테스트",
      category: "GENERAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "PUBLISHED",
      attachments: []
    });
    const otherComment = await store.createClassroomNoticeComment({
      classroomId: classroom.id,
      noticeId: otherNotice.id,
      authorUserId: "student_notice_store",
      contentMarkdown: "duplicate id survivor",
      visibility: { includeHidden: false }
    });
    expect(otherComment.ok).toBe(true);
    if (!otherComment.ok) throw new Error("other notice comment should be created");
    const unsafeStore = store as unknown as { paths: { classroomNoticeComments: string } };
    const storedComments = JSON.parse(
      await fs.readFile(unsafeStore.paths.classroomNoticeComments, "utf-8")
    ) as Array<{ id: string }>;
    await fs.writeFile(
      unsafeStore.paths.classroomNoticeComments,
      JSON.stringify(
        storedComments.map((comment) =>
          comment.id === otherComment.comment.id
            ? { ...comment, id: cascadeReply.comment.id }
            : comment
        ),
        null,
        2
      ),
      "utf-8"
    );

    await expect(
      store.deleteClassroomNoticeComment(
        classroom.id,
        notice.id,
        cascadeRoot.comment.id,
        { includeHidden: false }
      )
    ).resolves.toBe(true);
    const remaining = await store.listClassroomNoticeComments(classroom.id, notice.id);
    expect(remaining.map((comment) => comment.id)).not.toContain(cascadeRoot.comment.id);
    expect(remaining.map((comment) => comment.id)).not.toContain(cascadeReply.comment.id);
    const otherRemaining = await store.listClassroomNoticeComments(classroom.id, otherNotice.id);
    expect(otherRemaining.map((comment) => comment.id)).toContain(cascadeReply.comment.id);
  });

  it("scopes notice deletion comment cascade by classroom and notice", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroomA = await store.createClassroom("notice cascade A", "teacher_notice_a");
    const classroomB = await store.createClassroom("notice cascade B", "teacher_notice_b");
    const noticeA = await store.createClassroomNotice({
      classroomId: classroomA.id,
      authorUserId: "teacher_notice_a",
      title: "A 공지",
      contentMarkdown: "A 공지 삭제",
      category: "GENERAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "PUBLISHED",
      attachments: []
    });
    const noticeB = await store.createClassroomNotice({
      classroomId: classroomB.id,
      authorUserId: "teacher_notice_b",
      title: "B 공지",
      contentMarkdown: "B 공지는 살아야 합니다.",
      category: "GENERAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "PUBLISHED",
      attachments: []
    });
    const commentA = await store.createClassroomNoticeComment({
      classroomId: classroomA.id,
      noticeId: noticeA.id,
      authorUserId: "student_notice_a",
      contentMarkdown: "A 댓글",
      visibility: { includeHidden: false }
    });
    expect(commentA.ok).toBe(true);
    const commentB = await store.createClassroomNoticeComment({
      classroomId: classroomB.id,
      noticeId: noticeB.id,
      authorUserId: "student_notice_b",
      contentMarkdown: "B 댓글",
      visibility: { includeHidden: false }
    });
    expect(commentB.ok).toBe(true);

    const unsafeStore = store as unknown as {
      paths: { classroomNotices: string; classroomNoticeComments: string };
    };
    const storedNotices = JSON.parse(
      await fs.readFile(unsafeStore.paths.classroomNotices, "utf-8")
    ) as Array<{ id: string; classroomId: string }>;
    const storedComments = JSON.parse(
      await fs.readFile(unsafeStore.paths.classroomNoticeComments, "utf-8")
    ) as Array<{ noticeId: string; classroomId: string }>;
    await fs.writeFile(
      unsafeStore.paths.classroomNotices,
      JSON.stringify(
        storedNotices.map((notice) =>
          notice.classroomId === classroomB.id && notice.id === noticeB.id
            ? { ...notice, id: noticeA.id }
            : notice
        ),
        null,
        2
      ),
      "utf-8"
    );
    await fs.writeFile(
      unsafeStore.paths.classroomNoticeComments,
      JSON.stringify(
        storedComments.map((comment) =>
          comment.classroomId === classroomB.id && comment.noticeId === noticeB.id
            ? { ...comment, noticeId: noticeA.id }
            : comment
        ),
        null,
        2
      ),
      "utf-8"
    );

    await expect(store.deleteClassroomNotice(classroomA.id, noticeA.id)).resolves.toBe(true);
    await expect(
      store.listClassroomNoticeComments(classroomA.id, noticeA.id)
    ).resolves.toHaveLength(0);
    const otherScopeComments = await store.listClassroomNoticeComments(classroomB.id, noticeA.id);
    expect(otherScopeComments.map((comment) => comment.contentMarkdown)).toContain("B 댓글");
  });

  it("creates and restores session", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("테스트");
    const week = await store.createWeek(classroom.id);
    await store.createLecture({
      id: "lec_test",
      weekId: week.id,
      title: "샘플",
      pdfPath: "/tmp/sample.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/sample.pageIndex.json"
    });

    const session = await store.getOrCreateSessionByLecture("lec_test");
    await store.saveSession(session);
    const loaded = await store.getSession(session.sessionId);

    expect(loaded?.sessionId).toBe(session.sessionId);
    expect(loaded?.activeIntervention).toBeNull();
    expect(loaded?.quizAssessments).toEqual([]);
  });

  it("creates a new classroom without inheriting scoped learning data", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const existing = await store.createClassroom("기존 강의실", "teacher_scope");
    const existingWeek = await store.createWeek(existing.id, "1주차");
    await store.createLecture({
      id: "lec_existing_scope",
      weekId: existingWeek.id,
      title: "기존 자료",
      pdfPath: "/tmp/existing.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/existing.pageIndex.json"
    });
    await store.enrollStudent(existing.id, "student_scope", "teacher_scope");
    await store.createClassroomNotice({
      classroomId: existing.id,
      authorUserId: "teacher_scope",
      title: "기존 공지",
      contentMarkdown: "기존 강의실 공지",
      category: "GENERAL",
      priority: "NORMAL",
      target: "CLASS",
      pinned: false,
      status: "PUBLISHED",
      attachments: []
    });
    await store.createClassroomDiscussion({
      classroomId: existing.id,
      authorUserId: "teacher_scope",
      title: "기존 토론",
      contentMarkdown: "기존 강의실 토론",
      category: "FREE",
      visibility: "CLASS",
      pinned: false,
      anonymous: false,
      allowComments: true,
      status: "PUBLISHED",
      attachments: []
    });
    await store.createTeacherExam({
      classroomId: existing.id,
      weekId: existingWeek.id,
      draftRevision: {
        title: "기존 시험",
        descriptionMarkdown: "",
        availableFrom: "2026-05-01T00:00:00.000Z",
        availableUntil: "2026-05-02T00:00:00.000Z",
        timeLimitMinutes: 30,
        passScoreRatio: 0.7,
        aiGradingEnabled: true,
        questions: []
      }
    });
    await store.createClassroomReportCriterion(existing.id, {
      name: "기존 기준",
      description: "기존 강의실 기준"
    });
    await store.saveClassroomReport({
      schemaVersion: "1.0",
      classroomId: existing.id,
      reportScope: "STUDENT",
      studentUserId: "student_scope",
      classroomTitle: existing.title,
      studentLabel: "기존 학생",
      generatedAt: "2026-05-03T00:00:00.000Z",
      analysisStatus: "READY",
      generationMode: "HEURISTIC_FALLBACK",
      headline: "기존 리포트",
      summaryMarkdown: "기존 강의실 리포트",
      overallScore: 10,
      overallLevel: "EMERGING",
      competencies: [],
      strengths: [],
      growthAreas: [],
      coachingInsights: [],
      recommendedActions: [],
      lectureInsights: [],
      sourceStats: {
        lectureCount: 1,
        sessionCount: 0,
        completedPageCount: 0,
        pageCoverageRatio: 0,
        questionCount: 0,
        quizCount: 0,
        gradedQuizCount: 0,
        averageQuizScore: 0,
        feedbackCount: 0,
        memoryRefreshCount: 0
      },
      dataQualityNote: ""
    });

    const created = await store.createClassroom("새 강의실", "teacher_scope");
    const createdWeeks = await store.listWeeksByClassroom(created.id);

    expect(created.id).not.toBe(existing.id);
    await expect(store.listEnrollmentsByClassroom(created.id)).resolves.toHaveLength(0);
    expect(createdWeeks).toHaveLength(0);
    await expect(store.listClassroomNotices(created.id, { includeHidden: true })).resolves.toHaveLength(0);
    await expect(
      store.listClassroomDiscussions(created.id, { includeAllForTeacher: true })
    ).resolves.toHaveLength(0);
    await expect(store.listClassroomReportCriteria(created.id)).resolves.toHaveLength(0);
    await expect(store.listStudentClassroomReports(created.id)).resolves.toHaveLength(0);

    const createdLectureMap = await store.listLecturesByWeekIds(createdWeeks.map((week) => week.id));
    expect(createdLectureMap.size).toBe(0);
    const createdWeekExams = await Promise.all(
      createdWeeks.map((week) => store.listTeacherExamsByWeek(week.id))
    );
    expect(createdWeekExams.flat()).toHaveLength(0);
  });

  it("backfills legacy session files without assessments", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("레거시 테스트");
    const week = await store.createWeek(classroom.id);
    await store.createLecture({
      id: "lec_legacy",
      weekId: week.id,
      title: "샘플",
      pdfPath: "/tmp/legacy.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/legacy.pageIndex.json"
    });

    const session = await store.getOrCreateSessionByLecture("lec_legacy");
    const legacyPayload = { ...session } as Record<string, unknown>;
    delete legacyPayload.quizAssessments;
    await fs.writeFile(store.sessionPath(session.sessionId), JSON.stringify(legacyPayload, null, 2));

    const loaded = await store.getSession(session.sessionId);
    expect(loaded?.quizAssessments).toEqual([]);
  });

  it("round-trips persisted quiz assessments with delivery metadata intact", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("assessment roundtrip");
    const week = await store.createWeek(classroom.id);
    await store.createLecture({
      id: "lec_roundtrip",
      weekId: week.id,
      title: "샘플",
      pdfPath: "/tmp/roundtrip.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/roundtrip.pageIndex.json"
    });

    const session = await store.getOrCreateSessionByLecture("lec_roundtrip");
    session.quizAssessments = [
      {
        id: "asm_roundtrip",
        quizId: "quiz_roundtrip",
        page: 1,
        quizType: "MCQ",
        version: "1.0",
        source: "DETERMINISTIC_V1",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:01:00.000Z",
        scoreRatio: 0.5,
        readiness: "REPAIR_REQUIRED",
        deliveryStatus: "CONSUMED",
        consumedAt: "2026-04-16T00:02:00.000Z",
        strengths: [],
        weaknesses: ["핵심 개념 보강 필요"],
        misconceptions: ["적용 기준 재점검 필요"],
        behaviorSignals: ["반복적으로 흔들리는 패턴"],
        memoryHint: {
          strengths: [],
          weaknesses: ["핵심 개념 보강 필요"],
          misconceptions: ["적용 기준 재점검 필요"],
          explanationPreferences: [],
          preferredQuizTypes: [],
          targetDifficulty: "FOUNDATIONAL",
          nextCoachingGoals: ["오답 이유를 짧게 다시 설명한 뒤 바로 재확인하기"]
        },
        summaryMarkdown: "최근 퀴즈 이해도는 50% 수준입니다.",
        evidence: ["WRONG · 핵심 개념"]
      }
    ];

    await store.saveSession(session);
    const loaded = await store.getSession(session.sessionId);

    expect(loaded?.quizAssessments).toHaveLength(1);
    expect(loaded?.quizAssessments?.[0]?.deliveryStatus).toBe("CONSUMED");
    expect(loaded?.quizAssessments?.[0]?.consumedAt).toBe("2026-04-16T00:02:00.000Z");
  });

  it("groups lectures for multiple weeks with one bulk read API", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("bulk lectures");
    const firstWeek = await store.createWeek(classroom.id, "1주차");
    const secondWeek = await store.createWeek(classroom.id, "2주차");
    await store.createLecture({
      id: "lec_first",
      weekId: firstWeek.id,
      title: "첫 강의",
      pdfPath: "/tmp/first.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/first.pageIndex.json"
    });
    await store.createLecture({
      id: "lec_second",
      weekId: secondWeek.id,
      title: "둘째 강의",
      pdfPath: "/tmp/second.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/second.pageIndex.json"
    });

    const grouped = await store.listLecturesByWeekIds([firstWeek.id, secondWeek.id, "wk_empty"]);
    expect(grouped.get(firstWeek.id)?.map((lecture) => lecture.id)).toEqual(["lec_first"]);
    expect(grouped.get(secondWeek.id)?.map((lecture) => lecture.id)).toEqual(["lec_second"]);
    expect(grouped.get("wk_empty")).toEqual([]);
  });

  it("preserves concurrent quiz-result appends", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.appendQuizResultEntries([
          {
            id: `qlog_${index}`,
            sessionId: "ses_concurrent",
            lectureId: "lec_concurrent",
            quizId: `quiz_${index}`,
            quizType: "MCQ",
            page: 1,
            score: 1,
            maxScore: 1,
            scoreRatio: 1,
            summaryMarkdown: "ok",
            createdAt: new Date().toISOString()
          }
        ])
      )
    );

    const raw = await fs.readFile(path.join(testDir, "quiz-results.json"), "utf-8");
    const entries = JSON.parse(raw) as Array<{ id: string }>;
    expect(entries).toHaveLength(12);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(12);
  });

  it("saves and loads classroom report", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("리포트 테스트");
    await store.saveClassroomReport({
      schemaVersion: "1.0",
      classroomId: classroom.id,
      classroomTitle: classroom.title,
      studentLabel: "현재 학습자",
      generatedAt: new Date().toISOString(),
      analysisStatus: "READY",
      generationMode: "HEURISTIC_FALLBACK",
      headline: "요약",
      summaryMarkdown: "- 요약",
      overallScore: 70,
      overallLevel: "PROFICIENT",
      competencies: ([
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
      ] as const).map((key) => ({
        key,
        label: key,
        score: 70,
        trend: "STEADY" as const,
        summary: "ok",
        evidence: ["근거"]
      })),
      strengths: ["강점"],
      growthAreas: ["보완"],
      coachingInsights: ["인사이트"],
      recommendedActions: [
        {
          title: "복습",
          description: "설명"
        }
      ],
      lectureInsights: [],
      sourceStats: {
        lectureCount: 0,
        sessionCount: 0,
        completedPageCount: 0,
        pageCoverageRatio: 0,
        questionCount: 0,
        quizCount: 0,
        gradedQuizCount: 0,
        averageQuizScore: 0,
        feedbackCount: 0,
        memoryRefreshCount: 0
      },
      dataQualityNote: "ok"
    });

    const loaded = await store.getClassroomReport(classroom.id);
    expect(loaded?.classroomId).toBe(classroom.id);
  });

  it("keeps classroom aggregate and student scoped reports separate", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroom = await store.createClassroom("스코프 리포트 테스트");
    const makeReport = (scope: "CLASSROOM_AGGREGATE" | "STUDENT") => ({
      schemaVersion: "1.0" as const,
      classroomId: classroom.id,
      reportScope: scope,
      studentUserId: scope === "STUDENT" ? "usr_student" : undefined,
      classroomTitle: classroom.title,
      studentLabel: scope,
      generatedAt: new Date().toISOString(),
      analysisStatus: "READY" as const,
      generationMode: "HEURISTIC_FALLBACK" as const,
      headline: scope,
      summaryMarkdown: "- 요약",
      overallScore: 70,
      overallLevel: "PROFICIENT" as const,
      competencies: ([
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
      ] as const).map((key) => ({
        key,
        label: key,
        score: 70,
        trend: "STEADY" as const,
        summary: "ok",
        evidence: ["근거"]
      })),
      strengths: [],
      growthAreas: [],
      coachingInsights: [],
      recommendedActions: [],
      lectureInsights: [],
      sourceStats: {
        lectureCount: 0,
        sessionCount: 0,
        completedPageCount: 0,
        pageCoverageRatio: 0,
        questionCount: 0,
        quizCount: 0,
        gradedQuizCount: 0,
        averageQuizScore: 0,
        feedbackCount: 0,
        memoryRefreshCount: 0
      },
      dataQualityNote: "ok"
    });

    await store.saveClassroomReport(makeReport("STUDENT"));
    await store.saveClassroomReport(makeReport("CLASSROOM_AGGREGATE"));

    const aggregate = await store.getClassroomReport(classroom.id);
    expect(aggregate?.reportScope).toBe("CLASSROOM_AGGREGATE");
    expect(await store.listClassroomReports()).toHaveLength(2);
  });

  it("manages classroom-specific report criteria and removes them with the classroom", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();
    await expect(
      fs.stat(path.join(testDir, "classroom-report-criteria.json"))
    ).resolves.toBeTruthy();

    const classroomA = await store.createClassroom("A반");
    const classroomB = await store.createClassroom("B반");

    const criterion = await store.createClassroomReportCriterion(classroomA.id, {
      name: "발표 논리력",
      description: "발표 답변에서 근거와 결론이 연결되는지 평가"
    });
    await store.createClassroomReportCriterion(classroomB.id, {
      name: "협업 태도",
      description: "모둠 활동에서 피드백을 주고받는 흐름"
    });

    expect(await store.listClassroomReportCriteria(classroomA.id)).toHaveLength(1);
    expect(await store.listClassroomReportCriteria(classroomB.id)).toHaveLength(1);

    const updated = await store.updateClassroomReportCriterion(classroomA.id, criterion.id, {
      name: "발표 구조화",
      description: "주장, 근거, 예시가 순서대로 이어지는지 평가"
    });
    expect(updated?.id).toBe(criterion.id);
    expect(updated?.classroomId).toBe(classroomA.id);
    expect(updated?.createdAt).toBe(criterion.createdAt);
    expect(updated?.name).toBe("발표 구조화");

    const reloadedStore = new JsonStore({ dataDir: testDir, uploadDir });
    await reloadedStore.init();
    const reloadedCriteria = await reloadedStore.listClassroomReportCriteria(classroomA.id);
    expect(reloadedCriteria).toHaveLength(1);
    expect(reloadedCriteria[0]?.name).toBe("발표 구조화");

    const crossClassUpdate = await store.updateClassroomReportCriterion(classroomB.id, criterion.id, {
      name: "다른 반에서 수정",
      description: "이 값은 A반 항목에 반영되면 안 됩니다."
    });
    expect(crossClassUpdate).toBeNull();
    expect((await store.listClassroomReportCriteria(classroomA.id))[0]?.name).toBe("발표 구조화");

    const crossClassDelete = await store.deleteClassroomReportCriterion(classroomB.id, criterion.id);
    expect(crossClassDelete).toBe(false);
    expect(await store.listClassroomReportCriteria(classroomA.id)).toHaveLength(1);

    await store.deleteClassroom(classroomA.id);
    expect(await store.listClassroomReportCriteria(classroomA.id)).toHaveLength(0);
    expect(await store.listClassroomReportCriteria(classroomB.id)).toHaveLength(1);
  });

  it("rejects duplicate report criteria atomically per classroom", async () => {
    const { JsonStore, REPORT_CRITERION_DUPLICATE_MESSAGE } = await import(
      "../services/storage/JsonStore.js"
    );
    const store = new JsonStore({ dataDir: testDir, uploadDir });
    await store.init();

    const classroomA = await store.createClassroom("중복 A반");
    const classroomB = await store.createClassroom("중복 B반");
    const first = await store.createClassroomReportCriterion(classroomA.id, {
      name: "피드백 수용력",
      description: "교사와 AI 피드백 이후 학습 태도를 조정하는 정도"
    });
    const second = await store.createClassroomReportCriterion(classroomA.id, {
      name: "자료 탐색력",
      description: "자료에서 근거를 찾는 정도"
    });

    await expect(
      store.createClassroomReportCriterion(classroomA.id, {
        name: "  피드백   수용력 ",
        description: "정규화 중복"
      })
    ).rejects.toThrow(REPORT_CRITERION_DUPLICATE_MESSAGE);
    await expect(
      store.createClassroomReportCriterion(classroomA.id, {
        name: "개념 이해도",
        description: "기본 항목 이름 중복"
      })
    ).rejects.toThrow(REPORT_CRITERION_DUPLICATE_MESSAGE);
    expect(await store.listClassroomReportCriteria(classroomA.id)).toHaveLength(2);

    await expect(
      store.updateClassroomReportCriterion(classroomA.id, second.id, {
        name: "피드백 수용력"
      })
    ).rejects.toThrow(REPORT_CRITERION_DUPLICATE_MESSAGE);
    await expect(
      store.updateClassroomReportCriterion(classroomA.id, second.id, {
        name: "질문 구체성"
      })
    ).rejects.toThrow(REPORT_CRITERION_DUPLICATE_MESSAGE);

    const selfUpdate = await store.updateClassroomReportCriterion(classroomA.id, first.id, {
      description: "같은 항목 설명만 수정"
    });
    expect(selfUpdate?.name).toBe("피드백 수용력");
    expect(selfUpdate?.description).toBe("같은 항목 설명만 수정");

    await expect(
      store.createClassroomReportCriterion(classroomB.id, {
        name: "피드백 수용력",
        description: "다른 강의실에서는 같은 커스텀 이름 허용"
      })
    ).resolves.toMatchObject({ classroomId: classroomB.id, name: "피드백 수용력" });

    const criteriaA = await store.listClassroomReportCriteria(classroomA.id);
    expect(criteriaA.map((item) => item.name)).toEqual(["피드백 수용력", "자료 탐색력"]);
    expect(criteriaA.find((item) => item.id === second.id)?.description).toBe("자료에서 근거를 찾는 정도");
  });
});
