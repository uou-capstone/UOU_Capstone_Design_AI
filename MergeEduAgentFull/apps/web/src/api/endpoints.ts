import { ApiError, api } from "./client";
import {
  AiStatus,
  Classroom,
  ClassroomStudent,
  CurrentUser,
  LectureItem,
  SessionState,
  StudentInviteCandidate,
  StudentCompetencyReport,
  StudentReportListItem,
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

export async function inviteStudent(
  classroomId: string,
  input: { studentUserId: string; name: string; code: string }
): Promise<ClassroomStudent> {
  const res = await api.post<{ ok: boolean; data: ClassroomStudent }>(
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
  onEvent: (event: ClassroomReportAnalysisStreamEvent) => void
): Promise<StudentCompetencyReport> {
  const response = await fetch(
    `/api/classrooms/${classroomId}/report/students/${studentUserId}/analyze/stream`,
    {
      method: "POST",
      credentials: "include"
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
