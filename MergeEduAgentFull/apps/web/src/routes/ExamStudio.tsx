import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { getExam, getWeeks } from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { ExamStudioModal, isTeacherExamDto } from "../components/exams/ExamStudioModal";
import {
  clearMaterializedExam,
  readMaterializedExam
} from "../components/exams/examStudioRecovery";
import { TeacherExam } from "../types";

type RouteState =
  | { status: "loading" }
  | { status: "ready-new"; initialDraftScopeKey: string }
  | {
      status: "ready-materialized";
      initialDraftScopeKey: string;
      materializedExamId: string;
      exam?: TeacherExam;
    }
  | { status: "ready-edit"; initialDraftScopeKey: string; exam: TeacherExam }
  | { status: "error"; message: string };

type MaterializedLocationState = {
  materializedExamId?: string;
  initialDraftScopeKey?: string;
};

function makeScopeKey(input: {
  actorUserId: string;
  classroomId: string;
  weekId: string;
  examId: string;
}) {
  return `${input.actorUserId}:${input.classroomId}:${input.weekId}:${input.examId}`;
}

function returnToWeekPath(classroomId: string, weekId: string) {
  return `/classrooms/${classroomId}?section=weeks&week=${encodeURIComponent(weekId)}`;
}

function routeErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "로그인이 필요합니다.";
    if (error.status === 403) return "이 시험을 편집할 권한이 없습니다.";
    if (error.status === 404) return "시험 또는 주차를 찾을 수 없습니다.";
  }
  return error instanceof Error ? error.message : "시험 설계 화면을 불러오지 못했습니다.";
}

export function ExamStudioRoute() {
  const { classroomId, weekId, examId } = useParams<{
    classroomId: string;
    weekId: string;
    examId?: string;
  }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeLoadSeqRef = useRef(0);
  const [state, setState] = useState<RouteState>({ status: "loading" });

  const actorUserId = user?.id ?? "";
  const newInitialScopeKey = useMemo(() => {
    if (!actorUserId || !classroomId || !weekId) return "";
    return makeScopeKey({ actorUserId, classroomId, weekId, examId: "new" });
  }, [actorUserId, classroomId, weekId]);
  const directEditScopeKey = useMemo(() => {
    if (!actorUserId || !classroomId || !weekId || !examId) return "";
    return makeScopeKey({ actorUserId, classroomId, weekId, examId });
  }, [actorUserId, classroomId, weekId, examId]);

  useEffect(() => {
    if (!actorUserId || !classroomId || !weekId) {
      setState({ status: "error", message: "시험 설계 경로가 올바르지 않습니다." });
      return;
    }

    const actorUserIdValue = actorUserId;
    const classroomIdValue = classroomId;
    const weekIdValue = weekId;
    const requestId = routeLoadSeqRef.current + 1;
    routeLoadSeqRef.current = requestId;
    const materializedState = (location.state ?? {}) as MaterializedLocationState;
    setState({ status: "loading" });
    let cancelled = false;

    async function loadRoute() {
      try {
        const active = () => !cancelled && routeLoadSeqRef.current === requestId;
        if (!examId) {
          const weeks = await getWeeks(classroomIdValue);
          if (!active()) return;
          if (!weeks.some((week) => week.id === weekIdValue)) {
            setState({ status: "error", message: "현재 강의실에 속한 주차가 아닙니다." });
            return;
          }

          const materialized = readMaterializedExam({
            actorUserId: actorUserIdValue,
            classroomId: classroomIdValue,
            weekId: weekIdValue,
            originalScopeKey: newInitialScopeKey
          });
          if (materialized) {
            try {
              const loaded = await getExam(materialized.examId);
              if (!active()) return;
              if (
                isTeacherExamDto(loaded) &&
                loaded.id === materialized.examId &&
                loaded.classroomId === classroomIdValue &&
                loaded.weekId === weekIdValue
              ) {
                setState({
                  status: "ready-materialized",
                  initialDraftScopeKey: materialized.originalScopeKey,
                  materializedExamId: materialized.examId,
                  exam: loaded
                });
                return;
              }
              clearMaterializedExam({
                actorUserId: actorUserIdValue,
                classroomId: classroomIdValue,
                weekId: weekIdValue
              });
            } catch (error) {
              if (!active()) return;
              if (error instanceof ApiError && error.status === 404) {
                clearMaterializedExam({
                  actorUserId: actorUserIdValue,
                  classroomId: classroomIdValue,
                  weekId: weekIdValue
                });
              } else {
                setState({ status: "error", message: routeErrorMessage(error) });
                return;
              }
            }
          }

          setState({ status: "ready-new", initialDraftScopeKey: newInitialScopeKey });
          return;
        }

        if (
          materializedState.materializedExamId === examId &&
          materializedState.initialDraftScopeKey === newInitialScopeKey
        ) {
          const weeks = await getWeeks(classroomIdValue);
          if (!active()) return;
          if (!weeks.some((week) => week.id === weekIdValue)) {
            setState({ status: "error", message: "현재 강의실에 속한 주차가 아닙니다." });
            return;
          }
          const loaded = await getExam(examId);
          if (!active()) return;
          if (
            !isTeacherExamDto(loaded) ||
            loaded.id !== examId ||
            loaded.classroomId !== classroomIdValue ||
            loaded.weekId !== weekIdValue
          ) {
            setState({ status: "error", message: "현재 경로와 일치하는 교사용 시험이 아닙니다." });
            return;
          }
          setState({
            status: "ready-materialized",
            initialDraftScopeKey: materializedState.initialDraftScopeKey,
            materializedExamId: examId,
            exam: loaded
          });
          return;
        }

        const loaded = await getExam(examId);
        if (!active()) return;
        if (
          !isTeacherExamDto(loaded) ||
          loaded.id !== examId ||
          loaded.classroomId !== classroomIdValue ||
          loaded.weekId !== weekIdValue
        ) {
          setState({ status: "error", message: "현재 경로와 일치하는 교사용 시험이 아닙니다." });
          return;
        }
        setState({ status: "ready-edit", initialDraftScopeKey: directEditScopeKey, exam: loaded });
      } catch (error) {
        if (routeLoadSeqRef.current !== requestId) return;
        setState({ status: "error", message: routeErrorMessage(error) });
      }
    }

    loadRoute().catch(console.error);
    return () => {
      cancelled = true;
      routeLoadSeqRef.current += 1;
    };
  }, [actorUserId, classroomId, directEditScopeKey, examId, location.state, newInitialScopeKey, weekId]);

  if (!classroomId || !weekId || !actorUserId) {
    return (
      <main className="page-shell exam-studio-page" data-testid="app-shell-content">
        <section className="card alert alert-error">시험 설계 경로가 올바르지 않습니다.</section>
      </main>
    );
  }

  const returnPath = returnToWeekPath(classroomId, weekId);
  const close = () => navigate(returnPath);
  const onSaved = () => navigate(returnPath);
  const onMaterialized = (exam: TeacherExam) => {
    setState((prev) => {
      const initialDraftScopeKey =
        prev.status === "ready-new" || prev.status === "ready-materialized"
          ? prev.initialDraftScopeKey
          : newInitialScopeKey;
      return {
        status: "ready-materialized",
        initialDraftScopeKey,
        materializedExamId: exam.id
      };
    });
  };

  if (state.status === "loading") {
    return (
      <main className="page-shell exam-studio-page" data-testid="app-shell-content">
        <section className="card empty-state" data-testid="exam-studio-page">
          시험 설계 화면을 준비하는 중...
        </section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="page-shell exam-studio-page" data-testid="app-shell-content">
        <section className="card alert alert-error" data-testid="exam-studio-error">
          <p>{state.message}</p>
          <button className="btn ghost" onClick={close}>
            강의실로 돌아가기
          </button>
        </section>
      </main>
    );
  }

  const examForInitialDraft =
    state.status === "ready-edit" || (state.status === "ready-materialized" && state.exam)
      ? state.exam
      : null;
  const initialDraftScopeKey = state.initialDraftScopeKey;
  const materializedExamId = state.status === "ready-materialized" ? state.materializedExamId : null;

  return (
    <ExamStudioModal
      open
      variant="page"
      weekId={weekId}
      classroomId={classroomId}
      actorUserId={actorUserId}
      exam={examForInitialDraft}
      initialDraftScopeKey={initialDraftScopeKey}
      materializedExamId={materializedExamId}
      onExamMaterialized={onMaterialized}
      onClose={close}
      onSaved={onSaved}
    />
  );
}
