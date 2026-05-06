import { ApiError, api } from "./client";
import {
  AiStatus,
  Classroom,
  ClassroomAttendanceSummary,
  ClassroomDiscussionComment,
  ClassroomDiscussionCommentPatchPayload,
  ClassroomDiscussionCommentPayload,
  ClassroomDiscussionPatchPayload,
  ClassroomDiscussionPayload,
  ClassroomDiscussionPost,
  ClassroomInvitation,
  ClassroomMaterialItem,
  ClassroomNotice,
  ClassroomNoticeAttachment,
  ClassroomNoticeCategory,
  ClassroomNoticeComment,
  ClassroomNoticeCommentPatchPayload,
  ClassroomNoticeCommentPayload,
  ClassroomNoticePriority,
  ClassroomNoticeStatus,
  ClassroomNoticeTarget,
  ClassroomStudent,
  CurrentUser,
  DiscussionAssistantRequest,
  DiscussionAssistantResponse,
  ExamStudioProposal,
  LectureItem,
  ReportCriteriaAssistantProposal,
  SessionState,
  StudentClassroomAttendanceSummary,
  StudentExamMetadata,
  StudentInviteCandidate,
  StudentCompetencyReport,
  StudentReportCustomCriterion,
  StudentReportListItem,
  TeacherExam,
  TeacherExamAttemptSummary,
  TeacherExamReport,
  TeacherExamRevision,
  UserRole,
  Week
} from "../types";

export type ClassroomReportAnalysisStage =
  | "COLLECTING_DATA"
  | "BUILDING_PROFILE"
  | "GEMINI_THINKING"
  | "SCORING"
  | "WRITING_REPORT"
  | "COMPLETE";

export type ClassroomReportAnalysisStreamEvent =
  | {
      type: "stage";
      stage: ClassroomReportAnalysisStage;
      label: string;
      progress: number;
      detail?: string;
    }
  | {
      type: "thought_delta";
      text: string;
    }
  | {
      type: "answer_delta";
      text: string;
    }
  | {
      type: "final";
      data: StudentCompetencyReport;
    }
  | {
      type: "error";
      error: string;
    };

function handleReportStreamLine(
  line: string,
  onEvent: (event: ClassroomReportAnalysisStreamEvent) => void,
  fallbackErrorMessage: string
): StudentCompetencyReport | null {
  const payload = JSON.parse(line) as ClassroomReportAnalysisStreamEvent;

  if (payload.type === "final") {
    return payload.data;
  }

  if (payload.type === "error") {
    throw new Error(payload.error || fallbackErrorMessage);
  }

  onEvent(payload);
  return null;
}

export async function getMe(): Promise<CurrentUser | null> {
  try {
    const res = await api.get<{ ok: boolean; data: { user: CurrentUser } }>("/auth/me");
    return res.data.data.user;
  } catch (error: any) {
    if (error?.status === 401) return null;
    throw error;
  }
}

export async function updateAccount(input: {
  email: string;
  currentPassword?: string;
  password?: string;
}): Promise<{ user: CurrentUser; devVerificationCode?: string }> {
  const res = await api.patch<{
    ok: boolean;
    data: { user: CurrentUser };
    devVerificationCode?: string;
  }>("/auth/me", input);
  return {
    user: res.data.data.user,
    devVerificationCode: res.data.devVerificationCode
  };
}

export async function signup(input: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
}): Promise<{ user: CurrentUser; devVerificationCode?: string }> {
  const res = await api.post<{
    ok: boolean;
    data: { user: CurrentUser };
    devVerificationCode?: string;
  }>("/auth/signup", input);
  return {
    user: res.data.data.user,
    devVerificationCode: res.data.devVerificationCode
  };
}

export async function verifyEmail(input: {
  email: string;
  code: string;
}): Promise<CurrentUser> {
  const res = await api.post<{ ok: boolean; data: { user: CurrentUser } }>(
    "/auth/verify-email",
    input
  );
  return res.data.data.user;
}

export async function resendVerificationEmail(input: {
  email: string;
}): Promise<{ devVerificationCode?: string }> {
  const res = await api.post<{ ok: boolean; devVerificationCode?: string }>(
    "/auth/resend-verification",
    input
  );
  return { devVerificationCode: res.data.devVerificationCode };
}

export async function login(input: { email: string; password: string }): Promise<CurrentUser> {
  const res = await api.post<{ ok: boolean; data: { user: CurrentUser } }>(
    "/auth/login",
    input
  );
  return res.data.data.user;
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

export async function getGoogleOAuthStatus(): Promise<{ enabled: boolean }> {
  const res = await api.get<{ ok: boolean; data: { enabled: boolean } }>(
    "/auth/google/status"
  );
  return res.data.data;
}

export async function getAuthEmailStatus(): Promise<{
  mode: "dev" | "smtp";
  canDeliverToInbox: boolean;
  devVerificationCodeVisible: boolean;
}> {
  const res = await api.get<{
    ok: boolean;
    data: {
      mode: "dev" | "smtp";
      canDeliverToInbox: boolean;
      devVerificationCodeVisible: boolean;
    };
  }>("/auth/email/status");
  return res.data.data;
}

export async function searchStudentInvite(input: {
  name: string;
  code: string;
  classroomId?: string;
}): Promise<StudentInviteCandidate> {
  const res = await api.get<{ ok: boolean; data: StudentInviteCandidate }>(
    "/students/search",
    {
      params: {
        name: input.name,
        code: input.code,
        classroomId: input.classroomId
      }
    }
  );
  return res.data.data;
}

export async function getClassroomStudents(classroomId: string): Promise<ClassroomStudent[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomStudent[] }>(
    `/classrooms/${classroomId}/students`
  );
  return res.data.data;
}

export async function getClassroomInvitations(classroomId: string): Promise<ClassroomInvitation[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomInvitation[] }>(
    `/classrooms/${classroomId}/invitations`
  );
  return res.data.data;
}

export async function inviteStudent(
  classroomId: string,
  input: { studentUserId: string; name: string; code: string }
): Promise<ClassroomInvitation> {
  const res = await api.post<{ ok: boolean; data: ClassroomInvitation }>(
    `/classrooms/${classroomId}/students`,
    input
  );
  return res.data.data;
}

export async function removeClassroomStudent(
  classroomId: string,
  studentUserId: string
): Promise<void> {
  await api.delete(`/classrooms/${classroomId}/students/${studentUserId}`);
}

export async function getMyClassroomInvitations(): Promise<ClassroomInvitation[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomInvitation[] }>(
    "/students/invitations"
  );
  return res.data.data;
}

export async function acceptClassroomInvitation(invitationId: string): Promise<ClassroomInvitation> {
  const res = await api.post<{ ok: boolean; data: ClassroomInvitation }>(
    `/students/invitations/${invitationId}/accept`
  );
  return res.data.data;
}

export async function getClassrooms(): Promise<Classroom[]> {
  const res = await api.get<{ ok: boolean; data: Classroom[] }>("/classrooms");
  return res.data.data;
}

export async function createClassroom(title: string): Promise<Classroom> {
  const res = await api.post<{ ok: boolean; data: Classroom }>("/classrooms", { title });
  return res.data.data;
}

export async function deleteClassroom(classroomId: string): Promise<void> {
  await api.delete(`/classrooms/${classroomId}`);
}

export type ClassroomNoticePayload = {
  title: string;
  contentMarkdown: string;
  category: ClassroomNoticeCategory;
  priority: ClassroomNoticePriority;
  target: ClassroomNoticeTarget;
  pinned: boolean;
  status: ClassroomNoticeStatus;
  publishAt?: string | null;
  attachments: ClassroomNoticeAttachment[];
};

export type ClassroomNoticePatchPayload = Partial<ClassroomNoticePayload>;

export async function getClassroomNotices(classroomId: string): Promise<ClassroomNotice[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomNotice[] }>(
    `/classrooms/${classroomId}/notices`
  );
  return res.data.data;
}

export async function createClassroomNotice(
  classroomId: string,
  input: ClassroomNoticePayload
): Promise<ClassroomNotice> {
  const res = await api.post<{ ok: boolean; data: ClassroomNotice }>(
    `/classrooms/${classroomId}/notices`,
    input
  );
  return res.data.data;
}

export async function getClassroomNotice(
  classroomId: string,
  noticeId: string
): Promise<ClassroomNotice> {
  const res = await api.get<{ ok: boolean; data: ClassroomNotice }>(
    `/classrooms/${classroomId}/notices/${noticeId}`
  );
  return res.data.data;
}

export async function updateClassroomNotice(
  classroomId: string,
  noticeId: string,
  input: ClassroomNoticePatchPayload
): Promise<ClassroomNotice> {
  const res = await api.patch<{ ok: boolean; data: ClassroomNotice }>(
    `/classrooms/${classroomId}/notices/${noticeId}`,
    input
  );
  return res.data.data;
}

export async function deleteClassroomNotice(
  classroomId: string,
  noticeId: string
): Promise<void> {
  await api.delete(`/classrooms/${classroomId}/notices/${noticeId}`);
}

export async function getClassroomNoticeComments(
  classroomId: string,
  noticeId: string
): Promise<ClassroomNoticeComment[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomNoticeComment[] }>(
    `/classrooms/${classroomId}/notices/${noticeId}/comments`
  );
  return res.data.data;
}

export async function createClassroomNoticeComment(
  classroomId: string,
  noticeId: string,
  input: ClassroomNoticeCommentPayload
): Promise<ClassroomNoticeComment> {
  const res = await api.post<{ ok: boolean; data: ClassroomNoticeComment }>(
    `/classrooms/${classroomId}/notices/${noticeId}/comments`,
    input
  );
  return res.data.data;
}

export async function updateClassroomNoticeComment(
  classroomId: string,
  noticeId: string,
  commentId: string,
  input: ClassroomNoticeCommentPatchPayload
): Promise<ClassroomNoticeComment> {
  const res = await api.patch<{ ok: boolean; data: ClassroomNoticeComment }>(
    `/classrooms/${classroomId}/notices/${noticeId}/comments/${commentId}`,
    input
  );
  return res.data.data;
}

export async function deleteClassroomNoticeComment(
  classroomId: string,
  noticeId: string,
  commentId: string
): Promise<void> {
  await api.delete(`/classrooms/${classroomId}/notices/${noticeId}/comments/${commentId}`);
}

export async function getClassroomDiscussions(
  classroomId: string
): Promise<ClassroomDiscussionPost[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomDiscussionPost[] }>(
    `/classrooms/${classroomId}/discussions`
  );
  return res.data.data;
}

export async function createClassroomDiscussion(
  classroomId: string,
  input: ClassroomDiscussionPayload
): Promise<ClassroomDiscussionPost> {
  const res = await api.post<{ ok: boolean; data: ClassroomDiscussionPost }>(
    `/classrooms/${classroomId}/discussions`,
    input
  );
  return res.data.data;
}

export async function getClassroomDiscussion(
  classroomId: string,
  discussionId: string
): Promise<ClassroomDiscussionPost> {
  const res = await api.get<{ ok: boolean; data: ClassroomDiscussionPost }>(
    `/classrooms/${classroomId}/discussions/${discussionId}`
  );
  return res.data.data;
}

export async function updateClassroomDiscussion(
  classroomId: string,
  discussionId: string,
  input: ClassroomDiscussionPatchPayload
): Promise<ClassroomDiscussionPost> {
  const res = await api.patch<{ ok: boolean; data: ClassroomDiscussionPost }>(
    `/classrooms/${classroomId}/discussions/${discussionId}`,
    input
  );
  return res.data.data;
}

export async function deleteClassroomDiscussion(
  classroomId: string,
  discussionId: string
): Promise<void> {
  await api.delete(`/classrooms/${classroomId}/discussions/${discussionId}`);
}

export async function getClassroomDiscussionComments(
  classroomId: string,
  discussionId: string
): Promise<ClassroomDiscussionComment[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomDiscussionComment[] }>(
    `/classrooms/${classroomId}/discussions/${discussionId}/comments`
  );
  return res.data.data;
}

export async function createClassroomDiscussionComment(
  classroomId: string,
  discussionId: string,
  input: ClassroomDiscussionCommentPayload
): Promise<ClassroomDiscussionComment> {
  const res = await api.post<{ ok: boolean; data: ClassroomDiscussionComment }>(
    `/classrooms/${classroomId}/discussions/${discussionId}/comments`,
    input
  );
  return res.data.data;
}

export async function updateClassroomDiscussionComment(
  classroomId: string,
  discussionId: string,
  commentId: string,
  input: ClassroomDiscussionCommentPatchPayload
): Promise<ClassroomDiscussionComment> {
  const res = await api.patch<{ ok: boolean; data: ClassroomDiscussionComment }>(
    `/classrooms/${classroomId}/discussions/${discussionId}/comments/${commentId}`,
    input
  );
  return res.data.data;
}

export async function deleteClassroomDiscussionComment(
  classroomId: string,
  discussionId: string,
  commentId: string
): Promise<void> {
  await api.delete(`/classrooms/${classroomId}/discussions/${discussionId}/comments/${commentId}`);
}

export async function requestClassroomDiscussionAssistant(
  classroomId: string,
  input: DiscussionAssistantRequest
): Promise<DiscussionAssistantResponse> {
  const res = await api.post<{ ok: boolean; data: DiscussionAssistantResponse }>(
    `/classrooms/${classroomId}/discussions/assistant`,
    input
  );
  return res.data.data;
}

export type DiscussionAssistantMessageInput = {
  role: "user" | "assistant";
  contentMarkdown: string;
};

export type DiscussionAssistantStreamEvent =
  | {
      type: "thought_delta";
      text: string;
    }
  | {
      type: "answer_delta";
      text: string;
    }
  | {
      type: "done";
      answerText?: string;
      thoughtSummary?: string;
      data?: DiscussionAssistantResponse;
    }
  | {
      type: "error";
      error: string;
    };

function handleDiscussionAssistantStreamLine(
  line: string,
  onEvent: (event: DiscussionAssistantStreamEvent) => void
): { done: boolean; answerText: string; thoughtSummary: string; data?: DiscussionAssistantResponse } | null {
  const payload = JSON.parse(line) as DiscussionAssistantStreamEvent;
  if (payload.type === "error") {
    throw new Error(payload.error || "토론 작성 어시스턴트 스트리밍 처리 중 오류가 발생했습니다.");
  }
  if (payload.type === "done") {
    onEvent(payload);
    return {
      done: true,
      answerText: String(payload.answerText ?? ""),
      thoughtSummary: String(payload.thoughtSummary ?? ""),
      data: payload.data
    };
  }
  if (payload.type === "answer_delta" || payload.type === "thought_delta") {
    onEvent(payload);
    return null;
  }
  throw new Error("알 수 없는 토론 작성 어시스턴트 스트림 이벤트를 받았습니다.");
}

export async function streamClassroomDiscussionAssistant(
  classroomId: string,
  input: DiscussionAssistantRequest & {
    history?: DiscussionAssistantMessageInput[];
  },
  onEvent: (event: DiscussionAssistantStreamEvent) => void,
  signal?: AbortSignal
): Promise<{ answerText: string; thoughtSummary: string; data?: DiscussionAssistantResponse }> {
  const response = await fetch(`/api/classrooms/${classroomId}/discussions/assistant/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "include",
    signal,
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw parseFetchError(await response.text(), response.status);
  }

  if (!response.body) {
    throw new Error("토론 작성 어시스턴트 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: { answerText: string; thoughtSummary: string; data?: DiscussionAssistantResponse } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");
      if (!line) continue;

      const handled = handleDiscussionAssistantStreamLine(line, onEvent);
      if (handled?.done) {
        finalPayload = {
          answerText: handled.answerText,
          thoughtSummary: handled.thoughtSummary,
          data: handled.data
        };
      }
    }
  }
  buffer += decoder.decode();
  const remainingLine = buffer.trim();
  if (remainingLine) {
    const handled = handleDiscussionAssistantStreamLine(remainingLine, onEvent);
    if (handled?.done) {
      finalPayload = {
        answerText: handled.answerText,
        thoughtSummary: handled.thoughtSummary,
        data: handled.data
      };
    }
  }

  if (!finalPayload) {
    throw new Error("토론 작성 어시스턴트 스트리밍 최종 결과를 받지 못했습니다.");
  }

  return finalPayload;
}

export async function getClassroomCompetencyReport(
  classroomId: string
): Promise<StudentCompetencyReport | null> {
  const res = await api.get<{ ok: boolean; data: StudentCompetencyReport | null }>(
    `/classrooms/${classroomId}/report`
  );
  return res.data.data;
}

export async function getClassroomReportStudents(
  classroomId: string
): Promise<StudentReportListItem[]> {
  const res = await api.get<{ ok: boolean; data: StudentReportListItem[] }>(
    `/classrooms/${classroomId}/report/students`
  );
  return res.data.data;
}

export async function getStudentCompetencyReport(
  classroomId: string,
  studentUserId: string
): Promise<StudentCompetencyReport | null> {
  const res = await api.get<{ ok: boolean; data: StudentCompetencyReport | null }>(
    `/classrooms/${classroomId}/report/students/${studentUserId}`
  );
  return res.data.data;
}

export async function getClassroomReportCriteria(
  classroomId: string
): Promise<StudentReportCustomCriterion[]> {
  const res = await api.get<{ ok: boolean; data: StudentReportCustomCriterion[] }>(
    `/classrooms/${classroomId}/report/criteria`
  );
  return res.data.data;
}

export async function createClassroomReportCriterion(
  classroomId: string,
  input: { name: string; description: string }
): Promise<StudentReportCustomCriterion> {
  const res = await api.post<{ ok: boolean; data: StudentReportCustomCriterion }>(
    `/classrooms/${classroomId}/report/criteria`,
    input
  );
  return res.data.data;
}

export async function updateClassroomReportCriterion(
  classroomId: string,
  criterionId: string,
  input: { name?: string; description?: string }
): Promise<StudentReportCustomCriterion> {
  const res = await api.patch<{ ok: boolean; data: StudentReportCustomCriterion }>(
    `/classrooms/${classroomId}/report/criteria/${criterionId}`,
    input
  );
  return res.data.data;
}

export async function deleteClassroomReportCriterion(
  classroomId: string,
  criterionId: string
): Promise<void> {
  await api.delete(`/classrooms/${classroomId}/report/criteria/${criterionId}`);
}

export async function analyzeClassroomCompetencyReport(
  classroomId: string
): Promise<StudentCompetencyReport> {
  const res = await api.post<{ ok: boolean; data: StudentCompetencyReport }>(
    `/classrooms/${classroomId}/report/analyze`
  );
  return res.data.data;
}

export async function analyzeClassroomCompetencyReportStream(
  classroomId: string,
  onEvent: (event: ClassroomReportAnalysisStreamEvent) => void
): Promise<StudentCompetencyReport> {
  const response = await fetch(`/api/classrooms/${classroomId}/report/analyze/stream`, {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    const text = await response.text();
    let parsedMessage = "";
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      parsedMessage =
        (typeof parsed.error === "string" && parsed.error) ||
        (typeof parsed.detail === "string" && parsed.detail) ||
        "";
    } catch {
      // no-op
    }
    throw new Error(parsedMessage || text || `HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("리포트 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: StudentCompetencyReport | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");
      if (!line) continue;

      finalPayload =
        handleReportStreamLine(line, onEvent, "리포트 스트리밍 처리 중 오류가 발생했습니다.") ??
        finalPayload;
    }
  }
  buffer += decoder.decode();
  const remainingLine = buffer.trim();
  if (remainingLine) {
    finalPayload =
      handleReportStreamLine(
        remainingLine,
        onEvent,
        "리포트 스트리밍 처리 중 오류가 발생했습니다."
      ) ?? finalPayload;
  }

  if (!finalPayload) {
    throw new Error("리포트 스트리밍 최종 결과를 받지 못했습니다.");
  }

  return finalPayload;
}

export async function analyzeStudentCompetencyReportStream(
  classroomId: string,
  studentUserId: string,
  onEvent: (event: ClassroomReportAnalysisStreamEvent) => void,
  signal?: AbortSignal
): Promise<StudentCompetencyReport> {
  const response = await fetch(
    `/api/classrooms/${classroomId}/report/students/${studentUserId}/analyze/stream`,
    {
      method: "POST",
      credentials: "include",
      signal
    }
  );

  if (!response.ok) {
    const text = await response.text();
    let parsedMessage = "";
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      parsedMessage =
        (typeof parsed.error === "string" && parsed.error) ||
        (typeof parsed.detail === "string" && parsed.detail) ||
        "";
    } catch {
      // no-op
    }
    throw new Error(parsedMessage || text || `HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("학생별 리포트 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: StudentCompetencyReport | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");
      if (!line) continue;

      finalPayload =
        handleReportStreamLine(
          line,
          onEvent,
          "학생별 리포트 스트리밍 처리 중 오류가 발생했습니다."
        ) ?? finalPayload;
    }
  }
  buffer += decoder.decode();
  const remainingLine = buffer.trim();
  if (remainingLine) {
    finalPayload =
      handleReportStreamLine(
        remainingLine,
        onEvent,
        "학생별 리포트 스트리밍 처리 중 오류가 발생했습니다."
      ) ?? finalPayload;
  }

  if (!finalPayload) {
    throw new Error("학생별 리포트 스트리밍 최종 결과를 받지 못했습니다.");
  }

  if (finalPayload.reportScope !== "STUDENT" || finalPayload.studentUserId !== studentUserId) {
    throw new Error("선택한 학생과 다른 리포트가 반환되어 화면에 반영하지 않았습니다.");
  }

  return finalPayload;
}

export type StudentReportChatMessageInput = {
  role: "user" | "assistant";
  contentMarkdown: string;
};

export type StudentReportChatStreamEvent =
  | {
      type: "thought_delta";
      text: string;
    }
  | {
      type: "answer_delta";
      text: string;
    }
  | {
      type: "done";
      answerText?: string;
      thoughtSummary?: string;
    }
  | {
      type: "error";
      error: string;
    };

function parseFetchError(text: string, status: number): ApiError {
  let parsedMessage = "";
  let parsedCode = "";
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    parsedMessage =
      (typeof parsed.error === "string" && parsed.error) ||
      (typeof parsed.detail === "string" && parsed.detail) ||
      "";
    parsedCode = typeof parsed.code === "string" ? parsed.code : "";
  } catch {
    // keep raw response text fallback
  }
  return new ApiError(parsedMessage || text || `HTTP ${status}`, status, parsedCode);
}

function handleStudentReportChatStreamLine(
  line: string,
  onEvent: (event: StudentReportChatStreamEvent) => void
): { done: boolean; answerText: string; thoughtSummary: string } | null {
  const payload = JSON.parse(line) as StudentReportChatStreamEvent;
  if (payload.type === "error") {
    throw new Error(payload.error || "학생 리포트 챗봇 스트리밍 처리 중 오류가 발생했습니다.");
  }
  if (payload.type === "done") {
    onEvent(payload);
    return {
      done: true,
      answerText: String(payload.answerText ?? ""),
      thoughtSummary: String(payload.thoughtSummary ?? "")
    };
  }
  if (payload.type === "answer_delta" || payload.type === "thought_delta") {
    onEvent(payload);
    return null;
  }
  throw new Error("알 수 없는 학생 리포트 챗봇 스트림 이벤트를 받았습니다.");
}

export async function streamStudentReportChat(
  classroomId: string,
  studentUserId: string,
  input: {
    message: string;
    history?: StudentReportChatMessageInput[];
  },
  onEvent: (event: StudentReportChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<{ answerText: string; thoughtSummary: string }> {
  const response = await fetch(
    `/api/classrooms/${classroomId}/report/students/${studentUserId}/chat/stream`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "include",
      signal,
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    throw parseFetchError(await response.text(), response.status);
  }

  if (!response.body) {
    throw new Error("학생 리포트 챗봇 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: { answerText: string; thoughtSummary: string } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");
      if (!line) continue;

      const handled = handleStudentReportChatStreamLine(line, onEvent);
      if (handled?.done) {
        finalPayload = {
          answerText: handled.answerText,
          thoughtSummary: handled.thoughtSummary
        };
      }
    }
  }
  buffer += decoder.decode();
  const remainingLine = buffer.trim();
  if (remainingLine) {
    const handled = handleStudentReportChatStreamLine(remainingLine, onEvent);
    if (handled?.done) {
      finalPayload = {
        answerText: handled.answerText,
        thoughtSummary: handled.thoughtSummary
      };
    }
  }

  if (!finalPayload) {
    throw new Error("학생 리포트 챗봇 스트리밍 최종 결과를 받지 못했습니다.");
  }

  return finalPayload;
}

export type ReportCriteriaAssistantMessageInput = {
  role: "user" | "assistant";
  contentMarkdown: string;
};

export type ReportCriteriaAssistantStreamStage =
  | "UNDERSTANDING_REQUEST"
  | "CHECKING_CRITERIA"
  | "GENERATING_CRITERION"
  | "VALIDATING_APPLICABILITY"
  | "READY_TO_APPLY"
  | "COMPLETE";

export type ReportCriteriaAssistantStreamEvent =
  | {
      type: "stage";
      stage: ReportCriteriaAssistantStreamStage;
      label: string;
      progress: number;
      detail?: string;
    }
  | {
      type: "thought_delta";
      text: string;
    }
  | {
      type: "proposal";
      data: ReportCriteriaAssistantProposal;
      thoughtSummary?: string;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      error: string;
    };

function handleReportCriteriaAssistantStreamLine(
  line: string,
  onEvent: (event: ReportCriteriaAssistantStreamEvent) => void
): { proposal?: ReportCriteriaAssistantProposal; done?: boolean } {
  const payload = JSON.parse(line) as ReportCriteriaAssistantStreamEvent;
  if (payload.type === "error") {
    throw new Error(payload.error || "평가 항목 도우미 스트리밍 처리 중 오류가 발생했습니다.");
  }
  if (
    payload.type !== "stage" &&
    payload.type !== "thought_delta" &&
    payload.type !== "proposal" &&
    payload.type !== "done"
  ) {
    throw new Error("알 수 없는 평가 항목 도우미 스트림 이벤트를 받았습니다.");
  }
  onEvent(payload);
  if (payload.type === "proposal") {
    return { proposal: payload.data };
  }
  if (payload.type === "done") {
    return { done: true };
  }
  return {};
}

export async function streamReportCriteriaAssistantChat(
  classroomId: string,
  input: {
    message: string;
    history?: ReportCriteriaAssistantMessageInput[];
    currentProposal?: { name: string; description: string } | null;
  },
  onEvent: (event: ReportCriteriaAssistantStreamEvent) => void,
  signal?: AbortSignal
): Promise<ReportCriteriaAssistantProposal> {
  const response = await fetch(
    `/api/classrooms/${classroomId}/report/criteria/assistant/stream`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "include",
      signal,
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    throw parseFetchError(await response.text(), response.status);
  }

  if (!response.body) {
    throw new Error("평가 항목 도우미 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalProposal: ReportCriteriaAssistantProposal | null = null;
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");
      if (!line) continue;
      const handled = handleReportCriteriaAssistantStreamLine(line, onEvent);
      if (handled.proposal) finalProposal = handled.proposal;
      if (handled.done) sawDone = true;
    }
  }
  buffer += decoder.decode();
  const remainingLine = buffer.trim();
  if (remainingLine) {
    const handled = handleReportCriteriaAssistantStreamLine(remainingLine, onEvent);
    if (handled.proposal) finalProposal = handled.proposal;
    if (handled.done) sawDone = true;
  }

  if (!sawDone) {
    throw new Error("평가 항목 도우미 스트리밍이 완료 이벤트 없이 종료되었습니다.");
  }
  if (!finalProposal) {
    throw new Error("평가 항목 도우미 최종 제안을 받지 못했습니다.");
  }

  return finalProposal;
}

export async function getWeeks(classroomId: string): Promise<Week[]> {
  const res = await api.get<{ ok: boolean; data: Week[] }>(`/classrooms/${classroomId}/weeks`);
  return res.data.data;
}

export async function createWeek(classroomId: string, title?: string): Promise<Week> {
  const res = await api.post<{ ok: boolean; data: Week }>(`/classrooms/${classroomId}/weeks`, {
    title
  });
  return res.data.data;
}

export async function deleteWeek(weekId: string): Promise<void> {
  await api.delete(`/weeks/${weekId}`);
}

export async function deleteWeeksBulk(weekIds: string[]): Promise<void> {
  await api.post("/weeks/bulk-delete", { weekIds });
}

export async function getLectures(weekId: string): Promise<LectureItem[]> {
  const res = await api.get<{ ok: boolean; data: LectureItem[] }>(`/weeks/${weekId}/lectures`);
  return res.data.data;
}

export async function getClassroomMaterials(classroomId: string): Promise<ClassroomMaterialItem[]> {
  const res = await api.get<{ ok: boolean; data: ClassroomMaterialItem[] }>(
    `/classrooms/${classroomId}/materials`
  );
  return res.data.data;
}

export async function getClassroomAttendance(classroomId: string): Promise<ClassroomAttendanceSummary> {
  const res = await api.get<{ ok: boolean; data: ClassroomAttendanceSummary }>(
    `/classrooms/${classroomId}/attendance`
  );
  return res.data.data;
}

export async function getMyClassroomAttendance(classroomId: string): Promise<StudentClassroomAttendanceSummary> {
  const res = await api.get<{ ok: boolean; data: StudentClassroomAttendanceSummary }>(
    `/classrooms/${classroomId}/attendance/me`
  );
  return res.data.data;
}

export async function createLecture(weekId: string, title: string, pdfFile: File): Promise<LectureItem> {
  const form = new FormData();
  form.append("title", title);
  form.append("pdf", pdfFile);
  const res = await api.post<{ ok: boolean; data: LectureItem }>(`/weeks/${weekId}/lectures`, form, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return res.data.data;
}

export async function deleteLecture(lectureId: string): Promise<void> {
  await api.delete(`/lectures/${lectureId}`);
}

export async function updateLectureTitle(lectureId: string, title: string): Promise<LectureItem> {
  const res = await api.patch<{ ok: boolean; data: LectureItem }>(`/lectures/${lectureId}`, { title });
  return res.data.data;
}

export function getLectureDownloadUrl(lectureId: string): string {
  return `/api/lectures/${encodeURIComponent(lectureId)}/download`;
}

export type TeacherExamDraftPayload = Partial<
  Pick<
    TeacherExamRevision,
    | "title"
    | "descriptionMarkdown"
    | "availableFrom"
    | "availableUntil"
    | "timeLimitMinutes"
    | "passScoreRatio"
    | "aiGradingEnabled"
    | "questions"
  >
>;

export async function getWeekExams(weekId: string): Promise<Array<TeacherExam | StudentExamMetadata>> {
  const res = await api.get<{ ok: boolean; data: Array<TeacherExam | StudentExamMetadata> }>(
    `/weeks/${weekId}/exams`
  );
  return res.data.data;
}

export async function createTeacherExam(
  weekId: string,
  input: TeacherExamDraftPayload
): Promise<TeacherExam> {
  const res = await api.post<{ ok: boolean; data: TeacherExam }>(`/weeks/${weekId}/exams`, input);
  return res.data.data;
}

export async function updateTeacherExam(
  examId: string,
  input: TeacherExamDraftPayload
): Promise<TeacherExam> {
  const res = await api.put<{ ok: boolean; data: TeacherExam }>(`/exams/${examId}`, input);
  return res.data.data;
}

export type TeacherExamSettingsPayload = Pick<
  TeacherExamRevision,
  "title" | "availableFrom" | "availableUntil" | "timeLimitMinutes"
>;

export async function updateTeacherExamSettings(
  examId: string,
  input: TeacherExamSettingsPayload
): Promise<TeacherExam> {
  const res = await api.patch<{ ok: boolean; data: TeacherExam }>(`/exams/${examId}/settings`, input);
  return res.data.data;
}

export async function publishTeacherExam(
  examId: string,
  input: TeacherExamDraftPayload
): Promise<TeacherExam> {
  const res = await api.post<{ ok: boolean; data: TeacherExam }>(`/exams/${examId}/publish`, input);
  return res.data.data;
}

export async function deleteTeacherExam(examId: string): Promise<void> {
  await api.delete(`/exams/${examId}`);
}

export async function getExam(examId: string): Promise<TeacherExam | StudentExamMetadata> {
  const res = await api.get<{ ok: boolean; data: TeacherExam | StudentExamMetadata }>(
    `/exams/${examId}`
  );
  return res.data.data;
}

export async function startTeacherExam(examId: string): Promise<TeacherExamAttemptSummary> {
  const res = await api.post<{ ok: boolean; data: TeacherExamAttemptSummary }>(
    `/exams/${examId}/start`
  );
  return res.data.data;
}

export async function getMyExamAttempt(examId: string): Promise<TeacherExamAttemptSummary | null> {
  const res = await api.get<{ ok: boolean; data: TeacherExamAttemptSummary | null }>(
    `/exams/${examId}/attempts/me`
  );
  return res.data.data;
}

export async function saveExamAttemptAnswers(
  attemptId: string,
  answers: Record<string, unknown>
): Promise<TeacherExamAttemptSummary> {
  const res = await api.patch<{ ok: boolean; data: TeacherExamAttemptSummary }>(
    `/exam-attempts/${attemptId}/answers`,
    { answers }
  );
  return res.data.data;
}

export async function submitExamAttempt(
  attemptId: string,
  answers: Record<string, unknown>
): Promise<TeacherExamAttemptSummary> {
  const res = await api.post<{ ok: boolean; data: TeacherExamAttemptSummary }>(
    `/exam-attempts/${attemptId}/submit`,
    { answers }
  );
  return res.data.data;
}

export async function getTeacherExamReport(examId: string): Promise<TeacherExamReport> {
  const res = await api.get<{ ok: boolean; data: TeacherExamReport }>(`/exams/${examId}/report`);
  return res.data.data;
}

export async function uploadExamStudioPdfContext(
  weekId: string,
  pdfFile: File,
  signal?: AbortSignal
): Promise<{ text: string; numPages: number; truncated: boolean }> {
  const form = new FormData();
  form.append("pdf", pdfFile);
  const res = await api.post<{
    ok: boolean;
    data: { text: string; numPages: number; truncated: boolean };
  }>(`/weeks/${weekId}/exam-studio/pdf-context`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    signal
  });
  return res.data.data;
}

export async function sendExamStudioChat(input: {
  weekId: string;
  message: string;
  currentDraft: TeacherExamDraftPayload;
  sourceText?: string;
}): Promise<ExamStudioProposal> {
  const res = await api.post<{ ok: boolean; data: ExamStudioProposal }>(
    `/weeks/${input.weekId}/exam-studio/chat`,
    {
      message: input.message,
      currentDraft: input.currentDraft,
      sourceText: input.sourceText
    }
  );
  return res.data.data;
}

export type ExamStudioStreamStage =
  | "PREPARING"
  | "ANALYZING_SOURCE"
  | "AI_THINKING"
  | "VALIDATING_JSON"
  | "APPLYING_TO_STUDIO"
  | "COMPLETE";

export type ExamStudioChatStreamEvent =
  | {
      type: "stage";
      stage: ExamStudioStreamStage;
      label: string;
      progress: number;
      detail?: string;
    }
  | {
      type: "thought_delta";
      text: string;
    }
  | {
      type: "proposal";
      data: ExamStudioProposal;
      thoughtSummary?: string;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      error: string;
    };

export type ExamStudioStreamFailureReason =
  | "missing_done"
  | "missing_proposal"
  | "invalid_ndjson"
  | "stream_error"
  | "malformed_order"
  | "unknown";

export class ExamStudioStreamError extends Error {
  readonly reason: ExamStudioStreamFailureReason;

  constructor(reason: ExamStudioStreamFailureReason, message: string) {
    super(message);
    this.name = "ExamStudioStreamError";
    this.reason = reason;
  }
}

type ExamStudioStreamParseState = {
  sawProposal: boolean;
  sawDone: boolean;
  finalProposal: ExamStudioProposal | null;
};

function handleExamStudioStreamLine(
  line: string,
  state: ExamStudioStreamParseState,
  onEvent: (event: ExamStudioChatStreamEvent) => void
): void {
  let payload: ExamStudioChatStreamEvent;
  try {
    payload = JSON.parse(line) as ExamStudioChatStreamEvent;
  } catch (error) {
    throw new ExamStudioStreamError(
      "invalid_ndjson",
      error instanceof Error ? `시험 설계 스트리밍 JSON을 해석하지 못했습니다: ${error.message}` : "시험 설계 스트리밍 JSON을 해석하지 못했습니다."
    );
  }

  if (!payload || typeof payload !== "object" || typeof payload.type !== "string") {
    throw new ExamStudioStreamError("invalid_ndjson", "시험 설계 스트리밍 이벤트 형식이 올바르지 않습니다.");
  }
  if (state.sawDone) {
    throw new ExamStudioStreamError("malformed_order", "시험 설계 스트리밍 완료 이후 추가 이벤트를 받았습니다.");
  }
  if (payload.type === "error") {
    throw new ExamStudioStreamError("stream_error", "시험 설계 스트리밍 처리 중 오류가 발생했습니다.");
  }

  if (payload.type === "proposal") {
    if (state.sawProposal) {
      throw new ExamStudioStreamError("malformed_order", "시험 설계 스트리밍 제안 이벤트가 중복되었습니다.");
    }
    state.sawProposal = true;
    state.finalProposal = payload.data;
    if (payload.thoughtSummary) {
      onEvent({
        type: "proposal",
        thoughtSummary: payload.thoughtSummary,
        data: {
          answerMarkdown: "",
          replyMarkdown: "",
          source: payload.data?.source ?? "AI"
        }
      });
    }
    return;
  }
  if (payload.type === "done") {
    state.sawDone = true;
    onEvent(payload);
    return;
  }
  if (payload.type === "stage" || payload.type === "thought_delta") {
    onEvent(payload);
    return;
  }

  throw new ExamStudioStreamError("invalid_ndjson", "알 수 없는 시험 설계 스트리밍 이벤트입니다.");
}

export async function streamExamStudioChat(
  input: {
    weekId: string;
    message: string;
    currentDraft: TeacherExamDraftPayload;
    sourceText?: string;
  },
  onEvent: (event: ExamStudioChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<ExamStudioProposal> {
  const response = await fetch(`/api/weeks/${input.weekId}/exam-studio/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "include",
    signal,
    body: JSON.stringify({
      message: input.message,
      currentDraft: input.currentDraft,
      sourceText: input.sourceText
    })
  });

  if (!response.ok) {
    throw parseFetchError(await response.text(), response.status);
  }

  if (!response.body) {
    throw new Error("시험 설계 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseState: ExamStudioStreamParseState = {
    sawProposal: false,
    sawDone: false,
    finalProposal: null
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");
      if (!line) continue;
      handleExamStudioStreamLine(line, parseState, onEvent);
    }
  }
  buffer += decoder.decode();
  const remainingLine = buffer.trim();
  if (remainingLine) {
    handleExamStudioStreamLine(remainingLine, parseState, onEvent);
  }

  if (!parseState.sawDone) {
    throw new ExamStudioStreamError("missing_done", "시험 설계 스트리밍이 완료 이벤트 없이 종료되었습니다.");
  }
  if (!parseState.finalProposal) {
    throw new ExamStudioStreamError("missing_proposal", "시험 설계 스트리밍 최종 제안을 받지 못했습니다.");
  }

  return parseState.finalProposal;
}

export async function getSessionByLecture(lectureId: string): Promise<{
  session: SessionState;
  lecture: LectureItem;
  pdfUrl: string;
  aiStatus: AiStatus;
}> {
  const res = await api.get<{
    ok: boolean;
    data: {
      session: SessionState;
      lecture: LectureItem;
      pdfUrl: string;
      aiStatus: AiStatus;
    };
  }>(`/session/by-lecture/${lectureId}`);
  return res.data.data;
}

export async function sendSessionEvent(
  sessionId: string,
  event: {
    type:
      | "SESSION_ENTERED"
      | "START_EXPLANATION_DECISION"
      | "USER_MESSAGE"
      | "PAGE_CHANGED"
      | "QUIZ_TYPE_SELECTED"
      | "QUIZ_DECISION"
      | "QUIZ_SUBMITTED"
      | "NEXT_PAGE_DECISION"
      | "REVIEW_DECISION"
      | "RETEST_DECISION"
      | "SAVE_AND_EXIT";
    payload?: Record<string, unknown>;
  },
  clientContext?: { currentPage?: number }
) {
  const res = await api.post(`/session/${sessionId}/event`, {
    event,
    clientContext
  });
  return res.data as {
    ok: boolean;
    newMessages: SessionState["messages"];
    ui: {
      openQuizModal: boolean;
      quiz: any;
      disableQuizClose: boolean;
      passScoreRatio: number;
      widgets?: any[];
    };
    patch: {
      currentPage: number;
      learningProgressPage: number;
      progressText: string;
      learnerModel: SessionState["learnerModel"];
      activeIntervention?: SessionState["activeIntervention"];
      quizRecord?: SessionState["quizzes"][number] | null;
    };
  };
}

export type SessionStreamEvent =
  | {
      type: "orchestrator_thought_delta";
      text: string;
    }
  | {
      type: "agent_delta";
      tool: string;
      agent: "ORCHESTRATOR" | "EXPLAINER" | "QA" | "QUIZ" | "GRADER" | "SYSTEM";
      channel: "thought" | "answer";
      text: string;
    }
  | {
      type: "error";
      error: string;
    };

export async function sendSessionEventStream(
  sessionId: string,
  event: {
    type:
      | "SESSION_ENTERED"
      | "START_EXPLANATION_DECISION"
      | "USER_MESSAGE"
      | "PAGE_CHANGED"
      | "QUIZ_TYPE_SELECTED"
      | "QUIZ_DECISION"
      | "QUIZ_SUBMITTED"
      | "NEXT_PAGE_DECISION"
      | "REVIEW_DECISION"
      | "RETEST_DECISION"
      | "SAVE_AND_EXIT";
    payload?: Record<string, unknown>;
  },
  onEvent: (event: SessionStreamEvent) => void,
  clientContext?: { currentPage?: number },
  signal?: AbortSignal
) {
  type SessionEventResult = Awaited<ReturnType<typeof sendSessionEvent>>;

  const response = await fetch(`/api/session/${sessionId}/event/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "include",
    signal,
    body: JSON.stringify({
      event,
      clientContext
    })
  });

  if (!response.ok) {
    const text = await response.text();
    let parsedMessage = "";
    let parsedCode = "";
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      parsedMessage =
        (typeof parsed.error === "string" && parsed.error) ||
        (typeof parsed.detail === "string" && parsed.detail) ||
        "";
      parsedCode = typeof parsed.code === "string" ? parsed.code : "";
    } catch {
      // keep raw response text fallback
    }
    throw new ApiError(parsedMessage || text || `HTTP ${response.status}`, response.status, parsedCode);
  }

  if (!response.body) {
    throw new Error("스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: SessionEventResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");
      if (!line) continue;

      const payload = JSON.parse(line) as
        | SessionStreamEvent
        | {
            type: "final";
            data: SessionEventResult;
          };

      if (payload.type === "final") {
        finalPayload = payload.data;
        continue;
      }

      if (payload.type === "error") {
        throw new Error(payload.error || "스트리밍 처리 중 오류가 발생했습니다.");
      }

      onEvent(payload);
    }
  }

  if (!finalPayload) {
    throw new Error("스트리밍 최종 결과를 받지 못했습니다.");
  }

  return finalPayload;
}

export async function saveSession(sessionId: string): Promise<void> {
  await api.post(`/session/${sessionId}/save`, {});
}
