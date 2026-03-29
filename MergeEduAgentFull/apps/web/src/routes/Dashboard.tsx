import { FormEvent, useCallback, useEffect, useState } from "react";
import { ClassroomCard } from "../components/cards/ClassroomCard";
import {
  createClassroom,
  deleteClassroom,
  getClassrooms
} from "../api/endpoints";
import { Classroom } from "../types";

export function DashboardRoute() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [openAddModal, setOpenAddModal] = useState(false);
  const [error, setError] = useState("");

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
    if (!title.trim()) return;
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

  return (
    <main className="page-shell">
      <div className="heading">
        <div>
          <h1 style={{ margin: 0 }}>강의실 선택</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
            강의실 카드를 선택하거나 마지막 카드에서 새 강의실을 추가하세요.
          </p>
          {error ? (
            <p style={{ margin: "8px 0 0", color: "#b91c1c", fontWeight: 700 }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <section className="grid cards dashboard-cards">
        {classrooms.map((classroom) => (
          <ClassroomCard
            key={classroom.id}
            classroom={classroom}
            onDelete={onDelete}
          />
        ))}

        <button
          type="button"
          className="add-classroom-card fade-in"
          onClick={() => setOpenAddModal(true)}
        >
          <span className="add-classroom-plus">+</span>
          <span style={{ fontWeight: 700 }}>강의실 추가</span>
        </button>
      </section>

      {openAddModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeAddModal();
            }
          }}
        >
          <div className="card modal" style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>강의실 추가</h3>
            <form onSubmit={onAdd} style={{ display: "grid", gap: 10 }}>
              <input
                className="input"
                placeholder="새 강의실 이름"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
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
        </div>
      ) : null}
    </main>
  );
}
