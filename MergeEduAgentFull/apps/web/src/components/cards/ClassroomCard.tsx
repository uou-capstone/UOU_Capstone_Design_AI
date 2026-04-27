import { Link } from "react-router-dom";
import { Classroom } from "../../types";

interface Props {
  classroom: Classroom;
  onDelete: (id: string) => void;
  canDelete?: boolean;
}

export function ClassroomCard({ classroom, onDelete, canDelete = false }: Props) {
  const initial = classroom.title.trim().charAt(0).toUpperCase() || "M";

  return (
    <article className="card classroom-card fade-in">
      <div className="classroom-card-accent" aria-hidden="true" />
      <div className="classroom-card-head">
        <div className="classroom-card-badge">{initial}</div>
        <span className="classroom-card-kicker">
          {canDelete ? "교사용 강의실" : "초대된 강의실"}
        </span>
      </div>
      <h3 className="classroom-card-title">{classroom.title}</h3>
      <p className="classroom-card-copy">
        {canDelete
          ? "주차, 자료, 학생 초대를 관리합니다."
          : "선생님이 등록한 자료로 학습을 이어갑니다."}
      </p>
      <div className="classroom-card-actions">
        <Link className="btn" to={`/classrooms/${classroom.id}`}>
          강의실 입장
        </Link>
        {canDelete ? (
          <button
            type="button"
            className="btn danger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete(classroom.id);
            }}
          >
            삭제
          </button>
        ) : null}
      </div>
    </article>
  );
}
