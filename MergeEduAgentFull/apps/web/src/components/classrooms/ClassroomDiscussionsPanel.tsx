import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import {
  createClassroomDiscussion,
  createClassroomDiscussionComment,
  deleteClassroomDiscussion,
  deleteClassroomDiscussionComment,
  getClassroomDiscussion,
  getClassroomDiscussionComments,
  getClassroomDiscussions,
  streamClassroomDiscussionAssistant,
  updateClassroomDiscussion,
  updateClassroomDiscussionComment
} from "../../api/endpoints";
import type { DiscussionAssistantMessageInput } from "../../api/endpoints";
import {
  ClassroomDiscussionAttachment,
  ClassroomDiscussionCategory,
  ClassroomDiscussionComment,
  ClassroomDiscussionPayload,
  ClassroomDiscussionPatchPayload,
  ClassroomDiscussionPost,
  ClassroomDiscussionStatus,
  CurrentUser,
  DiscussionAssistantResponse
} from "../../types";

type SelectableDiscussionCategory = Exclude<ClassroomDiscussionCategory, "NOTICE">;
type DiscussionFilter = "ALL" | SelectableDiscussionCategory;
type DiscussionSort = "LATEST" | "POPULAR" | "COMMENTS" | "PINNED";

type DiscussionFormState = {
  title: string;
  contentMarkdown: string;
  category: ClassroomDiscussionCategory;
  pinned: boolean;
  anonymous: boolean;
  allowComments: boolean;
  attachments: ClassroomDiscussionAttachment[];
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  contentMarkdown: string;
  thoughtMarkdown?: string;
  thoughtOpen?: boolean;
  answerStarted?: boolean;
  thoughtManuallyToggled?: boolean;
  streaming?: boolean;
  response?: DiscussionAssistantResponse;
};

const DISCUSSION_ASSISTANT_PRESETS = [
  {
    label: "말투 다듬기",
    prompt: "현재 게시글 초안의 말투를 학생들이 부담 없이 참여할 수 있는 자연스러운 토론 톤으로 다듬어줘."
  },
  {
    label: "질문형 문장 만들기",
    prompt: "현재 게시글 초안을 학생들이 바로 댓글로 답하기 쉬운 질문형 문장으로 바꿔줘."
  },
  {
    label: "참여 안내문 추천",
    prompt: "현재 게시글 초안을 토론 안내와 참여 요청이 자연스럽게 섞인 깔끔한 형식으로 정리해줘."
  },
  {
    label: "핵심 요약 생성",
    prompt: "현재 게시글 초안의 핵심 내용을 짧게 요약하고, 학생들이 무엇을 남기면 좋을지 정리해줘."
  }
];

const CATEGORY_META: Record<ClassroomDiscussionCategory, {
  label: string;
  chip: string;
  icon: string;
  tone: string;
}> = {
  NOTICE: { label: "공지", chip: "공지", icon: "pin", tone: "notice" },
  QUESTION: { label: "질문", chip: "질문", icon: "question", tone: "question" },
  FREE: { label: "자유 토론", chip: "자유 토론", icon: "chat", tone: "free" },
  RESOURCE: { label: "자료 공유", chip: "자료 공유", icon: "folder", tone: "resource" }
};

const DISCUSSION_SELECTABLE_CATEGORIES: SelectableDiscussionCategory[] = ["QUESTION", "FREE", "RESOURCE"];
const DISCUSSION_FILTER_OPTIONS: Array<"ALL" | SelectableDiscussionCategory> = ["ALL", ...DISCUSSION_SELECTABLE_CATEGORIES];

function createDefaultForm(): DiscussionFormState {
  return {
    title: "",
    contentMarkdown: "",
    category: "FREE",
    pinned: false,
    anonymous: false,
    allowComments: true,
    attachments: []
  };
}

function formFromPost(post: ClassroomDiscussionPost): DiscussionFormState {
  return {
    title: post.title,
    contentMarkdown: post.contentMarkdown,
    category: post.category,
    pinned: post.pinned,
    anonymous: false,
    allowComments: post.allowComments,
    attachments: post.attachments ?? []
  };
}

function discussionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "토론 게시글을 처리하지 못했습니다.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatRelative(value: string): string {
  const time = new Date(value).getTime();
  const diffMs = Date.now() - time;
  if (!Number.isFinite(time) || diffMs < 0) return formatShortDate(value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return formatShortDate(value);
}

function stripMarkdown(value: string): string {
  return value.replace(/[#*_`>\-[\]()]/g, "").replace(/\s+/g, " ").trim();
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isEdited(createdAt: string, updatedAt: string): boolean {
  const createdTime = new Date(createdAt).getTime();
  const updatedTime = new Date(updatedAt).getTime();
  return Number.isFinite(createdTime) && Number.isFinite(updatedTime) && createdTime !== updatedTime;
}

function DiscussionIcon({ name }: { name: string }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false
  };

  if (name === "plus") {
    return (
      <svg {...commonProps}>
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="5.8" stroke="currentColor" strokeWidth="1.9" />
        <path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "comment") {
    return (
      <svg {...commonProps}>
        <path d="M5 6.8c0-1 .8-1.8 1.8-1.8h10.4c1 0 1.8.8 1.8 1.8v6.4c0 1-.8 1.8-1.8 1.8H12l-4.8 3.4V15H6.8c-1 0-1.8-.8-1.8-1.8V6.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M5 18.5h4l9.2-9.2a2.1 2.1 0 0 0-3-3L6 15.5l-1 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...commonProps}>
        <path d="M8 9v8M12 9v8M16 9v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M5 7h14M10 4h4l1 3H9l1-3ZM7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "eye") {
    return (
      <svg {...commonProps}>
        <path d="M3.5 12s3.1-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3.1 5.5-8.5 5.5S3.5 12 3.5 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "send") {
    return (
      <svg {...commonProps}>
        <path d="m4 12 16-7-5.4 15-3.3-6.4L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m11.3 13.6 3.2-3.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "paperclip") {
    return (
      <svg {...commonProps}>
        <path d="m8 12.5 5.9-5.9a3.3 3.3 0 0 1 4.7 4.7l-7.2 7.2a5 5 0 0 1-7.1-7.1l7.3-7.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "pin") {
    return (
      <svg {...commonProps}>
        <path d="m9 4 6 6M7 10l7 7M14 3l7 7-4 1.2-4.8 4.8L8 20.5 3.5 16l4.5-4.2L9 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "question") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9.8 9.5a2.4 2.4 0 0 1 4.6 1c0 1.8-2.4 2-2.4 3.6M12 17.2h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "folder") {
    return (
      <svg {...commonProps}>
        <path d="M4.5 7.2h6l1.8 2h7.2v8.7c0 .9-.6 1.5-1.5 1.5H6c-.9 0-1.5-.6-1.5-1.5V7.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "spark") {
    return (
      <svg {...commonProps}>
        <path d="M12 3.5 14 9l5.5 2-5.5 2-2 5.5-2-5.5-5.5-2L10 9l2-5.5ZM18 3.5l.8 2.2L21 6.5l-2.2.8L18 9.5l-.8-2.2-2.2-.8 2.2-.8L18 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DiscussionMarkdown({ content }: { content: string }) {
  return (
    <div className="discussion-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function ClassroomDiscussionsPanel({
  classroomId,
  isTeacher,
  user
}: {
  classroomId: string;
  isTeacher: boolean;
  user: CurrentUser;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const discussionMode = searchParams.get("discussionMode");
  const discussionId = searchParams.get("discussionId");
  const canCompose = discussionMode === "create" || discussionMode === "edit";
  const isEditing = discussionMode === "edit" && Boolean(discussionId);

  const [posts, setPosts] = useState<ClassroomDiscussionPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<ClassroomDiscussionPost | null>(null);
  const [comments, setComments] = useState<ClassroomDiscussionComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DiscussionFilter>("ALL");
  const [sortMode, setSortMode] = useState<DiscussionSort>("PINNED");
  const [form, setForm] = useState<DiscussionFormState>(() => createDefaultForm());
  const [formSourcePostId, setFormSourcePostId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditInput, setCommentEditInput] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantScrollTick, setAssistantScrollTick] = useState(0);
  const assistantSubmittingRef = useRef(false);
  const assistantThreadRef = useRef<HTMLDivElement | null>(null);
  const assistantScrollFrameRef = useRef<number | null>(null);
  const assistantAbortControllerRef = useRef<AbortController | null>(null);
  const activeAssistantRequestIdRef = useRef<string | null>(null);
  const activeAssistantUserMessageIdRef = useRef<string | null>(null);
  const editorCardRef = useRef<HTMLFormElement | null>(null);
  const [assistantPanelHeight, setAssistantPanelHeight] = useState<number | null>(null);

  const clearQueuedAssistantScroll = useCallback(() => {
    if (assistantScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(assistantScrollFrameRef.current);
      assistantScrollFrameRef.current = null;
    }
  }, []);

  const queueAssistantThreadScroll = useCallback(() => {
    setAssistantScrollTick((tick) => tick + 1);
  }, []);

  const clearActiveAssistantRequest = useCallback((assistantMessageId?: string) => {
    if (assistantMessageId && activeAssistantRequestIdRef.current !== assistantMessageId) return;
    assistantAbortControllerRef.current = null;
    activeAssistantRequestIdRef.current = null;
    activeAssistantUserMessageIdRef.current = null;
  }, []);

  const abortActiveAssistantRequest = useCallback(
    (options: { removeInFlightPair?: boolean; updateLoading?: boolean } = {}) => {
      const activeAssistantId = activeAssistantRequestIdRef.current;
      const activeUserId = activeAssistantUserMessageIdRef.current;
      assistantAbortControllerRef.current?.abort();

      if (options.removeInFlightPair && activeAssistantId) {
        setAssistantMessages((prev) => {
          const activeAssistant = prev.find((message) => message.id === activeAssistantId);
          if (!activeAssistant?.streaming) return prev;
          return prev.filter((message) => message.id !== activeAssistantId && message.id !== activeUserId);
        });
      }

      clearActiveAssistantRequest();
      assistantSubmittingRef.current = false;
      if (options.updateLoading) {
        setAssistantLoading(false);
      }
    },
    [clearActiveAssistantRequest]
  );

  useEffect(
    () => () => {
      assistantAbortControllerRef.current?.abort();
      clearActiveAssistantRequest();
      clearQueuedAssistantScroll();
    },
    [clearActiveAssistantRequest, clearQueuedAssistantScroll]
  );

  useEffect(() => {
    if (assistantScrollTick === 0) return;
    clearQueuedAssistantScroll();
    assistantScrollFrameRef.current = window.requestAnimationFrame(() => {
      assistantScrollFrameRef.current = null;
      const thread = assistantThreadRef.current;
      if (!thread) return;
      thread.scrollTop = thread.scrollHeight;
    });
    return clearQueuedAssistantScroll;
  }, [assistantScrollTick, clearQueuedAssistantScroll]);

  useEffect(() => {
    if (!canCompose) {
      abortActiveAssistantRequest({ removeInFlightPair: true, updateLoading: true });
    }
  }, [abortActiveAssistantRequest, canCompose]);

  useEffect(() => {
    if (!canCompose) {
      setAssistantPanelHeight(null);
      return;
    }
    const editorCard = editorCardRef.current;
    if (!editorCard) return;

    let frameId = 0;
    const updateAssistantHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const shouldLockHeight = window.matchMedia("(min-width: 1181px)").matches;
        if (!shouldLockHeight) {
          setAssistantPanelHeight(null);
          return;
        }
        const nextHeight = Math.round(editorCard.getBoundingClientRect().height * 10) / 10;
        setAssistantPanelHeight((prev) => {
          if (prev !== null && Math.abs(prev - nextHeight) <= 0.5) return prev;
          return nextHeight;
        });
      });
    };

    updateAssistantHeight();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateAssistantHeight) : null;
    observer?.observe(editorCard);
    window.addEventListener("resize", updateAssistantHeight);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", updateAssistantHeight);
    };
  }, [canCompose]);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPosts(await getClassroomDiscussions(classroomId));
    } catch (loadError) {
      setError(discussionErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [classroomId]);

  const loadDetail = useCallback(async () => {
    if (!discussionId) {
      setSelectedPost(null);
      setComments([]);
      return;
    }
    setDetailLoading(true);
    setActionError("");
    try {
      const [post, loadedComments] = await Promise.all([
        getClassroomDiscussion(classroomId, discussionId),
        getClassroomDiscussionComments(classroomId, discussionId)
      ]);
      setSelectedPost(post);
      setComments(loadedComments);
      setPosts((prev) => prev.map((item) => (item.id === post.id ? post : item)));
    } catch (loadError) {
      setSelectedPost(null);
      setComments([]);
      setActionError(discussionErrorMessage(loadError));
    } finally {
      setDetailLoading(false);
    }
  }, [classroomId, discussionId]);

  useEffect(() => {
    loadPosts().catch(console.error);
  }, [loadPosts]);

  useEffect(() => {
    if (discussionMode && !["create", "edit"].includes(discussionMode)) {
      setRoute({ discussionId: discussionId ?? undefined, replace: true });
    }
  });

  useEffect(() => {
    if (discussionMode === "edit" && !discussionId) {
      setActionError("수정할 게시글을 먼저 선택해 주세요.");
      setRoute({ replace: true });
    }
  });

  useEffect(() => {
    if (discussionId && discussionMode !== "create") {
      loadDetail().catch(console.error);
    } else {
      setSelectedPost(null);
      setComments([]);
    }
  }, [discussionId, discussionMode, loadDetail]);

  useEffect(() => {
    if (discussionMode === "create") {
      setForm(createDefaultForm());
      setFormSourcePostId(null);
      setAssistantMessages([]);
      setActionError("");
    }
  }, [discussionMode]);

  useEffect(() => {
    if (discussionMode === "edit") {
      setFormSourcePostId(null);
    }
  }, [discussionId, discussionMode]);

  useEffect(() => {
    if (isEditing && selectedPost && selectedPost.id === discussionId) {
      setForm(formFromPost(selectedPost));
      setFormSourcePostId(selectedPost.id);
      setActionError("");
    }
  }, [discussionId, isEditing, selectedPost]);

  const stats = useMemo(() => {
    const todayKey = new Date().toDateString();
    return {
      total: posts.filter((post) => post.status === "PUBLISHED").length,
      today: posts.filter((post) => new Date(post.createdAt).toDateString() === todayKey).length,
      unanswered: posts.filter((post) => post.category === "QUESTION" && post.commentCount === 0).length
    };
  }, [posts]);

  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return [...posts]
      .filter((post) => filter === "ALL" || post.category === filter)
      .filter((post) => {
        if (!normalizedQuery) return true;
        return `${post.title} ${post.contentMarkdown} ${post.authorDisplayName}`
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sortMode === "PINNED" && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sortMode === "POPULAR") return b.viewCount - a.viewCount || b.createdAt.localeCompare(a.createdAt);
        if (sortMode === "COMMENTS") return b.commentCount - a.commentCount || b.createdAt.localeCompare(a.createdAt);
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [filter, posts, query, sortMode]);

  const rootComments = comments.filter((comment) => !comment.parentCommentId);
  const repliesByParent = comments.reduce<Record<string, ClassroomDiscussionComment[]>>((acc, comment) => {
    if (comment.parentCommentId) {
      acc[comment.parentCommentId] = [...(acc[comment.parentCommentId] ?? []), comment];
    }
    return acc;
  }, {});
  const editFormReady = !isEditing || Boolean(discussionId && selectedPost?.id === discussionId && formSourcePostId === discussionId);

  function setRoute(next: {
    discussionMode?: string;
    discussionId?: string;
    replace?: boolean;
  }) {
    const params = new URLSearchParams(searchParams);
    params.set("section", "discussion");
    params.delete("mode");
    params.delete("noticeId");
    if (next.discussionMode) params.set("discussionMode", next.discussionMode);
    else params.delete("discussionMode");
    if (next.discussionId) params.set("discussionId", next.discussionId);
    else params.delete("discussionId");
    setSearchParams(params, { replace: next.replace });
  }

  function buildPayload(status: ClassroomDiscussionStatus): ClassroomDiscussionPayload {
    return {
      title: form.title.trim(),
      contentMarkdown: form.contentMarkdown.trim(),
      category: form.category,
      visibility: "CLASS",
      pinned: isTeacher ? form.pinned : false,
      anonymous: false,
      allowComments: form.allowComments,
      status,
      attachments: form.attachments
    };
  }

  function buildPatchPayload(status: ClassroomDiscussionStatus): ClassroomDiscussionPatchPayload {
    const payload = buildPayload(status);
    if (isTeacher) return payload;
    return {
      title: payload.title,
      contentMarkdown: payload.contentMarkdown,
      category: payload.category,
      visibility: payload.visibility,
      anonymous: payload.anonymous,
      allowComments: payload.allowComments,
      status: payload.status,
      attachments: payload.attachments
    };
  }

  async function savePost(status: ClassroomDiscussionStatus) {
    if (isEditing && !editFormReady) {
      setActionError("게시글 정보를 불러온 뒤 다시 시도해 주세요.");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const saved =
        isEditing && discussionId
          ? await updateClassroomDiscussion(classroomId, discussionId, buildPatchPayload(status))
          : await createClassroomDiscussion(classroomId, buildPayload(status));
      await loadPosts();
      setSelectedPost(saved);
      setRoute({ discussionId: saved.id });
    } catch (saveError) {
      setActionError(discussionErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function removePost(post: ClassroomDiscussionPost) {
    if (!post.canDelete) return;
    if (!confirm("게시글을 삭제하시겠습니까? 댓글과 답글도 함께 삭제됩니다.")) return;
    setActionError("");
    try {
      await deleteClassroomDiscussion(classroomId, post.id);
      await loadPosts();
      setRoute({});
    } catch (deleteError) {
      setActionError(discussionErrorMessage(deleteError));
    }
  }

  async function refreshSelectedPost(postId: string) {
    const [post, loadedComments] = await Promise.all([
      getClassroomDiscussion(classroomId, postId),
      getClassroomDiscussionComments(classroomId, postId)
    ]);
    setSelectedPost(post);
    setComments(loadedComments);
    setPosts((prev) => prev.map((item) => (item.id === post.id ? post : item)));
  }

  async function submitComment(parentCommentId?: string) {
    if (!selectedPost) return;
    const contentMarkdown = parentCommentId ? replyInput.trim() : commentInput.trim();
    if (!contentMarkdown) return;
    setActionError("");
    try {
      await createClassroomDiscussionComment(classroomId, selectedPost.id, {
        contentMarkdown,
        parentCommentId
      });
      setCommentInput("");
      setReplyInput("");
      setReplyTargetId(null);
      await refreshSelectedPost(selectedPost.id);
    } catch (commentError) {
      setActionError(discussionErrorMessage(commentError));
    }
  }

  async function saveCommentEdit(comment: ClassroomDiscussionComment) {
    const contentMarkdown = commentEditInput.trim();
    if (!contentMarkdown || !selectedPost) return;
    setActionError("");
    try {
      await updateClassroomDiscussionComment(classroomId, selectedPost.id, comment.id, {
        contentMarkdown
      });
      setEditingCommentId(null);
      setCommentEditInput("");
      await refreshSelectedPost(selectedPost.id);
    } catch (editError) {
      setActionError(discussionErrorMessage(editError));
    }
  }

  async function removeComment(comment: ClassroomDiscussionComment) {
    if (!selectedPost || !comment.canDelete) return;
    if (!confirm("댓글을 삭제하시겠습니까? 답글도 함께 삭제됩니다.")) return;
    setActionError("");
    try {
      await deleteClassroomDiscussionComment(classroomId, selectedPost.id, comment.id);
      await refreshSelectedPost(selectedPost.id);
    } catch (deleteError) {
      setActionError(discussionErrorMessage(deleteError));
    }
  }

  function onAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    setForm((prev) => ({
      ...prev,
      attachments: files.slice(0, 8).map((file) => ({
        id: `datt_${file.name}_${file.lastModified}`,
        name: file.name,
        size: file.size,
        mimeType: file.type || undefined
      }))
    }));
  }

  function finalizeAssistantMessage(
    message: AssistantMessage,
    final: {
      answerText?: string;
      thoughtSummary?: string;
      data?: DiscussionAssistantResponse;
    }
  ): AssistantMessage {
    const hasFinalAnswerText = Boolean(final.answerText?.trim());
    const hasFinalThoughtSummary = Boolean(final.thoughtSummary?.trim());
    const finalAnswerText = hasFinalAnswerText ? String(final.answerText) : message.contentMarkdown;
    const finalThoughtMarkdown = hasFinalThoughtSummary ? final.thoughtSummary : message.thoughtMarkdown;
    const finalIntroducesAnswer = !message.answerStarted && hasFinalAnswerText;
    const finalCreatesFirstThought = hasFinalThoughtSummary && !message.thoughtMarkdown?.trim();
    const shouldCollapseThought =
      finalIntroducesAnswer || (Boolean(message.answerStarted) && finalCreatesFirstThought);

    return {
      ...message,
      streaming: false,
      contentMarkdown: finalAnswerText,
      thoughtMarkdown: finalThoughtMarkdown,
      answerStarted: message.answerStarted || hasFinalAnswerText,
      thoughtOpen: shouldCollapseThought ? false : message.thoughtOpen,
      thoughtManuallyToggled: shouldCollapseThought ? false : message.thoughtManuallyToggled,
      response: final.data ?? message.response
    };
  }

  function toggleAssistantThought(messageId: string) {
    setAssistantMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              thoughtOpen: !Boolean(message.thoughtOpen),
              thoughtManuallyToggled: true
            }
          : message
      )
    );
  }

  async function sendAssistantPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? assistantPrompt).trim();
    if (!prompt || assistantSubmittingRef.current) return;
    abortActiveAssistantRequest({ removeInFlightPair: true });
    assistantSubmittingRef.current = true;
    setAssistantPrompt("");
    const messageTimestamp = Date.now();
    const userMessage: AssistantMessage = {
      id: `u_${messageTimestamp}`,
      role: "user",
      contentMarkdown: prompt
    };
    const assistantMessageId = `a_${messageTimestamp}`;
    const abortController = new AbortController();
    const assistantPlaceholder: AssistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      contentMarkdown: "",
      thoughtMarkdown: "",
      thoughtOpen: true,
      answerStarted: false,
      thoughtManuallyToggled: false,
      streaming: true
    };
    const history: DiscussionAssistantMessageInput[] = assistantMessages
      .filter((message) => !message.streaming && message.contentMarkdown.trim())
      .map((message) => ({
        role: message.role,
        contentMarkdown: message.contentMarkdown
      }));
    assistantAbortControllerRef.current = abortController;
    activeAssistantRequestIdRef.current = assistantMessageId;
    activeAssistantUserMessageIdRef.current = userMessage.id;
    setAssistantMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    queueAssistantThreadScroll();
    setAssistantLoading(true);
    const isActiveAssistantRequest = () =>
      activeAssistantRequestIdRef.current === assistantMessageId && !abortController.signal.aborted;
    try {
      const response = await streamClassroomDiscussionAssistant(
        classroomId,
        {
          prompt,
          history,
          draft: {
            title: form.title,
            contentMarkdown: form.contentMarkdown,
            category: form.category,
            visibility: "CLASS",
            pinned: isTeacher ? form.pinned : false,
            anonymous: false,
            allowComments: form.allowComments,
            status: "DRAFT",
            attachments: form.attachments
          }
        },
        (event) => {
          if (!isActiveAssistantRequest()) return;
          if (event.type === "thought_delta") {
            setAssistantMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? (() => {
                      const shouldKeepOpen = message.answerStarted
                        ? message.thoughtOpen
                        : message.thoughtManuallyToggled
                          ? message.thoughtOpen
                          : true;
                      return {
                        ...message,
                        thoughtMarkdown: `${message.thoughtMarkdown ?? ""}${event.text}`,
                        thoughtOpen: shouldKeepOpen
                      };
                    })()
                  : message
              )
            );
            queueAssistantThreadScroll();
          }
          if (event.type === "answer_delta") {
            setAssistantMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? (() => {
                      const firstAnswerDelta = !message.answerStarted;
                      return {
                        ...message,
                        contentMarkdown: `${message.contentMarkdown}${event.text}`,
                        answerStarted: true,
                        thoughtOpen: firstAnswerDelta ? false : message.thoughtOpen,
                        thoughtManuallyToggled: firstAnswerDelta ? false : message.thoughtManuallyToggled
                      };
                    })()
                  : message
              )
            );
            queueAssistantThreadScroll();
          }
          if (event.type === "done") {
            setAssistantMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? finalizeAssistantMessage(message, {
                      answerText: event.answerText,
                      thoughtSummary: event.thoughtSummary,
                      data: event.data
                    })
                  : message
              )
            );
            queueAssistantThreadScroll();
          }
        },
        abortController.signal
      );
      if (isActiveAssistantRequest()) {
        setAssistantMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? finalizeAssistantMessage(message, {
                  answerText: response.answerText,
                  thoughtSummary: response.thoughtSummary,
                  data: response.data
                })
              : message
          )
        );
        queueAssistantThreadScroll();
      }
    } catch (assistantError) {
      if (abortController.signal.aborted || isAbortError(assistantError) || !isActiveAssistantRequest()) return;
      setAssistantMessages((prev) => [
        ...prev.filter((message) => message.id !== assistantMessageId),
        {
          id: assistantMessageId,
          role: "assistant",
          contentMarkdown: discussionErrorMessage(assistantError),
          streaming: false
        }
      ]);
      queueAssistantThreadScroll();
    } finally {
      if (activeAssistantRequestIdRef.current === assistantMessageId) {
        setAssistantLoading(false);
        assistantSubmittingRef.current = false;
        clearActiveAssistantRequest(assistantMessageId);
      }
    }
  }

  function applyAssistantResponse(response: DiscussionAssistantResponse) {
    setForm((prev) => ({
      ...prev,
      title: response.suggestedTitle ?? prev.title,
      contentMarkdown: response.suggestedContentMarkdown ?? prev.contentMarkdown
    }));
  }

  function renderListCard(post: ClassroomDiscussionPost) {
    const meta = CATEGORY_META[post.category];
    const edited = isEdited(post.createdAt, post.updatedAt);
    return (
      <article
        key={post.id}
        className={`discussion-post-card${post.pinned ? " pinned" : ""}`}
        data-testid="discussion-post-card"
        onClick={() => setRoute({ discussionId: post.id })}
      >
        <div className={`discussion-post-icon tone-${meta.tone}`}>
          <DiscussionIcon name={post.pinned ? "pin" : meta.icon} />
        </div>
        <div className="discussion-post-body">
          <div className="discussion-post-title-row">
            <h3>{post.title}</h3>
            {post.pinned ? <span className="discussion-badge purple">상단 고정</span> : null}
            {post.status === "DRAFT" ? <span className="discussion-badge muted">임시 저장</span> : null}
            {edited ? <span className="discussion-badge muted">수정됨</span> : null}
          </div>
          <p>{stripMarkdown(post.contentMarkdown).slice(0, 118)}</p>
          <div className="discussion-author-row">
            <span className="discussion-mini-avatar">{post.authorDisplayName.charAt(0)}</span>
            <strong>{post.authorDisplayName}</strong>
            <span className={`discussion-role-chip ${post.authorRole}`}>{post.authorRole === "teacher" ? "선생님" : "학생"}</span>
            <time>{formatShortDate(post.publishedAt ?? post.createdAt)}</time>
          </div>
        </div>
        <div className="discussion-post-side">
          <span className={`discussion-category-chip tone-${meta.tone}`}>{meta.chip}</span>
          <span><DiscussionIcon name="comment" /> 댓글 {post.commentCount}</span>
          <span><DiscussionIcon name="eye" /> 조회 {post.viewCount}</span>
          <time>{formatRelative(post.updatedAt)}</time>
        </div>
        {(post.canEdit || post.canDelete) ? (
          <div className="discussion-card-actions" onClick={(event) => event.stopPropagation()}>
            {post.canEdit ? (
              <button
                type="button"
                data-testid="discussion-edit-action"
                aria-label="게시글 수정"
                onClick={() => setRoute({ discussionMode: "edit", discussionId: post.id })}
              >
                <DiscussionIcon name="edit" />
              </button>
            ) : null}
            {post.canDelete ? (
              <button
                type="button"
                className="danger"
                data-testid="discussion-delete-action"
                aria-label="게시글 삭제"
                onClick={() => removePost(post).catch(console.error)}
              >
                <DiscussionIcon name="trash" />
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }

  function renderList() {
    const hasNoViewerVisiblePosts = posts.length === 0;
    const emptyTitle = hasNoViewerVisiblePosts ? "아직 표시할 게시글이 없습니다." : "조건에 맞는 게시글이 없습니다.";
    const emptyDescription = hasNoViewerVisiblePosts
      ? "첫 토론 글을 작성해 수업 흐름을 열어보세요."
      : "검색어나 유형 필터를 바꿔 다시 확인해 보세요.";

    return (
      <section className="discussion-board-shell" data-testid="discussion-list-shell">
        <section className="discussion-hero">
          <div>
            <span className="discussion-eyebrow">소통 공간</span>
            <h1>토론 게시판</h1>
            <p>
              학생과 선생님이 질문, 의견, 토론 글과 자료를 자유롭게 올리고 댓글로 소통할 수 있습니다.
            </p>
          </div>
          <div className="discussion-hero-metrics">
            <span>
              <DiscussionIcon name="comment" />
              <small>전체 글</small>
              <strong>{stats.total}개</strong>
            </span>
            <span>
              <DiscussionIcon name="edit" />
              <small>오늘 새 글</small>
              <strong>{stats.today}개</strong>
            </span>
            <span>
              <DiscussionIcon name="question" />
              <small>미답변 질문</small>
              <strong>{stats.unanswered}개</strong>
            </span>
          </div>
          <div className="discussion-hero-visual" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>

        <div className="discussion-toolbar">
          <label className="discussion-search-field">
            <DiscussionIcon name="search" />
            <input
              value={query}
              placeholder="제목 또는 작성자로 검색"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            value={filter}
            aria-label="토론 유형"
            onChange={(event) => setFilter(event.target.value as DiscussionFilter)}
          >
            <option value="ALL">전체 유형</option>
            {DISCUSSION_SELECTABLE_CATEGORIES.map((value) => (
              <option key={value} value={value}>{CATEGORY_META[value].label}</option>
            ))}
          </select>
          <select
            value={sortMode}
            aria-label="토론 정렬"
            onChange={(event) => setSortMode(event.target.value as DiscussionSort)}
          >
            <option value="PINNED">최신순</option>
            <option value="POPULAR">조회순</option>
            <option value="COMMENTS">댓글순</option>
            <option value="LATEST">작성 최신순</option>
          </select>
          <button
            type="button"
            className="btn discussion-primary-action"
            data-testid="discussion-create-action"
            onClick={() => setRoute({ discussionMode: "create" })}
          >
            글 작성
            <DiscussionIcon name="plus" />
          </button>
        </div>

        {actionError ? <div className="alert alert-error">{actionError}</div> : null}
        {loading ? <section className="card empty-state">토론 게시글을 불러오는 중...</section> : null}
        {!loading && error ? <section className="card alert alert-error">{error}</section> : null}
        {!loading && !error ? (
          <section className="discussion-list-panel">
            <div className="discussion-list-head">
              <div>
                <h2>게시글 목록</h2>
                <p>수업 구성원이 남긴 질문과 토론 흐름을 확인하세요.</p>
              </div>
              <span>총 {filteredPosts.length}개</span>
            </div>
            <div className="discussion-category-tabs" role="group" aria-label="게시글 유형 빠른 필터">
              {DISCUSSION_FILTER_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? "active" : ""}
                  onClick={() => setFilter(item)}
                >
                  {item === "ALL" ? "전체" : CATEGORY_META[item].label}
                </button>
              ))}
            </div>
            {filteredPosts.length === 0 ? (
              <div className="discussion-empty-card">
                <DiscussionIcon name="comment" />
                <strong>{emptyTitle}</strong>
                <span>{emptyDescription}</span>
              </div>
            ) : (
              <div className="discussion-post-list">
                {filteredPosts.map(renderListCard)}
              </div>
            )}
          </section>
        ) : null}
      </section>
    );
  }

  function renderCompose() {
    const formTitle = isEditing ? "게시글 수정" : "게시글 작성";
    if (isEditing && !editFormReady) {
      return (
        <section className="discussion-compose-shell" data-testid="discussion-compose-shell">
          {actionError ? <div className="alert alert-error">{actionError}</div> : null}
          <section className="card empty-state" data-testid="discussion-edit-loading">
            {detailLoading ? "게시글 정보를 불러오는 중..." : "수정할 게시글 정보를 준비하고 있습니다."}
          </section>
        </section>
      );
    }
    const showCategoryField = form.category !== "NOTICE";
    return (
      <section className="discussion-compose-shell" data-testid="discussion-compose-shell">
        <section className="discussion-hero compose">
          <div>
            <span className="discussion-eyebrow">작성 스튜디오</span>
            <h1>{formTitle}</h1>
            <p>질문, 자유 토론, 자료 공유 글을 작성하고 게시판에 바로 등록할 수 있습니다.</p>
          </div>
          <div className="discussion-hero-metrics">
            <span>
              <DiscussionIcon name="comment" />
              <small>임시 저장</small>
              <strong>{posts.some((post) => post.status === "DRAFT" && post.authorUserId === user.id) ? "있음" : "없음"}</strong>
            </span>
            <span>
              <DiscussionIcon name="paperclip" />
              <small>첨부 파일</small>
              <strong>{form.attachments.length}개</strong>
            </span>
            <span>
              <DiscussionIcon name="spark" />
              <small>AI 도움</small>
              <strong>사용 가능</strong>
            </span>
          </div>
          <div className="discussion-hero-visual" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>

        {actionError ? <div className="alert alert-error">{actionError}</div> : null}

        <div className="discussion-compose-grid">
          <form
            ref={editorCardRef}
            className="discussion-editor-card"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              savePost("PUBLISHED").catch(console.error);
            }}
          >
            <h2>게시글 편집</h2>
            <label className="discussion-field wide">
              <span>제목</span>
              <input
                value={form.title}
                maxLength={120}
                placeholder="2주차 토론 주제 미리 의견 남겨주세요"
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />
            </label>
            <div className={`discussion-form-row ${showCategoryField ? "three" : "two"}`}>
              {showCategoryField ? (
                <label className="discussion-field">
                  <span>유형</span>
                  <select
                    aria-label="토론 글 유형"
                    value={form.category}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        category: event.target.value as SelectableDiscussionCategory
                      }))
                    }
                  >
                    {DISCUSSION_SELECTABLE_CATEGORIES.map((value) => (
                      <option key={value} value={value}>{CATEGORY_META[value].label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="discussion-field">
                <span>공개 범위</span>
                <select value="CLASS" disabled>
                  <option value="CLASS">강의실 전체</option>
                </select>
              </label>
              <label className="discussion-field">
                <span>작성자</span>
                <select value={user.id} disabled>
                  <option value={user.id}>{user.displayName}</option>
                </select>
              </label>
            </div>

            <label className="discussion-field wide">
              <span>본문</span>
              <div className="discussion-editor-toolbar" aria-hidden="true">
                <span>본문</span>
                <b>B</b>
                <i>I</i>
                <u>U</u>
                <span>•</span>
                <span>↶</span>
                <span>↷</span>
              </div>
              <textarea
                value={form.contentMarkdown}
                maxLength={12000}
                placeholder={"안녕하세요, 2주차 토론 주제에 대해 여러분의 의견을 미리 듣고 싶어요!\n\n이번 주제는 우리 일상 속 데이터 활용 사례와 윤리적 문제를 함께 생각해보는 것입니다."}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, contentMarkdown: event.target.value }))
                }
              />
              <small>{form.contentMarkdown.length} / 12000</small>
            </label>

            <div className="discussion-file-section">
              <strong>첨부 파일 <span>({form.attachments.length}/8)</span></strong>
              <label className="discussion-upload-chip">
                <input type="file" multiple onChange={onAttachmentChange} />
                <DiscussionIcon name="paperclip" />
                파일 선택
              </label>
              <div className="discussion-file-list">
                {form.attachments.map((file) => (
                  <span key={file.id}>
                    <DiscussionIcon name="paperclip" />
                    <strong>{file.name}</strong>
                    <small>{formatFileSize(file.size)}</small>
                    <button
                      type="button"
                      aria-label={`${file.name} 제거`}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          attachments: prev.attachments.filter((item) => item.id !== file.id)
                        }))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="discussion-option-grid">
              <label className="discussion-check-option">
                <input
                  type="checkbox"
                  checked={form.allowComments}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, allowComments: event.target.checked }))
                  }
                />
                <span>
                  <strong>댓글 허용</strong>
                  <small>학생들이 댓글로 참여할 수 있습니다.</small>
                </span>
              </label>
              <label className={`discussion-check-option${!isTeacher ? " disabled" : ""}`} data-testid="discussion-pin-option">
                <input
                  type="checkbox"
                  checked={isTeacher ? form.pinned : false}
                  disabled={!isTeacher}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, pinned: event.target.checked }))
                  }
                />
                <span>
                  <strong>상단 고정</strong>
                  <small>{isTeacher ? "게시글을 목록 상단에 고정합니다." : "선생님만 설정할 수 있습니다."}</small>
                </span>
              </label>
              <label className="discussion-check-option disabled">
                <input type="checkbox" checked={false} disabled />
                <span>
                  <strong>익명 허용</strong>
                  <small>익명 글쓰기는 추후 제공됩니다.</small>
                </span>
              </label>
            </div>

            <div className="discussion-compose-footer">
              <button type="button" className="btn ghost" onClick={() => setRoute({})}>
                취소
              </button>
              <button type="button" className="btn ghost strong" disabled={saving} onClick={() => savePost("DRAFT")}>
                임시 저장
              </button>
              <button type="submit" className="btn discussion-primary-action" disabled={saving}>
                {saving ? "저장 중..." : isEditing ? "수정하기" : "게시하기"}
              </button>
            </div>
          </form>

          <aside
            className="discussion-assistant-card"
            data-testid="discussion-assistant-panel"
            style={assistantPanelHeight ? { height: `${assistantPanelHeight}px` } : undefined}
          >
            <header>
              <div>
                <DiscussionIcon name="spark" />
                <div>
                  <h2>AI 작성 어시스턴트</h2>
                  <p>현재 작성 중인 게시글 JSON을 함께 읽고 도와드려요.</p>
                </div>
              </div>
              <button
                type="button"
                className="discussion-assistant-reset"
                disabled={assistantLoading || (!assistantMessages.length && !assistantPrompt.trim())}
                onClick={() => {
                  setAssistantMessages([]);
                  setAssistantPrompt("");
                }}
              >
                초기화
              </button>
            </header>
            <section className="discussion-assistant-intro">
              <span className="discussion-bot-face">AI</span>
              <p>주제 정리, 문장 다듬기, 질문 확장, 요약 작성을 도와드려요.</p>
            </section>
            <div className="discussion-assistant-presets">
              {DISCUSSION_ASSISTANT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={assistantLoading}
                  onClick={() => sendAssistantPrompt(preset.prompt).catch(console.error)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div ref={assistantThreadRef} className="discussion-assistant-thread" data-testid="discussion-assistant-thread">
              {assistantMessages.length === 0 ? (
                <div className="discussion-assistant-empty">
                  <strong>작성 중인 내용을 기반으로 더 정확한 도움을 드려요.</strong>
                  <span>예: 학생들이 의견을 남기기 쉽게 문장을 다듬어줘</span>
                </div>
              ) : (
                assistantMessages.map((message) => {
                  const thoughtBodyId = `discussion-assistant-thought-${message.id}`;
                  const hasThoughtMarkdown = Boolean(message.thoughtMarkdown?.trim());
                  const thoughtOpen = Boolean(message.thoughtOpen);
                  return (
                    <article key={message.id} className={`discussion-assistant-message ${message.role}`}>
                      {hasThoughtMarkdown ? (
                        <div
                          className={`discussion-assistant-thought${thoughtOpen ? " open" : " collapsed"}`}
                          data-testid="discussion-assistant-thought"
                        >
                          <button
                            type="button"
                            className="discussion-assistant-thought-toggle"
                            aria-expanded={thoughtOpen}
                            aria-controls={thoughtBodyId}
                            onClick={() => toggleAssistantThought(message.id)}
                          >
                            <span>사고 요약</span>
                            <span aria-hidden="true">{thoughtOpen ? "접기" : "펼치기"}</span>
                          </button>
                          <div
                            id={thoughtBodyId}
                            className="discussion-assistant-thought-body"
                            hidden={!thoughtOpen}
                          >
                            <DiscussionMarkdown content={message.thoughtMarkdown ?? ""} />
                          </div>
                        </div>
                      ) : null}
                      {message.contentMarkdown ? (
                        <DiscussionMarkdown content={message.contentMarkdown} />
                      ) : message.streaming ? (
                        <span className="discussion-assistant-stream-placeholder">응답을 작성하고 있습니다...</span>
                      ) : null}
                      {message.response?.suggestedContentMarkdown || message.response?.suggestedTitle ? (
                        <button type="button" onClick={() => applyAssistantResponse(message.response!)}>
                          {message.response.suggestionLabel ?? "본문에 반영"}
                        </button>
                      ) : null}
                    </article>
                  );
                })
              )}
              {assistantLoading ? <div className="discussion-assistant-loading">AI가 초안을 살펴보는 중...</div> : null}
            </div>
            <div className="discussion-assistant-input">
              <textarea
                value={assistantPrompt}
                placeholder="AI에게 작성 도움 요청하기"
                onChange={(event) => setAssistantPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    sendAssistantPrompt().catch(console.error);
                  }
                }}
              />
              <button
                type="button"
                className="discussion-send-btn"
                disabled={assistantLoading || !assistantPrompt.trim()}
                onClick={() => sendAssistantPrompt().catch(console.error)}
                aria-label="AI에게 작성 도움 요청하기"
              >
                <DiscussionIcon name="send" />
              </button>
            </div>
            <small>작성 중인 내용을 기반으로 더 정확한 도움을 드려요.</small>
          </aside>
        </div>
      </section>
    );
  }

  function renderComment(comment: ClassroomDiscussionComment, depth = 0) {
    const editing = editingCommentId === comment.id;
    return (
      <article key={comment.id} className={`discussion-comment${depth > 0 ? " reply" : ""}`} data-testid="discussion-comment">
        <div className="discussion-comment-avatar">{comment.authorDisplayName.charAt(0)}</div>
        <div className="discussion-comment-main">
          <div className="discussion-comment-head">
            <strong>{comment.authorDisplayName}</strong>
            <span>{comment.authorRole === "teacher" ? "선생님" : "학생"}</span>
            <time>{formatShortDate(comment.updatedAt)}</time>
            {isEdited(comment.createdAt, comment.updatedAt) ? <span>수정됨</span> : null}
          </div>
          {editing ? (
            <div className="discussion-comment-edit">
              <input
                value={commentEditInput}
                onChange={(event) => setCommentEditInput(event.target.value)}
              />
              <button className="btn discussion-primary-action" type="button" onClick={() => saveCommentEdit(comment).catch(console.error)}>
                저장
              </button>
              <button className="btn ghost" type="button" onClick={() => setEditingCommentId(null)}>
                취소
              </button>
            </div>
          ) : (
            <p>{comment.contentMarkdown}</p>
          )}
          <div className="discussion-comment-actions">
            {depth === 0 ? (
              <button
                type="button"
                onClick={() => {
                  setReplyTargetId(comment.id);
                  setReplyInput("");
                }}
              >
                답글
              </button>
            ) : null}
            {comment.canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setEditingCommentId(comment.id);
                  setCommentEditInput(comment.contentMarkdown);
                }}
              >
                수정
              </button>
            ) : null}
            {comment.canDelete ? (
              <button type="button" className="danger" onClick={() => removeComment(comment).catch(console.error)}>
                삭제
              </button>
            ) : null}
          </div>
          {replyTargetId === comment.id ? (
            <div className="discussion-reply-box">
              <input
                data-testid="discussion-reply-input"
                value={replyInput}
                placeholder="답글을 입력하세요..."
                onChange={(event) => setReplyInput(event.target.value)}
              />
              <button className="btn discussion-primary-action" type="button" onClick={() => submitComment(comment.id).catch(console.error)}>
                등록
              </button>
            </div>
          ) : null}
          {(repliesByParent[comment.id] ?? []).map((reply) => renderComment(reply, depth + 1))}
        </div>
      </article>
    );
  }

  function renderDetail() {
    if (detailLoading) {
      return <section className="card empty-state">게시글 상세를 불러오는 중...</section>;
    }
    if (!selectedPost) {
      return (
        <section className="discussion-detail-shell" data-testid="discussion-detail-shell">
          {actionError ? <div className="alert alert-error">{actionError}</div> : null}
          <button className="btn ghost" onClick={() => setRoute({})}>목록으로 돌아가기</button>
        </section>
      );
    }
    const meta = CATEGORY_META[selectedPost.category];
    return (
      <section className="discussion-detail-shell" data-testid="discussion-detail-shell">
        <button className="discussion-back-btn" onClick={() => setRoute({})}>← 목록으로 돌아가기</button>
        {actionError ? <div className="alert alert-error">{actionError}</div> : null}
        <article className="discussion-detail-card">
          <header className="discussion-detail-head">
            <div>
              <span className={`discussion-category-chip tone-${meta.tone}`}>{meta.chip}</span>
              {selectedPost.pinned ? <span className="discussion-badge purple">상단 고정</span> : null}
              {isEdited(selectedPost.createdAt, selectedPost.updatedAt) ? <span className="discussion-badge muted">수정됨</span> : null}
              <h2>{selectedPost.title}</h2>
              <div className="discussion-author-row">
                <span className="discussion-mini-avatar">{selectedPost.authorDisplayName.charAt(0)}</span>
                <strong>{selectedPost.authorDisplayName}</strong>
                <span className={`discussion-role-chip ${selectedPost.authorRole}`}>{selectedPost.authorRole === "teacher" ? "선생님" : "학생"}</span>
                <time>{formatShortDate(selectedPost.updatedAt)}</time>
              </div>
            </div>
            <div className="discussion-detail-actions">
              <span><DiscussionIcon name="comment" /> 댓글 {selectedPost.commentCount}</span>
              <span><DiscussionIcon name="eye" /> 조회 {selectedPost.viewCount}</span>
              {selectedPost.canEdit ? (
                <button className="btn ghost" onClick={() => setRoute({ discussionMode: "edit", discussionId: selectedPost.id })}>
                  <DiscussionIcon name="edit" />
                  수정
                </button>
              ) : null}
              {selectedPost.canDelete ? (
                <button className="btn danger" onClick={() => removePost(selectedPost).catch(console.error)}>
                  <DiscussionIcon name="trash" />
                  삭제
                </button>
              ) : null}
            </div>
          </header>
          <DiscussionMarkdown content={selectedPost.contentMarkdown} />
          {selectedPost.attachments.length > 0 ? (
            <div className="discussion-detail-files">
              <strong>첨부 파일 {selectedPost.attachments.length}</strong>
              {selectedPost.attachments.map((file) => (
                <span className="discussion-detail-file-row" key={file.id}>
                  <DiscussionIcon name="paperclip" />
                  <span className="discussion-detail-file-name">{file.name}</span>
                  <small>{formatFileSize(file.size)}</small>
                </span>
              ))}
            </div>
          ) : null}
        </article>

        <section className="discussion-comments-section">
          <h3>댓글 <span>{comments.length}</span></h3>
          {selectedPost.allowComments && selectedPost.status === "PUBLISHED" ? (
            <div className="discussion-comment-compose">
              <span className="discussion-comment-avatar">{user.displayName.charAt(0)}</span>
              <input
                data-testid="discussion-comment-input"
                value={commentInput}
                placeholder="댓글을 입력하세요..."
                onChange={(event) => setCommentInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitComment().catch(console.error);
                }}
              />
              <button className="btn discussion-primary-action" onClick={() => submitComment().catch(console.error)}>
                등록
              </button>
            </div>
          ) : (
            <div className="discussion-comment-disabled">이 게시글은 댓글을 받을 수 없습니다.</div>
          )}
          <div className="discussion-comment-list">
            {rootComments.length === 0 ? (
              <div className="discussion-empty-card">아직 댓글이 없습니다.</div>
            ) : (
              rootComments.map((comment) => renderComment(comment))
            )}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="classroom-discussions-panel" data-testid="classroom-discussions-panel">
      {canCompose ? renderCompose() : discussionId ? renderDetail() : renderList()}
    </section>
  );
}
