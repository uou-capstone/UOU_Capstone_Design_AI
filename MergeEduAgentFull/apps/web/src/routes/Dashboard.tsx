import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClassroomCard } from "../components/cards/ClassroomCard";
import {
  acceptClassroomInvitation,
  createClassroom,
  deleteClassroom,
  getClassrooms,
  getMyClassroomInvitations
} from "../api/endpoints";
import { useAuth } from "../auth/useAuth";
import { useDialogFocus } from "../components/ui/useDialogFocus";
import { Classroom, ClassroomInvitation } from "../types";

function formatInvitationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function DashboardRoute() {
  const { user } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [studentInvitations, setStudentInvitations] = useState<ClassroomInvitation[]>([]);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationError, setInvitationError] = useState("");
  const [acceptingInvitationId, setAcceptingInvitationId] = useState("");
  const [title, setTitle] = useState("");
  const [classroomsLoading, setClassroomsLoading] = useState(false);
  const [classroomError, setClassroomError] = useState("");
  const [loading, setLoading] = useState(false);
  const [openAddModal, setOpenAddModal] = useState(false);
  const [addError, setAddError] = useState("");
  const [error, setError] = useState("");
  const addModalRef = useRef<HTMLDivElement | null>(null);
  const addModalBackdropRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(openAddModal, addModalRef, addModalBackdropRef);

  const closeAddModal = useCallback(() => {
    setOpenAddModal(false);
    setTitle("");
    setAddError("");
  }, []);

  async function refresh(options: { preserveClassroomsOnError?: boolean } = {}) {
    setClassroomsLoading(true);
    setClassroomError("");
    try {
      const nextClassrooms = await getClassrooms();
      setClassrooms(nextClassrooms);
    } catch (err) {
      if (!options.preserveClassroomsOnError) {
        setClassrooms([]);
      }
      setClassroomError(err instanceof Error ? err.message : "강의실 목록을 불러오지 못했습니다.");
    } finally {
      setClassroomsLoading(false);
    }

    if (user?.role !== "student") {
      setStudentInvitations([]);
      setInvitationError("");
      return;
    }
    setInvitationLoading(true);
    setInvitationError("");
    try {
      setStudentInvitations(await getMyClassroomInvitations());
    } catch (err) {
      setInvitationError(err instanceof Error ? err.message : "받은 초대를 불러오지 못했습니다.");
    } finally {
      setInvitationLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch(console.error);
  }, [user?.role]);

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
    const trimmedTitle = title.trim();
    if (!trimmedTitle || user?.role !== "teacher" || loading) return;
    setAddError("");
    setLoading(true);
    try {
      const createdClassroom = await createClassroom(trimmedTitle);
      setClassrooms((prev) =>
        prev.some((classroom) => classroom.id === createdClassroom.id)
          ? prev
          : [...prev, createdClassroom]
      );
      closeAddModal();
      await refresh({ preserveClassroomsOnError: true });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "강의실 생성에 실패했습니다.");
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

  async function onAcceptInvitation(invitationId: string) {
    if (user?.role !== "student") return;
    setAcceptingInvitationId(invitationId);
    setInvitationError("");
    try {
      await acceptClassroomInvitation(invitationId);
      await refresh();
    } catch (err) {
      setInvitationError(err instanceof Error ? err.message : "초대 수락에 실패했습니다.");
    } finally {
      setAcceptingInvitationId("");
    }
  }

  const isTeacher = user?.role === "teacher";
  const dashboardTitle = isTeacher ? "내 강의실" : "초대받은 강의실";
  const dashboardCopy = isTeacher
    ? "강의실을 만들고 학생별 학습 흐름을 한 곳에서 관리하세요."
    : "선생님이 초대한 강의실과 학습 세션만 이곳에 표시됩니다.";

  return (
    <main className="page-shell" data-testid="app-shell-content">
      <section className="dashboard-hero fade-in" data-testid="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-status-pill">{isTeacher ? "관리 중" : "학습 중"}</span>
          <h1 className="page-title">{dashboardTitle}</h1>
          <p className="page-subtitle">{dashboardCopy}</p>
        </div>
        <div className="dashboard-hero-visual" aria-hidden="true">
          <span className="dashboard-visual-tile dashboard-visual-tile-lg" />
          <span className="dashboard-visual-tile dashboard-visual-tile-play" />
          <span className="dashboard-visual-tile dashboard-visual-tile-sm" />
        </div>
      </section>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="dashboard-content-grid" data-testid="dashboard-content-grid">
        <section className="dashboard-classroom-panel" data-testid="dashboard-classroom-panel">
          <div className="dashboard-card-head dashboard-panel-head">
            <div>
              <h2>강의실 목록</h2>
              <p>{isTeacher ? "수업 공간을 만들고 관리합니다." : "참여 중인 강의실로 이동합니다."}</p>
            </div>
          </div>

          {!isTeacher ? (
            <section
              className="card dashboard-panel-invitation-inbox student-invitation-inbox"
              data-testid="student-invitation-inbox"
            >
              <div className="dashboard-card-head">
                <div>
                  <h2>받은 초대</h2>
                  <p>선생님이 보낸 강의실 초대를 수락하세요.</p>
                </div>
                <span>{studentInvitations.length}건</span>
              </div>
              {invitationError ? (
                <div className="student-inbox-alert" role="alert">
                  <span>{invitationError}</span>
                  <button className="btn ghost" onClick={() => refresh()} disabled={invitationLoading}>
                    다시 시도
                  </button>
                </div>
              ) : null}
              <div className="student-invitation-list">
                {invitationLoading && studentInvitations.length === 0 ? (
                  <div className="student-invitation-empty">초대를 확인하는 중...</div>
                ) : null}
                {!invitationLoading && studentInvitations.length === 0 ? (
                  <div className="student-invitation-empty">대기 중인 초대가 없습니다.</div>
                ) : null}
                {studentInvitations.map((invitation) => (
                  <article key={invitation.id} className="student-invitation-row">
                    <span className="student-invitation-avatar" aria-hidden="true">
                      {invitation.classroomTitle.slice(0, 1)}
                    </span>
                    <span className="student-invitation-copy">
                      <strong>{invitation.classroomTitle}</strong>
                      <small>
                        {invitation.teacherDisplayName} · {formatInvitationTime(invitation.invitedAt)} 초대
                      </small>
                    </span>
                    <button
                      className="btn student-invitation-accept"
                      onClick={() => onAcceptInvitation(invitation.id)}
                      disabled={acceptingInvitationId === invitation.id}
                    >
                      {acceptingInvitationId === invitation.id ? "수락 중" : "수락"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {classroomError ? (
            <section className="student-inbox-alert dashboard-classroom-alert" role="alert">
              <span>{classroomError}</span>
              <button
                className="btn ghost"
                onClick={() => refresh({ preserveClassroomsOnError: classrooms.length > 0 })}
                disabled={classroomsLoading}
              >
                다시 시도
              </button>
            </section>
          ) : null}

          {classroomsLoading && classrooms.length === 0 ? (
            <section className="empty-state dashboard-empty-state">
              강의실 목록을 불러오는 중...
            </section>
          ) : null}

          <section className="dashboard-classroom-list" data-testid="dashboard-classroom-list">
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

          {!classroomsLoading && !classroomError && !isTeacher && classrooms.length === 0 ? (
            <section className="empty-state dashboard-empty-state">
              <strong>아직 초대받은 강의실이 없습니다.</strong>
              <span>선생님에게 이름과 초대 코드를 알려주면 이곳에 강의실이 표시됩니다.</span>
            </section>
          ) : null}
        </section>
      </section>

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
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (addError) setAddError("");
                  }}
                  autoFocus
                />
              </div>
              {addError ? (
                <p className="form-error" role="alert">
                  {addError}
                </p>
              ) : null}
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
