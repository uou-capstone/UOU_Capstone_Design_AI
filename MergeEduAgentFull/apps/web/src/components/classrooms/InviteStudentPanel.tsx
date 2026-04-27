import { FormEvent, useEffect, useState } from "react";
import {
  getClassroomStudents,
  inviteStudent,
  removeClassroomStudent,
  searchStudentInvite
} from "../../api/endpoints";
import { ClassroomStudent, StudentInviteCandidate } from "../../types";

export function InviteStudentPanel({
  classroomId,
  isTeacher
}: {
  classroomId: string;
  isTeacher: boolean;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [candidate, setCandidate] = useState<StudentInviteCandidate | null>(null);
  const [students, setStudents] = useState<ClassroomStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    if (!isTeacher) return;
    setStudents(await getClassroomStudents(classroomId));
  }

  useEffect(() => {
    if (!isTeacher) {
      setStudents([]);
      return;
    }
    refresh().catch(() => setStudents([]));
  }, [classroomId, isTeacher]);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    if (!isTeacher) return;
    setError("");
    setMessage("");
    setCandidate(null);
    if (!name.trim() || !/^\d{4}$/.test(code.trim())) {
      setError("학생 이름과 4자리 코드를 입력해 주세요.");
      return;
    }
    setLoading(true);
    try {
      setCandidate(
        await searchStudentInvite({
          name: name.trim(),
          code: code.trim(),
          classroomId
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생을 찾지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function onInvite() {
    if (!isTeacher || !candidate) return;
    setLoading(true);
    setError("");
    try {
      await inviteStudent(classroomId, {
        studentUserId: candidate.id,
        name: candidate.displayName,
        code: candidate.inviteCode
      });
      setMessage("학생을 초대했습니다.");
      setCandidate(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "초대에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function onRemove(studentId: string) {
    if (!isTeacher) return;
    setLoading(true);
    setError("");
    try {
      await removeClassroomStudent(classroomId, studentId);
      setMessage("학생을 제거했습니다.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생 제거에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (!isTeacher) return null;

  return (
    <section className="card invite-panel">
      <div className="invite-panel-head">
        <div>
          <h3>학생 초대</h3>
          <p>학생의 이름과 4자리 코드를 입력하세요.</p>
        </div>
      </div>
      <div className="invite-grid">
        <div className="invite-form-panel">
          <form className="invite-form" onSubmit={onSearch}>
            <div className="form-field">
              <label htmlFor="invite-student-name">학생 이름</label>
              <input
                id="invite-student-name"
                className="input"
                placeholder="학생 이름"
                value={name}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "invite-error" : undefined}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="invite-student-code">4자리 코드</label>
              <input
                id="invite-student-code"
                className="input"
                inputMode="numeric"
                placeholder="1234"
                value={code}
                maxLength={4}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "invite-error" : undefined}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </div>
            <button className="btn" disabled={loading}>
              검색
            </button>
          </form>
          {candidate ? (
            <div className="invite-candidate">
              <span>
                {candidate.displayName} #{candidate.inviteCode} · {candidate.maskedEmail}
              </span>
              <button className="btn" onClick={onInvite} disabled={loading}>
                초대
              </button>
            </div>
          ) : null}
          {message ? <div className="form-success" aria-live="polite">{message}</div> : null}
          {error ? <div id="invite-error" className="form-error" role="alert">{error}</div> : null}
        </div>

        <div className="student-list-panel">
          <div className="student-list-head">
            <strong>참여 학생</strong>
            <span>{students.length}명</span>
          </div>
          <div className="student-list">
            {students.length === 0 ? (
              <div className="student-empty">아직 초대된 학생이 없습니다.</div>
            ) : null}
            {students.map((student) => (
              <div key={student.id} className="student-row">
                <span>
                  {student.displayName} #{student.inviteCode}
                  <small>{student.maskedEmail}</small>
                </span>
                <button className="btn ghost" onClick={() => onRemove(student.id)} disabled={loading}>
                  제거
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
