import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  createLecture,
  createWeek,
  deleteLecture,
  deleteWeek,
  deleteWeeksBulk,
  getLectures,
  getWeeks
} from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { InviteStudentPanel } from "../components/classrooms/InviteStudentPanel";
import { LectureUploaderModal } from "../components/lectures/LectureUploaderModal";
import { LectureItem, Week } from "../types";

export function ClassroomRoute() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const { user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isTeacher = user?.role === "teacher";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
  const [lecturesByWeek, setLecturesByWeek] = useState<Record<string, LectureItem[]>>({});
  const [openUploaderForWeek, setOpenUploaderForWeek] = useState<string | null>(null);
  const [openWeekMenuId, setOpenWeekMenuId] = useState<string | null>(null);

  const canBulkDelete = useMemo(
    () => selectionMode && selectedWeeks.length > 0,
    [selectionMode, selectedWeeks]
  );

  const resetClassroomSurface = useCallback(() => {
    setWeeks([]);
    setExpandedWeek(null);
    setSelectionMode(false);
    setSelectedWeeks([]);
    setLecturesByWeek({});
    setOpenUploaderForWeek(null);
    setOpenWeekMenuId(null);
  }, []);

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
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
        return;
      }
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        navigate("/verify-email", { replace: true });
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
  }, [classroomId, location.pathname, navigate, refreshMe, resetClassroomSurface]);

  useEffect(() => {
    refreshWeeks().catch(console.error);
  }, [refreshWeeks]);

  useEffect(() => {
    if (!openWeekMenuId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenWeekMenuId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openWeekMenuId]);

  useEffect(() => {
    setSelectedWeeks((prev) => prev.filter((id) => weeks.some((week) => week.id === id)));
    if (expandedWeek && !weeks.some((week) => week.id === expandedWeek)) {
      setExpandedWeek(null);
    }
    if (openWeekMenuId && !weeks.some((week) => week.id === openWeekMenuId)) {
      setOpenWeekMenuId(null);
    }
  }, [weeks, expandedWeek, openWeekMenuId]);

  async function loadLectures(weekId: string) {
    const lectures = await getLectures(weekId);
    setLecturesByWeek((prev) => ({ ...prev, [weekId]: lectures }));
  }

  async function onAddWeek() {
    if (!classroomId || !isTeacher) return;
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
      await loadLectures(weekId);
    }
  }

  async function onUploadLecture(weekId: string, payload: { title: string; file: File }) {
    if (!isTeacher) return;
    await createLecture(weekId, payload.title, payload.file);
    await loadLectures(weekId);
  }

  async function onDeleteLecture(weekId: string, lectureId: string) {
    if (!isTeacher) return;
    if (!confirm("강의를 삭제하시겠습니까?")) return;
    await deleteLecture(lectureId);
    await loadLectures(weekId);
  }

  const canRenderClassroomTools = !loading && !loadError;
  const teacherSelectionMode = Boolean(isTeacher && selectionMode);

  return (
    <main className="page-shell" onClick={() => setOpenWeekMenuId(null)}>
      <section className="classroom-hero fade-in">
        <div className="classroom-title-block">
          <span className="eyebrow">CLASSROOM</span>
          <h1 className="page-title">강의실 주차</h1>
          <p className="page-subtitle">
            주차별 자료와 학습 세션을 한 곳에서 관리합니다.
          </p>
        </div>
        <div className="classroom-hero-meta" aria-label="강의실 현황">
          <span>
            <strong>{weeks.length}</strong>
            <small>주차</small>
          </span>
          <span>
            <strong>{Object.values(lecturesByWeek).flat().length}</strong>
            <small>불러온 자료</small>
          </span>
        </div>
        <div className="heading-actions classroom-actions">
          {canRenderClassroomTools && classroomId && isTeacher ? (
            <Link className="btn ghost" to={`/classrooms/${classroomId}/report`}>
              학생 리포트 보기
            </Link>
          ) : null}
          {canRenderClassroomTools && isTeacher ? (
            <>
              <button className="btn" onClick={onAddWeek}>
                + 주차 추가
              </button>
              {!selectionMode ? (
                <button className="btn danger" onClick={enterSelectionMode}>
                  선택 주차 삭제
                </button>
              ) : (
                <>
                  <button className="btn ghost" onClick={exitSelectionMode}>
                    선택 취소
                  </button>
                  <button className="btn danger" onClick={onBulkDelete} disabled={!canBulkDelete}>
                    삭제 실행 ({selectedWeeks.length})
                  </button>
                </>
              )}
            </>
          ) : null}
        </div>
      </section>

      {loading ? (
        <section className="card empty-state">강의실 정보를 확인하는 중...</section>
      ) : null}

      {!loading && loadError ? (
        <section className="card alert alert-error" role="alert">
          {loadError}
        </section>
      ) : null}

      {canRenderClassroomTools && teacherSelectionMode ? (
        <section className="card selection-mode-banner">
          <strong>선택 삭제 모드</strong>
          <p className="page-subtitle">
            삭제할 주차를 체크한 뒤, 우측 상단의 <b>삭제 실행</b>을 눌러주세요.
          </p>
        </section>
      ) : null}

      {canRenderClassroomTools && classroomId && isTeacher ? (
        <InviteStudentPanel classroomId={classroomId} isTeacher={isTeacher} />
      ) : null}

      {canRenderClassroomTools ? (
      <section className="week-timeline">
        {weeks.length === 0 ? (
          <section className="card empty-state">
            {isTeacher
              ? "아직 주차가 없습니다. 주차 추가 버튼으로 첫 수업 흐름을 만들어 보세요."
              : "아직 등록된 주차가 없습니다."}
          </section>
        ) : null}
        {weeks.map((week) => (
          <article key={week.id} className="card week-card">
            <div className="week-marker" aria-hidden="true" />
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
                  {week.title}
                </button>
              </div>

              {isTeacher ? (
                <div className="week-menu-anchor" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="icon-menu-btn"
                  aria-label="주차 메뉴"
                  aria-expanded={openWeekMenuId === week.id}
                  onClick={() =>
                    setOpenWeekMenuId((prev) => (prev === week.id ? null : week.id))
                  }
                >
                  ...
                </button>
                {openWeekMenuId === week.id ? (
                  <div className="floating-menu card">
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
                  <strong>세부 강의</strong>
                  {isTeacher ? (
                    <button className="btn" onClick={() => setOpenUploaderForWeek(week.id)}>
                      세부 강의 추가
                    </button>
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
                      <div className="lecture-main">
                        <div className="lecture-title">{lecture.title}</div>
                        <small className="lecture-meta">{lecture.pdf.numPages} pages</small>
                      </div>
                      <div className="lecture-actions">
                        <Link className="btn" to={`/session/${lecture.id}`}>
                          학습 시작
                        </Link>
                        {isTeacher ? (
                          <button
                            className="btn danger"
                            onClick={() => onDeleteLecture(week.id, lecture.id)}
                          >
                            삭제
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
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
      ) : null}
    </main>
  );
}
