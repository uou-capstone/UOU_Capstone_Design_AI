import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AccountProfilePanel } from "../components/account/AccountProfilePanel";
import { ClassroomCard } from "../components/cards/ClassroomCard";
import {
  createClassroom,
  deleteClassroom,
  getClassrooms
} from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { useDialogFocus } from "../components/ui/useDialogFocus";
import { Classroom } from "../types";

export function DashboardRoute() {
  const { user } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [openAddModal, setOpenAddModal] = useState(false);
  const [error, setError] = useState("");
  const addModalRef = useRef<HTMLDivElement | null>(null);
  const addModalBackdropRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(openAddModal, addModalRef, addModalBackdropRef);

  const closeAddModal = useCallback(() => {
    setOpenAddModal(false);
    setTitle("");
  }, []);

  async function refresh() {
    setClassrooms(await getClassrooms());
  }

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  useEffect(() => {
    if (!openAddModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAddModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openAddModal, closeAddModal]);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || user?.role !== "teacher") return;
    setLoading(true);
    try {
      await createClassroom(title.trim());
      closeAddModal();
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string) {
    if (user?.role !== "teacher") return;
    if (!confirm("강의실을 삭제하시겠습니까?")) return;
    setError("");
    try {
      await deleteClassroom(id);
      setClassrooms((prev) => prev.filter((item) => item.id !== id));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "강의실 삭제에 실패했습니다.");
    }
  }

  const isTeacher = user?.role === "teacher";
  const dashboardTitle = isTeacher ? "내 강의실" : "초대받은 강의실";
  const dashboardCopy = isTeacher
    ? "강의실을 만들고 학생별 학습 흐름을 한 곳에서 관리하세요."
    : "선생님이 초대한 강의실과 학습 세션만 이곳에 표시됩니다.";

  return (
    <main className="page-shell">
      <section className="dashboard-hero fade-in">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1 className="page-title">{dashboardTitle}</h1>
          <p className="page-subtitle">{dashboardCopy}</p>
        </div>
        <div className="dashboard-hero-panel" aria-label="강의실 요약">
          <span className="dashboard-hero-pill">
            {isTeacher ? "교사용 관리" : "학생 학습"}
          </span>
          <strong>{classrooms.length}개</strong>
          <small>{isTeacher ? "생성한 강의실" : "참여 중인 강의실"}</small>
          {user?.role === "student" ? (
            <span className="dashboard-code">초대 코드 #{user.inviteCode}</span>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <AccountProfilePanel />

      <section className="grid cards dashboard-cards">
        {classrooms.map((classroom) => (
          <ClassroomCard
            key={classroom.id}
            classroom={classroom}
            onDelete={onDelete}
            canDelete={isTeacher}
          />
        ))}

        {isTeacher ? (
          <button
            type="button"
            className="add-classroom-card fade-in"
            onClick={() => setOpenAddModal(true)}
          >
            <span className="add-classroom-plus">+</span>
            <span className="dashboard-add-label">강의실 추가</span>
            <span className="dashboard-add-copy">
              새 수업 공간을 만들고 PDF 자료를 연결하세요.
            </span>
          </button>
        ) : null}
      </section>

      {!isTeacher && classrooms.length === 0 ? (
        <section className="card empty-state dashboard-empty-state">
          <strong>아직 초대받은 강의실이 없습니다.</strong>
          <span>선생님에게 이름과 초대 코드를 알려주면 이곳에 강의실이 표시됩니다.</span>
        </section>
      ) : null}

      {openAddModal ? createPortal(
        <div
          ref={addModalBackdropRef}
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeAddModal();
            }
          }}
        >
          <div
            ref={addModalRef}
            className="card modal-panel modal-panel-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-classroom-title"
            tabIndex={-1}
          >
            <div className="modal-head">
              <h3 id="add-classroom-title">강의실 추가</h3>
            </div>
            <form onSubmit={onAdd} className="modal-body">
              <div className="form-field">
                <label htmlFor="classroom-title">새 강의실 이름</label>
                <input
                  id="classroom-title"
                  className="input"
                  placeholder="예: 메타버스 이해"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={closeAddModal}
                >
                  취소
                </button>
                <button className="btn" type="submit" disabled={loading}>
                  {loading ? "생성중..." : "생성"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      ) : null}
    </main>
  );
}
