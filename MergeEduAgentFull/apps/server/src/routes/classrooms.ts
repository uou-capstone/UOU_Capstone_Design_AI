import { Response, Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import {
  requireAuth,
  requireClassroomOwner,
  requireTeacher,
  requireVerifiedEmail
} from "../middleware/auth.js";
import {
  StudentCompetencyReportService,
  sanitizeStudentReportChatHistory
} from "../services/report/StudentCompetencyReportService.js";
import { Classroom, User } from "../types/domain.js";

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

function parseCriterionInput(
  body: unknown,
  options: { partial?: boolean } = {}
): { name?: string; description?: string; error?: string } {
  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nameProvided = Object.prototype.hasOwnProperty.call(candidate, "name");
  const descriptionProvided = Object.prototype.hasOwnProperty.call(candidate, "description");
  const name = nameProvided && typeof candidate.name === "string" ? candidate.name.trim() : "";
  const description =
    descriptionProvided && typeof candidate.description === "string"
      ? candidate.description.trim()
      : "";

  if (!options.partial || nameProvided) {
    if (!name) return { error: "항목 이름을 입력해 주세요." };
    if (name.length > 60) return { error: "항목 이름은 60자 이하로 입력해 주세요." };
  }
  if (!options.partial || descriptionProvided) {
    if (!description) return { error: "항목 설명을 입력해 주세요." };
    if (description.length > 600) {
      return { error: "항목 설명은 600자 이하로 입력해 주세요." };
    }
  }
  if (options.partial && !nameProvided && !descriptionProvided) {
    return { error: "수정할 항목 이름 또는 설명을 입력해 주세요." };
  }

  return {
    ...(nameProvided ? { name } : {}),
    ...(descriptionProvided ? { description } : {})
  };
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

  router.get("/:classroomId/report/criteria", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const data = await deps.store.listClassroomReportCriteria(classroom.id);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/report/criteria", requireTeacher, async (req, res, next) => {
    try {
      const classroom = await requireClassroomOwner(deps, req, res, String(req.params.classroomId));
      if (!classroom) return;
      const parsed = parseCriterionInput(req.body);
      if (parsed.error || !parsed.name || !parsed.description) {
        res.status(400).json({ ok: false, error: parsed.error ?? "Invalid criterion input" });
        return;
      }
      const data = await deps.store.createClassroomReportCriterion(classroom.id, {
        name: parsed.name,
        description: parsed.description
      });
      res.status(201).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/:classroomId/report/criteria/:criterionId",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroom = await requireClassroomOwner(
          deps,
          req,
          res,
          String(req.params.classroomId)
        );
        if (!classroom) return;
        const parsed = parseCriterionInput(req.body, { partial: true });
        if (parsed.error) {
          res.status(400).json({ ok: false, error: parsed.error });
          return;
        }
        const data = await deps.store.updateClassroomReportCriterion(
          classroom.id,
          String(req.params.criterionId),
          parsed
        );
        if (!data) {
          res.status(404).json({ ok: false, error: "Report criterion not found" });
          return;
        }
        res.json({ ok: true, data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    "/:classroomId/report/criteria/:criterionId",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroom = await requireClassroomOwner(
          deps,
          req,
          res,
          String(req.params.classroomId)
        );
        if (!classroom) return;
        const deleted = await deps.store.deleteClassroomReportCriterion(
          classroom.id,
          String(req.params.criterionId)
        );
        if (!deleted) {
          res.status(404).json({ ok: false, error: "Report criterion not found" });
          return;
        }
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    }
  );

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
    "/:classroomId/report/students/:studentUserId/chat/stream",
    requireTeacher,
    async (req, res, next) => {
      try {
        const classroomId = String(req.params.classroomId);
        const studentUserId = String(req.params.studentUserId);
        const classroom = await requireClassroomOwner(deps, req, res, classroomId);
        if (!classroom) return;
        const student = await requireReportStudent(deps, res, classroom, studentUserId);
        if (!student) return;

        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!message) {
          res.status(400).json({ ok: false, error: "message is required" });
          return;
        }
        if (message.length > 2000) {
          res.status(400).json({ ok: false, error: "message must be 2000 characters or fewer" });
          return;
        }

        const savedReport = await deps.store.getStudentClassroomReport(classroom.id, student.id);
        if (!savedReport) {
          res.status(409).json({ ok: false, error: "Generate the selected student's report before chatting" });
          return;
        }

        const history = sanitizeStudentReportChatHistory(req.body?.history);
        const abortController = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) {
            abortController.abort();
          }
        });

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

        const data = await reportService.chatAboutStudentReportStream(
          classroom.id,
          student.id,
          {
            message,
            history
          },
          {
            signal: abortController.signal,
            onThoughtDelta: (text) => write({ type: "thought_delta", text }),
            onAnswerDelta: (text) => write({ type: "answer_delta", text })
          }
        );

        if (!data) {
          write({ type: "error", error: "Student report not found" });
          res.end();
          return;
        }

        write({
          type: "done",
          answerText: data.markdown,
          thoughtSummary: data.thoughtSummary
        });
        res.end();
      } catch (error) {
        if (!res.headersSent) {
          next(error);
          return;
        }
        if (!res.destroyed && !res.writableEnded) {
          res.write(
            `${JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Unknown student report chat stream error"
            })}\n`
          );
          res.end();
        }
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
        const abortController = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) {
            abortController.abort();
          }
        });
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
            signal: abortController.signal,
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
        if (!res.destroyed && !res.writableEnded) {
          res.write(
            `${JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Unknown student report stream error"
            })}\n`
          );
          res.end();
        }
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
      const abortController = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });
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

      const data = await reportService.analyzeAndSaveClassroomReportStream(
        classroomId,
        {
          signal: abortController.signal,
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
      if (!res.destroyed && !res.writableEnded) {
        res.write(
          `${JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown report stream error"
          })}\n`
        );
        res.end();
      }
    }
  });

  return router;
}
