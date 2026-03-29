import { Router } from "express";
import { ServerDeps } from "../bootstrap.js";

export function weeksRouter(deps: ServerDeps): Router {
  const router = Router();

  router.get("/classrooms/:classroomId/weeks", async (req, res, next) => {
    try {
      const data = await deps.store.listWeeksByClassroom(req.params.classroomId);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/classrooms/:classroomId/weeks", async (req, res, next) => {
    try {
      const title = req.body?.title ? String(req.body.title) : undefined;
      const data = await deps.store.createWeek(req.params.classroomId, title);
      res.status(201).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/weeks/:weekId", async (req, res, next) => {
    try {
      await deps.store.deleteWeek(req.params.weekId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/weeks/bulk-delete", async (req, res, next) => {
    try {
      const weekIds = Array.isArray(req.body?.weekIds)
        ? req.body.weekIds.map((item: unknown) => String(item))
        : [];
      await deps.store.deleteWeeksBulk(weekIds);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
