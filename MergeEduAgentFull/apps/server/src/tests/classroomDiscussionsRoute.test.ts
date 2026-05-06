import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { appConfig } from "../config.js";
import { AuthService } from "../services/auth/AuthService.js";
import { DevEmailSender } from "../services/auth/EmailSender.js";
import { RequestEncryptionService } from "../services/security/RequestEncryptionService.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import {
  ClassroomDiscussionComment,
  ClassroomDiscussionPost,
  ClassroomDiscussionViewReceipt,
  PublicUser
} from "../types/domain.js";

const testDir = path.resolve(process.cwd(), "apps/server/data-discussions-route-test");
const uploadDir = path.resolve(process.cwd(), "apps/server/uploads-discussions-route-test");
const origin = "http://localhost:5173";

type SerializedDiscussionPost = ClassroomDiscussionPost & {
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
};

type SerializedDiscussionComment = ClassroomDiscussionComment & {
  canEdit: boolean;
  canDelete: boolean;
};

beforeEach(async () => {
  Object.assign(appConfig, {
    appOrigin: origin,
    authDevExposeVerificationCode: true,
    authCookieName: "merge_edu_session",
    authEmailDeliveryMode: "dev",
    authEmailResendCooldownSeconds: 0,
    modelName: "gemini-3-flash-preview",
    aiBridgeUrl: "http://127.0.0.1:8001",
    discussionAssistantAiTimeoutMs: 1_000,
    requestEncryptionMode: "optional",
    requestEncryptionRequiredPaths: []
  });
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.rm(uploadDir, { recursive: true, force: true });
});

async function startServer(bridge: Record<string, unknown> = {}) {
  const store = new JsonStore({ dataDir: testDir, uploadDir });
  await store.init();
  const app = createApp({
    store,
    auth: new AuthService(store, { emailSender: new DevEmailSender() }),
    requestEncryption: new RequestEncryptionService(),
    bridge: bridge as any,
    pdfIngest: {} as any,
    engine: {} as any
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    store,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function makeClient(baseUrl: string) {
  let cookie = "";
  return {
    async request(pathname: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("content-type") && init.body) {
        headers.set("content-type", "application/json");
      }
      headers.set("origin", origin);
      if (cookie) headers.set("cookie", cookie);
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    }
  };
}

async function signupClient(
  baseUrl: string,
  input: { email: string; role: "teacher" | "student"; displayName: string }
): Promise<{ client: ReturnType<typeof makeClient>; user: PublicUser }> {
  const client = makeClient(baseUrl);
  const signup = await client.request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: "pass1234",
      displayName: input.displayName,
      role: input.role
    })
  });
  expect(signup.status).toBe(201);
  const signupPayload = await signup.json() as {
    data: { user: PublicUser };
    devVerificationCode: string;
  };
  const verify = await client.request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      code: signupPayload.devVerificationCode
    })
  });
  expect(verify.status).toBe(200);
  const verifyPayload = await verify.json() as { data: { user: PublicUser } };
  return { client, user: verifyPayload.data.user };
}

function discussionInput(overrides: Partial<ClassroomDiscussionPost> = {}) {
  return {
    title: overrides.title ?? "2주차 토론 주제",
    contentMarkdown: overrides.contentMarkdown ?? "이번 주 수업에서 이해한 내용을 자유롭게 공유해 주세요.",
    category: overrides.category ?? "FREE",
    visibility: "CLASS",
    pinned: overrides.pinned ?? false,
    anonymous: overrides.anonymous ?? false,
    allowComments: overrides.allowComments ?? true,
    status: overrides.status ?? "PUBLISHED",
    attachments: overrides.attachments ?? []
  };
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function parseNdjson(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

async function readDiscussionViewReceipts(): Promise<ClassroomDiscussionViewReceipt[]> {
  return JSON.parse(
    await fs.readFile(path.join(testDir, "classroom-discussion-views.json"), "utf-8")
  ) as ClassroomDiscussionViewReceipt[];
}

function expectNoInternalDiscussionFields(post: Record<string, unknown>) {
  expect(post).not.toHaveProperty("viewerUserId");
  expect(post).not.toHaveProperty("lastViewedAt");
  expect(post).not.toHaveProperty("receipt");
  expect(post).not.toHaveProperty("receipts");
}

describe("classroom discussion routes", () => {
  it("enforces membership, draft visibility, ownership, comments, and assistant payload rules", async () => {
    const server = await startServer();
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "discussion.teacher@example.com",
        role: "teacher",
        displayName: "토론 선생님"
      });
      const otherTeacher = await signupClient(server.baseUrl, {
        email: "discussion.other.teacher@example.com",
        role: "teacher",
        displayName: "다른 선생님"
      });
      const studentA = await signupClient(server.baseUrl, {
        email: "discussion.student.a@example.com",
        role: "student",
        displayName: "토론 학생 A"
      });
      const studentB = await signupClient(server.baseUrl, {
        email: "discussion.student.b@example.com",
        role: "student",
        displayName: "토론 학생 B"
      });
      const studentC = await signupClient(server.baseUrl, {
        email: "discussion.student.c@example.com",
        role: "student",
        displayName: "토론 학생 C"
      });
      const studentD = await signupClient(server.baseUrl, {
        email: "discussion.student.d@example.com",
        role: "student",
        displayName: "토론 학생 D"
      });
      const outsider = await signupClient(server.baseUrl, {
        email: "discussion.outsider@example.com",
        role: "student",
        displayName: "외부 학생"
      });
      const anonymous = makeClient(server.baseUrl);

      const classroom = await server.store.createClassroom("토론 테스트 강의실", teacher.user.id);
      const otherClassroom = await server.store.createClassroom("다른 강의실", otherTeacher.user.id);
      await server.store.enrollStudent(classroom.id, studentA.user.id, teacher.user.id);
      await server.store.enrollStudent(classroom.id, studentB.user.id, teacher.user.id);
      await server.store.enrollStudent(classroom.id, studentC.user.id, teacher.user.id);
      await server.store.enrollStudent(classroom.id, studentD.user.id, teacher.user.id);

      const unauthenticatedList = await anonymous.request(`/classrooms/${classroom.id}/discussions`);
      expect(unauthenticatedList.status).toBe(401);
      const outsiderList = await outsider.client.request(`/classrooms/${classroom.id}/discussions`);
      expect(outsiderList.status).toBe(403);
      const outsiderCreate = await outsider.client.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput())
      });
      expect(outsiderCreate.status).toBe(403);
      const outsiderAssistant = await outsider.client.request(`/classrooms/${classroom.id}/discussions/assistant`, {
        method: "POST",
        body: JSON.stringify({ prompt: "도와줘", draft: discussionInput() })
      });
      expect(outsiderAssistant.status).toBe(403);
      const unauthenticatedCreate = await anonymous.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput())
      });
      expect(unauthenticatedCreate.status).toBe(401);

      const studentPinnedCreate = await studentA.client.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput({ pinned: true }))
      });
      expect(studentPinnedCreate.status).toBe(403);

      const studentCreate = await studentA.client.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput({ title: "학생이 올린 질문", category: "QUESTION" }))
      });
      expect(studentCreate.status).toBe(201);
      const studentPost = (await json<{ data: SerializedDiscussionPost }>(studentCreate)).data;
      expect(studentPost.canEdit).toBe(true);
      expect(studentPost.canDelete).toBe(true);
      expect(studentPost.canPin).toBe(false);
      expectNoInternalDiscussionFields(studentPost as unknown as Record<string, unknown>);

      const outsiderDetail = await outsider.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      expect(outsiderDetail.status).toBe(403);
      const unauthenticatedDetail = await anonymous.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      expect(unauthenticatedDetail.status).toBe(401);
      const outsiderComments = await outsider.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}/comments`);
      expect(outsiderComments.status).toBe(403);

      const teacherPin = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: true })
      });
      expect(teacherPin.status).toBe(200);
      expect((await json<{ data: SerializedDiscussionPost }>(teacherPin)).data.pinned).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const studentTitlePatch = await studentA.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "수정된 학생 질문" })
      });
      expect(studentTitlePatch.status).toBe(200);
      const studentPatchedPost = (await json<{ data: SerializedDiscussionPost }>(studentTitlePatch)).data;
      expect(studentPatchedPost.title).toBe("수정된 학생 질문");
      expect(studentPatchedPost.pinned).toBe(true);
      expectNoInternalDiscussionFields(studentPatchedPost as unknown as Record<string, unknown>);
      expect(new Date(studentPatchedPost.updatedAt).getTime()).toBeGreaterThan(
        new Date(studentPost.updatedAt).getTime()
      );

      const studentPinnedPatch = await studentA.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: false })
      });
      expect(studentPinnedPatch.status).toBe(403);
      const otherStudentPatch = await studentB.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "남의 글 수정" })
      });
      expect(otherStudentPatch.status).toBe(403);

      const draftCreate = await studentB.client.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput({ title: "학생 B 임시글", status: "DRAFT" }))
      });
      expect(draftCreate.status).toBe(201);
      const draftPost = (await json<{ data: SerializedDiscussionPost }>(draftCreate)).data;

      const draftForOtherStudent = await studentA.client.request(`/classrooms/${classroom.id}/discussions/${draftPost.id}`);
      expect(draftForOtherStudent.status).toBe(404);
      const draftForOwner = await studentB.client.request(`/classrooms/${classroom.id}/discussions/${draftPost.id}`);
      expect(draftForOwner.status).toBe(200);
      const ownerDraftFirst = (await json<{ data: SerializedDiscussionPost }>(draftForOwner)).data;
      const ownerDraftSecondResponse = await studentB.client.request(`/classrooms/${classroom.id}/discussions/${draftPost.id}`);
      const ownerDraftSecond = (await json<{ data: SerializedDiscussionPost }>(ownerDraftSecondResponse)).data;
      expect(ownerDraftSecond.viewCount).toBe(ownerDraftFirst.viewCount);
      const draftForTeacher = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${draftPost.id}`);
      expect(draftForTeacher.status).toBe(200);
      const teacherListWithDrafts = await teacher.client.request(`/classrooms/${classroom.id}/discussions`);
      expect((await json<{ data: SerializedDiscussionPost[] }>(teacherListWithDrafts)).data.some((post) => post.id === draftPost.id)).toBe(true);
      const ownerListWithDraft = await studentB.client.request(`/classrooms/${classroom.id}/discussions`);
      const ownerListWithDraftPosts = (await json<{ data: SerializedDiscussionPost[] }>(ownerListWithDraft)).data;
      expect(ownerListWithDraftPosts.some((post) => post.id === draftPost.id)).toBe(true);
      ownerListWithDraftPosts.forEach((post) =>
        expectNoInternalDiscussionFields(post as unknown as Record<string, unknown>)
      );
      const otherStudentListWithoutDraft = await studentA.client.request(`/classrooms/${classroom.id}/discussions`);
      expect((await json<{ data: SerializedDiscussionPost[] }>(otherStudentListWithoutDraft)).data.some((post) => post.id === draftPost.id)).toBe(false);

      const commentOnDraft = await studentB.client.request(`/classrooms/${classroom.id}/discussions/${draftPost.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ contentMarkdown: "임시글 댓글" })
      });
      expect(commentOnDraft.status).toBe(400);

      const detailBeforeView = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      const detailAfterView = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      const firstViewed = (await json<{ data: SerializedDiscussionPost }>(detailBeforeView)).data;
      const secondViewed = (await json<{ data: SerializedDiscussionPost }>(detailAfterView)).data;
      expectNoInternalDiscussionFields(firstViewed as unknown as Record<string, unknown>);
      expect(secondViewed.viewCount).toBe(firstViewed.viewCount);
      const listAfterDetail = await teacher.client.request(`/classrooms/${classroom.id}/discussions`);
      const listedAfterDetail = (await json<{ data: SerializedDiscussionPost[] }>(listAfterDetail)).data.find(
        (post) => post.id === studentPost.id
      );
      expect(listedAfterDetail?.viewCount).toBe(secondViewed.viewCount);
      await Promise.all(
        Array.from({ length: 5 }, () =>
          teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`)
        )
      );
      expect((await server.store.getClassroomDiscussion(classroom.id, studentPost.id))?.viewCount)
        .toBe(secondViewed.viewCount);
      const studentBDetail = await studentB.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      const studentBViewed = (await json<{ data: SerializedDiscussionPost }>(studentBDetail)).data;
      expect(studentBViewed.viewCount).toBe(secondViewed.viewCount + 1);

      const headBeforeReceipts = await readDiscussionViewReceipts();
      const teacherHead = await teacher.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}`,
        { method: "HEAD" }
      );
      expect(teacherHead.status).toBe(200);
      expect(await teacherHead.text()).toBe("");
      expect(await readDiscussionViewReceipts()).toEqual(headBeforeReceipts);
      expect((await server.store.getClassroomDiscussion(classroom.id, studentPost.id))?.viewCount)
        .toBe(studentBViewed.viewCount);
      const studentCHead = await studentC.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}`,
        { method: "HEAD" }
      );
      expect(studentCHead.status).toBe(200);
      expect(await readDiscussionViewReceipts()).toEqual(headBeforeReceipts);
      const studentCDetail = await studentC.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      const studentCViewed = (await json<{ data: SerializedDiscussionPost }>(studentCDetail)).data;
      expect(studentCViewed.viewCount).toBe(studentBViewed.viewCount + 1);
      const [studentAConcurrent, studentDConcurrent] = await Promise.all([
        studentA.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`),
        studentD.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`)
      ]);
      expect(studentAConcurrent.status).toBe(200);
      expect(studentDConcurrent.status).toBe(200);
      expect((await server.store.getClassroomDiscussion(classroom.id, studentPost.id))?.viewCount)
        .toBe(studentCViewed.viewCount + 2);

      const draftHead = await studentB.client.request(
        `/classrooms/${classroom.id}/discussions/${draftPost.id}`,
        { method: "HEAD" }
      );
      expect(draftHead.status).toBe(200);
      const teacherDraftHead = await teacher.client.request(
        `/classrooms/${classroom.id}/discussions/${draftPost.id}`,
        { method: "HEAD" }
      );
      expect(teacherDraftHead.status).toBe(200);
      const invisibleDraftHead = await studentA.client.request(
        `/classrooms/${classroom.id}/discussions/${draftPost.id}`,
        { method: "HEAD" }
      );
      expect(invisibleDraftHead.status).toBe(404);
      const outsiderHead = await outsider.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}`,
        { method: "HEAD" }
      );
      expect(outsiderHead.status).toBe(403);
      const anonymousHead = await anonymous.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}`,
        { method: "HEAD" }
      );
      expect(anonymousHead.status).toBe(401);
      const wrongClassHead = await otherTeacher.client.request(
        `/classrooms/${otherClassroom.id}/discussions/${studentPost.id}`,
        { method: "HEAD" }
      );
      expect(wrongClassHead.status).toBe(404);
      const unverified = makeClient(server.baseUrl);
      const unverifiedSignup = await unverified.request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "discussion.unverified@example.com",
          password: "pass1234",
          displayName: "미인증 학생",
          role: "student"
        })
      });
      expect(unverifiedSignup.status).toBe(201);
      const unverifiedHead = await unverified.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}`,
        { method: "HEAD" }
      );
      expect(unverifiedHead.status).toBe(401);
      const receiptsBeforeAgedTeacher = await readDiscussionViewReceipts();
      await fs.writeFile(
        path.join(testDir, "classroom-discussion-views.json"),
        JSON.stringify(
          receiptsBeforeAgedTeacher.map((receipt) =>
            receipt.postId === studentPost.id && receipt.viewerUserId === teacher.user.id
              ? { ...receipt, lastViewedAt: "2000-01-01T00:00:00.000Z" }
              : receipt
          ),
          null,
          2
        )
      );
      const beforeAgedTeacherCount = (await server.store.getClassroomDiscussion(classroom.id, studentPost.id))?.viewCount ?? 0;
      const agedTeacherDetail = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      expect(agedTeacherDetail.status).toBe(200);
      expect((await json<{ data: SerializedDiscussionPost }>(agedTeacherDetail)).data.viewCount)
        .toBe(beforeAgedTeacherCount + 1);

      const commentCreate = await studentB.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ contentMarkdown: "학생 B 댓글" })
      });
      expect(commentCreate.status).toBe(201);
      const comment = (await json<{ data: SerializedDiscussionComment }>(commentCreate)).data;
      expect(comment.canEdit).toBe(true);
      expect(comment.canDelete).toBe(true);

      const replyCreate = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ contentMarkdown: "선생님 답글", parentCommentId: comment.id })
      });
      expect(replyCreate.status).toBe(201);
      const reply = (await json<{ data: SerializedDiscussionComment }>(replyCreate)).data;

      const nestedReplyCreate = await studentA.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ contentMarkdown: "답글의 답글", parentCommentId: reply.id })
      });
      expect(nestedReplyCreate.status).toBe(400);

      const otherStudentCommentPatch = await studentA.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}/comments/${comment.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "남의 댓글 수정" })
        }
      );
      expect(otherStudentCommentPatch.status).toBe(403);
      const otherStudentCommentDelete = await studentA.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}/comments/${comment.id}`,
        { method: "DELETE" }
      );
      expect(otherStudentCommentDelete.status).toBe(403);

      const ownerCommentPatch = await studentB.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}/comments/${comment.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "학생이 직접 고친 댓글" })
        }
      );
      expect(ownerCommentPatch.status).toBe(200);
      expect((await json<{ data: SerializedDiscussionComment }>(ownerCommentPatch)).data.contentMarkdown).toBe(
        "학생이 직접 고친 댓글"
      );

      const teacherCommentPatch = await teacher.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}/comments/${comment.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "선생님이 정리한 댓글" })
        }
      );
      expect(teacherCommentPatch.status).toBe(200);
      expect((await json<{ data: SerializedDiscussionComment }>(teacherCommentPatch)).data.contentMarkdown).toBe(
        "선생님이 정리한 댓글"
      );
      const ownerDeleteCommentCreate = await studentA.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ contentMarkdown: "학생 A가 지울 댓글" })
      });
      expect(ownerDeleteCommentCreate.status).toBe(201);
      const ownerDeleteComment = (await json<{ data: SerializedDiscussionComment }>(ownerDeleteCommentCreate)).data;
      const ownerDelete = await studentA.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}/comments/${ownerDeleteComment.id}`,
        { method: "DELETE" }
      );
      expect(ownerDelete.status).toBe(200);

      const closedPostCreate = await teacher.client.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput({ title: "댓글 닫힌 글", allowComments: false }))
      });
      expect(closedPostCreate.status).toBe(201);
      const closedPost = (await json<{ data: SerializedDiscussionPost }>(closedPostCreate)).data;
      const closedComment = await studentA.client.request(`/classrooms/${classroom.id}/discussions/${closedPost.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ contentMarkdown: "닫힌 글 댓글" })
      });
      expect(closedComment.status).toBe(400);
      const anonymousPostCreate = await teacher.client.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput({ anonymous: true }))
      });
      expect(anonymousPostCreate.status).toBe(400);

      const assistant = await studentA.client.request(`/classrooms/${classroom.id}/discussions/assistant`, {
        method: "POST",
        body: JSON.stringify({
          prompt: "질문형으로 다듬어줘",
          draft: discussionInput({ title: "토론 참여", contentMarkdown: "데이터 활용 윤리를 생각해 봅시다." })
        })
      });
      expect(assistant.status).toBe(200);
      expect((await json<{ data: { suggestedTitle?: string; messageMarkdown: string } }>(assistant)).data.suggestedTitle)
        .toContain("의견을 나눠봅시다");

      const malformedAssistant = await studentA.client.request(`/classrooms/${classroom.id}/discussions/assistant`, {
        method: "POST",
        body: JSON.stringify({ prompt: "도와줘", draft: { title: "부족한 JSON" } })
      });
      expect(malformedAssistant.status).toBe(400);
      const missingAttachmentsAssistant = await studentA.client.request(`/classrooms/${classroom.id}/discussions/assistant`, {
        method: "POST",
        body: JSON.stringify({
          prompt: "도와줘",
          draft: {
            title: "첨부 누락",
            contentMarkdown: "내용",
            category: "FREE",
            visibility: "CLASS",
            pinned: false,
            anonymous: false,
            allowComments: true,
            status: "DRAFT"
          }
        })
      });
      expect(missingAttachmentsAssistant.status).toBe(400);

      const crossClassPostLookup = await otherTeacher.client.request(
        `/classrooms/${otherClassroom.id}/discussions/${studentPost.id}`
      );
      expect(crossClassPostLookup.status).toBe(404);
      const crossClassComments = await otherTeacher.client.request(
        `/classrooms/${otherClassroom.id}/discussions/${studentPost.id}/comments`
      );
      expect(crossClassComments.status).toBe(404);
      const crossClassCommentPatch = await otherTeacher.client.request(
        `/classrooms/${otherClassroom.id}/discussions/${studentPost.id}/comments/${comment.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ contentMarkdown: "다른 강의실 댓글 수정" })
        }
      );
      expect(crossClassCommentPatch.status).toBe(404);
      const crossClassCommentDelete = await otherTeacher.client.request(
        `/classrooms/${otherClassroom.id}/discussions/${studentPost.id}/comments/${comment.id}`,
        { method: "DELETE" }
      );
      expect(crossClassCommentDelete.status).toBe(404);

      const teacherDeleteComment = await teacher.client.request(
        `/classrooms/${classroom.id}/discussions/${studentPost.id}/comments/${comment.id}`,
        { method: "DELETE" }
      );
      expect(teacherDeleteComment.status).toBe(200);
      const afterCommentDelete = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}/comments`);
      expect((await json<{ data: SerializedDiscussionComment[] }>(afterCommentDelete)).data).toHaveLength(0);

      const teacherDeletePost = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`, {
        method: "DELETE"
      });
      expect(teacherDeletePost.status).toBe(200);
      const afterPostDelete = await teacher.client.request(`/classrooms/${classroom.id}/discussions/${studentPost.id}`);
      expect(afterPostDelete.status).toBe(404);

      const cascadePostResponse = await teacher.client.request(`/classrooms/${classroom.id}/discussions`, {
        method: "POST",
        body: JSON.stringify(discussionInput({ title: "강의실 삭제 cascade 글" }))
      });
      const cascadePost = (await json<{ data: SerializedDiscussionPost }>(cascadePostResponse)).data;
      const cascadeCommentResponse = await studentA.client.request(`/classrooms/${classroom.id}/discussions/${cascadePost.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ contentMarkdown: "강의실 삭제 cascade 댓글" })
      });
      expect(cascadeCommentResponse.status).toBe(201);
      await server.store.deleteClassroom(classroom.id);
      expect(await server.store.listClassroomDiscussions(classroom.id, { includeAllForTeacher: true })).toHaveLength(0);
      expect(await server.store.listClassroomDiscussionComments(classroom.id, cascadePost.id)).toHaveLength(0);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("streams discussion assistant markdown with sanitized draft and safe suggestion data", async () => {
    let bridgeInput: Record<string, any> | undefined;
    const server = await startServer({
      async discussionAssistantChatStream(
        input: Record<string, any>,
        onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void
      ) {
        bridgeInput = input;
        onDelta?.({ channel: "thought", text: "초안 JSON 확인 중" });
        onDelta?.({ channel: "answer", text: "**질문형 제안**입니다." });
        return {
          markdown: "**질문형 제안**입니다.",
          thoughtSummary: "초안 JSON 확인 중"
        };
      }
    });
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "discussion.stream.teacher@example.com",
        role: "teacher",
        displayName: "토론 선생님"
      });
      const student = await signupClient(server.baseUrl, {
        email: "discussion.stream.student@example.com",
        role: "student",
        displayName: "토론 학생"
      });
      const classroom = await server.store.createClassroom("토론 스트림 강의실", teacher.user.id);
      await server.store.enrollStudent(classroom.id, student.user.id, teacher.user.id);

      const response = await student.client.request(`/classrooms/${classroom.id}/discussions/assistant/stream`, {
        method: "POST",
        body: JSON.stringify({
          prompt: "질문형으로 바꿔줘",
          draft: discussionInput({ title: "데이터 윤리", contentMarkdown: "의견을 남겨주세요.", status: "DRAFT" }),
          history: [
            { role: "user", contentMarkdown: "이전 요청", thoughtMarkdown: "제외" },
            { role: "assistant", contentMarkdown: "이전 답변", response: { suggestedTitle: "제외" } }
          ]
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      const events = parseNdjson(await response.text());
      expect(events.some((event) => event.type === "thought_delta" && event.text.includes("초안 JSON"))).toBe(true);
      expect(events.some((event) => event.type === "answer_delta" && event.text.includes("질문형 제안"))).toBe(true);
      const done = events.at(-1)!;
      expect(done.type).toBe("done");
      expect(done.answerText).toContain("질문형 제안");
      expect(done.data.suggestedTitle).toContain("의견을 나눠봅시다");
      expect(bridgeInput?.model).toBe("gemini-3-flash-preview");
      expect(bridgeInput?.draft).toMatchObject({
        title: "데이터 윤리",
        contentMarkdown: "의견을 남겨주세요.",
        category: "FREE",
        visibility: "CLASS",
        pinned: false,
        anonymous: false,
        allowComments: true,
        status: "DRAFT",
        attachments: []
      });
      expect(bridgeInput?.history).toEqual([
        { role: "user", contentMarkdown: "이전 요청" },
        { role: "assistant", contentMarkdown: "이전 답변" }
      ]);
    } finally {
      await server.close();
    }
  });

  it("sanitizes discussion assistant stream bridge errors after headers are sent", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = await startServer({
      async discussionAssistantChatStream() {
        throw new Error("raw gemini provider stack with secret detail");
      }
    });
    try {
      const teacher = await signupClient(server.baseUrl, {
        email: "discussion.error.teacher@example.com",
        role: "teacher",
        displayName: "에러 선생님"
      });
      const student = await signupClient(server.baseUrl, {
        email: "discussion.error.student@example.com",
        role: "student",
        displayName: "에러 학생"
      });
      const classroom = await server.store.createClassroom("토론 에러 강의실", teacher.user.id);
      await server.store.enrollStudent(classroom.id, student.user.id, teacher.user.id);

      const response = await student.client.request(`/classrooms/${classroom.id}/discussions/assistant/stream`, {
        method: "POST",
        body: JSON.stringify({
          prompt: "도와줘",
          draft: discussionInput({ title: "에러 테스트", contentMarkdown: "내용", status: "DRAFT" })
        })
      });

      expect(response.status).toBe(200);
      const events = parseNdjson(await response.text());
      const errorEvent = events.find((event) => event.type === "error");
      expect(errorEvent?.error).toBe("토론 작성 어시스턴트 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      expect(errorEvent?.error).not.toContain("secret");
      expect(errorEvent?.error).not.toContain("gemini provider stack");
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      await server.close();
    }
  });
});
