import { Response, Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import {
  requireAuth,
  requireClassroomOwner,
  requireTeacher,
  requireVerifiedEmail
} from "../middleware/auth.js";
import {
  StudentCompetencyReportService
} from "../services/report/StudentCompetencyReportService.js";
import { Classroom, User } from "../types/domain.js";

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

async function requireReportStudent(
  deps: ServerDeps,
  res: Response,
  classroom: Classroom,
  studentUserId: string
): Promise<User | null> {
  const enrolled = await deps.store.isStudentEnrolled(classroom.id, studentUserId);
  const user = enrolled ? await deps.store.getUser(studentUserId) : null;
  if (!enrolled || !user || user.role !== "student" || !user.emailVerifiedAt) {
    res.status(404).json({ ok: false, error: "Student enrollment not found" });
    return null;
  }
  return user;
}

export function classroomsRouter(deps: ServerDeps): Router {
  const router = Router();
  const reportService = new StudentCompetencyReportService(deps.store, deps.bridge);

  router.use(requireAuth, requireVerifiedEmail);

  router.get("/", async (req, res, next) => {
    try {
      const data = await deps.store.listClassroomsForUser(req.authUser!);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", requireTeacher, async (req, res, next) => {
    try {
      const title = String(req.body?.title ?? "").trim();
      if (!title) {
        res.status(400).json({ ok: false, error: "title is required" });
        return;
      }
      const data = await deps.store.createClassroom(title, req.authUser!.id);
      res.status(201).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:classroomId", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      await deps.store.deleteClassroom(classroomId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/report", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) {
        return;
      }
      const data = await deps.store.getClassroomReport(classroomId);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:classroomId/report/students", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      const [enrollments, reports] = await Promise.all([
        deps.store.listEnrollmentsByClassroom(classroom.id),
        deps.store.listStudentClassroomReports(classroom.id)
      ]);
      const reportByStudentId = new Map(
        reports
          .filter((report) => report.studentUserId)
          .map((report) => [report.studentUserId!, report])
      );
      const students = await Promise.all(
        enrollments.map(async (enrollment) => {
          const user = await deps.store.getUser(enrollment.studentUserId);
          if (!user || user.role !== "student" || !user.emailVerifiedAt) return null;
          const report = reportByStudentId.get(user.id) ?? null;
          const sourceStats = report
            ? await reportService.enrichStudentProgressStats(classroom, user.id, report.sourceStats)
            : null;
          return {
            id: user.id,
            displayName: user.displayName,
            inviteCode: user.inviteCode,
            maskedEmail: maskEmail(user.email),
            enrolledAt: enrollment.createdAt,
            reportSummary: report
              ? {
                  generatedAt: report.generatedAt,
                  overallScore: report.overallScore,
                  overallLevel: report.overallLevel,
                  generationMode: report.generationMode,
                  analysisStatus: report.analysisStatus,
                  sourceStats
                }
              : null
          };
        })
      );
      res.json({ ok: true, data: students.filter(Boolean) });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/:classroomId/report/students/:studentUserId",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroomId = String(req.params.classroomId);
        const studentUserId = String(req.params.studentUserId);
        const classroom = await requireClassroomOwner(deps, req, res, classroomId);
        if (!classroom) return;
        const student = await requireReportStudent(deps, res, classroom, studentUserId);
        if (!student) return;
        const data = await deps.store.getStudentClassroomReport(classroom.id, studentUserId);
        res.json({ ok: true, data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/:classroomId/report/students/:studentUserId/analyze/stream",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroomId = String(req.params.classroomId);
        const studentUserId = String(req.params.studentUserId);
        const classroom = await requireClassroomOwner(deps, req, res, classroomId);
        if (!classroom) return;
        const student = await requireReportStudent(deps, res, classroom, studentUserId);
        if (!student) return;
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        if (typeof res.flushHeaders === "function") {
          res.flushHeaders();
        }

        const write = (payload: Record<string, unknown>) => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(`${JSON.stringify(payload)}\n`);
          }
        };

        const data = await reportService.analyzeAndSaveStudentReportStream(
          classroom.id,
          studentUserId,
          {
            onStage: (event) => write({ type: "stage", ...event }),
            onThoughtDelta: (text) => write({ type: "thought_delta", text }),
            onAnswerDelta: (text) => write({ type: "answer_delta", text })
          }
        );

        if (!data) {
          write({ type: "error", error: "Student enrollment not found" });
          res.end();
          return;
        }

        write({
          type: "final",
          data
        });
        res.end();
      } catch (error) {
        if (!res.headersSent) {
          next(error);
          return;
        }
        res.write(
          `${JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown student report stream error"
          })}\n`
        );
        res.end();
      }
    }
  );

  router.post("/:classroomId/report/analyze", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      const data = await reportService.analyzeAndSaveClassroomReport(classroomId);
      if (!data) {
        res.status(404).json({ ok: false, error: "Classroom not found" });
        return;
      }
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/report/analyze/stream", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const write = (payload: Record<string, unknown>) => {
        res.write(`${JSON.stringify(payload)}\n`);
      };

      const data = await reportService.analyzeAndSaveClassroomReportStream(
        classroomId,
        {
          onStage: (event) => write({ type: "stage", ...event }),
          onThoughtDelta: (text) => write({ type: "thought_delta", text }),
          onAnswerDelta: (text) => write({ type: "answer_delta", text })
        }
      );

      if (!data) {
        write({ type: "error", error: "Classroom not found" });
        res.end();
        return;
      }

      write({
        type: "final",
        data
      });
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        next(error);
        return;
      }
      res.write(
        `${JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown report stream error"
        })}\n`
      );
      res.end();
    }
  });

  return router;
}
