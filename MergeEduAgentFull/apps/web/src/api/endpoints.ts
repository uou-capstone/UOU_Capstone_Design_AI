import { api } from "./client";
import {
  AiStatus,
  Classroom,
  LectureItem,
  SessionState,
  StudentCompetencyReport,
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
      type: "error";
      error: string;
    };

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
    method: "POST"
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

      const payload = JSON.parse(line) as
        | ClassroomReportAnalysisStreamEvent
        | {
            type: "final";
            data: StudentCompetencyReport;
          };

      if (payload.type === "final") {
        finalPayload = payload.data;
        continue;
      }

      if (payload.type === "error") {
        throw new Error(payload.error || "리포트 스트리밍 처리 중 오류가 발생했습니다.");
      }

      onEvent(payload);
    }
  }

  if (!finalPayload) {
    throw new Error("리포트 스트리밍 최종 결과를 받지 못했습니다.");
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
      widgets?: any[];
    };
    patch: {
      currentPage: number;
      progressText: string;
      learnerModel: SessionState["learnerModel"];
      activeIntervention?: SessionState["activeIntervention"];
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
  clientContext?: { currentPage?: number }
) {
  type SessionEventResult = Awaited<ReturnType<typeof sendSessionEvent>>;

  const response = await fetch(`/api/session/${sessionId}/event/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      event,
      clientContext
    })
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
      // keep raw response text fallback
    }
    throw new Error(parsedMessage || text || `HTTP ${response.status}`);
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
