import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import {
  ClassroomNoticePayload,
  createClassroomNotice,
  createClassroomNoticeComment,
  deleteClassroomNotice,
  deleteClassroomNoticeComment,
  getClassroomNotice,
  getClassroomNoticeComments,
  getClassroomNotices,
  updateClassroomNotice,
  updateClassroomNoticeComment
} from "../../api/endpoints";
import {
  ClassroomNotice,
  ClassroomNoticeAttachment,
  ClassroomNoticeCategory,
  ClassroomNoticeComment,
  ClassroomNoticePriority,
  ClassroomNoticeStatus,
  CurrentUser
} from "../../types";

type NoticeFilter = "ALL" | "IMPORTANT" | "SCHEDULED" | "RECENT";
type SortMode = "LATEST" | "IMPORTANT";

const NOTICE_FILTER_OPTIONS: Array<[NoticeFilter, string]> = [
  ["ALL", "전체"],
  ["IMPORTANT", "중요"],
  ["SCHEDULED", "예약"],
  ["RECENT", "최근"]
];

type NoticeFormState = {
  title: string;
  contentMarkdown: string;
  category: ClassroomNoticeCategory;
  priority: ClassroomNoticePriority;
  pinned: boolean;
  immediate: boolean;
  scheduledDate: string;
  scheduledTime: string;
  attachments: ClassroomNoticeAttachment[];
};

const CATEGORY_LABELS: Record<ClassroomNoticeCategory, string> = {
  GENERAL: "일반 공지",
  EXAM: "시험/평가",
  MATERIAL: "학습자료",
  DISCUSSION: "토론",
  ASSIGNMENT: "과제"
};

const CATEGORY_BADGES: Record<ClassroomNoticeCategory, string> = {
  GENERAL: "공지",
  EXAM: "시험/평가",
  MATERIAL: "학습자료",
  DISCUSSION: "토론",
  ASSIGNMENT: "과제"
};

const PRIORITY_LABELS: Record<ClassroomNoticePriority, string> = {
  NORMAL: "보통",
  IMPORTANT: "중요"
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createDefaultForm(): NoticeFormState {
  const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000);
  scheduled.setMinutes(0, 0, 0);
  return {
    title: "",
    contentMarkdown: "",
    category: "GENERAL",
    priority: "NORMAL",
    pinned: false,
    immediate: true,
    scheduledDate: dateInputValue(scheduled),
    scheduledTime: timeInputValue(scheduled),
    attachments: []
  };
}

function formFromNotice(notice: ClassroomNotice): NoticeFormState {
  const publishDate = notice.publishAt ? new Date(notice.publishAt) : new Date();
  return {
    title: notice.title,
    contentMarkdown: notice.contentMarkdown,
    category: notice.category,
    priority: notice.priority,
    pinned: notice.pinned,
    immediate: !notice.publishAt,
    scheduledDate: dateInputValue(publishDate),
    scheduledTime: timeInputValue(publishDate),
    attachments: notice.attachments ?? []
  };
}

function formatDateTime(value?: string): string {
  if (!value) return "즉시";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isScheduledNotice(notice: ClassroomNotice): boolean {
  return Boolean(notice.publishAt && notice.publishAt > new Date().toISOString());
}

function groupNotice(notice: ClassroomNotice): string {
  const created = new Date(notice.createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  if (diffMs >= 0 && diffMs < 60 * 60 * 1000) return "방금";
  if (created.toDateString() === now.toDateString()) return "오늘";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (created.toDateString() === yesterday.toDateString()) return "어제";
  return "이전";
}

function noticeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "공지사항을 처리하지 못했습니다.";
}

function isRecoverableCommentStaleError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 403 || error.status === 404) return true;
  if (error.status !== 400) return false;
  return error.message.includes("답글 대상 댓글") || error.message.includes("답글에는 다시 답글");
}

function NoticeIcon({ name }: { name: string }) {
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
  if (name === "pin") {
    return (
      <svg {...commonProps}>
        <path d="m9 4 6 6M7 10l7 7M14 3l7 7-4 1.2-4.8 4.8L8 20.5 3.5 16l4.5-4.2L9 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...commonProps}>
        <path d="m20 20-4.2-4.2M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M5 18.5h4l9.3-9.3a2.1 2.1 0 0 0-3-3L6 15.5l-1 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
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
  if (name === "comment") {
    return (
      <svg {...commonProps}>
        <path d="M5 6.8c0-1 .8-1.8 1.8-1.8h10.4c1 0 1.8.8 1.8 1.8v6.4c0 1-.8 1.8-1.8 1.8h-5.4l-4.6 3.4V15H6.8c-1 0-1.8-.8-1.8-1.8V6.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
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
  if (name === "send") {
    return (
      <svg {...commonProps}>
        <path d="m4 12 16-7-5.5 15-3.2-6.4L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m11.2 13.6 3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "eye") {
    return (
      <svg {...commonProps}>
        <path d="M3.5 12s3-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3 5.5-8.5 5.5S3.5 12 3.5 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function NoticeMarkdown({ content }: { content: string }) {
  return (
    <div className="notice-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function ClassroomNoticesPanel({
  classroomId,
  isTeacher,
  user
}: {
  classroomId: string;
  isTeacher: boolean;
  user: CurrentUser;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get("mode");
  const noticeId = searchParams.get("noticeId");
  const canCompose = isTeacher && (mode === "create" || mode === "edit");
  const isEditing = canCompose && mode === "edit" && Boolean(noticeId);

  const [notices, setNotices] = useState<ClassroomNotice[]>([]);
  const [selectedNotice, setSelectedNotice] = useState<ClassroomNotice | null>(null);
  const [comments, setComments] = useState<ClassroomNoticeComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [permissionNotice, setPermissionNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NoticeFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("LATEST");
  const [form, setForm] = useState<NoticeFormState>(() => createDefaultForm());
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditInput, setCommentEditInput] = useState("");
  const currentNoticeIdRef = useRef<string | null>(noticeId);
  const replyTargetIdRef = useRef<string | null>(replyTargetId);
  const pendingCommentSubmitKeysRef = useRef<Set<string>>(new Set());
  const [pendingCommentSubmitKeys, setPendingCommentSubmitKeys] = useState<Set<string>>(() => new Set());

  const loadNotices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setNotices(await getClassroomNotices(classroomId));
    } catch (loadError) {
      setError(noticeErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [classroomId]);

  const loadNoticeDetail = useCallback(async () => {
    if (!noticeId) {
      setSelectedNotice(null);
      setComments([]);
      return;
    }
    setDetailLoading(true);
    setActionError("");
    try {
      const [notice, loadedComments] = await Promise.all([
        getClassroomNotice(classroomId, noticeId),
        getClassroomNoticeComments(classroomId, noticeId)
      ]);
      setSelectedNotice(notice);
      setComments(loadedComments);
    } catch (loadError) {
      setSelectedNotice(null);
      setComments([]);
      setActionError(noticeErrorMessage(loadError));
    } finally {
      setDetailLoading(false);
    }
  }, [classroomId, noticeId]);

  useEffect(() => {
    currentNoticeIdRef.current = noticeId;
  }, [noticeId]);

  useEffect(() => {
    replyTargetIdRef.current = replyTargetId;
  }, [replyTargetId]);

  useEffect(() => {
    loadNotices().catch(console.error);
  }, [loadNotices]);

  useEffect(() => {
    if (!isTeacher && (mode === "create" || mode === "edit")) {
      setPermissionNotice("공지사항 작성 권한이 없습니다.");
      return;
    }
    setPermissionNotice("");
  }, [isTeacher, mode]);

  useEffect(() => {
    if (!isTeacher && filter === "SCHEDULED") {
      setFilter("ALL");
    }
  }, [filter, isTeacher]);

  useEffect(() => {
    if (noticeId) {
      loadNoticeDetail().catch(console.error);
    } else {
      setSelectedNotice(null);
      setComments([]);
    }
  }, [noticeId, loadNoticeDetail]);

  useEffect(() => {
    if (mode === "create" && isTeacher) {
      setForm(createDefaultForm());
      setShowPreview(false);
      setActionError("");
    }
  }, [mode, isTeacher]);

  useEffect(() => {
    if (isEditing && selectedNotice) {
      setForm(formFromNotice(selectedNotice));
      setShowPreview(false);
      setActionError("");
    }
  }, [isEditing, selectedNotice]);

  const stats = useMemo(() => {
    const scheduled = notices.filter(isScheduledNotice).length;
    const important = notices.filter((notice) => notice.priority === "IMPORTANT").length;
    const commentsTotal = notices.reduce((sum, notice) => sum + notice.commentCount, 0);
    return {
      total: notices.length,
      important,
      scheduled,
      commentsTotal
    };
  }, [notices]);

  const noticeFilterOptions = useMemo(
    () => NOTICE_FILTER_OPTIONS.filter(([id]) => isTeacher || id !== "SCHEDULED"),
    [isTeacher]
  );

  const filteredNotices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = notices.filter((notice) => {
      const matchesQuery = normalizedQuery
        ? `${notice.title} ${notice.contentMarkdown}`.toLowerCase().includes(normalizedQuery)
        : true;
      const matchesFilter =
        filter === "ALL" ||
        (filter === "IMPORTANT" && notice.priority === "IMPORTANT") ||
        (filter === "SCHEDULED" && isScheduledNotice(notice)) ||
        (filter === "RECENT" && Date.now() - new Date(notice.createdAt).getTime() < 24 * 60 * 60 * 1000);
      return matchesQuery && matchesFilter;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "IMPORTANT" && a.priority !== b.priority) {
        return a.priority === "IMPORTANT" ? -1 : 1;
      }
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [filter, notices, query, sortMode]);

  const groupedNotices = useMemo(() => {
    const groups = new Map<string, ClassroomNotice[]>();
    for (const notice of filteredNotices) {
      const label = groupNotice(notice);
      groups.set(label, [...(groups.get(label) ?? []), notice]);
    }
    return Array.from(groups.entries());
  }, [filteredNotices]);

  const rootComments = comments.filter((comment) => !comment.parentCommentId);
  const repliesByParent = comments.reduce<Record<string, ClassroomNoticeComment[]>>((acc, comment) => {
    if (comment.parentCommentId) {
      acc[comment.parentCommentId] = [...(acc[comment.parentCommentId] ?? []), comment];
    }
    return acc;
  }, {});

  function setRoute(next: { mode?: string; noticeId?: string }) {
    const params = new URLSearchParams(searchParams);
    params.set("section", "notices");
    if (next.mode) params.set("mode", next.mode);
    else params.delete("mode");
    if (next.noticeId) params.set("noticeId", next.noticeId);
    else params.delete("noticeId");
    currentNoticeIdRef.current = next.noticeId ?? null;
    setSearchParams(params);
  }

  function commentSubmitKey(targetNoticeId: string, parentCommentId?: string): string {
    return parentCommentId
      ? `notice:${targetNoticeId}:reply:${parentCommentId}`
      : `notice:${targetNoticeId}:root`;
  }

  function setCommentSubmitPending(key: string, pending: boolean) {
    const next = new Set(pendingCommentSubmitKeysRef.current);
    if (pending) next.add(key);
    else next.delete(key);
    pendingCommentSubmitKeysRef.current = next;
    setPendingCommentSubmitKeys(next);
  }

  function isCommentSubmitPending(targetNoticeId: string, parentCommentId?: string): boolean {
    return pendingCommentSubmitKeys.has(commentSubmitKey(targetNoticeId, parentCommentId));
  }

  function shouldReflectCommentSubmitResult(targetNoticeId: string, parentCommentId?: string): boolean {
    if (currentNoticeIdRef.current !== targetNoticeId) return false;
    return parentCommentId ? replyTargetIdRef.current === parentCommentId : true;
  }

  function updateReplyTargetId(nextReplyTargetId: string | null) {
    replyTargetIdRef.current = nextReplyTargetId;
    setReplyTargetId(nextReplyTargetId);
  }

  function resetCommentTransientState() {
    setEditingCommentId(null);
    setCommentEditInput("");
    updateReplyTargetId(null);
    setReplyInput("");
  }

  async function refreshSelectedNotice(nextNoticeId: string) {
    try {
      const [notice, loadedComments] = await Promise.all([
        getClassroomNotice(classroomId, nextNoticeId),
        getClassroomNoticeComments(classroomId, nextNoticeId)
      ]);
      setNotices((prev) => prev.map((item) => (item.id === notice.id ? notice : item)));
      if (currentNoticeIdRef.current !== nextNoticeId) return;
      setSelectedNotice(notice);
      setComments(loadedComments);
    } catch (refreshError) {
      if (refreshError instanceof ApiError && refreshError.status === 404) {
        setNotices((prev) => prev.filter((item) => item.id !== nextNoticeId));
        if (currentNoticeIdRef.current === nextNoticeId) {
          resetCommentTransientState();
          setSelectedNotice(null);
          setComments([]);
          setRoute({});
        }
        return;
      }
      throw refreshError;
    }
  }

  async function recoverCommentStateAfterStaleError(nextNoticeId: string, parentCommentId?: string) {
    if (shouldReflectCommentSubmitResult(nextNoticeId, parentCommentId)) {
      resetCommentTransientState();
    }
    try {
      await refreshSelectedNotice(nextNoticeId);
    } catch (refreshError) {
      if (currentNoticeIdRef.current === nextNoticeId) throw refreshError;
    }
  }

  function buildPayload(status: ClassroomNoticeStatus): ClassroomNoticePayload {
    const publishAt = form.immediate
      ? null
      : new Date(`${form.scheduledDate}T${form.scheduledTime}:00`).toISOString();
    return {
      title: form.title.trim(),
      contentMarkdown: form.contentMarkdown.trim(),
      category: form.category,
      priority: form.priority,
      target: "CLASS",
      pinned: form.pinned,
      status,
      publishAt,
      attachments: form.attachments
    };
  }

  async function saveNotice(status: ClassroomNoticeStatus) {
    setSaving(true);
    setActionError("");
    try {
      const payload = buildPayload(status);
      const saved =
        isEditing && noticeId
          ? await updateClassroomNotice(classroomId, noticeId, payload)
          : await createClassroomNotice(classroomId, payload);
      await loadNotices();
      setSelectedNotice(saved);
      setRoute({ noticeId: saved.id });
    } catch (saveError) {
      setActionError(noticeErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function removeNotice(notice: ClassroomNotice) {
    if (!isTeacher) return;
    if (!confirm("공지사항을 삭제하시겠습니까?")) return;
    setActionError("");
    try {
      await deleteClassroomNotice(classroomId, notice.id);
      await loadNotices();
      setRoute({});
    } catch (deleteError) {
      setActionError(noticeErrorMessage(deleteError));
    }
  }

  async function submitComment(parentCommentId?: string) {
    const targetNotice = selectedNotice;
    if (!targetNotice) return;
    const targetNoticeId = targetNotice.id;
    const submitKey = commentSubmitKey(targetNoticeId, parentCommentId);
    if (pendingCommentSubmitKeysRef.current.has(submitKey)) return;
    const contentMarkdown = parentCommentId ? replyInput.trim() : commentInput.trim();
    if (!contentMarkdown) return;
    setActionError("");
    setCommentSubmitPending(submitKey, true);
    try {
      const createdComment = await createClassroomNoticeComment(classroomId, targetNoticeId, {
        contentMarkdown,
        parentCommentId
      });
      const shouldReflectCreatedComment = shouldReflectCommentSubmitResult(targetNoticeId, parentCommentId);
      if (currentNoticeIdRef.current === targetNoticeId) {
        setComments((prev) =>
          prev.some((comment) => comment.id === createdComment.id)
            ? prev
            : [...prev, createdComment]
        );
        setSelectedNotice((prev) =>
          prev && prev.id === targetNoticeId
            ? { ...prev, commentCount: prev.commentCount + 1 }
            : prev
        );
        setNotices((prev) =>
          prev.map((notice) =>
            notice.id === targetNoticeId
              ? { ...notice, commentCount: notice.commentCount + 1 }
              : notice
          )
        );
        if (parentCommentId) {
          if (shouldReflectCreatedComment) {
            setReplyInput("");
            updateReplyTargetId(null);
          }
        } else {
          setCommentInput("");
        }
      }
      try {
        await refreshSelectedNotice(targetNoticeId);
      } catch (refreshError) {
        if (shouldReflectCreatedComment) {
          setActionError(`댓글은 등록됐지만 최신 댓글 목록을 새로고침하지 못했습니다. ${noticeErrorMessage(refreshError)}`);
        }
      }
    } catch (commentError) {
      const shouldReflectCommentError = shouldReflectCommentSubmitResult(targetNoticeId, parentCommentId);
      if (isRecoverableCommentStaleError(commentError)) {
        try {
          await recoverCommentStateAfterStaleError(targetNoticeId, parentCommentId);
        } catch (recoverError) {
          if (shouldReflectCommentError) {
            setActionError(noticeErrorMessage(recoverError));
          }
          return;
        }
      }
      if (shouldReflectCommentError) {
        setActionError(noticeErrorMessage(commentError));
      }
    } finally {
      setCommentSubmitPending(submitKey, false);
    }
  }

  async function saveCommentEdit(comment: ClassroomNoticeComment) {
    if (!selectedNotice) return;
    const contentMarkdown = commentEditInput.trim();
    if (!contentMarkdown) return;
    setActionError("");
    try {
      await updateClassroomNoticeComment(classroomId, selectedNotice.id, comment.id, {
        contentMarkdown
      });
      resetCommentTransientState();
      await refreshSelectedNotice(selectedNotice.id);
    } catch (editError) {
      if (editError instanceof ApiError && (editError.status === 403 || editError.status === 404)) {
        await recoverCommentStateAfterStaleError(selectedNotice.id);
      }
      setActionError(noticeErrorMessage(editError));
    }
  }

  async function removeComment(comment: ClassroomNoticeComment) {
    if (!selectedNotice) return;
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    setActionError("");
    try {
      await deleteClassroomNoticeComment(classroomId, selectedNotice.id, comment.id);
      resetCommentTransientState();
      await refreshSelectedNotice(selectedNotice.id);
    } catch (deleteError) {
      if (
        deleteError instanceof ApiError &&
        (deleteError.status === 403 || deleteError.status === 404)
      ) {
        await recoverCommentStateAfterStaleError(selectedNotice.id);
      }
      setActionError(noticeErrorMessage(deleteError));
    }
  }

  function onAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    setForm((prev) => ({
      ...prev,
      attachments: files.map((file) => ({
        id: `att_${file.name}_${file.lastModified}`,
        name: file.name,
        size: file.size,
        mimeType: file.type || undefined
      }))
    }));
  }

  function renderNoticeCard(notice: ClassroomNotice) {
    return (
      <article
        key={notice.id}
        className={`notice-card${notice.priority === "IMPORTANT" ? " important" : ""}`}
        data-testid="notice-card"
        onClick={() => setRoute({ noticeId: notice.id })}
      >
        <div className="notice-card-leading">
          <span className="notice-pin-badge">
            <NoticeIcon name={notice.priority === "IMPORTANT" ? "pin" : "comment"} />
          </span>
        </div>
        <div className="notice-card-body">
          <div className="notice-card-title-row">
            <h3>{notice.title}</h3>
            {notice.priority === "IMPORTANT" ? <span className="notice-badge purple">중요</span> : null}
            {isScheduledNotice(notice) ? <span className="notice-badge">예약</span> : null}
            {notice.status === "DRAFT" ? <span className="notice-badge muted">임시저장</span> : null}
          </div>
          <p>{notice.contentMarkdown.replace(/[#*_`>-]/g, "").slice(0, 120)}</p>
          <div className="notice-card-meta">
            <span>전체 학생</span>
            <span className="notice-badge soft">{CATEGORY_BADGES[notice.category]}</span>
            {notice.attachments.length > 0 ? (
              <span>
                <NoticeIcon name="paperclip" />
                {notice.attachments.length}
              </span>
            ) : null}
            <span>
              <NoticeIcon name="comment" />
              {notice.commentCount}
            </span>
          </div>
        </div>
        <div className="notice-card-side">
          <time>{formatShortTime(notice.publishedAt ?? notice.createdAt)}</time>
          {isTeacher ? (
            <div className="notice-inline-actions">
              <button
                type="button"
                className="notice-icon-action"
                data-testid="notice-edit-action"
                aria-label="공지사항 수정"
                onClick={(event) => {
                  event.stopPropagation();
                  setRoute({ mode: "edit", noticeId: notice.id });
                }}
              >
                <NoticeIcon name="edit" />
              </button>
              <button
                type="button"
                className="notice-icon-action danger"
                data-testid="notice-delete-action"
                aria-label="공지사항 삭제"
                onClick={(event) => {
                  event.stopPropagation();
                  removeNotice(notice).catch(console.error);
                }}
              >
                <NoticeIcon name="trash" />
              </button>
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  function renderList() {
    return (
      <section className="notice-list-shell" data-testid="notice-list-shell">
        <div className="notice-page-head">
          <div>
            <h2>공지사항</h2>
            <p>수업 공지사항을 작성하고 학생들에게 효과적으로 전달하세요.</p>
          </div>
          {isTeacher ? (
            <button
              className="btn notice-primary-action"
              data-testid="notice-create-action"
              onClick={() => setRoute({ mode: "create" })}
            >
              <NoticeIcon name="plus" />
              공지사항 작성
            </button>
          ) : null}
        </div>

        <section className={`notice-stats-band${isTeacher ? "" : " student"}`} aria-label="공지사항 현황">
          <div className="notice-stat-card">
            <NoticeIcon name="comment" />
            <strong>{stats.total}</strong>
            <span>전체 공지</span>
          </div>
          <div className="notice-stat-card">
            <NoticeIcon name="pin" />
            <strong>{stats.important}</strong>
            <span>중요 공지</span>
          </div>
          {isTeacher ? (
            <div className="notice-stat-card">
              <NoticeIcon name="eye" />
              <strong>{stats.scheduled}</strong>
              <span>예약된 공지</span>
            </div>
          ) : null}
          <div className="notice-stat-card">
            <NoticeIcon name="comment" />
            <strong>{stats.commentsTotal}</strong>
            <span>댓글 흐름</span>
          </div>
          <div className="notice-hero-visual" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>

        <div className="notice-toolbar-row">
          <label className="notice-search">
            <input
              value={query}
              placeholder="공지 제목, 내용 검색"
              onChange={(event) => setQuery(event.target.value)}
            />
            <NoticeIcon name="search" />
          </label>
          <div className="notice-filter-chips" role="group" aria-label="공지 필터">
            {noticeFilterOptions.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            className="notice-sort-select"
            value={sortMode}
            aria-label="공지사항 정렬"
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="LATEST">최신순</option>
            <option value="IMPORTANT">중요순</option>
          </select>
        </div>

        {permissionNotice ? <div className="alert notice-alert">{permissionNotice}</div> : null}
        {actionError ? <div className="alert alert-error">{actionError}</div> : null}

        {loading ? <section className="card empty-state">공지사항을 불러오는 중...</section> : null}
        {!loading && error ? (
          <section className="card alert alert-error" role="alert">
            {error}
          </section>
        ) : null}
        {!loading && !error && filteredNotices.length === 0 ? (
          <section className="notice-empty-card">
            <NoticeIcon name="comment" />
            <strong>아직 표시할 공지사항이 없습니다.</strong>
            <span>{isTeacher ? "공지사항 작성으로 첫 수업 알림을 남겨보세요." : "선생님이 공지를 올리면 이곳에 표시됩니다."}</span>
          </section>
        ) : null}
        {!loading && !error ? (
          <div className="notice-group-list">
            {groupedNotices.map(([label, group]) => (
              <section key={label} className="notice-group">
                <h3>{label}</h3>
                <div className="notice-card-stack">{group.map(renderNoticeCard)}</div>
              </section>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  function renderPreview(notice: NoticeFormState) {
    return (
      <aside className="notice-preview-column" data-testid="notice-preview-panel">
        <section className="notice-preview-card">
          <header>
            {notice.priority === "IMPORTANT" ? <span className="notice-badge purple">중요</span> : null}
            <h3>{notice.title || "공지사항 제목"}</h3>
            <p>
              {user.displayName} · 전체 학생 · {notice.immediate ? "즉시 게시" : `${notice.scheduledDate} ${notice.scheduledTime}`}
            </p>
          </header>
          <NoticeMarkdown content={notice.contentMarkdown || "미리보기에 표시할 내용을 입력해 주세요."} />
          {notice.attachments.length > 0 ? (
            <div className="notice-attachment-preview">
              <strong>첨부파일 {notice.attachments.length}</strong>
              {notice.attachments.map((file) => (
                <span key={file.id}>
                  <NoticeIcon name="paperclip" />
                  {file.name}
                </span>
              ))}
            </div>
          ) : null}
        </section>
        <section className="notice-tip-card">
          <strong>알아두세요</strong>
          <ul>
            <li>공지 발행 후 학생 화면에서 바로 확인됩니다.</li>
            <li>예약 발송은 지정한 시간부터 학생에게 표시됩니다.</li>
            <li>중요 공지는 목록 상단에 강조되어 노출됩니다.</li>
          </ul>
        </section>
      </aside>
    );
  }

  function renderCompose() {
    return (
      <section className={`notice-compose-shell${showPreview ? " with-preview" : ""}`} data-testid="notice-compose-shell">
        <div className="notice-page-head compose">
          <div>
            <h2>{isEditing ? "공지사항 수정" : "공지사항 작성"}</h2>
            <p>수업 구성원에게 전달할 공지사항을 작성하세요.</p>
          </div>
          <div className="notice-compose-actions">
            <button className="btn ghost" disabled={saving} onClick={() => saveNotice("DRAFT")}>
              임시 저장
            </button>
            <button className="btn ghost strong" onClick={() => setShowPreview((open) => !open)}>
              미리보기
            </button>
            <button className="btn notice-primary-action" disabled={saving} onClick={() => saveNotice("PUBLISHED")}>
              <NoticeIcon name="send" />
              공지 발행
            </button>
          </div>
        </div>

        {actionError ? (
          <section className="alert alert-error" role="alert">
            {actionError}
          </section>
        ) : null}

        <div className="notice-compose-grid">
          <form
            className="notice-editor-card"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              saveNotice("PUBLISHED").catch(console.error);
            }}
          >
            <label className="notice-field wide">
              <span>제목 입력</span>
              <input
                value={form.title}
                maxLength={100}
                placeholder="예: 3주차 강의 자료 업로드 및 과제 안내"
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />
              <small>{form.title.length} / 100</small>
            </label>

            <div className="notice-form-row three">
              <label className="notice-field">
                <span>공지 유형</span>
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      category: event.target.value as ClassroomNoticeCategory
                    }))
                  }
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="notice-field">
                <span>대상 학생</span>
                <select value="CLASS" disabled>
                  <option value="CLASS">전체 학생</option>
                </select>
              </label>
              <label className="notice-field">
                <span>중요도</span>
                <select
                  value={form.priority}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      priority: event.target.value as ClassroomNoticePriority,
                      pinned: event.target.value === "IMPORTANT" ? true : prev.pinned
                    }))
                  }
                >
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="notice-form-row schedule">
              <label className="notice-field">
                <span>예약 발송</span>
                <input
                  type="date"
                  value={form.scheduledDate}
                  disabled={form.immediate}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, scheduledDate: event.target.value }))
                  }
                />
              </label>
              <label className="notice-field">
                <span>시간</span>
                <input
                  type="time"
                  value={form.scheduledTime}
                  disabled={form.immediate}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, scheduledTime: event.target.value }))
                  }
                />
              </label>
              <label className="notice-switch">
                <input
                  type="checkbox"
                  checked={form.immediate}
                  onChange={(event) => setForm((prev) => ({ ...prev, immediate: event.target.checked }))}
                />
                <span>즉시 발송</span>
              </label>
              <label className="notice-switch">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(event) => setForm((prev) => ({ ...prev, pinned: event.target.checked }))}
                />
                <span>상단 고정</span>
              </label>
            </div>

            <label className="notice-field wide">
              <span>내용 작성</span>
              <div className="notice-editor-toolbar" aria-hidden="true">
                <span>본문</span>
                <b>B</b>
                <i>I</i>
                <u>U</u>
                <span>•</span>
                <span>#</span>
                <span>↶</span>
              </div>
              <textarea
                className="notice-content-editor"
                value={form.contentMarkdown}
                placeholder={"안녕하세요, 여러분!\n공지할 내용을 입력해 주세요.\n\n- 중요한 안내\n- 일정 및 준비물"}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, contentMarkdown: event.target.value }))
                }
              />
            </label>

            <label className="notice-upload-box">
              <input type="file" multiple onChange={onAttachmentChange} />
              <NoticeIcon name="paperclip" />
              <span>파일을 드래그하거나 클릭해서 첨부하세요</span>
              <small>PDF, DOCX, PPTX, XLSX, ZIP 최대 10MB</small>
            </label>
            {form.attachments.length > 0 ? (
              <div className="notice-file-list">
                {form.attachments.map((file) => (
                  <div key={file.id} className="notice-file-row">
                    <NoticeIcon name="paperclip" />
                    <span>{file.name}</span>
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
                  </div>
                ))}
              </div>
            ) : null}
          </form>

          {showPreview ? renderPreview(form) : null}
        </div>
      </section>
    );
  }

  function renderComment(comment: ClassroomNoticeComment, depth = 0) {
    const isEditingComment = editingCommentId === comment.id;
    const isEdited = comment.createdAt !== comment.updatedAt;
    const actions = [
      depth === 0
        ? {
            key: "reply",
            label: "답글",
            icon: "comment",
            testId: "notice-reply-action",
            danger: false,
            onClick: () => {
              updateReplyTargetId(comment.id);
              setReplyInput("");
              setEditingCommentId(null);
              setCommentEditInput("");
            }
          }
        : null,
      comment.canEdit
        ? {
            key: "edit",
            label: "수정",
            icon: "edit",
            testId: "notice-comment-edit-action",
            danger: false,
            onClick: () => {
              setEditingCommentId(comment.id);
              setCommentEditInput(comment.contentMarkdown);
              updateReplyTargetId(null);
              setReplyInput("");
            }
          }
        : null,
      comment.canDelete
        ? {
            key: "delete",
            label: "삭제",
            icon: "trash",
            testId: "notice-comment-delete-action",
            danger: true,
            onClick: () => removeComment(comment).catch(console.error)
          }
        : null
    ].filter(Boolean) as Array<{
      key: string;
      label: string;
      icon: string;
      testId: string;
      danger: boolean;
      onClick: () => void;
    }>;

    return (
      <article
        key={comment.id}
        className={`notice-comment${depth > 0 ? " reply" : ""}`}
        data-testid="notice-comment"
      >
        <div className="notice-comment-avatar">{comment.authorDisplayName.charAt(0)}</div>
        <div className="notice-comment-main">
          <div className="notice-comment-head">
            <strong>{comment.authorDisplayName}</strong>
            <span>{formatShortTime(comment.createdAt)}</span>
            {isEdited ? <span className="notice-comment-edited">수정됨</span> : null}
          </div>
          {isEditingComment ? (
            <div className="notice-comment-edit" data-testid="notice-comment-edit-form">
              <textarea
                data-testid="notice-comment-edit-input"
                value={commentEditInput}
                onChange={(event) => setCommentEditInput(event.target.value)}
              />
              <button
                type="button"
                className="btn notice-primary-action"
                data-testid="notice-comment-edit-save"
                disabled={!commentEditInput.trim()}
                onClick={() => saveCommentEdit(comment).catch(console.error)}
              >
                저장
              </button>
              <button type="button" className="btn ghost" onClick={resetCommentTransientState}>
                취소
              </button>
            </div>
          ) : (
            <p>{comment.contentMarkdown}</p>
          )}
          {actions.length > 0 ? (
            <div className="notice-comment-actions" data-testid="notice-comment-actions">
              {actions.map((action, index) => (
                <span key={action.key} className="notice-comment-action-item">
                  {index > 0 ? <span className="notice-comment-action-divider" aria-hidden="true" /> : null}
                  <button
                    type="button"
                    className={action.danger ? "danger" : ""}
                    data-testid={action.testId}
                    onClick={action.onClick}
                  >
                    <NoticeIcon name={action.icon} />
                    {action.label}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {depth === 0 && replyTargetId === comment.id ? (
            <div className="notice-reply-box">
              <textarea
                data-testid="notice-reply-input"
                value={replyInput}
                placeholder="답글을 입력하세요..."
                onChange={(event) => setReplyInput(event.target.value)}
              />
              <button
                data-testid="notice-reply-submit"
                type="button"
                className="btn notice-primary-action"
                disabled={!replyInput.trim() || !selectedNotice || isCommentSubmitPending(selectedNotice.id, comment.id)}
                onClick={() => submitComment(comment.id).catch(console.error)}
              >
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
      return <section className="card empty-state">공지사항 상세를 불러오는 중...</section>;
    }
    if (!selectedNotice) {
      return (
        <section className="notice-detail-shell" data-testid="notice-detail-shell">
          {permissionNotice ? <div className="alert notice-alert">{permissionNotice}</div> : null}
          {actionError ? <div className="alert alert-error">{actionError}</div> : null}
          <button className="btn ghost" onClick={() => setRoute({})}>목록으로 돌아가기</button>
        </section>
      );
    }
    return (
      <section className="notice-detail-shell" data-testid="notice-detail-shell">
        <div className="notice-detail-breadcrumb">공지사항 › 상세</div>
        <button className="notice-back-btn" onClick={() => setRoute({})}>← 목록으로 돌아가기</button>
        {permissionNotice ? <div className="alert notice-alert">{permissionNotice}</div> : null}
        {actionError ? <div className="alert alert-error">{actionError}</div> : null}
        <section className="notice-detail-card">
          <article className="notice-detail-main">
            <div className="notice-detail-head">
              <div>
                <span className="notice-badge purple">{PRIORITY_LABELS[selectedNotice.priority]}</span>
                <h2>{selectedNotice.title}</h2>
                <div className="notice-detail-badges">
                  <span className="notice-badge soft">{CATEGORY_BADGES[selectedNotice.category]}</span>
                  <span className="notice-badge">전체 학생</span>
                </div>
              </div>
              {isTeacher ? (
                <div className="notice-detail-actions">
                  <button
                    className="btn ghost"
                    data-testid="notice-edit-action"
                    onClick={() => setRoute({ mode: "edit", noticeId: selectedNotice.id })}
                  >
                    <NoticeIcon name="edit" />
                    수정
                  </button>
                  <button
                    className="btn danger"
                    data-testid="notice-delete-action"
                    onClick={() => removeNotice(selectedNotice).catch(console.error)}
                  >
                    <NoticeIcon name="trash" />
                    삭제
                  </button>
                </div>
              ) : null}
            </div>
            <div className="notice-author-row">
              <span className="notice-avatar">{selectedNotice.authorDisplayName.charAt(0)}</span>
              <strong>{selectedNotice.authorDisplayName}</strong>
              <span>게시일 {formatDateTime(selectedNotice.publishedAt ?? selectedNotice.createdAt)}</span>
              {selectedNotice.pinned ? <span>상단 고정</span> : null}
            </div>
            <NoticeMarkdown content={selectedNotice.contentMarkdown} />
            {selectedNotice.attachments.length > 0 ? (
              <div className="notice-detail-files">
                <strong>첨부파일 {selectedNotice.attachments.length}</strong>
                {selectedNotice.attachments.map((file) => (
                  <span key={file.id}>
                    <NoticeIcon name="paperclip" />
                    {file.name}
                    <small>{formatFileSize(file.size)}</small>
                  </span>
                ))}
              </div>
            ) : null}
          </article>
          <aside className="notice-info-card">
            <h3>공지 정보</h3>
            <dl>
              <div>
                <dt>댓글 수</dt>
                <dd>{selectedNotice.commentCount}</dd>
              </div>
              <div>
                <dt>대상</dt>
                <dd>전체 학생</dd>
              </div>
              <div>
                <dt>카테고리</dt>
                <dd>{CATEGORY_BADGES[selectedNotice.category]}</dd>
              </div>
              <div>
                <dt>게시일</dt>
                <dd>{formatDateTime(selectedNotice.publishedAt ?? selectedNotice.createdAt)}</dd>
              </div>
              <div>
                <dt>수정일</dt>
                <dd>{formatDateTime(selectedNotice.updatedAt)}</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="notice-comments-section">
          <h3>댓글 <span>{comments.length}</span></h3>
          <div className="notice-comment-compose">
            <span className="notice-comment-avatar">{user.displayName.charAt(0)}</span>
            <textarea
              data-testid="notice-comment-input"
              value={commentInput}
              placeholder="댓글을 입력하세요..."
              onChange={(event) => setCommentInput(event.target.value)}
            />
            <button
              type="button"
              data-testid="notice-comment-submit"
              className="btn notice-primary-action"
              disabled={!commentInput.trim() || isCommentSubmitPending(selectedNotice.id)}
              onClick={() => submitComment().catch(console.error)}
            >
              등록
            </button>
          </div>
          <div className="notice-comment-list">
            {rootComments.length === 0 ? (
              <div className="notice-empty-comment">아직 댓글이 없습니다.</div>
            ) : (
              rootComments.map((comment) => renderComment(comment))
            )}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="classroom-notices-panel" data-testid="classroom-notices-panel">
      {canCompose ? renderCompose() : noticeId ? renderDetail() : renderList()}
    </section>
  );
}
