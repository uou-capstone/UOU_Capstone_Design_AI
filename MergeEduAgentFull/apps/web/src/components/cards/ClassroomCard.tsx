import { Link } from "react-router-dom";
import { Classroom } from "../../types";

interface Props {
  classroom: Classroom;
  onDelete: (id: string) => void;
}

export function ClassroomCard({ classroom, onDelete }: Props) {
  return (
    <article className="card classroom-card fade-in">
      <div className="classroom-card-badge">CLS</div>
      <h3 className="classroom-card-title">{classroom.title}</h3>
      <div className="classroom-card-actions">
        <Link className="btn" to={`/classrooms/${classroom.id}`}>
          입장
        </Link>
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
      </div>
    </article>
  );
}
