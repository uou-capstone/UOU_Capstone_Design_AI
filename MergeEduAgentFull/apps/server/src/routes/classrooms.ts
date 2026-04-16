import { Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import {
  StudentCompetencyReportService
} from "../services/report/StudentCompetencyReportService.js";

export function classroomsRouter(deps: ServerDeps): Router {
  const router = Router();
  const reportService = new StudentCompetencyReportService(deps.store, deps.bridge);

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

  router.get("/:classroomId/report", async (req, res, next) => {
    try {
      const classroom = (await deps.store.listClassrooms()).find(
        (item) => item.id === req.params.classroomId
      );
      if (!classroom) {
        res.status(404).json({ ok: false, error: "Classroom not found" });
        return;
      }
      const data = await deps.store.getClassroomReport(req.params.classroomId);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/report/analyze", async (req, res, next) => {
    try {
      const data = await reportService.analyzeAndSaveClassroomReport(req.params.classroomId);
      if (!data) {
        res.status(404).json({ ok: false, error: "Classroom not found" });
        return;
      }
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:classroomId/report/analyze/stream", async (req, res, next) => {
    try {
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
        req.params.classroomId,
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
