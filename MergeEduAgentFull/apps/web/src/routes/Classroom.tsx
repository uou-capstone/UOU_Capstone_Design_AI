import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  createLecture,
  createWeek,
  deleteLecture,
  deleteTeacherExam,
  deleteWeek,
  deleteWeeksBulk,
  getClassroomAttendance,
  getClassroomMaterials,
  getLectures,
  getLectureDownloadUrl,
  getMyClassroomAttendance,
  getWeekExams,
  getWeeks,
  updateLectureTitle,
  updateTeacherExamSettings
} from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { ClassroomDiscussionsPanel } from "../components/classrooms/ClassroomDiscussionsPanel";
import { ClassroomNoticesPanel } from "../components/classrooms/ClassroomNoticesPanel";
import { InviteStudentPanel } from "../components/classrooms/InviteStudentPanel";
import { LectureUploaderModal } from "../components/lectures/LectureUploaderModal";
import {
  ClassroomAttendanceLectureProgress,
  ClassroomAttendanceStatus,
  ClassroomAttendanceStudent,
  ClassroomAttendanceSummary,
  ClassroomMaterialItem,
  LectureItem,
  StudentExamMetadata,
  StudentClassroomAttendanceSummary,
  TeacherExam,
  TeacherExamRevision,
  Week
} from "../types";

type ClassroomSection =
  | "invite"
  | "weeks"
  | "files"
  | "tasks"
  | "notices"
  | "discussion"
  | "report"
  | "attendance";
type MaterialSortMode = "newest" | "oldest";
type TaskExamStatusFilter = "all" | "upcoming" | "ongoing" | "ended";
type TaskExamSortMode = "createdAsc" | "startAsc" | "startDesc" | "createdDesc" | "titleAsc";
type TaskExamScheduleStatus = "upcoming" | "ongoing" | "ended";
type AttendanceStatusFilter = "all" | ClassroomAttendanceStatus;
type AttendanceSortMode = "default" | "progressDesc" | "progressAsc" | "recentDesc";

type RenameMaterialState = {
  lectureId: string;
  title: string;
  draftTitle: string;
  error: string;
};

type TaskExamSettingsDraft = {
  examId: string;
  title: string;
  availableFrom: string;
  availableUntil: string;
  timeLimitMinutes: string;
  error: string;
};

type TaskExamRow = {
  id: string;
  kind: "teacher" | "student";
  exam: TeacherExam | StudentExamMetadata;
  week: Week;
  title: string;
  scheduleStatus: TaskExamScheduleStatus;
  availableFrom?: string;
  availableUntil?: string;
  timeLimitMinutes?: number;
  points: number;
  questionCount: number;
  createdAt: string | null;
  sortCreatedAt: number;
  sortStartAt: number;
};

function isTeacherExam(exam: TeacherExam | StudentExamMetadata): exam is TeacherExam {
  return "draftRevision" in exam;
}

function isClassroomSection(value: string | null): value is ClassroomSection {
  return (
    value === "invite" ||
    value === "weeks" ||
    value === "files" ||
    value === "tasks" ||
    value === "notices" ||
    value === "discussion" ||
    value === "report" ||
    value === "attendance"
  );
}

function defaultClassroomSection(isTeacher: boolean): ClassroomSection {
  return isTeacher ? "invite" : "weeks";
}

type ClassroomIconName =
  | "book"
  | "calendar"
  | "check"
  | "chevron"
  | "clipboard"
  | "clock"
  | "download"
  | "edit"
  | "empty"
  | "file"
  | "more"
  | "pdf"
  | "play"
  | "plus"
  | "search"
  | "sort"
  | "trash"
  | "users"
  | "warning";

type StudentExamActionMeta = {
  label: string;
  ariaSuffix: string;
  icon: ClassroomIconName;
  className: string;
  testId: string;
  disabled?: boolean;
};

function getStudentExamActionMeta(attempt: StudentExamMetadata["attempt"]): StudentExamActionMeta {
  if (attempt?.status === "GRADING") {
    return {
      label: "채점 중",
      ariaSuffix: "채점 중",
      icon: "clock",
      className: "exam-grading-btn",
      testId: "classroom-exam-grading",
      disabled: true
    };
  }

  if (attempt?.status === "GRADED" && attempt.grading) {
    return {
      label: "결과 보기",
      ariaSuffix: "결과 보기",
      icon: "clipboard",
      className: "exam-result-btn",
      testId: "classroom-exam-result"
    };
  }

  if (attempt?.status === "GRADED") {
    return {
      label: "결과 준비 중",
      ariaSuffix: "결과 준비 중",
      icon: "clock",
      className: "exam-grading-btn exam-result-pending-btn",
      testId: "classroom-exam-result-pending",
      disabled: true
    };
  }

  return {
    label: "시험 응시",
    ariaSuffix: "시험 응시",
    icon: "clipboard",
    className: "exam-take-btn",
    testId: "classroom-exam-take"
  };
}

function ClassroomIcon({ name, className = "" }: { name: ClassroomIconName; className?: string }) {
  const commonProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false
  };

  if (name === "plus") {
    return (
      <svg {...commonProps}>
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg {...commonProps}>
        <path d="M8 9v8M12 9v8M16 9v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M5 7h14M10 4h4l1 3H9l1-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "chevron") {
    return (
      <svg {...commonProps}>
        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "book") {
    return (
      <svg {...commonProps}>
        <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H8a3 3 0 0 0-3 3V5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M5 5.5V21M8 7h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "clipboard") {
    return (
      <svg {...commonProps}>
        <path d="M9 4h6l1 3H8l1-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M7 6H5v15h14V6h-2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...commonProps}>
        <path d="M5 6.5h14v12H5v-12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 4.5v4M16 4.5v4M5 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "clock") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg {...commonProps}>
        <path d="M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20c.7-3.4 2.8-5.2 6-5.2s5.3 1.8 6 5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16.5 11.5a3 3 0 1 0-1.2-5.8M16.8 15.1c2.1.5 3.4 2.1 3.9 4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...commonProps}>
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "warning") {
    return (
      <svg {...commonProps}>
        <path d="M12 4 21 20H3L12 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 9v5M12 17.2h.01" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "file") {
    return (
      <svg {...commonProps}>
        <path d="M7 3h7l4 4v14H7V3Z" fill="currentColor" opacity="0.16" />
        <path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 3v5h4M10 13h5M10 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "pdf") {
    return (
      <svg {...commonProps}>
        <path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 3v5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.2 15.8v-3.6h1.3c.8 0 1.3.4 1.3 1.1s-.5 1.1-1.3 1.1h-1.3M12.8 15.8v-3.6h1c1.1 0 1.8.7 1.8 1.8s-.7 1.8-1.8 1.8h-1M16.6 15.8v-3.6h2.2M16.6 13.8h1.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "download") {
    return (
      <svg {...commonProps}>
        <path d="M12 4v10M8 10l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.9" />
        <path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "sort") {
    return (
      <svg {...commonProps}>
        <path d="M8 5v14M5.5 7.5 8 5l2.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 19V5M13.5 16.5 16 19l2.5-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M5 18.5 6 14l8.5-8.5a2.1 2.1 0 0 1 3 3L9 17l-4 1.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m13.5 6.5 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "play") {
    return (
      <svg {...commonProps}>
        <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
      </svg>
    );
  }

  if (name === "empty") {
    return (
      <svg {...commonProps}>
        <path d="M5 10h14l-2 8H7l-2-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m8 10 2-4h4l2 4M8 14h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseTaskExamDurationInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const minutes = Number(normalized);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 240 ? minutes : null;
}

function addMinutesToLocalInput(startLocal: string, minutes: number): string | null {
  const start = new Date(startLocal);
  if (Number.isNaN(start.getTime()) || !Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
    return null;
  }
  return toLocalInput(new Date(start.getTime() + minutes * 60_000).toISOString());
}

function getTaskExamTimestamp(value?: string | null): number {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

function getTaskExamScheduleStatus(
  availableFrom?: string | null,
  availableUntil?: string | null,
  now = Date.now()
): TaskExamScheduleStatus {
  const start = new Date(availableFrom ?? "").getTime();
  const end = new Date(availableUntil ?? "").getTime();
  if (Number.isFinite(start) && now < start) return "upcoming";
  if (Number.isFinite(end) && now > end) return "ended";
  return "ongoing";
}

function getTeacherExamEffectiveSettingsRevision(exam: TeacherExam): TeacherExamRevision {
  return exam.publishedRevision ?? exam.draftRevision;
}

function getTeacherExamRevisionPoints(revision: TeacherExamRevision): number {
  return revision.questions.reduce((sum, question) => sum + question.points, 0);
}

function getTaskExamStatusLabel(status: TaskExamScheduleStatus): string {
  if (status === "upcoming") return "예정";
  if (status === "ongoing") return "진행 중";
  return "종료";
}

function getStudentTaskExamStatusLine(exam: StudentExamMetadata): string {
  const status = exam.attempt?.status ?? exam.status;
  return `${status} · ${exam.totalPoints}점`;
}

function getAttendanceStatusLabel(status: ClassroomAttendanceStatus): string {
  if (status === "completed") return "완료";
  if (status === "notStarted") return "미접속";
  if (status === "needsAttention") return "복귀 필요";
  if (status === "noMaterials") return "자료 없음";
  return "학습 중";
}

function getStudentAttendanceLectureStatus(lecture: ClassroomAttendanceLectureProgress): string {
  if (lecture.completed) return "출석 완료";
  if (lecture.maxReachedPage > 0) return "학습 중";
  return "미시청";
}

function getStudentAttendanceLectureTone(lecture: ClassroomAttendanceLectureProgress): string {
  if (lecture.completed) return "complete";
  if (lecture.maxReachedPage > 0) return "progress";
  return "none";
}

function getScopedAttendanceStatus(input: {
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

type ScopedAttendanceStudent = ClassroomAttendanceStudent & {
  scopedLectures: ClassroomAttendanceLectureProgress[];
  scopedStatus: ClassroomAttendanceStatus;
  scopedCompletedLectureCount: number;
  scopedTotalLectureCount: number;
  scopedTotalReachedPages: number;
  scopedTotalPages: number;
  scopedCompletionRatio: number;
  scopedPageCoverageRatio: number;
  scopedLastTouchedAt?: string;
  scopedCurrentWeekTitle?: string;
};

function getScopedAttendanceStudent(
  student: ClassroomAttendanceStudent,
  weekFilter: string
): ScopedAttendanceStudent {
  const scopedLectures = weekFilter === "all"
    ? student.lectures
    : student.lectures.filter((lecture) => lecture.weekId === weekFilter);
  const scopedCompletedLectureCount = scopedLectures.filter((lecture) => lecture.completed).length;
  const scopedTotalLectureCount = scopedLectures.length;
  const scopedTotalReachedPages = scopedLectures.reduce((sum, lecture) => sum + lecture.maxReachedPage, 0);
  const scopedTotalPages = scopedLectures.reduce((sum, lecture) => sum + lecture.totalPages, 0);
  const scopedCompletionRatio = scopedTotalLectureCount > 0
    ? scopedCompletedLectureCount / scopedTotalLectureCount
    : 0;
  const scopedPageCoverageRatio = scopedTotalPages > 0 ? scopedTotalReachedPages / scopedTotalPages : 0;
  const latestLecture = scopedLectures
    .filter((lecture) => lecture.lastTouchedAt)
    .sort((a, b) => Date.parse(b.lastTouchedAt!) - Date.parse(a.lastTouchedAt!))[0];
  const scopedStatus = getScopedAttendanceStatus({
    totalLectureCount: scopedTotalLectureCount,
    completedLectureCount: scopedCompletedLectureCount,
    totalReachedPages: scopedTotalReachedPages,
    completionRatio: scopedCompletionRatio
  });

  return {
    ...student,
    scopedLectures,
    scopedStatus,
    scopedCompletedLectureCount,
    scopedTotalLectureCount,
    scopedTotalReachedPages,
    scopedTotalPages,
    scopedCompletionRatio,
    scopedPageCoverageRatio,
    ...(latestLecture?.lastTouchedAt ? { scopedLastTouchedAt: latestLecture.lastTouchedAt } : {}),
    ...(latestLecture?.weekTitle ? { scopedCurrentWeekTitle: latestLecture.weekTitle } : {})
  };
}

function buildTaskExamSettingsDraftFromRevision(
  examId: string,
  revision: TeacherExamRevision,
  error = ""
): TaskExamSettingsDraft {
  return {
    examId,
    title: revision.title,
    availableFrom: toLocalInput(revision.availableFrom),
    availableUntil: toLocalInput(revision.availableUntil),
    timeLimitMinutes: String(revision.timeLimitMinutes),
    error
  };
}

function buildTaskExamSettingsDraft(exam: TeacherExam, useEffectiveRevision = false): TaskExamSettingsDraft {
  return buildTaskExamSettingsDraftFromRevision(
    exam.id,
    useEffectiveRevision ? getTeacherExamEffectiveSettingsRevision(exam) : exam.draftRevision
  );
}

export function ClassroomRoute() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const { user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTeacher = user?.role === "teacher";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
  const [lecturesByWeek, setLecturesByWeek] = useState<Record<string, LectureItem[]>>({});
  const [examsByWeek, setExamsByWeek] = useState<Record<string, Array<TeacherExam | StudentExamMetadata>>>({});
  const [materials, setMaterials] = useState<ClassroomMaterialItem[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState("");
  const [materialActionError, setMaterialActionError] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialWeekFilter, setMaterialWeekFilter] = useState("all");
  const [materialSort, setMaterialSort] = useState<MaterialSortMode>("oldest");
  const [openMaterialMenuId, setOpenMaterialMenuId] = useState<string | null>(null);
  const [renameMaterial, setRenameMaterial] = useState<RenameMaterialState | null>(null);
  const [materialActionId, setMaterialActionId] = useState<string | null>(null);
  const [taskExamSearch, setTaskExamSearch] = useState("");
  const [taskExamWeekFilter, setTaskExamWeekFilter] = useState("all");
  const [taskExamStatusFilter, setTaskExamStatusFilter] = useState<TaskExamStatusFilter>("all");
  const [taskExamSort, setTaskExamSort] = useState<TaskExamSortMode>("createdAsc");
  const [taskExamsLoading, setTaskExamsLoading] = useState(false);
  const [taskExamsError, setTaskExamsError] = useState("");
  const [taskExamActionError, setTaskExamActionError] = useState("");
  const [expandedTaskExamId, setExpandedTaskExamId] = useState<string | null>(null);
  const [taskExamDraft, setTaskExamDraft] = useState<TaskExamSettingsDraft | null>(null);
  const [taskExamSavingId, setTaskExamSavingId] = useState<string | null>(null);
  const [taskExamNowMs, setTaskExamNowMs] = useState(() => Date.now());
  const [serverLockedExamIds, setServerLockedExamIds] = useState<Set<string>>(() => new Set());
  const [attendance, setAttendance] = useState<ClassroomAttendanceSummary | null>(null);
  const [studentAttendance, setStudentAttendance] = useState<StudentClassroomAttendanceSummary | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [attendanceWeekFilter, setAttendanceWeekFilter] = useState("all");
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<AttendanceStatusFilter>("all");
  const [attendanceSort, setAttendanceSort] = useState<AttendanceSortMode>("default");
  const [expandedAttendanceStudentId, setExpandedAttendanceStudentId] = useState<string | null>(null);
  const [expandedStudentAttendanceWeekId, setExpandedStudentAttendanceWeekId] = useState<string | null>(null);
  const [openUploaderForWeek, setOpenUploaderForWeek] = useState<string | null>(null);
  const [openWeekMenuId, setOpenWeekMenuId] = useState<string | null>(null);
  const [weekContentError, setWeekContentError] = useState("");
  const [activeSection, setActiveSection] = useState<ClassroomSection | null>(null);
  const sectionParam = searchParams.get("section");
  const weekParam = searchParams.get("week");
  const currentSection = activeSection ?? defaultClassroomSection(Boolean(isTeacher));
  const currentRouteTarget = `${location.pathname}${location.search}${location.hash}`;
  const weekContentRequestSeqRef = useRef(0);
  const materialsRequestSeqRef = useRef(0);
  const taskExamsRequestSeqRef = useRef(0);
  const attendanceRequestSeqRef = useRef(0);
  const currentSectionRef = useRef(currentSection);
  const classroomIdRef = useRef(classroomId);
  const isTeacherRef = useRef(Boolean(isTeacher));
  const expandedTaskExamIdRef = useRef(expandedTaskExamId);
  const taskExamDraftRef = useRef(taskExamDraft);

  const canBulkDelete = useMemo(
    () => selectionMode && selectedWeeks.length > 0,
    [selectionMode, selectedWeeks]
  );

  const resetAttendanceSurface = useCallback(() => {
    setAttendance(null);
    setStudentAttendance(null);
    setAttendanceLoading(false);
    setAttendanceError("");
    setAttendanceSearch("");
    setAttendanceWeekFilter("all");
    setAttendanceStatusFilter("all");
    setAttendanceSort("default");
    setExpandedAttendanceStudentId(null);
    setExpandedStudentAttendanceWeekId(null);
  }, []);

  const resetClassroomSurface = useCallback(() => {
    setWeeks([]);
    setExpandedWeek(null);
    setSelectionMode(false);
    setSelectedWeeks([]);
    setLecturesByWeek({});
    setExamsByWeek({});
    setMaterials([]);
    setMaterialsLoading(false);
    setMaterialsError("");
    setMaterialActionError("");
    setMaterialSearch("");
    setMaterialWeekFilter("all");
    setMaterialSort("oldest");
    setOpenMaterialMenuId(null);
    setRenameMaterial(null);
    setMaterialActionId(null);
    setTaskExamSearch("");
    setTaskExamWeekFilter("all");
    setTaskExamStatusFilter("all");
    setTaskExamSort("createdAsc");
    setTaskExamsLoading(false);
    setTaskExamsError("");
    setTaskExamActionError("");
    setServerLockedExamIds(new Set());
    expandedTaskExamIdRef.current = null;
    taskExamDraftRef.current = null;
    setExpandedTaskExamId(null);
    setTaskExamDraft(null);
    setTaskExamSavingId(null);
    resetAttendanceSurface();
    setOpenUploaderForWeek(null);
    setOpenWeekMenuId(null);
    setWeekContentError("");
  }, [resetAttendanceSurface]);

  const refreshWeeks = useCallback(async () => {
    if (!classroomId) return;
    setLoading(true);
    setLoadError("");
    try {
      setWeeks(await getWeeks(classroomId));
    } catch (error) {
      resetClassroomSurface();
      if (error instanceof ApiError && error.status === 401) {
        await refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        await refreshMe().catch(() => null);
        navigate(`/verify-email?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setLoadError("이 강의실에 접근할 권한이 없습니다.");
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setLoadError("강의실을 찾을 수 없습니다.");
        return;
      }
      setLoadError(error instanceof Error ? error.message : "강의실 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [classroomId, currentRouteTarget, navigate, refreshMe, resetClassroomSurface]);

  useEffect(() => {
    refreshWeeks().catch(console.error);
  }, [refreshWeeks]);

  useEffect(() => {
    if (!openWeekMenuId && !openMaterialMenuId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenWeekMenuId(null);
        setOpenMaterialMenuId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openMaterialMenuId, openWeekMenuId]);

  useEffect(() => {
    expandedTaskExamIdRef.current = expandedTaskExamId;
    taskExamDraftRef.current = taskExamDraft;
  }, [expandedTaskExamId, taskExamDraft]);

  useEffect(() => {
    if (!expandedTaskExamId || !taskExamDraft) return;
    const exam = findTeacherTaskExam(expandedTaskExamId);
    if (!exam || !isTeacherTaskExamLocked(exam, taskExamNowMs)) return;
    const lockedDraft = buildTaskExamSettingsDraft(exam, true);
    setTaskExamDraft((prev) => {
      if (!prev || prev.examId !== expandedTaskExamId) return prev;
      if (
        prev.title === lockedDraft.title &&
        prev.availableFrom === lockedDraft.availableFrom &&
        prev.availableUntil === lockedDraft.availableUntil &&
        prev.timeLimitMinutes === lockedDraft.timeLimitMinutes
      ) {
        return prev;
      }
      return { ...lockedDraft, error: prev.error };
    });
  }, [expandedTaskExamId, examsByWeek, serverLockedExamIds, taskExamDraft, taskExamNowMs]);

  useEffect(() => {
    classroomIdRef.current = classroomId;
    isTeacherRef.current = Boolean(isTeacher);
    taskExamsRequestSeqRef.current += 1;
    attendanceRequestSeqRef.current += 1;
    expandedTaskExamIdRef.current = null;
    taskExamDraftRef.current = null;
    setExpandedTaskExamId(null);
    setTaskExamDraft(null);
    setTaskExamSavingId(null);
    setServerLockedExamIds(new Set());
    setTaskExamActionError("");
    resetAttendanceSurface();
  }, [classroomId, isTeacher, resetAttendanceSurface]);

  useEffect(() => {
    setSelectedWeeks((prev) => prev.filter((id) => weeks.some((week) => week.id === id)));
    if (expandedWeek && !weeks.some((week) => week.id === expandedWeek)) {
      setExpandedWeek(null);
    }
    if (openWeekMenuId && !weeks.some((week) => week.id === openWeekMenuId)) {
      setOpenWeekMenuId(null);
    }
    setMaterialWeekFilter((prev) =>
      prev === "all" || weeks.some((week) => week.id === prev) ? prev : "all"
    );
    setTaskExamWeekFilter((prev) =>
      prev === "all" || weeks.some((week) => week.id === prev) ? prev : "all"
    );
    setAttendanceWeekFilter((prev) =>
      prev === "all" || weeks.some((week) => week.id === prev) ? prev : "all"
    );
  }, [weeks, expandedWeek, openWeekMenuId]);

  useEffect(() => {
    if (!user?.role) return;
    const nextSection = resolveSection(sectionParam);
    setActiveSection((prev) => (prev === nextSection ? prev : nextSection));
  }, [user?.role, sectionParam]);

  useEffect(() => {
    if (activeSection === "report" && !classroomId) {
      setActiveSection("weeks");
    }
  }, [activeSection, classroomId]);

  useEffect(() => {
    if (!activeSection) return;
    setOpenWeekMenuId(null);
    if (activeSection !== "weeks") {
      setOpenUploaderForWeek(null);
    }
    if (activeSection !== "files") {
      setOpenMaterialMenuId(null);
      setRenameMaterial(null);
      setMaterialActionError("");
    }
    if (activeSection !== "tasks") {
      setTaskExamActionError("");
      expandedTaskExamIdRef.current = null;
      taskExamDraftRef.current = null;
      setExpandedTaskExamId(null);
      setTaskExamDraft(null);
    }
    if (activeSection !== "attendance") {
      resetAttendanceSurface();
    }
  }, [activeSection, resetAttendanceSurface]);

  useEffect(() => {
    currentSectionRef.current = currentSection;
    if (currentSection !== "weeks") {
      weekContentRequestSeqRef.current += 1;
    }
    if (currentSection !== "files") {
      materialsRequestSeqRef.current += 1;
    }
    if (currentSection !== "tasks") {
      taskExamsRequestSeqRef.current += 1;
    }
    if (currentSection !== "attendance") {
      attendanceRequestSeqRef.current += 1;
    }
  }, [currentSection]);

  useEffect(() => {
    if (loading || currentSection !== "weeks" || !weekParam) return;
    const targetWeek = weeks.find((week) => week.id === weekParam);
    if (!targetWeek) return;
    setExpandedWeek(targetWeek.id);
    loadWeekContent(targetWeek.id).catch(console.error);
  }, [currentSection, loading, weekParam, weeks]);

  useEffect(() => {
    if (loading || currentSection !== "files" || !classroomId) return;
    loadMaterials().catch(console.error);
  }, [classroomId, currentSection, loading]);

  useEffect(() => {
    if (loading || currentSection !== "tasks" || !classroomId) return;
    loadTaskExams().catch(console.error);
  }, [classroomId, currentSection, isTeacher, loading, weeks]);

  useEffect(() => {
    if (loading || currentSection !== "tasks") return;
    setTaskExamNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setTaskExamNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [currentSection, loading]);

  useEffect(() => {
    if (loading || currentSection !== "attendance" || !classroomId) return;
    if (isTeacher) {
      loadAttendance().catch(console.error);
    } else {
      loadStudentAttendance().catch(console.error);
    }
  }, [classroomId, currentSection, isTeacher, loading, weeks]);

  async function loadWeekContent(weekId: string) {
    const requestId = weekContentRequestSeqRef.current + 1;
    weekContentRequestSeqRef.current = requestId;
    const isActiveWeekContentRequest = () =>
      weekContentRequestSeqRef.current === requestId && currentSectionRef.current === "weeks";
    setWeekContentError("");
    try {
      const [lectures, exams] = await Promise.all([getLectures(weekId), getWeekExams(weekId)]);
      if (!isActiveWeekContentRequest()) return;
      setLecturesByWeek((prev) => ({ ...prev, [weekId]: lectures }));
      setExamsByWeek((prev) => ({ ...prev, [weekId]: exams }));
    } catch (error) {
      if (!isActiveWeekContentRequest()) return;
      if (error instanceof ApiError && error.status === 401) {
        await refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        await refreshMe().catch(() => null);
        navigate(`/verify-email?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setWeekContentError("이 주차 콘텐츠에 접근할 권한이 없습니다.");
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setWeekContentError("주차 콘텐츠를 찾을 수 없습니다.");
        return;
      }
      setWeekContentError(error instanceof Error ? error.message : "주차 콘텐츠를 불러오지 못했습니다.");
    }
  }

  async function loadMaterials() {
    if (!classroomId) return;
    const requestId = materialsRequestSeqRef.current + 1;
    materialsRequestSeqRef.current = requestId;
    const isActiveMaterialsRequest = () =>
      materialsRequestSeqRef.current === requestId && currentSectionRef.current === "files";
    setMaterialsLoading(true);
    setMaterialsError("");
    setMaterialActionError("");
    try {
      const data = await getClassroomMaterials(classroomId);
      if (!isActiveMaterialsRequest()) return;
      setMaterials(data);
    } catch (error) {
      if (!isActiveMaterialsRequest()) return;
      if (error instanceof ApiError && error.status === 401) {
        await refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        await refreshMe().catch(() => null);
        navigate(`/verify-email?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setMaterialsError("이 자료실에 접근할 권한이 없습니다.");
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setMaterialsError("강의실을 찾을 수 없습니다.");
        return;
      }
      setMaterialsError(error instanceof Error ? error.message : "자료실을 불러오지 못했습니다.");
    } finally {
      if (isActiveMaterialsRequest()) {
        setMaterialsLoading(false);
      }
    }
  }

  async function loadTaskExams() {
    if (!classroomId) return;
    const requestClassroomId = classroomId;
    const requestIsTeacher = Boolean(isTeacher);
    const requestId = taskExamsRequestSeqRef.current + 1;
    taskExamsRequestSeqRef.current = requestId;
    const isActiveTaskExamRequest = () =>
      taskExamsRequestSeqRef.current === requestId &&
      currentSectionRef.current === "tasks" &&
      classroomIdRef.current === requestClassroomId &&
      isTeacherRef.current === requestIsTeacher;
    setTaskExamsLoading(true);
    setTaskExamsError("");
    setTaskExamActionError("");
    try {
      const entries = await Promise.all(
        weeks.map(async (week) => [week.id, await getWeekExams(week.id)] as const)
      );
      if (!isActiveTaskExamRequest()) return;
      setExamsByWeek((prev) => {
        const next = { ...prev };
        for (const week of weeks) {
          next[week.id] = entries.find(([weekId]) => weekId === week.id)?.[1] ?? [];
        }
        return next;
      });
    } catch (error) {
      if (!isActiveTaskExamRequest()) return;
      if (error instanceof ApiError && error.status === 401) {
        await refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        await refreshMe().catch(() => null);
        navigate(`/verify-email?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setTaskExamsError("이 강의실의 시험 목록에 접근할 권한이 없습니다.");
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setTaskExamsError("강의실 또는 주차를 찾을 수 없습니다.");
        return;
      }
      setTaskExamsError(error instanceof Error ? error.message : "시험 목록을 불러오지 못했습니다.");
    } finally {
      if (isActiveTaskExamRequest()) {
        setTaskExamsLoading(false);
      }
    }
  }

  async function loadAttendance() {
    if (!classroomId || !isTeacher) return;
    const requestClassroomId = classroomId;
    const requestIsTeacher = Boolean(isTeacher);
    const requestId = attendanceRequestSeqRef.current + 1;
    attendanceRequestSeqRef.current = requestId;
    const isActiveAttendanceRequest = () =>
      attendanceRequestSeqRef.current === requestId &&
      currentSectionRef.current === "attendance" &&
      classroomIdRef.current === requestClassroomId &&
      isTeacherRef.current === requestIsTeacher &&
      requestIsTeacher;
    setAttendanceLoading(true);
    setAttendance(null);
    setStudentAttendance(null);
    setAttendanceError("");
    setExpandedAttendanceStudentId(null);
    try {
      const data = await getClassroomAttendance(requestClassroomId);
      if (!isActiveAttendanceRequest()) return;
      setAttendance(data);
    } catch (error) {
      if (!isActiveAttendanceRequest()) return;
      if (error instanceof ApiError && error.status === 401) {
        await refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        await refreshMe().catch(() => null);
        navigate(`/verify-email?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setAttendanceError("이 출석 현황에 접근할 권한이 없습니다.");
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setAttendanceError("강의실을 찾을 수 없습니다.");
        return;
      }
      setAttendanceError(error instanceof Error ? error.message : "출석 현황을 불러오지 못했습니다.");
    } finally {
      if (isActiveAttendanceRequest()) {
        setAttendanceLoading(false);
      }
    }
  }

  async function loadStudentAttendance() {
    if (!classroomId || isTeacher) return;
    const requestClassroomId = classroomId;
    const requestIsTeacher = Boolean(isTeacher);
    const requestId = attendanceRequestSeqRef.current + 1;
    attendanceRequestSeqRef.current = requestId;
    const isActiveAttendanceRequest = () =>
      attendanceRequestSeqRef.current === requestId &&
      currentSectionRef.current === "attendance" &&
      classroomIdRef.current === requestClassroomId &&
      isTeacherRef.current === requestIsTeacher &&
      !requestIsTeacher;
    setAttendanceLoading(true);
    setAttendance(null);
    setStudentAttendance(null);
    setAttendanceError("");
    setExpandedAttendanceStudentId(null);
    setExpandedStudentAttendanceWeekId(null);
    try {
      const data = await getMyClassroomAttendance(requestClassroomId);
      if (!isActiveAttendanceRequest()) return;
      setStudentAttendance(data);
      setExpandedStudentAttendanceWeekId(data.weeks[0]?.weekId ?? null);
    } catch (error) {
      if (!isActiveAttendanceRequest()) return;
      if (error instanceof ApiError && error.status === 401) {
        await refreshMe().catch(() => null);
        navigate(`/login?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        await refreshMe().catch(() => null);
        navigate(`/verify-email?next=${encodeURIComponent(currentRouteTarget)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setAttendanceError("이 출석 현황에 접근할 권한이 없습니다.");
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setAttendanceError("강의실을 찾을 수 없습니다.");
        return;
      }
      setAttendanceError(error instanceof Error ? error.message : "출석 현황을 불러오지 못했습니다.");
    } finally {
      if (isActiveAttendanceRequest()) {
        setAttendanceLoading(false);
      }
    }
  }

  function syncUpdatedLecture(updatedLecture: LectureItem) {
    setMaterials((prev) =>
      prev.map((item) =>
        item.lecture.id === updatedLecture.id ? { ...item, lecture: updatedLecture } : item
      )
    );
    setLecturesByWeek((prev) => {
      const current = prev[updatedLecture.weekId];
      if (!current) return prev;
      return {
        ...prev,
        [updatedLecture.weekId]: current.map((lecture) =>
          lecture.id === updatedLecture.id ? updatedLecture : lecture
        )
      };
    });
  }

  function removeLectureFromClassroomState(lectureId: string) {
    setMaterials((prev) => prev.filter((item) => item.lecture.id !== lectureId));
    setLecturesByWeek((prev) => {
      let changed = false;
      const next: Record<string, LectureItem[]> = {};
      for (const [weekId, lectures] of Object.entries(prev)) {
        const filtered = lectures.filter((lecture) => lecture.id !== lectureId);
        if (filtered.length !== lectures.length) {
          changed = true;
        }
        next[weekId] = filtered;
      }
      return changed ? next : prev;
    });
  }

  function syncUpdatedExam(updatedExam: TeacherExam) {
    setExamsByWeek((prev) => {
      const current = prev[updatedExam.weekId] ?? [];
      const nextForWeek = current.some((exam) => exam.id === updatedExam.id)
        ? current.map((exam) => (exam.id === updatedExam.id ? updatedExam : exam))
        : [...current, updatedExam];
      return { ...prev, [updatedExam.weekId]: nextForWeek };
    });
  }

  function openRenameMaterial(item: ClassroomMaterialItem) {
    setOpenMaterialMenuId(null);
    setMaterialActionError("");
    setRenameMaterial({
      lectureId: item.lecture.id,
      title: item.lecture.title,
      draftTitle: item.lecture.title,
      error: ""
    });
  }

  async function onRenameMaterial() {
    if (!renameMaterial || !isTeacher) return;
    const title = renameMaterial.draftTitle.trim();
    if (!title) {
      setRenameMaterial((prev) => prev ? { ...prev, error: "자료 이름을 입력해 주세요." } : prev);
      return;
    }
    setMaterialActionId(renameMaterial.lectureId);
    setRenameMaterial((prev) => prev ? { ...prev, error: "" } : prev);
    try {
      const updated = await updateLectureTitle(renameMaterial.lectureId, title);
      syncUpdatedLecture(updated);
      setRenameMaterial(null);
    } catch (error) {
      setRenameMaterial((prev) =>
        prev
          ? {
              ...prev,
              error: error instanceof Error ? error.message : "자료 이름을 수정하지 못했습니다."
            }
          : prev
      );
    } finally {
      setMaterialActionId(null);
    }
  }

  async function onDeleteMaterial(item: ClassroomMaterialItem) {
    if (!isTeacher) return;
    if (!confirm("이 자료를 삭제하시겠습니까? 주차 관리에서도 함께 삭제됩니다.")) return;
    setMaterialActionError("");
    setMaterialActionId(item.lecture.id);
    try {
      await deleteLecture(item.lecture.id);
      removeLectureFromClassroomState(item.lecture.id);
      setOpenMaterialMenuId(null);
    } catch (error) {
      setMaterialActionError(error instanceof Error ? error.message : "자료를 삭제하지 못했습니다.");
    } finally {
      setMaterialActionId(null);
    }
  }

  async function onAddWeek() {
    if (!classroomId || !isTeacher) return;
    selectSection("weeks");
    await createWeek(classroomId);
    await refreshWeeks();
  }

  async function onDeleteWeek(weekId: string) {
    if (!isTeacher) return;
    if (!confirm("해당 주차를 삭제하시겠습니까?")) return;
    await deleteWeek(weekId);
    setSelectedWeeks((prev) => prev.filter((id) => id !== weekId));
    setOpenWeekMenuId(null);
    await refreshWeeks();
  }

  async function onBulkDelete() {
    if (!canBulkDelete || !isTeacher) return;
    if (!confirm("선택한 주차를 일괄 삭제하시겠습니까?")) return;
    await deleteWeeksBulk(selectedWeeks);
    exitSelectionMode();
    await refreshWeeks();
  }

  function enterSelectionMode() {
    if (!isTeacher) return;
    selectSection("weeks");
    setSelectionMode(true);
    setSelectedWeeks([]);
    setOpenWeekMenuId(null);
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedWeeks([]);
  }

  function toggleSelection(weekId: string) {
    setSelectedWeeks((prev) =>
      prev.includes(weekId) ? prev.filter((id) => id !== weekId) : [...prev, weekId]
    );
  }

  async function toggleExpand(weekId: string) {
    const willExpand = expandedWeek !== weekId;
    setExpandedWeek(willExpand ? weekId : null);
    if (willExpand) {
      await loadWeekContent(weekId);
    }
  }

  async function onUploadLecture(weekId: string, payload: { title: string; file: File }) {
    if (!isTeacher) return;
    await createLecture(weekId, payload.title, payload.file);
    await loadWeekContent(weekId);
  }

  async function onDeleteLecture(weekId: string, lectureId: string) {
    if (!isTeacher) return;
    if (!confirm("강의를 삭제하시겠습니까?")) return;
    await deleteLecture(lectureId);
    removeLectureFromClassroomState(lectureId);
    await loadWeekContent(weekId);
  }

  async function onDeleteExam(weekId: string, examId: string) {
    if (!isTeacher) return;
    if (!confirm("시험을 삭제하시겠습니까?")) return;
    await deleteTeacherExam(examId);
    await loadWeekContent(weekId);
  }

  function findTeacherTaskExam(examId: string): TeacherExam | null {
    for (const exams of Object.values(examsByWeek)) {
      const exam = exams.find((item) => item.id === examId);
      if (exam && isTeacherExam(exam)) return exam;
    }
    return null;
  }

  function isTeacherTaskExamLocked(exam: TeacherExam, nowMs = Date.now()): boolean {
    return (
      serverLockedExamIds.has(exam.id) ||
      getTaskExamScheduleStatus(
        getTeacherExamEffectiveSettingsRevision(exam).availableFrom,
        getTeacherExamEffectiveSettingsRevision(exam).availableUntil,
        nowMs
      ) === "ended"
    );
  }

  function openTaskExamDetails(exam: TeacherExam) {
    const nextDraft = buildTaskExamSettingsDraft(exam, isTeacherTaskExamLocked(exam));
    expandedTaskExamIdRef.current = exam.id;
    taskExamDraftRef.current = nextDraft;
    setExpandedTaskExamId(exam.id);
    setTaskExamDraft(nextDraft);
    setTaskExamActionError("");
  }

  function closeTaskExamDetails() {
    expandedTaskExamIdRef.current = null;
    taskExamDraftRef.current = null;
    setExpandedTaskExamId(null);
    setTaskExamDraft(null);
  }

  function updateTaskExamStart(availableFrom: string) {
    setTaskExamDraft((prev) => {
      if (!prev) return prev;
      const duration = parseTaskExamDurationInput(prev.timeLimitMinutes);
      const calculatedUntil = duration !== null ? addMinutesToLocalInput(availableFrom, duration) : null;
      return {
        ...prev,
        availableFrom,
        availableUntil: calculatedUntil ?? prev.availableUntil,
        error: ""
      };
    });
  }

  function updateTaskExamDuration(timeLimitMinutes: string) {
    setTaskExamDraft((prev) => {
      if (!prev) return prev;
      const duration = parseTaskExamDurationInput(timeLimitMinutes);
      const calculatedUntil = duration !== null ? addMinutesToLocalInput(prev.availableFrom, duration) : null;
      return {
        ...prev,
        timeLimitMinutes,
        availableUntil: calculatedUntil ?? prev.availableUntil,
        error: ""
      };
    });
  }

  async function saveTaskExamSettings() {
    if (!isTeacher || !taskExamDraft) return;
    const requestExamId = taskExamDraft.examId;
    const currentExam = findTeacherTaskExam(requestExamId);
    if (currentExam && isTeacherTaskExamLocked(currentExam)) {
      const lockedDraft = buildTaskExamSettingsDraft(currentExam, true);
      setTaskExamDraft((prev) =>
        prev?.examId === requestExamId
          ? {
              ...lockedDraft,
              error: "종료된 시험은 기록 보존을 위해 이름과 시간 설정을 수정할 수 없습니다."
            }
          : prev
      );
      return;
    }
    const title = taskExamDraft.title.trim();
    const availableFrom = fromLocalInput(taskExamDraft.availableFrom);
    const availableUntil = fromLocalInput(taskExamDraft.availableUntil);
    const startTime = Date.parse(availableFrom);
    const endTime = Date.parse(availableUntil);
    const timeLimitMinutes = parseTaskExamDurationInput(taskExamDraft.timeLimitMinutes);
    const errors: string[] = [];
    if (!title) errors.push("시험 이름을 입력해 주세요.");
    if (!availableFrom || !Number.isFinite(startTime)) errors.push("시작 시간을 확인해 주세요.");
    if (!availableUntil || !Number.isFinite(endTime)) errors.push("종료 시간을 확인해 주세요.");
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && startTime >= endTime) {
      errors.push("시작 시간은 종료 시간보다 빨라야 합니다.");
    }
    if (timeLimitMinutes === null) {
      errors.push("진행 시간은 1~240분 사이로 입력해 주세요.");
    }
    if (errors.length > 0) {
      setTaskExamDraft((prev) => prev?.examId === requestExamId ? { ...prev, error: errors.join("\n") } : prev);
      return;
    }
    if (timeLimitMinutes === null) return;

    setTaskExamSavingId(requestExamId);
    setTaskExamDraft((prev) => prev?.examId === requestExamId ? { ...prev, error: "" } : prev);
    setTaskExamActionError("");
    try {
      const updated = await updateTeacherExamSettings(requestExamId, {
        title,
        availableFrom,
        availableUntil,
        timeLimitMinutes
      });
      syncUpdatedExam(updated);
      if (taskExamDraftRef.current?.examId === requestExamId) {
        setTaskExamDraft(buildTaskExamSettingsDraft(updated));
      }
      if (expandedTaskExamIdRef.current === requestExamId) {
        setExpandedTaskExamId(updated.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "시험 설정을 저장하지 못했습니다.";
      if (error instanceof ApiError && error.code === "EXAM_ENDED") {
        setServerLockedExamIds((prev) => new Set(prev).add(requestExamId));
        const lockedExam = findTeacherTaskExam(requestExamId);
        const lockedDraft = lockedExam ? buildTaskExamSettingsDraft(lockedExam, true) : null;
        setTaskExamDraft((prev) =>
          prev?.examId === requestExamId
            ? { ...(lockedDraft ?? prev), error: message }
            : prev
        );
        return;
      }
      if (taskExamDraftRef.current?.examId === requestExamId) {
        setTaskExamDraft((prev) => prev?.examId === requestExamId ? { ...prev, error: message } : prev);
      } else {
        setTaskExamActionError(message);
      }
    } finally {
      setTaskExamSavingId((prev) => prev === requestExamId ? null : prev);
    }
  }

  function canUseSection(section: ClassroomSection) {
    return (
      isTeacher ||
      section === "weeks" ||
      section === "files" ||
      section === "tasks" ||
      section === "notices" ||
      section === "discussion" ||
      section === "attendance"
    );
  }

  function resolveSection(rawSection: string | null): ClassroomSection {
    if (isClassroomSection(rawSection) && canUseSection(rawSection)) {
      return rawSection;
    }
    return defaultClassroomSection(Boolean(isTeacher));
  }

  function writeSectionQuery(section: ClassroomSection) {
    const next = new URLSearchParams(searchParams);
    next.set("section", section);
    setSearchParams(next);
  }

  function selectSection(section: ClassroomSection) {
    if (!canUseSection(section)) return;
    setActiveSection(section);
    writeSectionQuery(section);
  }

  const canRenderClassroomTools = !loading && !loadError;
  const teacherSelectionMode = Boolean(isTeacher && selectionMode);
  const loadedLectureCount = Object.values(lecturesByWeek).flat().length;
  const loadedExamCount = Object.values(examsByWeek).flat().length;
  const materialRows = useMemo(() => {
    const query = materialSearch.trim().toLocaleLowerCase("ko-KR");
    return materials
      .filter((item) => materialWeekFilter === "all" || item.week.id === materialWeekFilter)
      .filter((item) => !query || item.lecture.title.toLocaleLowerCase("ko-KR").includes(query))
      .sort((a, b) => {
        const aTime = Date.parse(a.lecture.createdAt);
        const bTime = Date.parse(b.lecture.createdAt);
        const safeATime = Number.isFinite(aTime) ? aTime : 0;
        const safeBTime = Number.isFinite(bTime) ? bTime : 0;
        const dateOrder = materialSort === "newest"
          ? safeBTime - safeATime
          : safeATime - safeBTime;
        if (dateOrder !== 0) return dateOrder;
        return a.lecture.title.localeCompare(b.lecture.title, "ko");
      });
  }, [materialSearch, materialSort, materialWeekFilter, materials]);
	  const taskExamAllRows = useMemo<TaskExamRow[]>(
	    () =>
	      weeks.flatMap((week) =>
	        (examsByWeek[week.id] ?? []).flatMap((exam): TaskExamRow[] => {
	          if (!isTeacher && isTeacherExam(exam)) {
	            return [];
	          }
	          if (isTeacherExam(exam)) {
	            const revision = getTeacherExamEffectiveSettingsRevision(exam);
	            const createdAt = exam.createdAt;
	            return [{
	              id: exam.id,
	              kind: "teacher" as const,
	              exam,
              week,
              title: revision.title,
              scheduleStatus: getTaskExamScheduleStatus(revision.availableFrom, revision.availableUntil, taskExamNowMs),
              availableFrom: revision.availableFrom,
              availableUntil: revision.availableUntil,
              timeLimitMinutes: revision.timeLimitMinutes,
              points: getTeacherExamRevisionPoints(revision),
              questionCount: revision.questions.length,
	              createdAt,
	              sortCreatedAt: getTaskExamTimestamp(createdAt),
	              sortStartAt: getTaskExamTimestamp(revision.availableFrom)
	            }];
	          }

	          const startTimestamp = getTaskExamTimestamp(exam.availableFrom);
	          return [{
	            id: exam.id,
	            kind: "student" as const,
            exam,
            week,
            title: exam.title,
            scheduleStatus: getTaskExamScheduleStatus(exam.availableFrom, exam.availableUntil, taskExamNowMs),
            availableFrom: exam.availableFrom,
            availableUntil: exam.availableUntil,
            timeLimitMinutes: exam.timeLimitMinutes,
            points: exam.totalPoints,
            questionCount: exam.questionCount,
	            createdAt: null,
	            sortCreatedAt: startTimestamp,
	            sortStartAt: startTimestamp
	          }];
	        })
	      ),
	    [examsByWeek, isTeacher, taskExamNowMs, weeks]
	  );
  const taskExamRows = useMemo(() => {
    const query = taskExamSearch.trim().toLocaleLowerCase("ko-KR");
    const compareWeekTitle = (a: TaskExamRow, b: TaskExamRow) =>
      a.week.weekIndex - b.week.weekIndex || a.title.localeCompare(b.title, "ko");
    return taskExamAllRows
      .filter((row) => taskExamWeekFilter === "all" || row.week.id === taskExamWeekFilter)
      .filter((row) => taskExamStatusFilter === "all" || row.scheduleStatus === taskExamStatusFilter)
      .filter((row) => !query || row.title.toLocaleLowerCase("ko-KR").includes(query))
      .sort((a, b) => {
        if (taskExamSort === "titleAsc") {
          return a.title.localeCompare(b.title, "ko") || compareWeekTitle(a, b);
        }
        if (taskExamSort === "createdDesc") {
          return b.sortCreatedAt - a.sortCreatedAt || compareWeekTitle(a, b);
        }
        if (taskExamSort === "createdAsc") {
          return a.sortCreatedAt - b.sortCreatedAt || compareWeekTitle(a, b);
        }
        return taskExamSort === "startDesc"
          ? b.sortStartAt - a.sortStartAt || compareWeekTitle(a, b)
          : a.sortStartAt - b.sortStartAt || compareWeekTitle(a, b);
      });
  }, [taskExamAllRows, taskExamSearch, taskExamSort, taskExamStatusFilter, taskExamWeekFilter]);
  const attendanceRows = useMemo(() => {
    const query = attendanceSearch.trim().toLocaleLowerCase("ko-KR");
    return (attendance?.students ?? [])
      .map((student) => getScopedAttendanceStudent(student, attendanceWeekFilter))
      .filter((student) =>
        !query ||
        student.displayName.toLocaleLowerCase("ko-KR").includes(query) ||
        student.inviteCode.includes(query)
      )
      .filter((student) =>
        attendanceStatusFilter === "all" || student.scopedStatus === attendanceStatusFilter
      )
      .sort((a, b) => {
        if (attendanceSort === "progressDesc") {
          return b.scopedCompletionRatio - a.scopedCompletionRatio ||
            a.displayName.localeCompare(b.displayName, "ko");
        }
        if (attendanceSort === "progressAsc") {
          return a.scopedCompletionRatio - b.scopedCompletionRatio ||
            a.displayName.localeCompare(b.displayName, "ko");
        }
        if (attendanceSort === "recentDesc") {
          const aTime = Date.parse(a.scopedLastTouchedAt ?? "");
          const bTime = Date.parse(b.scopedLastTouchedAt ?? "");
          const safeATime = Number.isFinite(aTime) ? aTime : 0;
          const safeBTime = Number.isFinite(bTime) ? bTime : 0;
          return safeBTime - safeATime || a.displayName.localeCompare(b.displayName, "ko");
        }
        return a.displayName.localeCompare(b.displayName, "ko") || a.inviteCode.localeCompare(b.inviteCode);
      });
  }, [attendance, attendanceSearch, attendanceSort, attendanceStatusFilter, attendanceWeekFilter]);
  useEffect(() => {
    if (currentSection !== "attendance" || attendanceLoading || attendanceError) return;
    if (attendanceRows.length === 0) {
      setExpandedAttendanceStudentId(null);
      return;
    }
    setExpandedAttendanceStudentId((prev) =>
      prev && attendanceRows.some((student) => student.studentUserId === prev)
        ? prev
        : attendanceRows[0].studentUserId
    );
  }, [attendanceError, attendanceLoading, attendanceRows, currentSection]);
  const totalMaterialCount = materials.length;
  const materialWeekCount = weeks.length;
  const totalTaskExamCount = taskExamAllRows.length;
  const ongoingTaskExamCount = taskExamAllRows.filter((row) => row.scheduleStatus === "ongoing").length;
  const totalAttendanceStudents = attendance?.totalStudents ?? 0;
  const activeAttendanceStudents = attendance?.activeStudentCount ?? 0;
  const attentionAttendanceStudents = attendance?.attentionStudentCount ?? 0;
  const studentAttendancePercent = Math.round((studentAttendance?.overallAttendanceRatio ?? 0) * 100);
  const studentCompletedLectures = studentAttendance?.completedLectureCount ?? 0;
  const studentTotalLectures = studentAttendance?.totalLectureCount ?? 0;
  const studentCompletedExams = studentAttendance?.completedExamCount ?? 0;
  const studentTotalExams = studentAttendance?.totalExamCount ?? 0;
  const studentTotalWeeks = studentAttendance?.totalWeeks ?? weeks.length;
  const formatMaterialDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  };
  const formatTaskExamDate = (value?: string | null) => {
    const date = new Date(value ?? "");
    if (Number.isNaN(date.getTime())) return "-";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  };
  const formatTaskExamDateTime = (value?: string | null) => {
    const date = new Date(value ?? "");
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  const formatAttendanceDateTime = (value?: string) => {
    if (!value) return "기록 없음";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "기록 없음";
    return date.toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  const groupAttendanceLecturesByWeek = (lectures: ClassroomAttendanceLectureProgress[]) =>
    lectures.reduce<Array<{ weekId: string; weekTitle: string; weekIndex: number; lectures: ClassroomAttendanceLectureProgress[] }>>(
      (groups, lecture) => {
        const existing = groups.find((group) => group.weekId === lecture.weekId);
        if (existing) {
          existing.lectures.push(lecture);
        } else {
          groups.push({
            weekId: lecture.weekId,
            weekTitle: lecture.weekTitle,
            weekIndex: lecture.weekIndex,
            lectures: [lecture]
          });
        }
        return groups;
      },
      []
    );
  const getLearningSessionPath = (lectureId: string, weekId: string) => {
    const next = new URLSearchParams();
    if (classroomId) {
      next.set("classroomId", classroomId);
    }
    next.set("section", "weeks");
    next.set("week", weekId);
    return `/session/${encodeURIComponent(lectureId)}?${next.toString()}`;
  };
  const showClassroomHero =
    currentSection !== "invite" &&
    currentSection !== "files" &&
    currentSection !== "tasks" &&
    currentSection !== "discussion" &&
    currentSection !== "attendance";

  return (
    <main
      className="page-shell classroom-page"
      data-testid="app-shell-content"
      onClick={() => {
        setOpenWeekMenuId(null);
        setOpenMaterialMenuId(null);
      }}
    >
      {currentSection === "attendance" ? (
        <section
          className={`classroom-hero attendance-hero${isTeacher ? "" : " student-attendance-hero"} fade-in`}
          data-testid={isTeacher ? "classroom-attendance-hero" : "student-attendance-hero"}
        >
          <div className="classroom-title-block attendance-title-block">
            <span className="dashboard-status-pill">{isTeacher ? "참여 관리" : "출석 현황"}</span>
            <h1 className="page-title">{isTeacher ? "학생별 출석 현황" : "학습 참여 현황"}</h1>
            <p className="page-subtitle">
              {isTeacher ? (
                <>
                  각 학생의 참여 상태와 전체 학습 진도 현황을 확인할 수 있습니다.
                  <br />
                  학생을 클릭하면 주차별 학습 자료별 진도 상세를 확인할 수 있습니다.
                </>
              ) : (
                "주차별 강의 참여도와 시험 응시 상태를 한눈에 확인하세요."
              )}
            </p>
          </div>
          <div className="attendance-hero-metrics" aria-label="출석 현황">
            {isTeacher ? (
              <>
                <span>
                  <ClassroomIcon name="users" />
                  <small>전체 학생</small>
                  <strong>{totalAttendanceStudents}명</strong>
                </span>
                <span>
                  <ClassroomIcon name="check" />
                  <small>출석 중</small>
                  <strong>{activeAttendanceStudents}명</strong>
                </span>
                <span>
                  <ClassroomIcon name="warning" />
                  <small>진도 확인 필요</small>
                  <strong>{attentionAttendanceStudents}명</strong>
                </span>
              </>
            ) : (
              <>
                <span>
                  <ClassroomIcon name="check" />
                  <small>전체 출석률</small>
                  <strong>{studentAttendancePercent}%</strong>
                </span>
                <span>
                  <ClassroomIcon name="play" />
                  <small>완료한 강의</small>
                  <strong>{studentCompletedLectures} / {studentTotalLectures}</strong>
                </span>
                <span>
                  <ClassroomIcon name="clipboard" />
                  <small>시험 응시</small>
                  <strong>{studentCompletedExams} / {studentTotalExams}</strong>
                </span>
                <span>
                  <ClassroomIcon name="calendar" />
                  <small>주차</small>
                  <strong>{studentTotalWeeks}</strong>
                </span>
              </>
            )}
          </div>
          <div className="classroom-hero-visual" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>
      ) : null}

      {currentSection === "tasks" ? (
        <section className="classroom-hero tasks-hero fade-in" data-testid="classroom-tasks-hero">
          <div className="classroom-title-block tasks-title-block">
            <span className="dashboard-status-pill">{isTeacher ? "평가 관리" : "시험 응시"}</span>
            <h1 className="page-title">과제/시험</h1>
            <p className="page-subtitle">
              {isTeacher
                ? "강의실에서 생성한 시험을 주차별로 한눈에 확인하고 시험 설정을 빠르게 관리할 수 있습니다."
                : "강의실에 공개된 시험을 주차별로 확인하고 응시 상태와 결과를 한곳에서 관리하세요."}
            </p>
          </div>
          <div className="tasks-hero-metrics" aria-label="과제 시험 현황">
            <span>
              <ClassroomIcon name="clipboard" />
              <small>전체 시험</small>
              <strong>{totalTaskExamCount}개</strong>
            </span>
            <span>
              <ClassroomIcon name="calendar" />
              <small>주차</small>
              <strong>{weeks.length}개</strong>
            </span>
            <span>
              <ClassroomIcon name="clock" />
              <small>진행 중 시험</small>
              <strong>{ongoingTaskExamCount}개</strong>
            </span>
          </div>
          <div className="classroom-hero-visual" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>
      ) : null}

      {currentSection === "files" ? (
        <section className="classroom-hero materials-hero fade-in" data-testid="classroom-materials-hero">
          <div className="classroom-title-block materials-title-block">
            <span className="dashboard-status-pill">강의 운영</span>
            <h1 className="page-title">자료실</h1>
            <p className="page-subtitle">
              강의실에 업로드된 PDF 자료를 주차별로 한눈에 확인하고 빠르게 찾아볼 수 있습니다.
            </p>
          </div>
          <div className="materials-hero-metrics" aria-label="자료실 현황">
            <span>
              <ClassroomIcon name="file" />
              <small>전체 자료</small>
              <strong>{totalMaterialCount}개</strong>
            </span>
            <span>
              <ClassroomIcon name="calendar" />
              <small>주차</small>
              <strong>{materialWeekCount}개</strong>
            </span>
            <span>
              <ClassroomIcon name="pdf" />
              <small>PDF 파일</small>
              <strong>{totalMaterialCount}개</strong>
            </span>
          </div>
          <div className="classroom-hero-visual" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>
      ) : null}

      {showClassroomHero ? (
        <section className="classroom-hero fade-in" data-testid="classroom-hero">
          <div className="classroom-title-block">
            <span className="dashboard-status-pill">{isTeacher ? "강의 운영" : "학습 진행"}</span>
            <h1 className="page-title">강의실 학습 공간</h1>
            <p className="page-subtitle">
              주차별 자료, 세부 강의, 과제와 시험을 한 곳에서 이어서 관리합니다.
            </p>
          </div>
          <div className="classroom-hero-meta" aria-label="강의실 현황">
            <span>
              <strong>{weeks.length}</strong>
              <small>주차</small>
            </span>
            <span>
              <strong>{loadedLectureCount}</strong>
              <small>불러온 자료</small>
            </span>
            <span>
              <strong>{loadedExamCount}</strong>
              <small>과제/시험</small>
            </span>
          </div>
          <div className="classroom-hero-visual" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>
      ) : null}

      {loading ? (
        <section className="card empty-state">강의실 정보를 확인하는 중...</section>
      ) : null}

      {!loading && loadError ? (
        <section className="card alert alert-error" role="alert">
          {loadError}
        </section>
      ) : null}

      {canRenderClassroomTools ? (
        <section className="classroom-workspace">
          <section className="classroom-section-panel" data-testid="classroom-section-panel">
            {currentSection === "invite" && classroomId && isTeacher ? (
              <InviteStudentPanel classroomId={classroomId} isTeacher={isTeacher} />
            ) : null}

            {currentSection === "weeks" ? (
              <section className="classroom-weeks-section" data-testid="classroom-weeks-section">
                <div className="classroom-section-head">
                  <div>
                    <h2>주차 관리</h2>
                    <p>주차별 세부 강의와 PDF 자료를 이곳에서 정리합니다.</p>
                  </div>
                  {isTeacher ? (
                    <div className="heading-actions classroom-actions">
                      <button className="btn week-primary-action" aria-label="+ 주차 추가" onClick={onAddWeek}>
                        <ClassroomIcon name="plus" className="btn-icon" />
                        주차 추가
                      </button>
                      {!selectionMode ? (
                        <button className="btn danger week-danger-action" onClick={enterSelectionMode}>
                          <ClassroomIcon name="trash" className="btn-icon" />
                          선택 주차 삭제
                        </button>
                      ) : (
                        <>
                          <button className="btn ghost" onClick={exitSelectionMode}>
                            선택 취소
                          </button>
                          <button className="btn danger week-danger-action" onClick={onBulkDelete} disabled={!canBulkDelete}>
                            <ClassroomIcon name="trash" className="btn-icon" />
                            삭제 실행 ({selectedWeeks.length})
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>

                {teacherSelectionMode ? (
                  <section className="card selection-mode-banner" data-testid="classroom-selection-banner">
                    <strong>선택 삭제 모드</strong>
                    <p className="page-subtitle">
                      삭제할 주차를 체크한 뒤, 우측 상단의 <b>삭제 실행</b>을 눌러주세요.
                    </p>
                  </section>
                ) : null}

                {weekContentError ? (
                  <section className="card alert alert-error" role="alert">
                    {weekContentError}
                  </section>
                ) : null}

                <section className="week-timeline" data-testid="classroom-week-timeline">
                  {weeks.length === 0 ? (
                    <section className="card empty-state">
                      {isTeacher
                        ? "아직 주차가 없습니다. 주차 추가 버튼으로 첫 수업 흐름을 만들어 보세요."
                        : "아직 등록된 주차가 없습니다."}
                    </section>
                  ) : null}
                  {weeks.map((week) => (
                    <article
                      key={week.id}
                      className={`card week-card${expandedWeek === week.id ? " expanded" : ""}`}
                      data-testid="classroom-week-card"
                    >
                      <div className="week-row-glass">
                        <div className="week-row-main">
                          {teacherSelectionMode ? (
                            <label className="week-select-hit">
                              <input
                                className="week-select-box"
                                type="checkbox"
                                checked={selectedWeeks.includes(week.id)}
                                aria-label={`${week.title} 선택`}
                                onChange={() => toggleSelection(week.id)}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </label>
                          ) : null}
                          <button
                            className="week-open-btn"
                            aria-expanded={expandedWeek === week.id}
                            aria-controls={`week-detail-${week.id}`}
                            onClick={() => toggleExpand(week.id)}
                          >
                            <span className="week-chevron-badge" aria-hidden="true">
                              <ClassroomIcon name="chevron" className="week-open-icon" />
                            </span>
                            <span className="week-title-text">{week.title}</span>
                          </button>
                        </div>

                        {isTeacher ? (
                          <div className="week-menu-anchor" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="icon-menu-btn"
                              data-testid="classroom-week-menu-trigger"
                              aria-label="주차 메뉴"
                              aria-expanded={openWeekMenuId === week.id}
                              onClick={() =>
                                setOpenWeekMenuId((prev) => (prev === week.id ? null : week.id))
                              }
                            >
                              <ClassroomIcon name="more" />
                            </button>
                            {openWeekMenuId === week.id ? (
                              <div className="floating-menu card" data-testid="classroom-week-menu">
                                <button className="menu-danger-btn" onClick={() => onDeleteWeek(week.id)}>
                                  주차 삭제
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {expandedWeek === week.id ? (
                        <div className="week-detail-panel" id={`week-detail-${week.id}`}>
                          <div className="toolbar classroom-content-head">
                            <div className="week-section-title">
                              <span className="week-section-icon">
                                <ClassroomIcon name="book" />
                              </span>
                              <strong>세부 강의</strong>
                            </div>
                            {isTeacher ? (
                              <div className="heading-actions">
                                <button className="btn ghost week-content-action" onClick={() => setOpenUploaderForWeek(week.id)}>
                                  <ClassroomIcon name="book" className="btn-icon" />
                                  세부 강의 추가
                                </button>
                                <button
                                  className="btn ghost week-content-action"
                                  data-testid="classroom-add-exam"
                                  onClick={() => {
                                    navigate(`/classrooms/${classroomId}/weeks/${week.id}/exam-studio`);
                                  }}
                                >
                                  <ClassroomIcon name="clipboard" className="btn-icon" />
                                  과제/시험 추가
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <div className="grid lecture-list">
                            {(lecturesByWeek[week.id] ?? []).length === 0 ? (
                              <section className="lecture-empty-state">
                                {isTeacher
                                  ? "아직 세부 강의가 없습니다. 세부 강의 추가로 PDF 자료를 올려주세요."
                                  : "아직 등록된 강의가 없습니다."}
                              </section>
                            ) : null}
                            {(lecturesByWeek[week.id] ?? []).map((lecture) => (
                              <div key={lecture.id} className="lecture-row">
                                <span className="lecture-leading-icon">
                                  <ClassroomIcon name="file" />
                                </span>
                                <div className="lecture-main">
                                  <div className="lecture-title">{lecture.title}</div>
                                  <small className="lecture-meta">{lecture.pdf.numPages} pages</small>
                                </div>
                                <div className="lecture-actions">
                                  <Link className="btn ghost lecture-start-btn" to={getLearningSessionPath(lecture.id, week.id)}>
                                    <ClassroomIcon name="play" className="btn-icon" />
                                    학습 시작
                                  </Link>
                                  {isTeacher ? (
                                    <button
                                      className="btn danger lecture-delete-btn"
                                      onClick={() => onDeleteLecture(week.id, lecture.id)}
                                      aria-label={`${lecture.title} 삭제`}
                                    >
                                      <ClassroomIcon name="trash" />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="toolbar classroom-content-head exam-content-head">
                            <div className="week-section-title">
                              <span className="week-section-icon">
                                <ClassroomIcon name="clipboard" />
                              </span>
                              <strong>과제/시험</strong>
                            </div>
                          </div>
                          <div className="grid lecture-list classroom-exam-list" data-testid="classroom-exam-list">
                            {(examsByWeek[week.id] ?? []).length === 0 ? (
                              <section className="lecture-empty-state week-empty-evaluation">
                                <span className="week-empty-icon">
                                  <ClassroomIcon name="empty" />
                                </span>
                                <span>{isTeacher ? "아직 시험이 없습니다." : "아직 등록된 시험이 없습니다."}</span>
                                <small>
                                  {isTeacher
                                    ? "과제/시험 추가로 첫 평가를 만들어 보세요."
                                    : "선생님이 시험을 공개하면 이곳에 표시됩니다."}
                                </small>
                              </section>
                            ) : null}
                            {(examsByWeek[week.id] ?? []).map((exam, examIndex) => {
                              const title = isTeacherExam(exam)
                                ? exam.draftRevision.title
                                : exam.title;
                              const status = isTeacherExam(exam) ? exam.status : exam.attempt?.status ?? exam.status;
                              const points = isTeacherExam(exam)
                                ? exam.publishedTotalPoints ?? exam.totalPoints ?? 0
                                : exam.totalPoints;
                              const examActionLabel = `${week.title} ${title} ${examIndex + 1}번 시험`;
                              const studentExamAction = !isTeacherExam(exam)
                                ? getStudentExamActionMeta(exam.attempt)
                                : null;
                              return (
                                <div
                                  key={exam.id}
                                  className="lecture-row classroom-exam-row"
                                  data-testid="classroom-exam-row"
                                  data-exam-id={exam.id}
                                >
                                  <span className="lecture-leading-icon exam-leading-icon">
                                    <ClassroomIcon name="clipboard" />
                                  </span>
                                  <div className="lecture-main">
                                    <div className="lecture-title">{title}</div>
                                    <small className="lecture-meta">{status} · {points}점</small>
                                  </div>
                                  <div className="lecture-actions">
                                    {isTeacher && isTeacherExam(exam) ? (
                                      <>
                                        <button
                                          type="button"
                                          className="btn ghost exam-edit-btn"
                                          data-testid="classroom-exam-edit"
                                          aria-label={`${examActionLabel} 수정`}
                                          onClick={() => {
                                            navigate(`/classrooms/${classroomId}/weeks/${week.id}/exam-studio/${exam.id}`);
                                          }}
                                        >
                                          <ClassroomIcon name="edit" className="btn-icon" />
                                          수정
                                        </button>
                                        <Link
                                          className="btn exam-report-btn"
                                          data-testid="classroom-exam-report"
                                          aria-label={`${examActionLabel} 리포트`}
                                          to={`/exams/${exam.id}/report`}
                                        >
                                          <ClassroomIcon name="file" className="btn-icon" />
                                          리포트
                                        </Link>
                                        <button
                                          type="button"
                                          className="btn danger exam-delete-btn"
                                          data-testid="classroom-exam-delete"
                                          aria-label={`${examActionLabel} 삭제`}
                                          onClick={() => onDeleteExam(week.id, exam.id)}
                                        >
                                          <ClassroomIcon name="trash" />
                                        </button>
                                      </>
                                    ) : studentExamAction ? (
                                      <Link
                                        className={`btn ghost exam-student-action-btn ${studentExamAction.className}`}
                                        data-testid={studentExamAction.testId}
                                        aria-label={`${examActionLabel} ${studentExamAction.ariaSuffix}`}
                                        aria-disabled={studentExamAction.disabled ? "true" : undefined}
                                        to={`/exams/${exam.id}`}
                                        onClick={studentExamAction.disabled ? (event) => event.preventDefault() : undefined}
                                      >
                                        <ClassroomIcon name={studentExamAction.icon} className="btn-icon" />
                                        {studentExamAction.label}
                                      </Link>
                                    ) : (
                                      <Link
                                        className="btn ghost exam-student-action-btn exam-view-btn"
                                        to={`/exams/${exam.id}`}
                                      >
                                        <ClassroomIcon name="file" className="btn-icon" />
                                        보기
                                      </Link>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <LectureUploaderModal
                        open={openUploaderForWeek === week.id}
                        onClose={() => setOpenUploaderForWeek(null)}
                        onSubmit={(payload) => onUploadLecture(week.id, payload)}
                      />
                    </article>
                  ))}
                </section>
              </section>
            ) : null}

            {currentSection === "attendance" && isTeacher ? (
              <section className="classroom-attendance-section" data-testid="classroom-attendance-section">
                <div className="attendance-toolbar" data-testid="classroom-attendance-toolbar">
                  <label className="attendance-search-field">
                    <span className="sr-only">학생 이름 또는 코드로 검색</span>
                    <ClassroomIcon name="search" />
                    <input
                      value={attendanceSearch}
                      onChange={(event) => setAttendanceSearch(event.target.value)}
                      placeholder="학생 이름 또는 코드로 검색"
                      aria-label="학생 이름 또는 코드로 검색"
                    />
                  </label>
                  <label className="attendance-select-field">
                    <span className="sr-only">출석 주차 필터</span>
                    <select
                      value={attendanceWeekFilter}
                      onChange={(event) => setAttendanceWeekFilter(event.target.value)}
                      aria-label="출석 주차 필터"
                    >
                      <option value="all">전체 주차</option>
                      {weeks.map((week) => (
                        <option key={week.id} value={week.id}>
                          {week.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="attendance-select-field">
                    <span className="sr-only">참여 상태</span>
                    <select
                      value={attendanceStatusFilter}
                      onChange={(event) => setAttendanceStatusFilter(event.target.value as AttendanceStatusFilter)}
                      aria-label="참여 상태"
                    >
                      <option value="all">참여 상태</option>
                      <option value="active">학습 중</option>
                      <option value="completed">완료</option>
                      <option value="notStarted">미접속</option>
                      <option value="needsAttention">복귀 필요</option>
                      <option value="noMaterials">자료 없음</option>
                    </select>
                  </label>
                  <label className="attendance-select-field attendance-sort-field">
                    <ClassroomIcon name="sort" />
                    <span className="sr-only">출석 정렬</span>
                    <select
                      value={attendanceSort}
                      onChange={(event) => setAttendanceSort(event.target.value as AttendanceSortMode)}
                      aria-label="출석 정렬"
                    >
                      <option value="default">정렬</option>
                      <option value="progressDesc">진도 높은순</option>
                      <option value="progressAsc">진도 낮은순</option>
                      <option value="recentDesc">최근 접속순</option>
                    </select>
                  </label>
                </div>

                <section className="attendance-list-panel" data-testid="classroom-attendance-list-panel">
                  {attendanceLoading ? (
                    <section className="attendance-loading-card" data-testid="classroom-attendance-loading">
                      출석 현황을 불러오는 중...
                    </section>
                  ) : null}

                  {!attendanceLoading && attendanceError ? (
                    <section className="attendance-error-card" role="alert" data-testid="classroom-attendance-error">
                      <span>{attendanceError}</span>
                      <button className="btn ghost" onClick={() => loadAttendance().catch(console.error)}>
                        다시 시도
                      </button>
                    </section>
                  ) : null}

                  {!attendanceLoading && !attendanceError ? (
                    <div className="attendance-list" data-testid="classroom-attendance-list">
                      {(attendance?.students.length ?? 0) === 0 ? (
                        <section className="attendance-empty-state">
                          아직 참여 중인 학생이 없습니다.
                        </section>
                      ) : null}
                      {(attendance?.students.length ?? 0) > 0 && attendanceRows.length === 0 ? (
                        <section className="attendance-empty-state">
                          조건에 맞는 학생이 없습니다.
                        </section>
                      ) : null}
                      {attendanceRows.map((student, index) => {
                        const expanded = expandedAttendanceStudentId === student.studentUserId;
                        const progressPercent = Math.round(student.scopedCompletionRatio * 100);
                        const detailGroups = groupAttendanceLecturesByWeek(student.scopedLectures);
                        return (
                          <article
                            key={student.studentUserId}
                            className={`attendance-row${expanded ? " expanded" : ""}`}
                            data-testid="classroom-attendance-row"
                            data-student-id={student.studentUserId}
                          >
                            <button
                              type="button"
                              className="attendance-row-summary"
                              aria-expanded={expanded}
                              onClick={() =>
                                setExpandedAttendanceStudentId((prev) =>
                                  prev === student.studentUserId ? null : student.studentUserId
                                )
                              }
                            >
                              <span className={`attendance-index-badge tone-${(index % 6) + 1}`}>
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="attendance-row-main">
                                <strong>{student.displayName}</strong>
                                <small>#{student.inviteCode}</small>
                              </span>
                              <span className="attendance-progress-copy">
                                <small>전체 진도</small>
                                <strong>
                                  완료 {student.scopedCompletedLectureCount} / {student.scopedTotalLectureCount} 자료
                                </strong>
                              </span>
                              <span className="attendance-progress-track" aria-hidden="true">
                                <span style={{ width: `${progressPercent}%` }} />
                              </span>
                              <span className={`attendance-status-chip status-${student.scopedStatus}`}>
                                {getAttendanceStatusLabel(student.scopedStatus)}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="attendance-chevron-btn"
                              aria-label={`${student.displayName} 출석 상세`}
                              aria-expanded={expanded}
                              onClick={() =>
                                setExpandedAttendanceStudentId((prev) =>
                                  prev === student.studentUserId ? null : student.studentUserId
                                )
                              }
                            >
                              <ClassroomIcon name="chevron" />
                            </button>

                            {expanded ? (
                              <section className="attendance-detail-panel" data-testid="classroom-attendance-detail">
                                {detailGroups.length === 0 ? (
                                  <section className="attendance-detail-empty">이 주차에는 확인할 학습 자료가 없습니다.</section>
                                ) : null}
                                {detailGroups.map((group) => (
                                  <div key={group.weekId} className="attendance-week-group">
                                    <span className={`attendance-week-pill week-tone-${Math.min(group.weekIndex, 4)}`}>
                                      {group.weekTitle}
                                    </span>
                                    <div className="attendance-lecture-list">
                                      {group.lectures.map((lecture) => {
                                        const lectureRatio = lecture.totalPages > 0
                                          ? Math.min(1, lecture.maxReachedPage / lecture.totalPages)
                                          : 0;
                                        return (
                                          <div key={lecture.lectureId} className="attendance-lecture-row">
                                            <span className="attendance-file-icon" aria-hidden="true">
                                              <ClassroomIcon name="file" />
                                            </span>
                                            <strong>{lecture.lectureTitle}</strong>
                                            <span className="attendance-page-copy">
                                              {lecture.maxReachedPage} / {lecture.totalPages} page
                                            </span>
                                            <span className="attendance-page-track" aria-hidden="true">
                                              <span style={{ width: `${Math.round(lectureRatio * 100)}%` }} />
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                                <div className="attendance-detail-footer">
                                  <span>
                                    <ClassroomIcon name="clock" />
                                    <small>최근 접속</small>
                                    <strong>{formatAttendanceDateTime(student.scopedLastTouchedAt)}</strong>
                                  </span>
                                  <span>
                                    <ClassroomIcon name="sort" />
                                    <small>현재 학습 주차</small>
                                    <strong>{student.scopedCurrentWeekTitle ?? "-"}</strong>
                                  </span>
                                  <button type="button" className="btn ghost attendance-detail-btn">
                                    상세 보기
                                  </button>
                                </div>
                              </section>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              </section>
            ) : null}

            {currentSection === "attendance" && !isTeacher ? (
              <section className="student-attendance-section" data-testid="student-attendance-section">
                <div className="student-attendance-heading">
                  <div>
                    <h2>주차별 출석 요약</h2>
                    <p>각 주차별 강의 시청 진행률과 시험 응시 여부를 확인할 수 있습니다.</p>
                  </div>
                </div>

                {attendanceLoading ? (
                  <section className="attendance-loading-card" data-testid="student-attendance-loading">
                    출석 현황을 불러오는 중...
                  </section>
                ) : null}

                {!attendanceLoading && attendanceError ? (
                  <section className="attendance-error-card" role="alert" data-testid="student-attendance-error">
                    <span>{attendanceError}</span>
                    <button className="btn ghost" onClick={() => loadStudentAttendance().catch(console.error)}>
                      다시 시도
                    </button>
                  </section>
                ) : null}

                {!attendanceLoading && !attendanceError ? (
                  <div className="student-attendance-week-list" data-testid="student-attendance-week-list">
                    {(studentAttendance?.weeks.length ?? 0) === 0 ? (
                      <section className="student-attendance-empty-state">아직 확인할 주차가 없습니다.</section>
                    ) : null}
                    {(studentAttendance?.weeks ?? []).map((week) => {
                      const expanded = expandedStudentAttendanceWeekId === week.weekId;
                      const attendancePercent = Math.round(week.lectureAttendanceRatio * 100);
                      const lectureStatusLabel = week.lectureCount === 0
                        ? "강의 없음"
                        : week.completedLectureCount === week.lectureCount
                          ? `강의 ${week.completedLectureCount}/${week.lectureCount} 완료`
                          : `강의 출석률 ${attendancePercent}%`;
                      return (
                        <article
                          key={week.weekId}
                          className={`student-attendance-week${expanded ? " expanded" : ""}`}
                          data-testid="student-attendance-week"
                        >
                          <button
                            type="button"
                            className="student-attendance-week-summary"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedStudentAttendanceWeekId((prev) =>
                                prev === week.weekId ? null : week.weekId
                              )
                            }
                          >
                            <span className="student-attendance-week-toggle" aria-hidden="true">
                              <ClassroomIcon name="chevron" />
                            </span>
                            <strong>{week.weekTitle}</strong>
                            <span className="student-attendance-week-chips">
                              <span className="student-attendance-summary-chip lecture">{lectureStatusLabel}</span>
                              <span className={`student-attendance-summary-chip exam tone-${week.examStatusTone}`}>
                                {week.examStatusLabel}
                              </span>
                            </span>
                          </button>

                          {expanded ? (
                            <div className="student-attendance-week-detail" data-testid="student-attendance-week-detail">
                              <section className="student-attendance-detail-column">
                                <h3>세부 강의 출석</h3>
                                {week.lectures.length === 0 ? (
                                  <div className="student-attendance-detail-empty">강의 없음</div>
                                ) : null}
                                {week.lectures.map((lecture) => {
                                  const lecturePercent = Math.round(
                                    (lecture.totalPages > 0 ? lecture.maxReachedPage / lecture.totalPages : 0) * 100
                                  );
                                  return (
                                    <div key={lecture.lectureId} className="student-attendance-lecture-card">
                                      <span className="student-attendance-file-icon" aria-hidden="true">
                                        <ClassroomIcon name="file" />
                                      </span>
                                      <span className="student-attendance-lecture-main">
                                        <strong>{lecture.lectureTitle}</strong>
                                        <small>{lecture.totalPages} pages</small>
                                      </span>
                                      <span className="student-attendance-progress-track" aria-hidden="true">
                                        <span style={{ width: `${lecturePercent}%` }} />
                                      </span>
                                      <span className="student-attendance-percent">{lecturePercent}%</span>
                                      <span className={`student-attendance-status-chip tone-${getStudentAttendanceLectureTone(lecture)}`}>
                                        {getStudentAttendanceLectureStatus(lecture)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </section>

                              <section className="student-attendance-detail-column student-attendance-exams-column">
                                <h3>과제/시험 참여</h3>
                                {week.exams.length === 0 ? (
                                  <div className="student-attendance-detail-empty">시험 없음</div>
                                ) : null}
                                {week.exams.map((exam) => (
                                  <div key={exam.examId} className="student-attendance-exam-card">
                                    <span className="student-attendance-exam-icon" aria-hidden="true">
                                      <ClassroomIcon name="clipboard" />
                                    </span>
                                    <span className="student-attendance-exam-main">
                                      <strong>{exam.title}</strong>
                                      <small>{exam.statusLabel} · {exam.totalPoints}점</small>
                                    </span>
                                    <span className={`student-attendance-status-chip tone-${exam.statusTone}`}>
                                      {exam.statusLabel}
                                    </span>
                                    {exam.action.kind === "disabled" ? (
                                      <button
                                        type="button"
                                        className="btn ghost exam-student-action-btn student-attendance-exam-action"
                                        disabled
                                      >
                                        <ClassroomIcon name="clock" className="btn-icon" />
                                        {exam.action.label}
                                      </button>
                                    ) : (
                                      <Link
                                        className={`btn ghost exam-student-action-btn student-attendance-exam-action ${
                                          exam.action.kind === "result" ? "exam-result-btn" : "exam-take-btn"
                                        }`}
                                        data-testid={exam.action.kind === "result" ? "student-attendance-exam-result" : "student-attendance-exam-take"}
                                        to={exam.action.to}
                                      >
                                        <ClassroomIcon
                                          name={exam.action.kind === "result" ? "clipboard" : "play"}
                                          className="btn-icon"
                                        />
                                        {exam.action.label}
                                      </Link>
                                    )}
                                  </div>
                                ))}
                              </section>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            ) : null}

            {currentSection === "tasks" ? (
              <section className="classroom-tasks-section" data-testid="classroom-tasks-section">
                <div className="tasks-toolbar" data-testid="classroom-tasks-toolbar">
                  <label className="tasks-search-field">
                    <span className="sr-only">시험명으로 검색</span>
                    <ClassroomIcon name="search" />
                    <input
                      value={taskExamSearch}
                      onChange={(event) => setTaskExamSearch(event.target.value)}
                      placeholder="시험명으로 검색"
                      aria-label="시험명으로 검색"
                    />
                  </label>
                  <label className="tasks-select-field">
                    <span className="sr-only">주차 필터</span>
                    <select
                      value={taskExamWeekFilter}
                      onChange={(event) => setTaskExamWeekFilter(event.target.value)}
                      aria-label="주차 필터"
                    >
                      <option value="all">전체 주차</option>
                      {weeks.map((week) => (
                        <option key={week.id} value={week.id}>
                          {week.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="tasks-select-field">
                    <span className="sr-only">진행 상태</span>
                    <select
                      value={taskExamStatusFilter}
                      onChange={(event) => setTaskExamStatusFilter(event.target.value as TaskExamStatusFilter)}
                      aria-label="진행 상태"
                    >
                      <option value="all">진행 상태</option>
                      <option value="upcoming">예정</option>
                      <option value="ongoing">진행 중</option>
                      <option value="ended">종료</option>
                    </select>
                  </label>
                  <label className="tasks-select-field tasks-sort-field">
                    <ClassroomIcon name="sort" />
                    <span className="sr-only">정렬</span>
                    <select
                      value={taskExamSort}
                      onChange={(event) => setTaskExamSort(event.target.value as TaskExamSortMode)}
                      aria-label="정렬"
                    >
                      <option value="createdAsc">정렬</option>
                      <option value="startAsc">시작 빠른순</option>
                      <option value="startDesc">시작 최신순</option>
                      <option value="createdDesc">생성 최신순</option>
                      <option value="titleAsc">시험명순</option>
                    </select>
                  </label>
                </div>

                <section className="tasks-list-panel" data-testid="classroom-tasks-list-panel">
	                  <div className="tasks-list-head">
	                    <div>
	                      <h2>시험 목록</h2>
	                      <p>
	                        {isTeacher
	                          ? "현재 강의실에 등록된 시험을 선택해 상세 정보를 확인하고 설정을 수정하세요."
	                          : "공개된 시험을 주차별로 확인하고 응시하거나 결과를 확인하세요."}
	                      </p>
	                    </div>
	                    <span className="tasks-count-pill">총 {taskExamRows.length}개</span>
	                  </div>

                  {taskExamActionError ? (
                    <section className="alert alert-error tasks-action-alert" role="alert">
                      {taskExamActionError}
                    </section>
                  ) : null}

                  {taskExamsLoading ? (
                    <section className="tasks-loading-card" data-testid="classroom-tasks-loading">
                      시험 목록을 불러오는 중...
                    </section>
                  ) : null}

                  {!taskExamsLoading && taskExamsError ? (
                    <section className="tasks-error-card" role="alert" data-testid="classroom-tasks-error">
                      <span>{taskExamsError}</span>
                      <button className="btn ghost" onClick={() => loadTaskExams().catch(console.error)}>
                        다시 시도
                      </button>
                    </section>
                  ) : null}

                  {!taskExamsLoading && !taskExamsError ? (
	                    <div className="tasks-list" data-testid="classroom-tasks-list">
	                      {totalTaskExamCount === 0 ? (
	                        <section className="tasks-empty-state">
	                          {isTeacher
	                            ? "아직 등록된 시험이 없습니다. 주차 관리에서 시험을 추가해 주세요."
	                            : "아직 공개된 시험이 없습니다. 선생님이 시험을 공개하면 이곳에 표시됩니다."}
	                        </section>
	                      ) : null}
	                      {totalTaskExamCount > 0 && taskExamRows.length === 0 ? (
	                        <section className="tasks-empty-state">조건에 맞는 시험이 없습니다.</section>
	                      ) : null}
	                      {taskExamRows.map((row) => {
	                        const teacherExam = isTeacher && row.kind === "teacher" && isTeacherExam(row.exam) ? row.exam : null;
	                        const studentExam = row.kind === "student" && !isTeacherExam(row.exam) ? row.exam : null;
	                        const expanded = Boolean(teacherExam && expandedTaskExamId === row.id);
	                        const draft = teacherExam && expanded && taskExamDraft?.examId === row.id ? taskExamDraft : null;
	                        const settingsLocked = Boolean(
	                          teacherExam && (row.scheduleStatus === "ended" || serverLockedExamIds.has(row.id))
	                        );
	                        const studentExamAction = studentExam ? getStudentExamActionMeta(studentExam.attempt) : null;
	                        const examActionLabel = `${row.week.title} ${row.title} 시험`;
	                        const rowSummary = (
	                          <>
	                            <span className="tasks-file-icon" aria-hidden="true">
	                              <ClassroomIcon name="clipboard" />
	                            </span>
	                            <span className="tasks-row-main">
	                              <strong>{row.title}</strong>
	                              <small>
	                                {teacherExam
	                                  ? `생성 ${formatTaskExamDate(row.createdAt)} · 선생님`
	                                  : studentExam
	                                    ? getStudentTaskExamStatusLine(studentExam)
	                                    : "-"}
	                              </small>
	                            </span>
	                            <span className={`tasks-week-chip week-tone-${Math.min(row.week.weekIndex, 4)}`}>
	                              {row.week.weekIndex}주차
	                            </span>
	                            <span className={`tasks-status-chip status-${row.scheduleStatus}`}>
	                              {getTaskExamStatusLabel(row.scheduleStatus)}
	                            </span>
	                            <span className="tasks-time-copy">{formatTaskExamDateTime(row.availableFrom)}</span>
	                          </>
	                        );
	                        return (
	                          <article
	                            key={row.id}
	                            className={`tasks-row${expanded ? " expanded" : ""}${studentExam ? " tasks-student-row" : ""}`}
	                            data-testid="classroom-task-exam-row"
	                            data-exam-id={row.id}
	                          >
	                            {teacherExam ? (
	                              <>
	                                <button
	                                  type="button"
	                                  className="tasks-row-summary"
	                                  aria-expanded={expanded}
	                                  onClick={() => openTaskExamDetails(teacherExam)}
	                                >
	                                  {rowSummary}
	                                </button>
	                                <button
	                                  type="button"
	                                  className="tasks-chevron-btn"
	                                  aria-label={`${row.title} 상세 설정`}
	                                  aria-expanded={expanded}
	                                  onClick={() => openTaskExamDetails(teacherExam)}
	                                >
	                                  <ClassroomIcon name="chevron" />
	                                </button>
	                                <button
	                                  type="button"
	                                  className="tasks-more-btn"
	                                  aria-label={`${row.title} 더보기`}
	                                  onClick={() => openTaskExamDetails(teacherExam)}
	                                >
	                                  <ClassroomIcon name="more" />
	                                </button>
	                              </>
	                            ) : (
	                              <div className="tasks-row-summary" role="group" aria-label={`${row.title} 정보`}>
	                                {rowSummary}
	                              </div>
	                            )}

	                            {studentExam && studentExamAction ? (
	                              studentExamAction.disabled ? (
	                                <button
	                                  type="button"
	                                  className={`btn ghost exam-student-action-btn tasks-student-action-btn ${studentExamAction.className}`}
	                                  data-testid={studentExamAction.testId}
	                                  aria-label={`${examActionLabel} ${studentExamAction.ariaSuffix}`}
	                                  aria-disabled="true"
	                                  disabled
	                                >
	                                  <ClassroomIcon name={studentExamAction.icon} className="btn-icon" />
	                                  {studentExamAction.label}
	                                </button>
	                              ) : (
	                                <Link
	                                  className={`btn ghost exam-student-action-btn tasks-student-action-btn ${studentExamAction.className}`}
	                                  data-testid={studentExamAction.testId}
	                                  aria-label={`${examActionLabel} ${studentExamAction.ariaSuffix}`}
	                                  to={`/exams/${row.id}`}
	                                >
	                                  <ClassroomIcon name={studentExamAction.icon} className="btn-icon" />
	                                  {studentExamAction.label}
	                                </Link>
	                              )
	                            ) : null}

	                            {draft ? (
	                              <form
                                className="tasks-settings-panel"
                                data-testid="classroom-task-exam-settings"
                                aria-disabled={settingsLocked ? "true" : undefined}
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  saveTaskExamSettings().catch(console.error);
                                }}
                              >
                                <div className="tasks-settings-title">
                                  <strong>시험 상세 설정</strong>
                                  <small>이름과 시간 설정만 수정할 수 있습니다. 문항 내용은 시험 스튜디오에서 관리합니다.</small>
                                </div>
                                <label className="tasks-settings-field tasks-title-field">
                                  <span>시험 이름</span>
                                  <input
                                    value={draft.title}
                                    disabled={settingsLocked}
                                    onChange={(event) =>
                                      setTaskExamDraft((prev) =>
                                        prev ? { ...prev, title: event.target.value, error: "" } : prev
                                      )
                                    }
                                  />
                                </label>
                                <div className="tasks-settings-grid">
                                  <label className="tasks-settings-field">
                                    <span>시작 시간</span>
                                    <input
                                      type="datetime-local"
                                      value={draft.availableFrom}
                                      disabled={settingsLocked}
                                      onChange={(event) => updateTaskExamStart(event.target.value)}
                                    />
                                  </label>
                                  <label className="tasks-settings-field">
                                    <span>종료 시간</span>
                                    <input
                                      type="datetime-local"
                                      value={draft.availableUntil}
                                      disabled={settingsLocked}
                                      onChange={(event) =>
                                        setTaskExamDraft((prev) =>
                                          prev ? { ...prev, availableUntil: event.target.value, error: "" } : prev
                                        )
                                      }
                                    />
                                  </label>
                                  <label className="tasks-settings-field">
                                    <span>진행 시간</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={240}
                                      value={draft.timeLimitMinutes}
                                      disabled={settingsLocked}
                                      onChange={(event) => updateTaskExamDuration(event.target.value)}
                                    />
                                  </label>
                                </div>
                                <p className="tasks-settings-helper">
                                  {settingsLocked
                                    ? "종료된 시험은 기록 보존을 위해 이름과 시간 설정을 수정할 수 없습니다."
                                    : "시험을 눌러 상세 정보를 확인하고 이름·시간 설정을 수정할 수 있습니다."}
                                </p>
                                {draft.error ? (
                                  <p className="tasks-settings-error" role="alert">{draft.error}</p>
                                ) : null}
                                <div className="tasks-settings-actions">
                                  <button type="button" className="btn ghost" onClick={closeTaskExamDetails}>
                                    취소
                                  </button>
	                                  <button
	                                    type="submit"
	                                    className="btn tasks-save-btn"
	                                    aria-disabled={settingsLocked ? "true" : undefined}
	                                    disabled={settingsLocked || taskExamSavingId === row.id}
	                                  >
	                                    {taskExamSavingId === row.id ? "저장 중..." : "수정 저장"}
	                                  </button>
                                </div>
                              </form>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              </section>
            ) : null}

            {currentSection === "files" ? (
              <section className="classroom-materials-section" data-testid="classroom-materials-section">
                <div className="materials-toolbar" data-testid="classroom-materials-toolbar">
                  <label className="materials-search-field">
                    <span className="sr-only">파일명으로 검색</span>
                    <ClassroomIcon name="search" />
                    <input
                      value={materialSearch}
                      onChange={(event) => setMaterialSearch(event.target.value)}
                      placeholder="파일명으로 검색"
                      aria-label="파일명으로 검색"
                    />
                  </label>
                  <label className="materials-select-field">
                    <span className="sr-only">주차 필터</span>
                    <select
                      value={materialWeekFilter}
                      onChange={(event) => setMaterialWeekFilter(event.target.value)}
                      aria-label="주차 필터"
                    >
                      <option value="all">전체 주차</option>
                      {weeks.map((week) => (
                        <option key={week.id} value={week.id}>
                          {week.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="materials-select-field">
                    <span className="sr-only">파일 형식</span>
                    <select value="pdf" aria-label="파일 형식" disabled>
                      <option value="pdf">파일 형식: PDF</option>
                    </select>
                  </label>
                  <label className="materials-select-field materials-sort-field">
                    <ClassroomIcon name="sort" />
                    <span className="sr-only">정렬</span>
                    <select
                      value={materialSort}
                      onChange={(event) => setMaterialSort(event.target.value as MaterialSortMode)}
                      aria-label="정렬"
                    >
                      <option value="oldest">정렬</option>
                      <option value="newest">업로드 최신순</option>
                    </select>
                  </label>
                </div>

                <section className="materials-list-panel" data-testid="classroom-materials-list-panel">
                  <div className="materials-list-head">
                    <div>
                      <h2>업로드 자료 목록</h2>
                      <p>현재 강의실에 등록된 PDF 자료를 주차와 함께 확인하세요.</p>
                    </div>
                    <span className="materials-count-pill">총 {materialRows.length}개</span>
                  </div>

                  {materialActionError ? (
                    <section className="alert alert-error materials-action-alert" role="alert">
                      {materialActionError}
                    </section>
                  ) : null}

                  {materialsLoading ? (
                    <section className="materials-loading-card" data-testid="classroom-materials-loading">
                      자료실을 불러오는 중...
                    </section>
                  ) : null}

                  {!materialsLoading && materialsError ? (
                    <section className="materials-error-card" role="alert" data-testid="classroom-materials-error">
                      <span>{materialsError}</span>
                      <button className="btn ghost" onClick={() => loadMaterials().catch(console.error)}>
                        다시 시도
                      </button>
                    </section>
                  ) : null}

                  {!materialsLoading && !materialsError ? (
                    <div className="materials-list" data-testid="classroom-materials-list">
                      {materials.length === 0 ? (
                        <section className="materials-empty-state">아직 업로드된 PDF 자료가 없습니다.</section>
                      ) : null}
                      {materials.length > 0 && materialRows.length === 0 ? (
                        <section className="materials-empty-state">조건에 맞는 자료가 없습니다.</section>
                      ) : null}
                      {materialRows.map((item) => (
                        <article
                          key={item.lecture.id}
                          className="materials-row"
                          data-testid="classroom-material-row"
                          data-lecture-id={item.lecture.id}
                        >
                          <span className="materials-file-icon" aria-hidden="true">
                            <ClassroomIcon name="file" />
                          </span>
                          <div className="materials-row-main">
                            <strong>{item.lecture.title}</strong>
                            <small>업로드 {formatMaterialDate(item.lecture.createdAt)} · 선생님</small>
                          </div>
                          <span className={`materials-week-chip week-tone-${Math.min(item.week.weekIndex, 4)}`}>
                            {item.week.weekIndex}주차
                          </span>
                          <span className="materials-type-chip">PDF</span>
                          <span className="materials-pages">{item.lecture.pdf.numPages} pages</span>
                          <a
                            className="materials-icon-action"
                            href={getLectureDownloadUrl(item.lecture.id)}
                            aria-label={`${item.lecture.title} 다운로드`}
                          >
                            <ClassroomIcon name="download" />
                          </a>
                          {isTeacher ? (
                            <div className="materials-menu-anchor" onClick={(event) => event.stopPropagation()}>
                              <button
                                type="button"
                                className="materials-more-btn"
                                aria-label={`${item.lecture.title} 자료 메뉴`}
                                aria-expanded={openMaterialMenuId === item.lecture.id}
                                data-testid="classroom-material-menu-trigger"
                                disabled={materialActionId === item.lecture.id}
                                onClick={() =>
                                  setOpenMaterialMenuId((prev) =>
                                    prev === item.lecture.id ? null : item.lecture.id
                                  )
                                }
                              >
                                <ClassroomIcon name="more" />
                              </button>
                              {openMaterialMenuId === item.lecture.id ? (
                                <div className="materials-floating-menu" data-testid="classroom-material-menu">
                                  <button
                                    type="button"
                                    disabled={materialActionId === item.lecture.id}
                                    onClick={() => openRenameMaterial(item)}
                                  >
                                    <ClassroomIcon name="edit" />
                                    자료 이름 수정
                                  </button>
                                  <button
                                    type="button"
                                    className="danger"
                                    disabled={materialActionId === item.lecture.id}
                                    onClick={() => onDeleteMaterial(item)}
                                  >
                                    <ClassroomIcon name="trash" />
                                    삭제
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>

                {renameMaterial ? (
                  <div className="material-rename-backdrop" role="presentation" onClick={() => setRenameMaterial(null)}>
                    <form
                      className="material-rename-dialog"
                      data-testid="classroom-material-rename-dialog"
                      onClick={(event) => event.stopPropagation()}
                      onSubmit={(event) => {
                        event.preventDefault();
                        onRenameMaterial().catch(console.error);
                      }}
                    >
                      <div className="material-rename-head">
                        <span className="materials-file-icon">
                          <ClassroomIcon name="edit" />
                        </span>
                        <div>
                          <h2>자료 이름 수정</h2>
                          <p>주차 관리에 표시되는 자료 이름도 함께 바뀝니다.</p>
                        </div>
                      </div>
                      <label className="material-rename-field">
                        <span>자료 이름</span>
                        <input
                          value={renameMaterial.draftTitle}
                          onChange={(event) =>
                            setRenameMaterial((prev) =>
                              prev ? { ...prev, draftTitle: event.target.value, error: "" } : prev
                            )
                          }
                          autoFocus
                        />
                      </label>
                      {renameMaterial.error ? (
                        <p className="material-rename-error" role="alert">{renameMaterial.error}</p>
                      ) : null}
                      <div className="material-rename-actions">
                        <button type="button" className="btn ghost" onClick={() => setRenameMaterial(null)}>
                          취소
                        </button>
                        <button
                          type="submit"
                          className="btn material-save-btn"
                          disabled={materialActionId === renameMaterial.lectureId}
                        >
                          {materialActionId === renameMaterial.lectureId ? "저장 중..." : "저장"}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </section>
            ) : null}

            {currentSection === "notices" && classroomId && user ? (
              <ClassroomNoticesPanel
                classroomId={classroomId}
                isTeacher={Boolean(isTeacher)}
                user={user}
              />
            ) : null}

            {currentSection === "discussion" && classroomId && user ? (
              <ClassroomDiscussionsPanel
                classroomId={classroomId}
                isTeacher={Boolean(isTeacher)}
                user={user}
              />
            ) : null}

            {currentSection === "report" && classroomId && isTeacher ? (
              <section className="classroom-report-entry" data-testid="classroom-report-entry">
                <div className="classroom-section-head">
                  <div>
                    <span className="eyebrow">REPORT</span>
                    <h2>학생 리포트</h2>
                    <p>학생별 학습 기록과 역량 분석은 전용 리포트 화면에서 확인합니다.</p>
                  </div>
                  <Link className="btn" to={`/classrooms/${classroomId}/report`}>
                    학생 리포트 보기
                  </Link>
                </div>
                <div className="classroom-report-metrics" aria-label="리포트 참고 현황">
                  <span>
                    <strong>{weeks.length}</strong>
                    <small>분석 대상 주차</small>
                  </span>
                  <span>
                    <strong>{loadedLectureCount}</strong>
                    <small>현재 불러온 자료</small>
                  </span>
                </div>
              </section>
            ) : null}
          </section>
        </section>
      ) : null}
    </main>
  );
}
