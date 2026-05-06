import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getClassroomInvitations,
  getClassroomStudents,
  inviteStudent,
  removeClassroomStudent,
  searchStudentInvite
} from "../../api/endpoints";
import { ClassroomInvitation, ClassroomStudent } from "../../types";

type InviteViewMode = "dashboard" | "joined-all" | "invites-all";
type InviteIconName = "back" | "check" | "clock" | "copy" | "more" | "refresh" | "trash" | "users";

function InviteIcon({ name }: { name: InviteIconName }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false
  };

  if (name === "users") {
    return (
      <svg {...commonProps}>
        <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM15.5 10a3 3 0 1 0 0-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M3.5 20c.8-3.6 2.7-5.4 5-5.4s4.2 1.8 5 5.4M14 15c2.5.2 4.4 1.9 5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "clock") {
    return (
      <svg {...commonProps}>
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="1.9" />
        <path d="M12 7v5l3.2 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...commonProps}>
        <path d="m5 12.5 4.2 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg {...commonProps}>
        <path d="M8 8h11v11H8V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M5 16H4V4h12v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg {...commonProps}>
        <path d="M8 9v8M12 9v8M16 9v8M5 7h14M10 4h4l1 3H9l1-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg {...commonProps}>
        <path d="M20 12a8 8 0 0 1-13.4 5.9M4 12A8 8 0 0 1 17.4 6.1M17 3v4h-4M7 21v-4h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "back") {
    return (
      <svg {...commonProps}>
        <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getInitial(name: string) {
  return name.trim().slice(0, 1) || "학";
}

function studentFromInvitation(invitation: ClassroomInvitation): ClassroomStudent {
  return {
    ...invitation.student,
    enrolledAt: invitation.acceptedAt ?? invitation.updatedAt
  };
}

export function InviteStudentPanel({
  classroomId,
  isTeacher
}: {
  classroomId: string;
  isTeacher: boolean;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [students, setStudents] = useState<ClassroomStudent[]>([]);
  const [invitations, setInvitations] = useState<ClassroomInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<InviteViewMode>("dashboard");
  const requestSeq = useRef(0);

  const acceptedInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === "ACCEPTED"),
    [invitations]
  );
  const pendingInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === "PENDING"),
    [invitations]
  );
  const joinedStudents = students.length > 0
    ? students
    : acceptedInvitations.map(studentFromInvitation);

  const refresh = useCallback(async () => {
    if (!isTeacher) return;
    const nextSeq = requestSeq.current + 1;
    requestSeq.current = nextSeq;
    setListLoading(true);
    setListError("");
    try {
      const [nextStudents, nextInvitations] = await Promise.all([
        getClassroomStudents(classroomId),
        getClassroomInvitations(classroomId)
      ]);
      if (requestSeq.current !== nextSeq) return;
      setStudents(nextStudents);
      setInvitations(nextInvitations);
    } catch (err) {
      if (requestSeq.current !== nextSeq) return;
      setListError(err instanceof Error ? err.message : "초대 현황을 불러오지 못했습니다.");
    } finally {
      if (requestSeq.current !== nextSeq) return;
      setListLoading(false);
    }
  }, [classroomId, isTeacher]);

  useEffect(() => {
    if (!isTeacher) {
      requestSeq.current += 1;
      setStudents([]);
      setInvitations([]);
      setListError("");
      setListLoading(false);
      return;
    }
    refresh().catch(console.error);
    return () => {
      requestSeq.current += 1;
    };
  }, [isTeacher, refresh]);

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    if (!isTeacher) return;
    setError("");
    setMessage("");
    if (!name.trim() || !/^\d{4}$/.test(code.trim())) {
      setError("학생 이름과 4자리 코드를 입력해 주세요.");
      return;
    }
    setLoading(true);
    try {
      const candidate = await searchStudentInvite({
        name: name.trim(),
        code: code.trim(),
        classroomId
      });
      const invitation = await inviteStudent(classroomId, {
        studentUserId: candidate.id,
        name: candidate.displayName,
        code: candidate.inviteCode
      });
      setMessage(
        invitation.status === "ACCEPTED"
          ? "이미 참여한 학생입니다. 참여 명단을 갱신했습니다."
          : "초대를 보냈습니다. 학생이 수락하면 참여 학생에 표시됩니다."
      );
      setName("");
      setCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생 초대에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function onRemove(studentId: string, status: "PENDING" | "ACCEPTED") {
    if (!isTeacher) return;
    const confirmText = status === "ACCEPTED"
      ? "참여 학생을 강의실에서 제거하시겠습니까?"
      : "아직 수락하지 않은 초대를 취소하시겠습니까?";
    if (!confirm(confirmText)) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await removeClassroomStudent(classroomId, studentId);
      setMessage(status === "ACCEPTED" ? "참여 학생을 제거했습니다." : "초대를 취소했습니다.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function onCopyCode(inviteCode: string) {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setMessage(`초대 코드 ${inviteCode}를 복사했습니다.`);
    } catch {
      setError("브라우저에서 복사를 허용하지 않았습니다.");
    }
  }

  if (!isTeacher) return null;

  const joinedPreview = joinedStudents.slice(0, 5);
  const invitationPreview = invitations.slice(0, 5);
  const currentTitle = viewMode === "joined-all"
    ? "참여 학생 전체"
    : viewMode === "invites-all"
      ? "초대 현황 전체"
      : "";

  return (
    <section className="invite-redesign" data-testid="classroom-invite-panel">
      <section className="classroom-hero invite-hero fade-in" data-testid="classroom-hero">
        <div className="classroom-title-block">
          <span className="dashboard-status-pill">강의 운영</span>
          <h1 className="page-title">학생 초대</h1>
          <p className="page-subtitle">
            학생 이름과 참여 코드를 통해 수업 구성원을 초대하고 참여 현황을 관리하세요.
          </p>
        </div>
        <div className="invite-hero-metrics" aria-label="학생 초대 현황">
          <span className="invite-metric invite-metric-blue">
            <InviteIcon name="users" />
            <strong>초대 완료</strong>
            <b>{invitations.length}명</b>
            <small>전체 초대 인원</small>
          </span>
          <span className="invite-metric invite-metric-amber">
            <InviteIcon name="clock" />
            <strong>대기 중</strong>
            <b>{pendingInvitations.length}명</b>
            <small>참여 승인 대기</small>
          </span>
          <span className="invite-metric invite-metric-green">
            <InviteIcon name="check" />
            <strong>참여 학생</strong>
            <b>{joinedStudents.length}명</b>
            <small>현재 수업 참여</small>
          </span>
        </div>
        <div className="classroom-hero-visual" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      {listError ? (
        <div className="invite-inline-alert" role="alert">
          <span>{listError}</span>
          <button className="invite-retry-btn" onClick={refresh} disabled={listLoading}>
            <InviteIcon name="refresh" />
            다시 시도
          </button>
        </div>
      ) : null}

      {message ? <div className="form-success invite-message" aria-live="polite">{message}</div> : null}
      {error ? <div id="invite-error" className="form-error invite-message" role="alert">{error}</div> : null}

      {viewMode !== "dashboard" ? (
        <section className="card invite-full-view" data-testid={viewMode === "joined-all" ? "joined-students-full-view" : "invitation-history-full-view"}>
          <div className="invite-card-head">
            <div>
              <h2>{currentTitle}</h2>
              <p>{viewMode === "joined-all" ? "초대를 수락하고 실제 참여 중인 학생입니다." : "초대 발송부터 참여 완료까지의 전체 기록입니다."}</p>
            </div>
            <button className="invite-back-btn" onClick={() => setViewMode("dashboard")}>
              <InviteIcon name="back" />
              돌아가기
            </button>
          </div>
          {viewMode === "joined-all" ? (
            <JoinedStudentsList
              students={joinedStudents}
              loading={listLoading || Boolean(listError)}
              onRemove={(studentId) => onRemove(studentId, "ACCEPTED")}
            />
          ) : (
            <InvitationHistory
              invitations={invitations}
              loading={listLoading || Boolean(listError)}
              onCopyCode={onCopyCode}
              onRemove={(invitation) => onRemove(invitation.student.id, invitation.status)}
            />
          )}
        </section>
      ) : (
        <>
          <section className="invite-dashboard-grid">
            <section className="card invite-form-card" data-testid="invite-form-card">
              <div className="invite-card-head">
                <div>
                  <h2>학생 초대</h2>
                  <p>학생 정보를 입력하고 4자리 코드를 전달해 주세요.</p>
                </div>
              </div>
              <form className="invite-inline-form" onSubmit={onInvite}>
                <div className="form-field">
                  <label htmlFor="invite-student-name">학생 이름</label>
                  <input
                    id="invite-student-name"
                    className="input"
                    placeholder="학생 이름 입력"
                    value={name}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "invite-error" : undefined}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="form-field invite-code-field">
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
                <button className="btn invite-primary-btn" disabled={loading}>
                  <InviteIcon name="users" />
                  {loading ? "초대 중..." : "학생 초대"}
                </button>
              </form>
              <div className="invite-help-line">
                <span className="invite-help-icon">i</span>
                강의에 초대할 학생의 이름과 코드를 입력해 주세요.
              </div>
            </section>

            <section className="card joined-students-card" data-testid="joined-students-card">
              <div className="invite-card-head">
                <div>
                  <h2>참여 학생</h2>
                  <p>총 {joinedStudents.length}명</p>
                </div>
                <button className="invite-link-btn" onClick={() => setViewMode("joined-all")} disabled={joinedStudents.length === 0}>
                  전체 보기
                </button>
              </div>
              <JoinedStudentsList
                students={joinedPreview}
                loading={listLoading || Boolean(listError)}
                onRemove={(studentId) => onRemove(studentId, "ACCEPTED")}
              />
            </section>
          </section>

          <section className="card invitation-history-card" data-testid="invitation-history-card">
            <div className="invite-card-head">
              <div>
                <h2>초대 현황</h2>
                <p>최근 초대한 학생 목록과 상태를 확인하세요.</p>
              </div>
              <button className="invite-link-btn" onClick={() => setViewMode("invites-all")} disabled={invitations.length === 0}>
                전체 보기
              </button>
            </div>
            <InvitationHistory
              invitations={invitationPreview}
              loading={listLoading || Boolean(listError)}
              onCopyCode={onCopyCode}
              onRemove={(invitation) => onRemove(invitation.student.id, invitation.status)}
            />
          </section>
        </>
      )}
    </section>
  );
}

function JoinedStudentsList({
  students,
  loading,
  onRemove
}: {
  students: ClassroomStudent[];
  loading: boolean;
  onRemove: (studentId: string) => void;
}) {
  if (loading && students.length === 0) {
    return <div className="invite-empty-state">참여 학생을 불러오는 중...</div>;
  }
  if (students.length === 0) {
    return <div className="invite-empty-state">아직 참여한 학생이 없습니다.</div>;
  }
  return (
    <div className="joined-student-list">
      {students.map((student) => (
        <article key={student.id} className="joined-student-row">
          <span className="student-avatar" aria-hidden="true">{getInitial(student.displayName)}</span>
          <span className="joined-student-copy">
            <strong>{student.displayName}</strong>
            <small>참여: {formatTime(student.enrolledAt)}</small>
          </span>
          <button className="invite-icon-action" aria-label={`${student.displayName} 제거`} onClick={() => onRemove(student.id)}>
            <InviteIcon name="more" />
          </button>
        </article>
      ))}
    </div>
  );
}

function InvitationHistory({
  invitations,
  loading,
  onCopyCode,
  onRemove
}: {
  invitations: ClassroomInvitation[];
  loading: boolean;
  onCopyCode: (inviteCode: string) => void;
  onRemove: (invitation: ClassroomInvitation) => void;
}) {
  if (loading && invitations.length === 0) {
    return <div className="invite-empty-state">초대 현황을 불러오는 중...</div>;
  }
  if (invitations.length === 0) {
    return <div className="invite-empty-state">아직 초대된 학생이 없습니다.</div>;
  }
  return (
    <div className="invitation-history-table" data-testid="invitation-history-table">
      <div className="invitation-history-head" aria-hidden="true">
        <span>학생</span>
        <span>상태</span>
        <span>초대 시간</span>
        <span>코드</span>
        <span />
      </div>
      {invitations.map((invitation) => (
        <article key={invitation.id} className="invitation-history-row">
          <span className="student-avatar" aria-hidden="true">{getInitial(invitation.student.displayName)}</span>
          <span className="invitation-student-main">
            <strong>{invitation.student.displayName}</strong>
            <small>{invitation.student.maskedEmail}</small>
          </span>
          <span className={`invite-status-pill ${invitation.status === "ACCEPTED" ? "accepted" : "pending"}`}>
            {invitation.status === "ACCEPTED" ? "참여 완료" : "초대 완료"}
          </span>
          <span className="invitation-muted">{formatTime(invitation.invitedAt)} 초대</span>
          <span className="invitation-code">{invitation.student.inviteCode}</span>
          <span className="invitation-actions">
            <button className="invite-icon-action" aria-label={`${invitation.student.displayName} 코드 복사`} onClick={() => onCopyCode(invitation.student.inviteCode)}>
              <InviteIcon name="copy" />
            </button>
            <button className="invite-icon-action danger" aria-label={`${invitation.student.displayName} ${invitation.status === "ACCEPTED" ? "제거" : "초대 취소"}`} onClick={() => onRemove(invitation)}>
              <InviteIcon name="trash" />
            </button>
          </span>
        </article>
      ))}
    </div>
  );
}
