import crypto from "node:crypto";
import { Response, Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import { appConfig } from "../config.js";
import {
  requireAuth,
  requireClassroomReadable,
  requireClassroomOwner,
  requireTeacher,
  requireVerifiedEmail
} from "../middleware/auth.js";
import {
  ReportCriteriaAssistantService,
  ReportCriteriaAssistantStage,
  REPORT_CRITERIA_ASSISTANT_SAFE_THOUGHT_DELTA,
  REPORT_CRITERIA_ASSISTANT_SAFE_THOUGHT_SUMMARY
} from "../services/report/ReportCriteriaAssistantService.js";
import {
  StudentCompetencyReportService,
  sanitizeStudentReportChatHistory
} from "../services/report/StudentCompetencyReportService.js";
import { ConsoleExamLogger } from "../services/exams/ExamLogger.js";
import { SystemExamClock } from "../services/exams/ExamClock.js";
import { TeacherExamGradingService } from "../services/exams/TeacherExamGradingService.js";
import { TeacherExamService } from "../services/exams/TeacherExamService.js";
import { ReportCriterionDuplicateError } from "../services/storage/JsonStore.js";
import { resolveLearningProgressPage } from "../services/learningProgress.js";
import {
  Classroom,
  ClassroomAttendanceLectureProgress,
  ClassroomAttendanceStatus,
  ClassroomAttendanceStudent,
  ClassroomAttendanceSummary,
  ClassroomDiscussionAttachment,
  ClassroomDiscussionCategory,
  ClassroomDiscussionComment,
  ClassroomDiscussionPost,
  ClassroomDiscussionStatus,
  ClassroomDiscussionVisibility,
  ClassroomNotice,
  ClassroomNoticeAttachment,
  ClassroomNoticeCategory,
  ClassroomNoticeComment,
  ClassroomNoticePriority,
  ClassroomNoticeStatus,
  ClassroomNoticeTarget,
  LectureItem,
  SessionState,
  StudentClassroomAttendanceExam,
  StudentClassroomAttendanceExamStatusTone,
  StudentClassroomAttendanceSummary,
  StudentClassroomAttendanceWeek,
  StudentReportCustomCriterion,
  TeacherExam,
  User,
  Week
} from "../types/domain.js";

const NOTICE_CATEGORIES = new Set<ClassroomNoticeCategory>([
  "GENERAL",
  "EXAM",
  "MATERIAL",
  "DISCUSSION",
  "ASSIGNMENT"
]);
const NOTICE_PRIORITIES = new Set<ClassroomNoticePriority>(["NORMAL", "IMPORTANT"]);
const NOTICE_STATUSES = new Set<ClassroomNoticeStatus>(["DRAFT", "PUBLISHED"]);
const NOTICE_TARGETS = new Set<ClassroomNoticeTarget>(["CLASS"]);
const DISCUSSION_CATEGORIES = new Set<ClassroomDiscussionCategory>([
  "NOTICE",
  "QUESTION",
  "FREE",
  "RESOURCE"
]);
const DISCUSSION_STATUSES = new Set<ClassroomDiscussionStatus>(["DRAFT", "PUBLISHED"]);
const DISCUSSION_VISIBILITIES = new Set<ClassroomDiscussionVisibility>(["CLASS"]);

type NoticePatch = {
  title?: string;
  contentMarkdown?: string;
  category?: ClassroomNoticeCategory;
  priority?: ClassroomNoticePriority;
  target?: ClassroomNoticeTarget;
  pinned?: boolean;
  status?: ClassroomNoticeStatus;
  publishAt?: string | null;
  attachments?: ClassroomNoticeAttachment[];
};

type DiscussionPatch = {
  title?: string;
  contentMarkdown?: string;
  category?: ClassroomDiscussionCategory;
  visibility?: ClassroomDiscussionVisibility;
  pinned?: boolean;
  anonymous?: boolean;
  allowComments?: boolean;
  status?: ClassroomDiscussionStatus;
  attachments?: ClassroomDiscussionAttachment[];
};

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

function parseCriterionInput(
  body: unknown,
  options: { partial?: boolean } = {}
): { name?: string; description?: string; error?: string } {
  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nameProvided = Object.prototype.hasOwnProperty.call(candidate, "name");
  const descriptionProvided = Object.prototype.hasOwnProperty.call(candidate, "description");
  const name = nameProvided && typeof candidate.name === "string" ? candidate.name.trim() : "";
  const description =
    descriptionProvided && typeof candidate.description === "string"
      ? candidate.description.trim()
      : "";

  if (!options.partial || nameProvided) {
    if (!name) return { error: "항목 이름을 입력해 주세요." };
    if (name.length > 60) return { error: "항목 이름은 60자 이하로 입력해 주세요." };
  }
  if (!options.partial || descriptionProvided) {
    if (!description) return { error: "항목 설명을 입력해 주세요." };
    if (description.length > 600) {
      return { error: "항목 설명은 600자 이하로 입력해 주세요." };
    }
  }
  if (options.partial && !nameProvided && !descriptionProvided) {
    return { error: "수정할 항목 이름 또는 설명을 입력해 주세요." };
  }

  return {
    ...(nameProvided ? { name } : {}),
    ...(descriptionProvided ? { description } : {})
  };
}

function hasOwn(candidate: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(candidate, key);
}

function isValidIsoDate(value: string): boolean {
  const isoDateTime =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  return isoDateTime.test(value) && Number.isFinite(Date.parse(value));
}

function parseNoticeAttachments(value: unknown): { attachments?: ClassroomNoticeAttachment[]; error?: string } {
  if (value === undefined) return { attachments: [] };
  if (!Array.isArray(value)) return { error: "attachments must be an array" };
  if (value.length > 8) return { error: "첨부파일은 최대 8개까지 등록할 수 있습니다." };

  const attachments: ClassroomNoticeAttachment[] = [];
  for (const item of value) {
    const candidate = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const size = typeof candidate.size === "number" && Number.isFinite(candidate.size)
      ? candidate.size
      : Number.NaN;
    if (!name) return { error: "첨부파일 이름을 확인해 주세요." };
    if (name.length > 120) return { error: "첨부파일 이름은 120자 이하로 입력해 주세요." };
    if (!Number.isFinite(size) || size < 0) {
      return { error: "첨부파일 크기 정보가 올바르지 않습니다." };
    }
    const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType.trim() : "";
    attachments.push({
      id: typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : `att_${crypto.randomUUID()}`,
      name,
      size,
      ...(mimeType ? { mimeType: mimeType.slice(0, 120) } : {})
    });
  }

  return { attachments };
}

function parseNoticeInput(
  body: unknown,
  options: { partial?: boolean } = {}
): NoticePatch & { error?: string } {
  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const patch: NoticePatch = {};

  if (!options.partial || hasOwn(candidate, "title")) {
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    if (!title) return { error: "공지사항 제목을 입력해 주세요." };
    if (title.length > 100) return { error: "공지사항 제목은 100자 이하로 입력해 주세요." };
    patch.title = title;
  }

  if (!options.partial || hasOwn(candidate, "contentMarkdown")) {
    const contentMarkdown =
      typeof candidate.contentMarkdown === "string" ? candidate.contentMarkdown.trim() : "";
    if (!contentMarkdown) return { error: "공지사항 내용을 입력해 주세요." };
    if (contentMarkdown.length > 12000) {
      return { error: "공지사항 내용은 12000자 이하로 입력해 주세요." };
    }
    patch.contentMarkdown = contentMarkdown;
  }

  if (!options.partial || hasOwn(candidate, "category")) {
    const category = typeof candidate.category === "string" ? candidate.category : "GENERAL";
    if (!NOTICE_CATEGORIES.has(category as ClassroomNoticeCategory)) {
      return { error: "공지 유형이 올바르지 않습니다." };
    }
    patch.category = category as ClassroomNoticeCategory;
  }

  if (!options.partial || hasOwn(candidate, "priority")) {
    const priority = typeof candidate.priority === "string" ? candidate.priority : "NORMAL";
    if (!NOTICE_PRIORITIES.has(priority as ClassroomNoticePriority)) {
      return { error: "공지 중요도가 올바르지 않습니다." };
    }
    patch.priority = priority as ClassroomNoticePriority;
  }

  if (!options.partial || hasOwn(candidate, "target")) {
    const target = typeof candidate.target === "string" ? candidate.target : "CLASS";
    if (!NOTICE_TARGETS.has(target as ClassroomNoticeTarget)) {
      return { error: "공지 대상이 올바르지 않습니다." };
    }
    patch.target = target as ClassroomNoticeTarget;
  }

  if (!options.partial || hasOwn(candidate, "status")) {
    const status = typeof candidate.status === "string" ? candidate.status : "DRAFT";
    if (!NOTICE_STATUSES.has(status as ClassroomNoticeStatus)) {
      return { error: "공지 상태가 올바르지 않습니다." };
    }
    patch.status = status as ClassroomNoticeStatus;
  }

  if (hasOwn(candidate, "pinned") || !options.partial) {
    patch.pinned = Boolean(candidate.pinned);
  }

  if (hasOwn(candidate, "publishAt")) {
    if (candidate.publishAt === null || candidate.publishAt === "") {
      patch.publishAt = null;
    } else if (typeof candidate.publishAt === "string" && isValidIsoDate(candidate.publishAt)) {
      patch.publishAt = new Date(candidate.publishAt).toISOString();
    } else {
      return { error: "예약 게시 시간이 올바르지 않습니다." };
    }
  }

  if (hasOwn(candidate, "attachments") || !options.partial) {
    const parsed = parseNoticeAttachments(candidate.attachments);
    if (parsed.error) return { error: parsed.error };
    patch.attachments = parsed.attachments ?? [];
  }

  if (options.partial && Object.keys(patch).length === 0) {
    return { error: "수정할 공지사항 항목을 입력해 주세요." };
  }

  return patch;
}

function parseDiscussionAttachments(value: unknown): { attachments?: ClassroomDiscussionAttachment[]; error?: string } {
  const parsed = parseNoticeAttachments(value);
  return parsed as { attachments?: ClassroomDiscussionAttachment[]; error?: string };
}

function parseDiscussionInput(
  body: unknown,
  options: { partial?: boolean } = {}
): DiscussionPatch & { error?: string } {
  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const patch: DiscussionPatch = {};

  if (!options.partial || hasOwn(candidate, "title")) {
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    if (!title) return { error: "게시글 제목을 입력해 주세요." };
    if (title.length > 120) return { error: "게시글 제목은 120자 이하로 입력해 주세요." };
    patch.title = title;
  }

  if (!options.partial || hasOwn(candidate, "contentMarkdown")) {
    const contentMarkdown =
      typeof candidate.contentMarkdown === "string" ? candidate.contentMarkdown.trim() : "";
    if (!contentMarkdown) return { error: "게시글 내용을 입력해 주세요." };
    if (contentMarkdown.length > 12000) {
      return { error: "게시글 내용은 12000자 이하로 입력해 주세요." };
    }
    patch.contentMarkdown = contentMarkdown;
  }

  if (!options.partial || hasOwn(candidate, "category")) {
    const category = typeof candidate.category === "string" ? candidate.category : "FREE";
    if (!DISCUSSION_CATEGORIES.has(category as ClassroomDiscussionCategory)) {
      return { error: "토론 유형이 올바르지 않습니다." };
    }
    patch.category = category as ClassroomDiscussionCategory;
  }

  if (!options.partial || hasOwn(candidate, "visibility")) {
    const visibility = typeof candidate.visibility === "string" ? candidate.visibility : "CLASS";
    if (!DISCUSSION_VISIBILITIES.has(visibility as ClassroomDiscussionVisibility)) {
      return { error: "공개 범위가 올바르지 않습니다." };
    }
    patch.visibility = visibility as ClassroomDiscussionVisibility;
  }

  if (!options.partial || hasOwn(candidate, "status")) {
    const status = typeof candidate.status === "string" ? candidate.status : "PUBLISHED";
    if (!DISCUSSION_STATUSES.has(status as ClassroomDiscussionStatus)) {
      return { error: "게시글 상태가 올바르지 않습니다." };
    }
    patch.status = status as ClassroomDiscussionStatus;
  }

  if (!options.partial || hasOwn(candidate, "allowComments")) {
    patch.allowComments = hasOwn(candidate, "allowComments")
      ? Boolean(candidate.allowComments)
      : true;
  }

  if (hasOwn(candidate, "pinned") || !options.partial) {
    patch.pinned = Boolean(candidate.pinned);
  }

  if (hasOwn(candidate, "anonymous")) {
    if (Boolean(candidate.anonymous)) {
      return { error: "익명 작성은 아직 지원하지 않습니다." };
    }
    patch.anonymous = false;
  } else if (!options.partial) {
    patch.anonymous = false;
  }

  if (hasOwn(candidate, "attachments") || !options.partial) {
    const parsed = parseDiscussionAttachments(candidate.attachments);
    if (parsed.error) return { error: parsed.error };
    patch.attachments = parsed.attachments ?? [];
  }

  if (options.partial && Object.keys(patch).length === 0) {
    return { error: "수정할 게시글 항목을 입력해 주세요." };
  }

  return patch;
}

function parseCommentInput(body: unknown): {
  contentMarkdown?: string;
  parentCommentId?: string;
  error?: string;
} {
  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const contentMarkdown =
    typeof candidate.contentMarkdown === "string" ? candidate.contentMarkdown.trim() : "";
  if (!contentMarkdown) return { error: "댓글 내용을 입력해 주세요." };
  if (contentMarkdown.length > 2000) return { error: "댓글은 2000자 이하로 입력해 주세요." };
  const parentCommentId =
    typeof candidate.parentCommentId === "string" && candidate.parentCommentId.trim()
      ? candidate.parentCommentId.trim()
      : undefined;
  return { contentMarkdown, parentCommentId };
}

type DiscussionAssistantDraft = {
  title: string;
  contentMarkdown: string;
  category: ClassroomDiscussionCategory;
  visibility: ClassroomDiscussionVisibility;
  pinned: boolean;
  anonymous: boolean;
  allowComments: boolean;
  status: ClassroomDiscussionStatus;
  attachments: ClassroomDiscussionAttachment[];
};

type DiscussionAssistantHistoryMessage = {
  role: "user" | "assistant";
  contentMarkdown: string;
};

function parseDiscussionAssistantInput(body: unknown): {
  prompt?: string;
  draft?: DiscussionAssistantDraft;
  error?: string;
} {
  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
  if (!prompt) return { error: "AI에게 요청할 내용을 입력해 주세요." };
  if (prompt.length > 1000) return { error: "AI 요청은 1000자 이하로 입력해 주세요." };
  const draftCandidate =
    candidate.draft && typeof candidate.draft === "object"
      ? (candidate.draft as Record<string, unknown>)
      : null;
  if (!draftCandidate) return { error: "현재 게시글 초안을 함께 보내 주세요." };

  for (const key of ["authorUserId", "classroomId", "canPin", "canEdit", "canDelete"]) {
    if (hasOwn(draftCandidate, key)) {
      return { error: "권한 필드는 AI 초안에 포함할 수 없습니다." };
    }
  }

  if (!hasOwn(draftCandidate, "title") || typeof draftCandidate.title !== "string") {
    return { error: "게시글 제목을 초안에 포함해 주세요." };
  }
  const title = draftCandidate.title.trim();
  if (title.length > 120) return { error: "게시글 제목은 120자 이하로 입력해 주세요." };
  if (!hasOwn(draftCandidate, "contentMarkdown") || typeof draftCandidate.contentMarkdown !== "string") {
    return { error: "게시글 내용을 초안에 포함해 주세요." };
  }
  const contentMarkdown = draftCandidate.contentMarkdown.trim();
  if (contentMarkdown.length > 12000) {
    return { error: "게시글 내용은 12000자 이하로 입력해 주세요." };
  }
  const category =
    typeof draftCandidate.category === "string" ? draftCandidate.category : undefined;
  if (!category || !DISCUSSION_CATEGORIES.has(category as ClassroomDiscussionCategory)) {
    return { error: "토론 유형이 올바르지 않습니다." };
  }
  const visibility =
    typeof draftCandidate.visibility === "string" ? draftCandidate.visibility : undefined;
  if (!visibility || !DISCUSSION_VISIBILITIES.has(visibility as ClassroomDiscussionVisibility)) {
    return { error: "공개 범위가 올바르지 않습니다." };
  }
  const status = typeof draftCandidate.status === "string" ? draftCandidate.status : undefined;
  if (!status || !DISCUSSION_STATUSES.has(status as ClassroomDiscussionStatus)) {
    return { error: "게시글 상태가 올바르지 않습니다." };
  }
  if (typeof draftCandidate.pinned !== "boolean") return { error: "상단 고정 값이 올바르지 않습니다." };
  if (typeof draftCandidate.anonymous !== "boolean" || draftCandidate.anonymous) {
    return { error: "익명 작성은 아직 지원하지 않습니다." };
  }
  if (typeof draftCandidate.allowComments !== "boolean") {
    return { error: "댓글 허용 값이 올바르지 않습니다." };
  }
  if (!hasOwn(draftCandidate, "attachments") || !Array.isArray(draftCandidate.attachments)) {
    return { error: "첨부 파일 목록을 초안에 포함해 주세요." };
  }
  const parsedAttachments = parseDiscussionAttachments(draftCandidate.attachments);
  if (parsedAttachments.error) return { error: parsedAttachments.error };

  return {
    prompt,
    draft: {
      title,
      contentMarkdown,
      category: category as ClassroomDiscussionCategory,
      visibility: visibility as ClassroomDiscussionVisibility,
      pinned: draftCandidate.pinned,
      anonymous: false,
      allowComments: draftCandidate.allowComments,
      status: status as ClassroomDiscussionStatus,
      attachments: parsedAttachments.attachments ?? []
    }
  };
}

function sanitizeDiscussionAssistantHistory(body: unknown): DiscussionAssistantHistoryMessage[] {
  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const history = Array.isArray(candidate.history) ? candidate.history : [];
  return history
    .slice(-8)
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const message = item as Record<string, unknown>;
      const role = message.role === "user" || message.role === "assistant" ? message.role : null;
      const contentMarkdown =
        typeof message.contentMarkdown === "string" ? message.contentMarkdown.trim() : "";
      if (!role || !contentMarkdown) return [];
      return [
        {
          role,
          contentMarkdown: contentMarkdown.slice(0, 4000)
        }
      ];
    });
}

function canIncludeHiddenNotices(user: User, classroom: Classroom): boolean {
  return user.role === "teacher" && classroom.teacherId === user.id;
}

function canIncludeAllDiscussions(user: User, classroom: Classroom): boolean {
  return user.role === "teacher" && classroom.teacherId === user.id;
}

function discussionViewerOptions(user: User, classroom: Classroom) {
  return canIncludeAllDiscussions(user, classroom)
    ? { includeAllForTeacher: true, viewerUserId: user.id }
    : { viewerUserId: user.id };
}

async function serializeNotice(deps: ServerDeps, notice: ClassroomNotice) {
  const [author, comments] = await Promise.all([
    deps.store.getUser(notice.authorUserId),
    deps.store.listClassroomNoticeComments(notice.classroomId, notice.id)
  ]);
  return {
    ...notice,
    authorDisplayName: author?.displayName ?? "알 수 없는 사용자",
    authorRole: author?.role ?? "teacher",
    commentCount: comments.length
  };
}

async function serializeNoticeComment(
  deps: ServerDeps,
  comment: ClassroomNoticeComment,
  viewer: User,
  classroom: Classroom
) {
  const author = await deps.store.getUser(comment.authorUserId);
  const isOwnerTeacher = viewer.role === "teacher" && classroom.teacherId === viewer.id;
  const isAuthor = comment.authorUserId === viewer.id;
  return {
    ...comment,
    authorDisplayName: author?.displayName ?? "알 수 없는 사용자",
    authorRole: author?.role ?? "student",
    canEdit: isOwnerTeacher || isAuthor,
    canDelete: isOwnerTeacher || isAuthor
  };
}

async function serializeDiscussionPost(
  deps: ServerDeps,
  post: ClassroomDiscussionPost,
  viewer: User,
  classroom: Classroom
) {
  const [author, comments] = await Promise.all([
    deps.store.getUser(post.authorUserId),
    deps.store.listClassroomDiscussionComments(post.classroomId, post.id)
  ]);
  const isOwnerTeacher = viewer.role === "teacher" && classroom.teacherId === viewer.id;
  const isAuthor = post.authorUserId === viewer.id;
  return {
    id: post.id,
    classroomId: post.classroomId,
    authorUserId: post.authorUserId,
    title: post.title,
    contentMarkdown: post.contentMarkdown,
    category: post.category,
    visibility: post.visibility,
    pinned: post.pinned,
    anonymous: post.anonymous,
    allowComments: post.allowComments,
    status: post.status,
    attachments: post.attachments,
    viewCount: post.viewCount,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    authorDisplayName: post.anonymous ? "익명" : author?.displayName ?? "알 수 없는 사용자",
    authorRole: author?.role ?? "student",
    commentCount: comments.length,
    canEdit: isOwnerTeacher || isAuthor,
    canDelete: isOwnerTeacher || isAuthor,
    canPin: isOwnerTeacher
  };
}

async function serializeDiscussionComment(
  deps: ServerDeps,
  comment: ClassroomDiscussionComment,
  viewer: User,
  classroom: Classroom
) {
  const author = await deps.store.getUser(comment.authorUserId);
  const isOwnerTeacher = viewer.role === "teacher" && classroom.teacherId === viewer.id;
  const isAuthor = comment.authorUserId === viewer.id;
  return {
    ...comment,
    authorDisplayName: author?.displayName ?? "알 수 없는 사용자",
    authorRole: author?.role ?? "student",
    canEdit: isOwnerTeacher || isAuthor,
    canDelete: isOwnerTeacher || isAuthor
  };
}

function buildDiscussionAssistantResponse(prompt: string, draft: DiscussionAssistantDraft) {
  const normalizedPrompt = prompt.toLocaleLowerCase("ko-KR");
  const baseTitle = draft.title.trim() || "토론 주제";
  const baseContent = draft.contentMarkdown.trim();
  const wantsQuestion = normalizedPrompt.includes("질문");
  const wantsSummary = normalizedPrompt.includes("요약") || normalizedPrompt.includes("핵심");
  const wantsTone =
    normalizedPrompt.includes("말투") ||
    normalizedPrompt.includes("다듬") ||
    normalizedPrompt.includes("정리");

  if (wantsQuestion) {
    return {
      messageMarkdown: "학생들이 바로 의견을 남길 수 있도록 질문형 문장으로 바꿔봤습니다.",
      suggestedTitle: baseTitle.includes("?") ? baseTitle : `${baseTitle}에 대해 의견을 나눠봅시다`,
      suggestedContentMarkdown:
        `${baseContent || "이번 주 학습 내용과 연결해 여러분의 생각을 남겨 주세요."}\n\n` +
        "여러분은 이 주제를 실제 사례에 적용한다면 어떤 점이 가장 중요하다고 생각하나요?",
      suggestionLabel: "질문형으로 반영"
    };
  }

  if (wantsSummary) {
    return {
      messageMarkdown: "게시글의 핵심이 먼저 보이도록 요약 문단을 제안했어요.",
      suggestedContentMarkdown:
        `핵심 요약: ${baseContent ? baseContent.replace(/\s+/g, " ").slice(0, 140) : "토론 주제와 참여 방법을 간단히 정리했습니다."}\n\n${baseContent}`,
      suggestionLabel: "요약 반영"
    };
  }

  if (wantsTone) {
    return {
      messageMarkdown: "학생들이 부담 없이 참여하도록 문장을 더 부드럽게 다듬었습니다.",
      suggestedContentMarkdown:
        `${baseContent || "이번 주 주제에 대해 여러분의 생각을 자유롭게 나눠 주세요."}\n\n서로의 의견을 존중하면서, 짧은 예시나 질문도 편하게 남겨 주세요.`,
      suggestionLabel: "다듬은 문장 반영"
    };
  }

  return {
    messageMarkdown:
      `현재 초안 JSON을 확인했습니다. 제목은 **${baseTitle}**, 유형은 **${draft.category}**이며 댓글은 ${draft.allowComments ? "허용" : "비허용"} 상태입니다.\n\n` +
      "원하시면 제목을 더 선명하게 바꾸거나, 학생들이 답하기 쉬운 질문형 문장으로 다듬어 드릴 수 있습니다."
  };
}

function safePositivePageCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function validPageCandidate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const page = Math.floor(value);
  return page > 0 ? page : null;
}

function validIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function latestIsoTimestamp(values: Array<string | null | undefined>): string | undefined {
  let latest: string | undefined;
  let latestTime = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time) && time > latestTime) {
      latest = new Date(time).toISOString();
      latestTime = time;
    }
  }
  return latest;
}

function clampPage(value: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return Math.max(0, Math.min(totalPages, Math.floor(value)));
}

function getAttendanceStatus(input: {
  totalLectureCount: number;
  completedLectureCount: number;
  totalReachedPages: number;
  completionRatio: number;
}): ClassroomAttendanceStatus {
  if (input.totalLectureCount === 0) return "noMaterials";
  if (input.totalReachedPages === 0) return "notStarted";
  if (input.completedLectureCount === input.totalLectureCount) return "completed";
  if (input.completionRatio < 0.4) return "needsAttention";
  return "active";
}

function computeLectureProgress(
  lecture: LectureItem,
  week: Week,
  session: SessionState | null
): ClassroomAttendanceLectureProgress {
  const totalPages = safePositivePageCount(lecture.pdf.numPages);
  const rawSession = session as unknown as {
    learningProgressPage?: unknown;
    pageStates?: Array<{ page?: unknown; lastTouchedAt?: unknown }>;
    updatedAt?: unknown;
  } | null;
  const pageStates = Array.isArray(rawSession?.pageStates) ? rawSession.pageStates : [];
  const maxReachedPage = session
    ? clampPage(resolveLearningProgressPage(session, totalPages), totalPages)
    : 0;
  const lastTouchedAt = maxReachedPage > 0
    ? latestIsoTimestamp([
        validIsoTimestamp(rawSession?.updatedAt),
        ...pageStates
          .filter((pageState) => {
            const page = validPageCandidate(pageState?.page);
            return page !== null && page <= maxReachedPage;
          })
          .map((pageState) => validIsoTimestamp(pageState?.lastTouchedAt))
      ])
    : undefined;

  return {
    lectureId: lecture.id,
    lectureTitle: lecture.title,
    weekId: week.id,
    weekTitle: week.title,
    weekIndex: week.weekIndex,
    totalPages,
    maxReachedPage,
    completed: totalPages > 0 && maxReachedPage >= totalPages,
    ...(lastTouchedAt ? { lastTouchedAt } : {})
  };
}

function summarizeAttendanceLectures(
  lectures: ClassroomAttendanceLectureProgress[]
): Pick<
  ClassroomAttendanceStudent,
  | "status"
  | "completedLectureCount"
  | "totalLectureCount"
  | "totalReachedPages"
  | "totalPages"
  | "completionRatio"
  | "pageCoverageRatio"
  | "currentWeekTitle"
  | "lastTouchedAt"
> {
  const totalLectureCount = lectures.length;
  const completedLectureCount = lectures.filter((lecture) => lecture.completed).length;
  const totalReachedPages = lectures.reduce((sum, lecture) => sum + lecture.maxReachedPage, 0);
  const totalPages = lectures.reduce((sum, lecture) => sum + lecture.totalPages, 0);
  const completionRatio = totalLectureCount > 0 ? completedLectureCount / totalLectureCount : 0;
  const pageCoverageRatio = totalPages > 0 ? totalReachedPages / totalPages : 0;
  const latestLecture = lectures
    .filter((lecture) => lecture.lastTouchedAt)
    .sort((a, b) => Date.parse(b.lastTouchedAt!) - Date.parse(a.lastTouchedAt!))[0];
  const status = getAttendanceStatus({
    totalLectureCount,
    completedLectureCount,
    totalReachedPages,
    completionRatio
  });

  return {
    status,
    completedLectureCount,
    totalLectureCount,
    totalReachedPages,
    totalPages,
    completionRatio,
    pageCoverageRatio,
    ...(latestLecture?.weekTitle ? { currentWeekTitle: latestLecture.weekTitle } : {}),
    ...(latestLecture?.lastTouchedAt ? { lastTouchedAt: latestLecture.lastTouchedAt } : {})
  };
}

async function buildClassroomAttendance(
  deps: ServerDeps,
  classroom: Classroom
): Promise<ClassroomAttendanceSummary> {
  const [enrollments, rawWeeks] = await Promise.all([
    deps.store.listEnrollmentsByClassroom(classroom.id),
    deps.store.listWeeksByClassroom(classroom.id)
  ]);
  const weeks = [...rawWeeks].sort((a, b) => {
    const weekOrder = a.weekIndex - b.weekIndex;
    if (weekOrder !== 0) return weekOrder;
    return a.title.localeCompare(b.title, "ko");
  });
  const lecturesByWeek = await deps.store.listLecturesByWeekIds(weeks.map((week) => week.id));
  const lectureRows = weeks.flatMap((week) =>
    [...(lecturesByWeek.get(week.id) ?? [])]
      .sort((a, b) => {
        const createdOrder = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        if (createdOrder !== 0) return createdOrder;
        return a.title.localeCompare(b.title, "ko");
      })
      .map((lecture) => ({ lecture, week }))
  );

  const studentRows = await Promise.all(
    [...enrollments]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(async (enrollment) => {
        const user = await deps.store.getUser(enrollment.studentUserId);
        if (!user || user.role !== "student" || !user.emailVerifiedAt) return null;
        const lectures = await Promise.all(
          lectureRows.map(async ({ lecture, week }) => {
            const session = await deps.store.getSessionByLectureForOwner(lecture.id, user.id);
            return computeLectureProgress(lecture, week, session);
          })
        );
        const summary = summarizeAttendanceLectures(lectures);
        return {
          studentUserId: user.id,
          displayName: user.displayName,
          inviteCode: user.inviteCode,
          maskedEmail: maskEmail(user.email),
          enrolledAt: enrollment.createdAt,
          ...summary,
          lectures
        };
      })
  );

  const students = studentRows
    .filter((student): student is ClassroomAttendanceStudent => Boolean(student))
    .sort((a, b) => {
      const enrollmentOrder = a.enrolledAt.localeCompare(b.enrolledAt);
      if (enrollmentOrder !== 0) return enrollmentOrder;
      return a.displayName.localeCompare(b.displayName, "ko");
    });

  return {
    totalStudents: students.length,
    activeStudentCount: students.filter((student) => student.totalReachedPages > 0).length,
    attentionStudentCount: students.filter((student) =>
      student.status === "notStarted" || student.status === "needsAttention"
    ).length,
    totalLectureCount: lectureRows.length,
    totalPages: lectureRows.reduce(
      (sum, row) => sum + safePositivePageCount(row.lecture.pdf.numPages),
      0
    ),
    weeks,
    students
  };
}

function examServiceForAttendance(deps: ServerDeps): TeacherExamService {
  return deps.examService ?? new TeacherExamService(
    deps.store,
    deps.examGradingService ?? new TeacherExamGradingService(deps.bridge),
    deps.examClock ?? new SystemExamClock(),
    deps.examLogger ?? new ConsoleExamLogger()
  );
}

function lectureAttendanceRatio(lecture: ClassroomAttendanceLectureProgress): number {
  if (lecture.totalPages <= 0) return 0;
  return Math.max(0, Math.min(1, lecture.maxReachedPage / lecture.totalPages));
}

function averageLectureAttendanceRatio(lectures: ClassroomAttendanceLectureProgress[]): number {
  if (lectures.length === 0) return 0;
  const average = lectures.reduce((sum, lecture) => sum + lectureAttendanceRatio(lecture), 0) / lectures.length;
  return Number(average.toFixed(4));
}

function completedAttendanceExams(exams: StudentClassroomAttendanceExam[]): number {
  return exams.filter((exam) => exam.participationStatus === "graded" || exam.participationStatus === "submitted").length;
}

function weekExamStatus(exams: StudentClassroomAttendanceExam[]): Pick<
  StudentClassroomAttendanceWeek,
  "examStatusLabel" | "examStatusTone"
> {
  if (exams.length === 0) {
    return { examStatusLabel: "시험 없음", examStatusTone: "none" };
  }
  const completed = completedAttendanceExams(exams);
  const inProgress = exams.filter((exam) => exam.participationStatus === "inProgress").length;
  const missed = exams.filter((exam) => exam.participationStatus === "missed").length;
  const upcoming = exams.filter((exam) => exam.participationStatus === "upcoming").length;

  if (completed === exams.length) {
    return { examStatusLabel: "시험 응시 완료", examStatusTone: "complete" };
  }
  if (inProgress > 0) {
    return { examStatusLabel: "시험 응시 중", examStatusTone: "progress" };
  }
  if (missed === exams.length) {
    return { examStatusLabel: "시험 미응시", examStatusTone: "missed" };
  }
  if (completed > 0) {
    return { examStatusLabel: `시험 ${completed}/${exams.length} 완료`, examStatusTone: "progress" };
  }
  if (upcoming === exams.length) {
    return { examStatusLabel: "시험 예정", examStatusTone: "upcoming" };
  }
  return { examStatusLabel: "시험 대기", examStatusTone: "progress" };
}

function sanitizeAttendanceExam(
  metadata: Awaited<ReturnType<TeacherExamService["studentMetadataDto"]>>,
  nowIso: string
): StudentClassroomAttendanceExam {
  const attempt = metadata.attempt;
  const hasGrading = Boolean(attempt?.grading);
  if (attempt?.status === "GRADED") {
    return {
      examId: metadata.id,
      weekId: metadata.weekId,
      title: metadata.title,
      ...(metadata.availableFrom ? { availableFrom: metadata.availableFrom } : {}),
      ...(metadata.availableUntil ? { availableUntil: metadata.availableUntil } : {}),
      ...(metadata.timeLimitMinutes ? { timeLimitMinutes: metadata.timeLimitMinutes } : {}),
      totalPoints: metadata.totalPoints,
      questionCount: metadata.questionCount,
      participationStatus: "graded",
      statusLabel: "응시 완료",
      statusTone: "complete",
      action: hasGrading
        ? { kind: "result", label: "결과 보기", to: `/exams/${metadata.id}` }
        : { kind: "disabled", label: "결과 준비 중" },
      attempt: {
        status: attempt.status,
        ...(attempt.startedAt ? { startedAt: attempt.startedAt } : {}),
        ...(attempt.submittedAt ? { submittedAt: attempt.submittedAt } : {}),
        ...(attempt.gradedAt ? { gradedAt: attempt.gradedAt } : {}),
        hasGrading
      }
    };
  }

  if (attempt?.status === "GRADING") {
    return {
      examId: metadata.id,
      weekId: metadata.weekId,
      title: metadata.title,
      ...(metadata.availableFrom ? { availableFrom: metadata.availableFrom } : {}),
      ...(metadata.availableUntil ? { availableUntil: metadata.availableUntil } : {}),
      ...(metadata.timeLimitMinutes ? { timeLimitMinutes: metadata.timeLimitMinutes } : {}),
      totalPoints: metadata.totalPoints,
      questionCount: metadata.questionCount,
      participationStatus: "submitted",
      statusLabel: "채점 중",
      statusTone: "progress",
      action: { kind: "disabled", label: "채점 중" },
      attempt: {
        status: attempt.status,
        ...(attempt.startedAt ? { startedAt: attempt.startedAt } : {}),
        ...(attempt.submittedAt ? { submittedAt: attempt.submittedAt } : {}),
        ...(attempt.gradedAt ? { gradedAt: attempt.gradedAt } : {}),
        hasGrading
      }
    };
  }

  if (attempt?.status === "IN_PROGRESS") {
    return {
      examId: metadata.id,
      weekId: metadata.weekId,
      title: metadata.title,
      ...(metadata.availableFrom ? { availableFrom: metadata.availableFrom } : {}),
      ...(metadata.availableUntil ? { availableUntil: metadata.availableUntil } : {}),
      ...(metadata.timeLimitMinutes ? { timeLimitMinutes: metadata.timeLimitMinutes } : {}),
      totalPoints: metadata.totalPoints,
      questionCount: metadata.questionCount,
      participationStatus: "inProgress",
      statusLabel: "응시 중",
      statusTone: "progress",
      action: { kind: "take", label: "시험 응시", to: `/exams/${metadata.id}` },
      attempt: {
        status: attempt.status,
        ...(attempt.startedAt ? { startedAt: attempt.startedAt } : {}),
        ...(attempt.submittedAt ? { submittedAt: attempt.submittedAt } : {}),
        ...(attempt.gradedAt ? { gradedAt: attempt.gradedAt } : {}),
        hasGrading
      }
    };
  }

  const now = Date.parse(nowIso);
  const start = Date.parse(metadata.availableFrom ?? "");
  const end = Date.parse(metadata.availableUntil ?? "");
  const scheduleStatus =
    Number.isFinite(start) && Number.isFinite(now) && now < start
      ? "upcoming"
      : Number.isFinite(end) && Number.isFinite(now) && now > end
        ? "missed"
        : "open";
  const statusLabel = scheduleStatus === "upcoming"
    ? "시험 예정"
    : scheduleStatus === "missed"
      ? "시험 미응시"
      : "시험 대기";
  const statusTone: Exclude<StudentClassroomAttendanceExamStatusTone, "none"> =
    scheduleStatus === "upcoming" ? "upcoming" : scheduleStatus === "missed" ? "missed" : "progress";
  const action: StudentClassroomAttendanceExam["action"] =
    scheduleStatus === "upcoming"
      ? { kind: "disabled", label: "시험 예정" }
      : scheduleStatus === "missed"
        ? { kind: "disabled", label: "시험 종료" }
        : { kind: "take", label: "시험 응시", to: `/exams/${metadata.id}` };

  return {
    examId: metadata.id,
    weekId: metadata.weekId,
    title: metadata.title,
    ...(metadata.availableFrom ? { availableFrom: metadata.availableFrom } : {}),
    ...(metadata.availableUntil ? { availableUntil: metadata.availableUntil } : {}),
    ...(metadata.timeLimitMinutes ? { timeLimitMinutes: metadata.timeLimitMinutes } : {}),
    totalPoints: metadata.totalPoints,
    questionCount: metadata.questionCount,
    participationStatus: scheduleStatus,
    statusLabel,
    statusTone,
    action
  };
}

async function buildStudentClassroomAttendance(
  deps: ServerDeps,
  classroom: Classroom,
  student: User
): Promise<StudentClassroomAttendanceSummary> {
  const rawWeeks = await deps.store.listWeeksByClassroom(classroom.id);
  const weeks = [...rawWeeks].sort((a, b) => {
    const weekOrder = a.weekIndex - b.weekIndex;
    if (weekOrder !== 0) return weekOrder;
    return a.title.localeCompare(b.title, "ko");
  });
  const lecturesByWeek = await deps.store.listLecturesByWeekIds(weeks.map((week) => week.id));
  const examService = examServiceForAttendance(deps);
  const nowIso = examService.nowIso();

  const weekRows = await Promise.all(
    weeks.map(async (week) => {
      const lectures = await Promise.all(
        [...(lecturesByWeek.get(week.id) ?? [])]
          .sort((a, b) => {
            const createdOrder = Date.parse(a.createdAt) - Date.parse(b.createdAt);
            if (createdOrder !== 0) return createdOrder;
            return a.title.localeCompare(b.title, "ko");
          })
          .map(async (lecture) => {
            const session = await deps.store.getSessionByLectureForOwner(lecture.id, student.id);
            return computeLectureProgress(lecture, week, session);
          })
      );
      const exams = await Promise.all(
        (await deps.store.listTeacherExamsByWeek(week.id))
          .filter((exam): exam is TeacherExam => exam.status === "PUBLISHED" && Boolean(exam.publishedRevision))
          .map(async (exam) => sanitizeAttendanceExam(
            await examService.studentMetadataDto(exam, student.id),
            nowIso
          ))
      );
      const completedExamCount = completedAttendanceExams(exams);
      const examStatus = weekExamStatus(exams);

      return {
        weekId: week.id,
        weekTitle: week.title,
        weekIndex: week.weekIndex,
        lectureCount: lectures.length,
        completedLectureCount: lectures.filter((lecture) => lecture.completed).length,
        lectureAttendanceRatio: averageLectureAttendanceRatio(lectures),
        lectures,
        examCount: exams.length,
        completedExamCount,
        inProgressExamCount: exams.filter((exam) => exam.participationStatus === "inProgress").length,
        missedExamCount: exams.filter((exam) => exam.participationStatus === "missed").length,
        ...examStatus,
        exams
      };
    })
  );
  const allLectures = weekRows.flatMap((week) => week.lectures);

  return {
    classroomId: classroom.id,
    studentUserId: student.id,
    totalWeeks: weeks.length,
    totalLectureCount: allLectures.length,
    completedLectureCount: allLectures.filter((lecture) => lecture.completed).length,
    overallAttendanceRatio: averageLectureAttendanceRatio(allLectures),
    totalExamCount: weekRows.reduce((sum, week) => sum + week.examCount, 0),
    completedExamCount: weekRows.reduce((sum, week) => sum + week.completedExamCount, 0),
    weeks: weekRows
  };
}

async function requireReportStudent(
  deps: ServerDeps,
  res: Response,
  classroom: Classroom,
  studentUserId: string
): Promise<User | null> {
  const enrolled = await deps.store.isStudentEnrolled(classroom.id, studentUserId);
  const user = enrolled ? await deps.store.getUser(studentUserId) : null;
  if (!enrolled || !user || user.role !== "student" || !user.emailVerifiedAt) {
    res.status(404).json({ ok: false, error: "Student enrollment not found" });
    return null;
  }
  return user;
}

export function classroomsRouter(deps: ServerDeps): Router {
  const router = Router();
  const reportService = new StudentCompetencyReportService(deps.store, deps.bridge);
  const criteriaAssistantService = new ReportCriteriaAssistantService();

  router.use(requireAuth, requireVerifiedEmail);

  router.get("/", async (req, res, next) => {
    try {
      const data = await deps.store.listClassroomsForUser(req.authUser!);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", requireTeacher, async (req, res, next) => {
    try {
      const title = String(req.body?.title ?? "").trim();
      if (!title) {
        res.status(400).json({ ok: false, error: "title is required" });
        return;
      }
      const data = await deps.store.createClassroom(title, req.authUser!.id);
      res.status(201).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:classroomId", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      await deps.store.deleteClassroom(classroomId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/materials", async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomReadable(deps, req, res, classroomId);
      if (!classroom) return;
      const weeks = await deps.store.listWeeksByClassroom(classroomId);
      const lecturesByWeek = await deps.store.listLecturesByWeekIds(weeks.map((week) => week.id));
      const rows = weeks.flatMap((week) =>
        (lecturesByWeek.get(week.id) ?? []).map((lecture) => ({ lecture, week }))
      );
      rows.sort((a, b) => {
        const weekOrder = a.week.weekIndex - b.week.weekIndex;
        if (weekOrder !== 0) return weekOrder;
        const createdOrder = Date.parse(a.lecture.createdAt) - Date.parse(b.lecture.createdAt);
        if (createdOrder !== 0) return createdOrder;
        return a.lecture.title.localeCompare(b.lecture.title, "ko");
      });
      res.json({ ok: true, data: rows });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/attendance", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const data = await buildClassroomAttendance(deps, classroom);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/attendance/me", async (req, res, next) => {
    try {
      if (req.authUser!.role !== "student") {
        res.status(403).json({ ok: false, error: "Student role required", code: "STUDENT_ONLY" });
        return;
      }
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const data = await buildStudentClassroomAttendance(deps, classroom, req.authUser!);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/notices", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const includeHidden = canIncludeHiddenNotices(req.authUser!, classroom);
      const notices = await deps.store.listClassroomNotices(classroom.id, { includeHidden });
      const data = await Promise.all(notices.map((notice) => serializeNotice(deps, notice)));
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/notices", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const parsed = parseNoticeInput(req.body);
      if (
        parsed.error ||
        !parsed.title ||
        !parsed.contentMarkdown ||
        !parsed.category ||
        !parsed.priority ||
        !parsed.target ||
        !parsed.status
      ) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid notice input" });
        return;
      }
      const data = await deps.store.createClassroomNotice({
        classroomId: classroom.id,
        authorUserId: req.authUser!.id,
        title: parsed.title,
        contentMarkdown: parsed.contentMarkdown,
        category: parsed.category,
        priority: parsed.priority,
        target: parsed.target,
        pinned: Boolean(parsed.pinned),
        status: parsed.status,
        publishAt: parsed.publishAt ?? undefined,
        attachments: parsed.attachments ?? []
      });
      res.status(201).json({ ok: true, data: await serializeNotice(deps, data) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/notices/:noticeId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const includeHidden = canIncludeHiddenNotices(req.authUser!, classroom);
      const notice = await deps.store.getClassroomNotice(
        classroom.id,
        String(req.params.noticeId),
        { includeHidden }
      );
      if (!notice) {
        res.status(404).json({ ok: false, error: "Notice not found" });
        return;
      }
      res.json({ ok: true, data: await serializeNotice(deps, notice) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:classroomId/notices/:noticeId", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const parsed = parseNoticeInput(req.body, { partial: true });
      if (parsed.error) {
        res.status(400).json({ ok: false, error: parsed.error });
        return;
      }
      const data = await deps.store.updateClassroomNotice(
        classroom.id,
        String(req.params.noticeId),
        parsed
      );
      if (!data) {
        res.status(404).json({ ok: false, error: "Notice not found" });
        return;
      }
      res.json({ ok: true, data: await serializeNotice(deps, data) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:classroomId/notices/:noticeId", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const deleted = await deps.store.deleteClassroomNotice(
        classroom.id,
        String(req.params.noticeId)
      );
      if (!deleted) {
        res.status(404).json({ ok: false, error: "Notice not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/notices/:noticeId/comments", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const includeHidden = canIncludeHiddenNotices(req.authUser!, classroom);
      const notice = await deps.store.getClassroomNotice(
        classroom.id,
        String(req.params.noticeId),
        { includeHidden }
      );
      if (!notice) {
        res.status(404).json({ ok: false, error: "Notice not found" });
        return;
      }
      const comments = await deps.store.listClassroomNoticeComments(classroom.id, notice.id);
      const data = await Promise.all(
        comments.map((comment) => serializeNoticeComment(deps, comment, req.authUser!, classroom))
      );
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/notices/:noticeId/comments", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const includeHidden = canIncludeHiddenNotices(req.authUser!, classroom);
      const notice = await deps.store.getClassroomNotice(
        classroom.id,
        String(req.params.noticeId),
        { includeHidden }
      );
      if (!notice) {
        res.status(404).json({ ok: false, error: "Notice not found" });
        return;
      }
      const parsed = parseCommentInput(req.body);
      if (parsed.error || !parsed.contentMarkdown) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid comment input" });
        return;
      }
      const data = await deps.store.createClassroomNoticeComment({
        classroomId: classroom.id,
        noticeId: notice.id,
        authorUserId: req.authUser!.id,
        contentMarkdown: parsed.contentMarkdown,
        parentCommentId: parsed.parentCommentId,
        visibility: { includeHidden }
      });
      if (!data.ok) {
        const messageByReason: Record<typeof data.reason, string> = {
          NOTICE_NOT_FOUND_OR_HIDDEN: "Notice not found",
          PARENT_NOT_FOUND: "답글 대상 댓글을 찾을 수 없습니다.",
          REPLY_DEPTH: "답글에는 다시 답글을 남길 수 없습니다."
        };
        res
          .status(data.reason === "NOTICE_NOT_FOUND_OR_HIDDEN" ? 404 : 400)
          .json({ ok: false, error: messageByReason[data.reason] });
        return;
      }
      res.status(201).json({
        ok: true,
        data: await serializeNoticeComment(deps, data.comment, req.authUser!, classroom)
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:classroomId/notices/:noticeId/comments/:commentId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const includeHidden = canIncludeHiddenNotices(viewer, classroom);
      const notice = await deps.store.getClassroomNotice(
        classroom.id,
        String(req.params.noticeId),
        { includeHidden }
      );
      if (!notice) {
        res.status(404).json({ ok: false, error: "Notice not found" });
        return;
      }
      const comment = await deps.store.getClassroomNoticeComment(
        classroom.id,
        notice.id,
        String(req.params.commentId)
      );
      if (!comment) {
        res.status(404).json({ ok: false, error: "Notice comment not found" });
        return;
      }
      const isOwnerTeacher = canIncludeHiddenNotices(viewer, classroom);
      if (!isOwnerTeacher && comment.authorUserId !== viewer.id) {
        res.status(403).json({ ok: false, error: "댓글 수정 권한이 없습니다." });
        return;
      }
      const parsed = parseCommentInput(req.body);
      if (parsed.error || !parsed.contentMarkdown) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid comment input" });
        return;
      }
      const updated = await deps.store.updateClassroomNoticeComment(
        classroom.id,
        notice.id,
        comment.id,
        { contentMarkdown: parsed.contentMarkdown },
        { includeHidden }
      );
      if (!updated) {
        res.status(404).json({ ok: false, error: "Notice comment not found" });
        return;
      }
      res.json({
        ok: true,
        data: await serializeNoticeComment(deps, updated, viewer, classroom)
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:classroomId/notices/:noticeId/comments/:commentId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const includeHidden = canIncludeHiddenNotices(viewer, classroom);
      const notice = await deps.store.getClassroomNotice(
        classroom.id,
        String(req.params.noticeId),
        { includeHidden }
      );
      if (!notice) {
        res.status(404).json({ ok: false, error: "Notice not found" });
        return;
      }
      const comment = await deps.store.getClassroomNoticeComment(
        classroom.id,
        notice.id,
        String(req.params.commentId)
      );
      if (!comment) {
        res.status(404).json({ ok: false, error: "Notice comment not found" });
        return;
      }
      const isOwnerTeacher = canIncludeHiddenNotices(viewer, classroom);
      if (!isOwnerTeacher && comment.authorUserId !== viewer.id) {
        res.status(403).json({ ok: false, error: "댓글 삭제 권한이 없습니다." });
        return;
      }
      const deleted = await deps.store.deleteClassroomNoticeComment(
        classroom.id,
        notice.id,
        comment.id,
        { includeHidden }
      );
      if (!deleted) {
        res.status(404).json({ ok: false, error: "Notice comment not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/discussions", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const posts = await deps.store.listClassroomDiscussions(
        classroom.id,
        discussionViewerOptions(viewer, classroom)
      );
      const data = await Promise.all(
        posts.map((post) => serializeDiscussionPost(deps, post, viewer, classroom))
      );
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/discussions", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const isOwnerTeacher = canIncludeAllDiscussions(viewer, classroom);
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      if (!isOwnerTeacher && Boolean(body.pinned)) {
        res.status(403).json({ ok: false, error: "상단 고정은 선생님만 설정할 수 있습니다." });
        return;
      }
      const parsed = parseDiscussionInput(req.body);
      if (
        parsed.error ||
        !parsed.title ||
        !parsed.contentMarkdown ||
        !parsed.category ||
        !parsed.visibility ||
        !parsed.status ||
        typeof parsed.allowComments !== "boolean"
      ) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid discussion input" });
        return;
      }
      const created = await deps.store.createClassroomDiscussion({
        classroomId: classroom.id,
        authorUserId: viewer.id,
        title: parsed.title,
        contentMarkdown: parsed.contentMarkdown,
        category: parsed.category,
        visibility: parsed.visibility,
        pinned: isOwnerTeacher ? Boolean(parsed.pinned) : false,
        anonymous: false,
        allowComments: parsed.allowComments,
        status: parsed.status,
        attachments: parsed.attachments ?? []
      });
      res.status(201).json({
        ok: true,
        data: await serializeDiscussionPost(deps, created, viewer, classroom)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/discussions/assistant/stream", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const parsed = parseDiscussionAssistantInput(req.body);
      if (parsed.error || !parsed.prompt || !parsed.draft) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid assistant input" });
        return;
      }

      const history = sanitizeDiscussionAssistantHistory(req.body);
      const safeSuggestion = buildDiscussionAssistantResponse(parsed.prompt, parsed.draft);
      const abortController = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const write = (payload: Record<string, unknown>) => {
        if (!res.destroyed && !res.writableEnded) {
          res.write(`${JSON.stringify(payload)}\n`);
        }
      };

      if (typeof deps.bridge.discussionAssistantChatStream !== "function") {
        const fallbackThought = "현재 게시글 초안 JSON과 요청을 확인했습니다.";
        write({ type: "thought_delta", text: fallbackThought });
        write({ type: "answer_delta", text: safeSuggestion.messageMarkdown });
        write({
          type: "done",
          answerText: safeSuggestion.messageMarkdown,
          thoughtSummary: fallbackThought,
          data: safeSuggestion
        });
        res.end();
        return;
      }

      const streamed = await deps.bridge.discussionAssistantChatStream(
        {
          model: appConfig.modelName,
          prompt: parsed.prompt,
          draft: parsed.draft,
          history
        },
        (delta) => {
          write({
            type: delta.channel === "thought" ? "thought_delta" : "answer_delta",
            text: delta.text
          });
        },
        abortController.signal
      );

      write({
        type: "done",
        answerText: streamed.markdown || safeSuggestion.messageMarkdown,
        thoughtSummary: streamed.thoughtSummary,
        data: safeSuggestion
      });
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        next(error);
        return;
      }
      console.error("[discussion_assistant_stream_error]", error);
      if (!res.destroyed && !res.writableEnded) {
        res.write(
          `${JSON.stringify({
            type: "error",
            error: "토론 작성 어시스턴트 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."
          })}\n`
        );
        res.end();
      }
    }
  });

  router.post("/:classroomId/discussions/assistant", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const parsed = parseDiscussionAssistantInput(req.body);
      if (parsed.error || !parsed.prompt || !parsed.draft) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid assistant input" });
        return;
      }
      res.json({
        ok: true,
        data: buildDiscussionAssistantResponse(parsed.prompt, parsed.draft)
      });
    } catch (error) {
      next(error);
    }
  });

  router.head("/:classroomId/discussions/:postId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const post = await deps.store.getClassroomDiscussion(
        classroom.id,
        String(req.params.postId),
        discussionViewerOptions(viewer, classroom)
      );
      if (!post) {
        res.status(404).end();
        return;
      }
      res.status(200).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/discussions/:postId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const post = await deps.store.getAndTouchClassroomDiscussion(
        classroom.id,
        String(req.params.postId),
        discussionViewerOptions(viewer, classroom)
      );
      if (!post) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      res.json({ ok: true, data: await serializeDiscussionPost(deps, post, viewer, classroom) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:classroomId/discussions/:postId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const isOwnerTeacher = canIncludeAllDiscussions(viewer, classroom);
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const existing = await deps.store.getClassroomDiscussion(
        classroom.id,
        String(req.params.postId),
        discussionViewerOptions(viewer, classroom)
      );
      if (!existing) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      if (!isOwnerTeacher && existing.authorUserId !== viewer.id) {
        res.status(403).json({ ok: false, error: "게시글 수정 권한이 없습니다." });
        return;
      }
      if (!isOwnerTeacher && hasOwn(body, "pinned")) {
        res.status(403).json({ ok: false, error: "상단 고정은 선생님만 수정할 수 있습니다." });
        return;
      }
      const parsed = parseDiscussionInput(req.body, { partial: true });
      if (parsed.error) {
        res.status(400).json({ ok: false, error: parsed.error });
        return;
      }
      const patch: DiscussionPatch = {
        ...parsed,
        ...(isOwnerTeacher && hasOwn(body, "pinned") ? { pinned: Boolean(parsed.pinned) } : {}),
        ...(!isOwnerTeacher ? { pinned: undefined } : {})
      };
      if (!isOwnerTeacher) {
        delete patch.pinned;
      }
      const updated = await deps.store.updateClassroomDiscussion(
        classroom.id,
        existing.id,
        patch
      );
      if (!updated) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      res.json({ ok: true, data: await serializeDiscussionPost(deps, updated, viewer, classroom) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:classroomId/discussions/:postId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const isOwnerTeacher = canIncludeAllDiscussions(viewer, classroom);
      const post = await deps.store.getClassroomDiscussion(
        classroom.id,
        String(req.params.postId),
        discussionViewerOptions(viewer, classroom)
      );
      if (!post) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      if (!isOwnerTeacher && post.authorUserId !== viewer.id) {
        res.status(403).json({ ok: false, error: "게시글 삭제 권한이 없습니다." });
        return;
      }
      const deleted = await deps.store.deleteClassroomDiscussion(classroom.id, post.id);
      if (!deleted) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/discussions/:postId/comments", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const post = await deps.store.getClassroomDiscussion(
        classroom.id,
        String(req.params.postId),
        discussionViewerOptions(viewer, classroom)
      );
      if (!post) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      const comments = await deps.store.listClassroomDiscussionComments(classroom.id, post.id);
      const data = await Promise.all(
        comments.map((comment) => serializeDiscussionComment(deps, comment, viewer, classroom))
      );
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/discussions/:postId/comments", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const parsed = parseCommentInput(req.body);
      if (parsed.error || !parsed.contentMarkdown) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid comment input" });
        return;
      }
      const result = await deps.store.createClassroomDiscussionComment({
        classroomId: classroom.id,
        postId: String(req.params.postId),
        authorUserId: viewer.id,
        contentMarkdown: parsed.contentMarkdown,
        parentCommentId: parsed.parentCommentId,
        viewerOptions: discussionViewerOptions(viewer, classroom)
      });
      if (!result.ok) {
        const messageByReason: Record<typeof result.reason, string> = {
          POST_NOT_FOUND: "Discussion post not found",
          DRAFT_POST: "임시 저장 게시글에는 댓글을 남길 수 없습니다.",
          COMMENTS_DISABLED: "이 게시글은 댓글이 허용되지 않았습니다.",
          PARENT_NOT_FOUND: "답글 대상 댓글을 찾을 수 없습니다.",
          REPLY_DEPTH: "답글에는 다시 답글을 남길 수 없습니다."
        };
        res
          .status(result.reason === "POST_NOT_FOUND" ? 404 : 400)
          .json({ ok: false, error: messageByReason[result.reason] });
        return;
      }
      res.status(201).json({
        ok: true,
        data: await serializeDiscussionComment(deps, result.comment, viewer, classroom)
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:classroomId/discussions/:postId/comments/:commentId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const isOwnerTeacher = canIncludeAllDiscussions(viewer, classroom);
      const post = await deps.store.getClassroomDiscussion(
        classroom.id,
        String(req.params.postId),
        discussionViewerOptions(viewer, classroom)
      );
      if (!post) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      const comment = await deps.store.getClassroomDiscussionComment(
        classroom.id,
        post.id,
        String(req.params.commentId)
      );
      if (!comment) {
        res.status(404).json({ ok: false, error: "Discussion comment not found" });
        return;
      }
      if (!isOwnerTeacher && comment.authorUserId !== viewer.id) {
        res.status(403).json({ ok: false, error: "댓글 수정 권한이 없습니다." });
        return;
      }
      const parsed = parseCommentInput(req.body);
      if (parsed.error || !parsed.contentMarkdown) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid comment input" });
        return;
      }
      const updated = await deps.store.updateClassroomDiscussionComment(
        classroom.id,
        post.id,
        comment.id,
        { contentMarkdown: parsed.contentMarkdown }
      );
      if (!updated) {
        res.status(404).json({ ok: false, error: "Discussion comment not found" });
        return;
      }
      res.json({
        ok: true,
        data: await serializeDiscussionComment(deps, updated, viewer, classroom)
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:classroomId/discussions/:postId/comments/:commentId", async (req, res, next) => {
    try {
      const classroom = await requireClassroomReadable(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const viewer = req.authUser!;
      const isOwnerTeacher = canIncludeAllDiscussions(viewer, classroom);
      const post = await deps.store.getClassroomDiscussion(
        classroom.id,
        String(req.params.postId),
        discussionViewerOptions(viewer, classroom)
      );
      if (!post) {
        res.status(404).json({ ok: false, error: "Discussion post not found" });
        return;
      }
      const comment = await deps.store.getClassroomDiscussionComment(
        classroom.id,
        post.id,
        String(req.params.commentId)
      );
      if (!comment) {
        res.status(404).json({ ok: false, error: "Discussion comment not found" });
        return;
      }
      if (!isOwnerTeacher && comment.authorUserId !== viewer.id) {
        res.status(403).json({ ok: false, error: "댓글 삭제 권한이 없습니다." });
        return;
      }
      const deleted = await deps.store.deleteClassroomDiscussionComment(
        classroom.id,
        post.id,
        comment.id
      );
      if (!deleted) {
        res.status(404).json({ ok: false, error: "Discussion comment not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/report", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) {
        return;
      }
      const data = await deps.store.getClassroomReport(classroomId);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/report/criteria", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const data = await deps.store.listClassroomReportCriteria(classroom.id);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/report/criteria", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const parsed = parseCriterionInput(req.body);
      if (parsed.error || !parsed.name || !parsed.description) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid criterion input" });
        return;
      }
      const data = await deps.store.createClassroomReportCriterion(classroom.id, {
        name: parsed.name,
        description: parsed.description
      });
      res.status(201).json({ ok: true, data });
    } catch (error) {
      if (error instanceof ReportCriterionDuplicateError) {
        res.status(409).json({ ok: false, error: error.message });
        return;
      }
      next(error);
    }
  });

  router.post(
    "/:classroomId/report/criteria/assistant/stream",
    requireTeacher,
    async (req, res, next) => {
      const startedAt = Date.now();
      let streamStarted = false;
      let abortLogged = false;
      let customCriteria: StudentReportCustomCriterion[] = [];
      try {
        const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
        if (!classroom) return;
        const parsedMessage = criteriaAssistantService.sanitizeMessage(req.body?.message);
        if (parsedMessage.error || !parsedMessage.message) {
          res.status(400).json({ ok: false, error: parsedMessage.error ?? "message is required" });
          return;
        }
        const message = parsedMessage.message;
        const history = criteriaAssistantService.sanitizeHistory(req.body?.history);
        const currentProposal = criteriaAssistantService.sanitizeCurrentProposal(
          req.body?.currentProposal
        );
        customCriteria = await deps.store.listClassroomReportCriteria(classroom.id);
        const abortController = new AbortController();

        res.on("close", () => {
          if (!res.writableEnded) {
            abortController.abort();
            if (!abortLogged) {
              abortLogged = true;
              deps.examLogger?.event("[report_criteria_assistant_stream_abort]", {
                classroomId: classroom.id,
                actorUserId: req.authUser!.id,
                elapsedMs: Date.now() - startedAt
              });
            }
          }
        });

        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        if (typeof res.flushHeaders === "function") {
          res.flushHeaders();
        }
        streamStarted = true;

        const write = (payload: Record<string, unknown>) => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(`${JSON.stringify(payload)}\n`);
          }
        };

        const writeStage = (
          stage: ReportCriteriaAssistantStage,
          label: string,
          progress: number,
          detail?: string
        ) => {
          write({ type: "stage", stage, label, progress, ...(detail ? { detail } : {}) });
        };

        deps.examLogger?.event("[report_criteria_assistant_stream_start]", {
          classroomId: classroom.id,
          actorUserId: req.authUser!.id,
          operationCount: customCriteria.length,
          stage: "UNDERSTANDING_REQUEST"
        });

        for (const stage of criteriaAssistantService.stages.slice(0, 3)) {
          writeStage(stage.stage, stage.label, stage.progress, stage.detail);
        }

        let safeThoughtDeltaSent = false;
        const result = await deps.bridge.reportCriteriaAssistantChatStream(
          criteriaAssistantService.buildBridgeInput({
            model: appConfig.modelName,
            message,
            history,
            currentProposal,
            customCriteria
          }) as {
            model: string;
            message: string;
            history: unknown[];
            currentProposal: unknown;
            builtInCriteria: unknown[];
            customCriteria: unknown[];
            responseJsonSchema: Record<string, unknown>;
          },
          (delta) => {
            if (delta.channel === "thought" && !safeThoughtDeltaSent) {
              safeThoughtDeltaSent = true;
              write({
                type: "thought_delta",
                text: REPORT_CRITERIA_ASSISTANT_SAFE_THOUGHT_DELTA
              });
            }
          },
          abortController.signal
        );

        for (const stage of criteriaAssistantService.stages.slice(3, 5)) {
          writeStage(stage.stage, stage.label, stage.progress, stage.detail);
        }
        const proposal = criteriaAssistantService.sanitizeProposal(result.proposal, {
          message,
          currentProposal,
          customCriteria
        });
        write({
          type: "proposal",
          data: proposal,
          thoughtSummary: REPORT_CRITERIA_ASSISTANT_SAFE_THOUGHT_SUMMARY
        });
        const complete = criteriaAssistantService.stages.at(-1)!;
        writeStage(complete.stage, complete.label, complete.progress, complete.detail);
        write({ type: "done" });
        deps.examLogger?.event("[report_criteria_assistant_stream_complete]", {
          classroomId: classroom.id,
          actorUserId: req.authUser!.id,
          operationMethods: [proposal.operation.method],
          targetCriterionId: proposal.operation.params?.targetCriterionId,
          downgradeReason: proposal.downgradeReason,
          fallback: proposal.fallback === true,
          elapsedMs: Date.now() - startedAt
        });
        res.end();
      } catch (error) {
        if (!streamStarted || !res.headersSent) {
          next(error);
          return;
        }
        if (res.destroyed || res.writableEnded) {
          return;
        }
        const message = criteriaAssistantService.sanitizeMessage(req.body?.message).message ?? "";
        const currentProposal = criteriaAssistantService.sanitizeCurrentProposal(
          req.body?.currentProposal
        );
        const fallback = criteriaAssistantService.fallbackProposal({
          message,
          currentProposal,
          customCriteria
        });
        deps.examLogger?.event("[report_criteria_assistant_stream_fallback]", {
          classroomId: String(req.params.classroomId),
          actorUserId: req.authUser?.id,
          operationMethods: [fallback.operation.method],
          targetCriterionId: fallback.operation.params?.targetCriterionId,
          downgradeReason: fallback.downgradeReason,
          fallback: true,
          elapsedMs: Date.now() - startedAt
        });
        res.write(
          `${JSON.stringify({
            type: "stage",
            stage: "READY_TO_APPLY",
            label: "복구 응답 준비",
            progress: 0.9,
            detail: "AI 응답을 가져오지 못해 안전한 초안을 준비했습니다."
          })}\n`
        );
        res.write(
          `${JSON.stringify({
            type: "proposal",
            data: fallback,
            thoughtSummary: REPORT_CRITERIA_ASSISTANT_SAFE_THOUGHT_SUMMARY
          })}\n`
        );
        res.write(
          `${JSON.stringify({
            type: "stage",
            stage: "COMPLETE",
            label: "완료",
            progress: 1
          })}\n`
        );
        res.write(`${JSON.stringify({ type: "done" })}\n`);
        res.end();
      }
    }
  );

  router.patch(
    "/:classroomId/report/criteria/:criterionId",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroom = await requireClassroomOwner(
          deps,
          req,
          res,
          String(req.params.classroomId)
        );
        if (!classroom) return;
        const parsed = parseCriterionInput(req.body, { partial: true });
        if (parsed.error) {
          res.status(400).json({ ok: false, error: parsed.error });
          return;
        }
        const data = await deps.store.updateClassroomReportCriterion(
          classroom.id,
          String(req.params.criterionId),
          parsed
        );
        if (!data) {
          res.status(404).json({ ok: false, error: "Report criterion not found" });
          return;
        }
        res.json({ ok: true, data });
      } catch (error) {
        if (error instanceof ReportCriterionDuplicateError) {
          res.status(409).json({ ok: false, error: error.message });
          return;
        }
        next(error);
      }
    }
  );

  router.delete(
    "/:classroomId/report/criteria/:criterionId",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroom = await requireClassroomOwner(
          deps,
          req,
          res,
          String(req.params.classroomId)
        );
        if (!classroom) return;
        const deleted = await deps.store.deleteClassroomReportCriterion(
          classroom.id,
          String(req.params.criterionId)
        );
        if (!deleted) {
          res.status(404).json({ ok: false, error: "Report criterion not found" });
          return;
        }
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/:classroomId/report/students", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      const [enrollments, reports] = await Promise.all([
        deps.store.listEnrollmentsByClassroom(classroom.id),
        deps.store.listStudentClassroomReports(classroom.id)
      ]);
      const reportByStudentId = new Map(
        reports
          .filter((report) => report.studentUserId)
          .map((report) => [report.studentUserId!, report])
      );
      const students = await Promise.all(
        enrollments.map(async (enrollment) => {
          const user = await deps.store.getUser(enrollment.studentUserId);
          if (!user || user.role !== "student" || !user.emailVerifiedAt) return null;
          const report = reportByStudentId.get(user.id) ?? null;
          const sourceStats = report
            ? await reportService.enrichStudentProgressStats(classroom, user.id, report.sourceStats)
            : null;
          return {
            id: user.id,
            displayName: user.displayName,
            inviteCode: user.inviteCode,
            maskedEmail: maskEmail(user.email),
            enrolledAt: enrollment.createdAt,
            reportSummary: report
              ? {
                  generatedAt: report.generatedAt,
                  overallScore: report.overallScore,
                  overallLevel: report.overallLevel,
                  generationMode: report.generationMode,
                  analysisStatus: report.analysisStatus,
                  sourceStats
                }
              : null
          };
        })
      );
      res.json({ ok: true, data: students.filter(Boolean) });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/:classroomId/report/students/:studentUserId",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroomId = String(req.params.classroomId);
        const studentUserId = String(req.params.studentUserId);
        const classroom = await requireClassroomOwner(deps, req, res, classroomId);
        if (!classroom) return;
        const student = await requireReportStudent(deps, res, classroom, studentUserId);
        if (!student) return;
        const data = await deps.store.getStudentClassroomReport(classroom.id, studentUserId);
        res.json({ ok: true, data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/:classroomId/report/students/:studentUserId/chat/stream",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroomId = String(req.params.classroomId);
        const studentUserId = String(req.params.studentUserId);
        const classroom = await requireClassroomOwner(deps, req, res, classroomId);
        if (!classroom) return;
        const student = await requireReportStudent(deps, res, classroom, studentUserId);
        if (!student) return;

        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!message) {
          res.status(400).json({ ok: false, error: "message is required" });
          return;
        }
        if (message.length > 2000) {
          res.status(400).json({ ok: false, error: "message must be 2000 characters or fewer" });
          return;
        }

        const savedReport = await deps.store.getStudentClassroomReport(classroom.id, student.id);
        if (!savedReport) {
          res.status(409).json({ ok: false, error: "Generate the selected student's report before chatting" });
          return;
        }

        const history = sanitizeStudentReportChatHistory(req.body?.history);
        const abortController = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) {
            abortController.abort();
          }
        });

        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        if (typeof res.flushHeaders === "function") {
          res.flushHeaders();
        }

        const write = (payload: Record<string, unknown>) => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(`${JSON.stringify(payload)}\n`);
          }
        };

        const data = await reportService.chatAboutStudentReportStream(
          classroom.id,
          student.id,
          {
            message,
            history
          },
          {
            signal: abortController.signal,
            onThoughtDelta: (text) => write({ type: "thought_delta", text }),
            onAnswerDelta: (text) => write({ type: "answer_delta", text })
          }
        );

        if (!data) {
          write({ type: "error", error: "Student report not found" });
          res.end();
          return;
        }

        write({
          type: "done",
          answerText: data.markdown,
          thoughtSummary: data.thoughtSummary
        });
        res.end();
      } catch (error) {
        if (!res.headersSent) {
          next(error);
          return;
        }
        if (!res.destroyed && !res.writableEnded) {
          res.write(
            `${JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Unknown student report chat stream error"
            })}\n`
          );
          res.end();
        }
      }
    }
  );

  router.post(
    "/:classroomId/report/students/:studentUserId/analyze/stream",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroomId = String(req.params.classroomId);
        const studentUserId = String(req.params.studentUserId);
        const classroom = await requireClassroomOwner(deps, req, res, classroomId);
        if (!classroom) return;
        const student = await requireReportStudent(deps, res, classroom, studentUserId);
        if (!student) return;
        const abortController = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) {
            abortController.abort();
          }
        });
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        if (typeof res.flushHeaders === "function") {
          res.flushHeaders();
        }

        const write = (payload: Record<string, unknown>) => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(`${JSON.stringify(payload)}\n`);
          }
        };

        const data = await reportService.analyzeAndSaveStudentReportStream(
          classroom.id,
          studentUserId,
          {
            signal: abortController.signal,
            onStage: (event) => write({ type: "stage", ...event }),
            onThoughtDelta: (text) => write({ type: "thought_delta", text }),
            onAnswerDelta: (text) => write({ type: "answer_delta", text })
          }
        );

        if (!data) {
          write({ type: "error", error: "Student enrollment not found" });
          res.end();
          return;
        }

        write({
          type: "final",
          data
        });
        res.end();
      } catch (error) {
        if (!res.headersSent) {
          next(error);
          return;
        }
        if (!res.destroyed && !res.writableEnded) {
          res.write(
            `${JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Unknown student report stream error"
            })}\n`
          );
          res.end();
        }
      }
    }
  );

  router.post("/:classroomId/report/analyze", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      const data = await reportService.analyzeAndSaveClassroomReport(classroomId);
      if (!data) {
        res.status(404).json({ ok: false, error: "Classroom not found" });
        return;
      }
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/report/analyze/stream", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      const abortController = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const write = (payload: Record<string, unknown>) => {
        if (!res.destroyed && !res.writableEnded) {
          res.write(`${JSON.stringify(payload)}\n`);
        }
      };

      const data = await reportService.analyzeAndSaveClassroomReportStream(
        classroomId,
        {
          signal: abortController.signal,
          onStage: (event) => write({ type: "stage", ...event }),
          onThoughtDelta: (text) => write({ type: "thought_delta", text }),
          onAnswerDelta: (text) => write({ type: "answer_delta", text })
        }
      );

      if (!data) {
        write({ type: "error", error: "Classroom not found" });
        res.end();
        return;
      }

      write({
        type: "final",
        data
      });
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        next(error);
        return;
      }
      if (!res.destroyed && !res.writableEnded) {
        res.write(
          `${JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown report stream error"
          })}\n`
        );
        res.end();
      }
    }
  });

  return router;
}
