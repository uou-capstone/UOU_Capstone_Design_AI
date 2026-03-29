import path from "node:path";
import { Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import { EventApiRequest } from "../types/domain.js";
import { EventStreamChunk } from "../services/engine/OrchestrationEngine.js";

export function sessionRouter(deps: ServerDeps): Router {
  const router = Router();

  router.get("/session/by-lecture/:lectureId", async (req, res, next) => {
    try {
      const lectureId = req.params.lectureId;
      const lecture = await deps.store.getLecture(lectureId);
      if (!lecture) {
        res.status(404).json({ ok: false, error: "Lecture not found" });
        return;
      }

      let resolvedLecture = lecture;
      let aiStatus: { connected: boolean; message?: string } = { connected: true };

      if (!lecture.pdf.geminiFile) {
        try {
          const uploaded = await deps.bridge.uploadPdf({
            lectureId: lecture.id,
            pdfPath: lecture.pdf.path,
            displayName: lecture.title
          });
          const updated = await deps.store.updateLecture(lecture.id, {
            pdf: {
              ...lecture.pdf,
              geminiFile: uploaded
            }
          });
          if (updated) {
            resolvedLecture = updated;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI bridge reconnect failed";
          aiStatus = {
            connected: false,
            message: `AI 에이전트 PDF 연결 복구 실패: ${message}`
          };
        }
      }

      const session = await deps.store.getOrCreateSessionByLecture(lectureId);
      res.json({
        ok: true,
        data: {
          session,
          lecture: resolvedLecture,
          pdfUrl: `/uploads/${path.basename(resolvedLecture.pdf.path)}`,
          aiStatus
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/session/:sessionId/save", async (req, res, next) => {
    try {
      const sessionId = req.params.sessionId;
      const state = await deps.store.getSession(sessionId);
      if (!state) {
        res.status(404).json({ ok: false, error: "Session not found" });
        return;
      }
      await deps.store.saveSession({
        ...state,
        ...(req.body?.state ?? {}),
        sessionId: state.sessionId,
        lectureId: state.lectureId,
        updatedAt: new Date().toISOString()
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/session/:sessionId/event", async (req, res, next) => {
    try {
      const payload = req.body as EventApiRequest;
      if (!payload?.event?.type) {
        res.status(400).json({ ok: false, error: "event.type is required" });
        return;
      }
      const data = await deps.engine.handleEvent(req.params.sessionId, payload);
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  router.post("/session/:sessionId/event/stream", async (req, res, next) => {
    try {
      const payload = req.body as EventApiRequest;
      if (!payload?.event?.type) {
        res.status(400).json({ ok: false, error: "event.type is required" });
        return;
      }

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const write = (chunk: EventStreamChunk) => {
        res.write(`${JSON.stringify(chunk)}\n`);
      };

      await deps.engine.handleEventStream(req.params.sessionId, payload, write);
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        next(error);
        return;
      }
      res.write(
        `${JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown stream error"
        })}\n`
      );
      res.end();
    }
  });

  return router;
}
