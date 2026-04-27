import { Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import {
  requireAuth,
  requireClassroomOwner,
  requireTeacher,
  requireVerifiedEmail
} from "../middleware/auth.js";

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
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
        `student-enroll:${req.authUser!.id}:${classroom.id}`,
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
          action: "ENROLL",
          result: "NOT_FOUND"
        });
        res.status(404).json({ ok: false, error: "초대할 수 있는 학생을 찾지 못했습니다." });
        return;
      }
      if (!student || student.role !== "student" || !student.emailVerifiedAt) {
        res.status(404).json({ ok: false, error: "초대할 수 있는 학생을 찾지 못했습니다." });
        return;
      }
      const enrollment = await deps.store.enrollStudent(
        classroom.id,
        student.id,
        req.authUser!.id
      );
      await deps.store.appendInviteAuditLog({
        classroomId: classroom.id,
        teacherId: req.authUser!.id,
        studentUserId: student.id,
        action: "ENROLL",
        result: "SUCCESS"
      });
      res.status(201).json({
        ok: true,
        data: {
          id: student.id,
          displayName: student.displayName,
          inviteCode: student.inviteCode,
          maskedEmail: maskEmail(student.email),
          enrolledAt: enrollment.createdAt
        }
      });
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
        await deps.store.removeEnrollment(classroom.id, studentUserId);
        await deps.store.appendInviteAuditLog({
          classroomId: classroom.id,
          teacherId: req.authUser!.id,
          studentUserId,
          action: "REMOVE",
          result: "SUCCESS"
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
