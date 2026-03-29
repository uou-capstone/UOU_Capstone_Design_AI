import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createLecture,
  createWeek,
  deleteLecture,
  deleteWeek,
  deleteWeeksBulk,
  getLectures,
  getWeeks
} from "../api/endpoints";
import { LectureUploaderModal } from "../components/lectures/LectureUploaderModal";
import { LectureItem, Week } from "../types";

export function ClassroomRoute() {
  const { classroomId } = useParams<{ classroomId: string }>();
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

  async function refreshWeeks() {
    if (!classroomId) return;
    setWeeks(await getWeeks(classroomId));
  }

  useEffect(() => {
    refreshWeeks().catch(console.error);
  }, [classroomId]);

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
    if (!classroomId) return;
    await createWeek(classroomId);
    await refreshWeeks();
  }

  async function onDeleteWeek(weekId: string) {
    if (!confirm("해당 주차를 삭제하시겠습니까?")) return;
    await deleteWeek(weekId);
    setSelectedWeeks((prev) => prev.filter((id) => id !== weekId));
    setOpenWeekMenuId(null);
    await refreshWeeks();
  }

  async function onBulkDelete() {
    if (!canBulkDelete) return;
    if (!confirm("선택한 주차를 일괄 삭제하시겠습니까?")) return;
    await deleteWeeksBulk(selectedWeeks);
    exitSelectionMode();
    await refreshWeeks();
  }

  function enterSelectionMode() {
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
    await createLecture(weekId, payload.title, payload.file);
    await loadLectures(weekId);
  }

  async function onDeleteLecture(weekId: string, lectureId: string) {
    if (!confirm("강의를 삭제하시겠습니까?")) return;
    await deleteLecture(lectureId);
    await loadLectures(weekId);
  }

  return (
    <main className="page-shell" onClick={() => setOpenWeekMenuId(null)}>
      <div className="heading">
        <h1 style={{ margin: 0 }}>강의실 주차</h1>
        <div className="heading-actions">
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
        </div>
      </div>

      {selectionMode ? (
        <section className="card selection-mode-banner">
          <strong>선택 삭제 모드</strong>
          <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
            삭제할 주차를 체크한 뒤, 우측 상단의 <b>삭제 실행</b>을 눌러주세요.
          </p>
        </section>
      ) : null}

      <section className="grid">
        {weeks.map((week) => (
          <article key={week.id} className="card week-card">
            <div className="week-row-glass">
              <div className="week-row-main">
                {selectionMode ? (
                  <input
                    className="week-select-box"
                    type="checkbox"
                    checked={selectedWeeks.includes(week.id)}
                    onChange={() => toggleSelection(week.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : null}
                <button className="week-open-btn" onClick={() => toggleExpand(week.id)}>
                  {week.title}
                </button>
              </div>

              <div className="week-menu-anchor" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="icon-menu-btn"
                  aria-label="주차 메뉴"
                  aria-haspopup="menu"
                  aria-expanded={openWeekMenuId === week.id}
                  onClick={() =>
                    setOpenWeekMenuId((prev) => (prev === week.id ? null : week.id))
                  }
                >
                  ...
                </button>
                {openWeekMenuId === week.id ? (
                  <div className="floating-menu card" role="menu">
                    <button className="menu-danger-btn" onClick={() => onDeleteWeek(week.id)}>
                      주차 삭제
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {expandedWeek === week.id ? (
              <div className="week-detail-panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>세부 강의</strong>
                  <button className="btn" onClick={() => setOpenUploaderForWeek(week.id)}>
                    세부 강의 추가
                  </button>
                </div>
                <div className="grid" style={{ marginTop: 10 }}>
                  {(lecturesByWeek[week.id] ?? []).map((lecture) => (
                    <div key={lecture.id} className="card lecture-row">
                      <div>
                        <div style={{ fontWeight: 700 }}>{lecture.title}</div>
                        <small style={{ color: "var(--muted)" }}>{lecture.pdf.numPages} pages</small>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Link className="btn" to={`/session/${lecture.id}`}>
                          학습 시작
                        </Link>
                        <button
                          className="btn danger"
                          onClick={() => onDeleteLecture(week.id, lecture.id)}
                        >
                          삭제
                        </button>
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
    </main>
  );
}
