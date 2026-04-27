import { Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import {
  requireAuth,
  requireClassroomOwner,
  requireClassroomReadable,
  requireTeacher,
  requireVerifiedEmail,
  requireWeekWritable
} from "../middleware/auth.js";

export function weeksRouter(deps: ServerDeps): Router {
  const router = Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.get("/classrooms/:classroomId/weeks", async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomReadable(deps, req, res, classroomId);
      if (!classroom) return;
      const data = await deps.store.listWeeksByClassroom(classroomId);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/classrooms/:classroomId/weeks", requireTeacher, async (req, res, next) => {
    try {
      const classroomId = String(req.params.classroomId);
      const classroom = await requireClassroomOwner(deps, req, res, classroomId);
      if (!classroom) return;
      const title = req.body?.title ? String(req.body.title) : undefined;
      const data = await deps.store.createWeek(classroomId, title);
      res.status(201).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/weeks/:weekId", requireTeacher, async (req, res, next) => {
    try {
      const weekId = String(req.params.weekId);
      const week = await requireWeekWritable(deps, req, res, weekId);
      if (!week) return;
      await deps.store.deleteWeek(weekId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/weeks/bulk-delete", requireTeacher, async (req, res, next) => {
    try {
      const weekIds: string[] = Array.isArray(req.body?.weekIds)
        ? req.body.weekIds.map((item: unknown) => String(item))
        : [];
      const weeks = await Promise.all(weekIds.map((weekId) => deps.store.getWeek(weekId)));
      if (weeks.some((week) => !week)) {
        res.status(404).json({ ok: false, error: "Week not found" });
        return;
      }
      for (const week of weeks) {
        const classroom = await deps.store.getClassroom(week!.classroomId);
        if (!classroom || classroom.teacherId !== req.authUser!.id) {
          res.status(403).json({ ok: false, error: "Forbidden" });
          return;
        }
      }
      await deps.store.deleteWeeksBulk(weekIds);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
