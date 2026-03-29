import { Router } from "express";
import { ServerDeps } from "../bootstrap.js";

export function classroomsRouter(deps: ServerDeps): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const data = await deps.store.listClassrooms();
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const title = String(req.body?.title ?? "").trim();
      if (!title) {
        res.status(400).json({ ok: false, error: "title is required" });
        return;
      }
      const data = await deps.store.createClassroom(title);
      res.status(201).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:classroomId", async (req, res, next) => {
    try {
      await deps.store.deleteClassroom(req.params.classroomId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
