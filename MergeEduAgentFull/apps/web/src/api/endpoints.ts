import { ApiError, api } from "./client";
import {
  AiStatus,
  Classroom,
  ClassroomStudent,
  CurrentUser,
  ExamStudioProposal,
  LectureItem,
  SessionState,
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
  pdfFile: File
): Promise<{ text: string; numPages: number; truncated: boolean }> {
  const form = new FormData();
  form.append("pdf", pdfFile);
  const res = await api.post<{
    ok: boolean;
    data: { text: string; numPages: number; truncated: boolean };
  }>(`/weeks/${weekId}/exam-studio/pdf-context`, form, {
    headers: { "Content-Type": "multipart/form-data" }
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

function handleExamStudioStreamLine(
  line: string,
  onEvent: (event: ExamStudioChatStreamEvent) => void
): { proposal?: ExamStudioProposal; done?: boolean } {
  const payload = JSON.parse(line) as ExamStudioChatStreamEvent;
  if (payload.type === "error") {
    throw new Error(payload.error || "시험 설계 스트리밍 처리 중 오류가 발생했습니다.");
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
  let finalProposal: ExamStudioProposal | null = null;
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
      const handled = handleExamStudioStreamLine(line, onEvent);
      if (handled.proposal) finalProposal = handled.proposal;
      if (handled.done) sawDone = true;
    }
  }
  buffer += decoder.decode();
  const remainingLine = buffer.trim();
  if (remainingLine) {
    const handled = handleExamStudioStreamLine(remainingLine, onEvent);
    if (handled.proposal) finalProposal = handled.proposal;
    if (handled.done) sawDone = true;
  }

  if (!sawDone) {
    throw new Error("시험 설계 스트리밍이 완료 이벤트 없이 종료되었습니다.");
  }
  if (!finalProposal) {
    throw new Error("시험 설계 스트리밍 최종 제안을 받지 못했습니다.");
  }

  return finalProposal;
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
