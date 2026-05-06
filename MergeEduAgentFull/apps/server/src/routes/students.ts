import { Request, Response, Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import {
  requireAuth,
  requireClassroomOwner,
  requireTeacher,
  requireVerifiedEmail
} from "../middleware/auth.js";
import { ClassroomInvitation } from "../types/domain.js";

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

async function serializeInvitation(
  deps: ServerDeps,
  invitation: ClassroomInvitation
) {
  const [student, classroom, teacher] = await Promise.all([
    deps.store.getUser(invitation.studentUserId),
    deps.store.getClassroom(invitation.classroomId),
    deps.store.getUser(invitation.invitedByTeacherId)
  ]);
  if (!student || student.role !== "student" || !classroom) return null;
  return {
    id: invitation.id,
    classroomId: invitation.classroomId,
    classroomTitle: classroom.title,
    teacherDisplayName: teacher?.displayName ?? "선생님",
    student: {
      id: student.id,
      displayName: student.displayName,
      inviteCode: student.inviteCode,
      maskedEmail: maskEmail(student.email)
    },
    status: invitation.status,
    invitedAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
    acceptedAt: invitation.acceptedAt
  };
}

function requireStudentRole(req: Request, res: Response): boolean {
  if (req.authUser?.role !== "student") {
    res.status(403).json({ ok: false, error: "Student role required", code: "STUDENT_ONLY" });
    return false;
  }
  return true;
}

export function studentsRouter(deps: ServerDeps): Router {
  const router = Router();

  router.use(requireAuth, requireVerifiedEmail);

  router.get("/students/search", requireTeacher, async (req, res, next) => {
    try {
      const name = String(req.query.name ?? "");
      const code = String(req.query.code ?? "").trim();
      const classroomId = String(req.query.classroomId ?? "");
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      const limited = await deps.store.checkAndIncrementRateLimit(
        `student-search:${req.authUser!.id}:${classroom.id}`,
        30,
        15 * 60 * 1000
      );
      if (!limited) {
        res.status(429).json({ ok: false, error: "잠시 후 다시 시도해 주세요." });
        return;
      }
      if (!name.trim() || !/^\d{4}$/.test(code)) {
        res.status(400).json({ ok: false, error: "이름과 4자리 코드를 입력해 주세요." });
        return;
      }
      const student = await deps.store.findStudentByInviteTag(name, code);
      await deps.store.appendInviteAuditLog({
        classroomId: classroom.id,
        teacherId: req.authUser!.id,
        studentUserId: student?.id,
        action: "SEARCH",
        result: student ? "SUCCESS" : "NOT_FOUND"
      });
      if (!student) {
        res.status(404).json({ ok: false, error: "학생을 찾지 못했습니다." });
        return;
      }
      res.json({
        ok: true,
        data: {
          id: student.id,
          displayName: student.displayName,
          inviteCode: student.inviteCode,
          maskedEmail: maskEmail(student.email)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/students/invitations", async (req, res, next) => {
    try {
      if (!requireStudentRole(req, res)) return;
      const invitations = await deps.store.listStudentClassroomInvitations(req.authUser!.id);
      const pending = invitations.filter((invitation) => invitation.status === "PENDING");
      const data = await Promise.all(pending.map((invitation) => serializeInvitation(deps, invitation)));
      res.json({ ok: true, data: data.filter(Boolean) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/students/invitations/:invitationId/accept", async (req, res, next) => {
    try {
      if (!requireStudentRole(req, res)) return;
      const result = await deps.store.acceptClassroomInvitation(
        String(req.params.invitationId),
        req.authUser!.id
      );
      if (!result.ok) {
        res.status(result.reason === "FORBIDDEN" ? 403 : 404).json({
          ok: false,
          error: result.reason === "FORBIDDEN"
            ? "다른 학생에게 발송된 초대입니다."
            : "초대를 찾을 수 없습니다."
        });
        return;
      }
      await deps.store.appendInviteAuditLog({
        classroomId: result.invitation.classroomId,
        teacherId: result.invitation.invitedByTeacherId,
        studentUserId: req.authUser!.id,
        action: "ACCEPT",
        result: result.acceptedNow ? "SUCCESS" : "DUPLICATE"
      });
      const data = await serializeInvitation(deps, result.invitation);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get("/classrooms/:classroomId/invitations", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const invitations = await deps.store.listClassroomInvitations(classroom.id);
      const data = await Promise.all(
        invitations.map((invitation) => serializeInvitation(deps, invitation))
      );
      res.json({ ok: true, data: data.filter(Boolean) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/classrooms/:classroomId/students", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const enrollments = await deps.store.listEnrollmentsByClassroom(classroom.id);
      const students = await Promise.all(
        enrollments.map(async (enrollment) => {
          const user = await deps.store.getUser(enrollment.studentUserId);
          return user
            ? {
                id: user.id,
                displayName: user.displayName,
                inviteCode: user.inviteCode,
                maskedEmail: maskEmail(user.email),
                enrolledAt: enrollment.createdAt
              }
            : null;
        })
      );
      res.json({ ok: true, data: students.filter(Boolean) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/classrooms/:classroomId/students", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const studentUserId = String(req.body?.studentUserId ?? "");
      const name = String(req.body?.name ?? "");
      const code = String(req.body?.code ?? "").trim();
      const limited = await deps.store.checkAndIncrementRateLimit(
        `student-invite:${req.authUser!.id}:${classroom.id}`,
        20,
        15 * 60 * 1000
      );
      if (!limited) {
        res.status(429).json({ ok: false, error: "잠시 후 다시 시도해 주세요." });
        return;
      }
      if (!name.trim() || !/^\d{4}$/.test(code)) {
        res.status(400).json({ ok: false, error: "이름과 4자리 코드를 다시 확인해 주세요." });
        return;
      }
      const student = await deps.store.findStudentByInviteTag(name, code);
      if (!student || student.id !== studentUserId) {
        await deps.store.appendInviteAuditLog({
          classroomId: classroom.id,
          teacherId: req.authUser!.id,
          studentUserId,
          action: "INVITE",
          result: "NOT_FOUND"
        });
        res.status(404).json({ ok: false, error: "초대할 수 있는 학생을 찾지 못했습니다." });
        return;
      }
      if (!student || student.role !== "student" || !student.emailVerifiedAt) {
        res.status(404).json({ ok: false, error: "초대할 수 있는 학생을 찾지 못했습니다." });
        return;
      }
      const result = await deps.store.createClassroomInvitation(
        classroom.id,
        student.id,
        req.authUser!.id
      );
      await deps.store.appendInviteAuditLog({
        classroomId: classroom.id,
        teacherId: req.authUser!.id,
        studentUserId: student.id,
        action: "INVITE",
        result: result.created ? "SUCCESS" : "DUPLICATE"
      });
      const data = await serializeInvitation(deps, result.invitation);
      res.status(result.created ? 201 : 200).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    "/classrooms/:classroomId/students/:studentUserId",
    requireTeacher,
    async (req, res, next) => {
      try {
        const studentUserId = String(req.params.studentUserId);
        const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
        if (!classroom) return;
        const result = await deps.store.deleteClassroomInvitationForStudent(
          classroom.id,
          studentUserId
        );
        await deps.store.appendInviteAuditLog({
          classroomId: classroom.id,
          teacherId: req.authUser!.id,
          studentUserId,
          action: "REMOVE",
          result: result.deletedInvitation || result.deletedEnrollment ? "SUCCESS" : "NOT_FOUND"
        });
        if (!result.deletedInvitation && !result.deletedEnrollment) {
          res.status(404).json({ ok: false, error: "초대 또는 참여 학생을 찾지 못했습니다." });
          return;
        }
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
