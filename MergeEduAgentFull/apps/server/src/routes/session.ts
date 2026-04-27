import path from "node:path";
import { Request, Response, Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import { EventApiRequest, SessionState } from "../types/domain.js";
import { EventStreamChunk } from "../services/engine/OrchestrationEngine.js";
import {
  requireAuth,
  requireLectureReadable,
  requireVerifiedEmail
} from "../middleware/auth.js";

const GENERIC_STREAM_ERROR_MESSAGE =
  "세션 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
const AI_CONNECTION_REQUIRED_MESSAGE =
  "Gemini PDF 연결이 완료되지 않아 학습 세션을 열 수 없습니다. API 키와 AI bridge 설정을 확인한 뒤 자료를 다시 업로드해 주세요.";

export function buildProtectedSessionSaveState(
  state: SessionState,
  clientState?: Partial<SessionState>
): SessionState {
  const ignoredKeys = Object.keys(clientState ?? {});
  if (ignoredKeys.length > 0) {
    console.warn(
      "[session_save] " +
        JSON.stringify({
          sessionId: state.sessionId,
          ignoredKeys
        })
    );
  }
  return {
    ...state,
    updatedAt: new Date().toISOString()
  };
}

export function attachSessionStreamAbortHandlers(
  req: Request,
  res: Response,
  controller: AbortController
): () => void {
  const abortOpenStream = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };

  req.on("aborted", abortOpenStream);
  res.on("close", abortOpenStream);

  return () => {
    req.off("aborted", abortOpenStream);
    res.off("close", abortOpenStream);
  };
}

function canWriteStreamResponse(res: Response, signal: AbortSignal): boolean {
  return !signal.aborted && !res.destroyed && !res.writableEnded;
}

export function sessionRouter(deps: ServerDeps): Router {
  const router = Router();
  const enforceAuth = Boolean((deps as Partial<ServerDeps>).auth && (deps as Partial<ServerDeps>).store);
  if (enforceAuth) {
    router.use(requireAuth, requireVerifiedEmail);
  }

  async function getOwnedSession(req: Request, res: Response): Promise<SessionState | null> {
    if (!enforceAuth) {
      return {} as SessionState;
    }
    const session = await deps.store.getSession(String(req.params.sessionId));
    if (!session) {
      res.status(404).json({ ok: false, error: "Session not found" });
      return null;
    }
    if (session.ownerUserId !== req.authUser?.id) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return null;
    }
    const lecture = await requireLectureReadable(deps, req, res, session.lectureId);
    if (!lecture) {
      return null;
    }
    return session;
  }

  router.get("/session/by-lecture/:lectureId", async (req, res, next) => {
    try {
      const lectureId = String(req.params.lectureId);
      const lecture = await requireLectureReadable(deps, req, res, lectureId);
      if (!lecture) {
        return;
      }

      let resolvedLecture = lecture;
      if (!lecture.pdf.geminiFile) {
        if (req.authUser?.role !== "teacher") {
          res.status(409).json({
            ok: false,
            error:
              "이 자료는 아직 Gemini PDF 연결이 완료되지 않았습니다. 선생님에게 자료 재업로드를 요청해 주세요."
          });
          return;
        }

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
          console.warn(
            "[session_ai_reconnect_failed] " +
              JSON.stringify({
                lectureId: lecture.id,
                message
              })
          );
          res.status(502).json({
            ok: false,
            error: AI_CONNECTION_REQUIRED_MESSAGE
          });
          return;
        }
      }

      const session = await deps.store.getOrCreateSessionByLectureForOwner(
        lectureId,
        req.authUser!.id
      );
      res.json({
        ok: true,
        data: {
          session,
          lecture: resolvedLecture,
          pdfUrl: `/api/uploads/${path.basename(resolvedLecture.pdf.path)}`,
          aiStatus: { connected: true }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/session/:sessionId/save", async (req, res, next) => {
    try {
      const sessionId = req.params.sessionId;
      const owned = await getOwnedSession(req, res);
      if (!owned) return;
      let saved = false;
      await deps.store.withSessionLock(sessionId, async () => {
        const latest = await deps.store.getSession(sessionId);
        if (!latest) return;
        await deps.store.saveSession(buildProtectedSessionSaveState(latest, req.body?.state));
        saved = true;
      });
      if (!saved) {
        res.status(404).json({ ok: false, error: "Session not found" });
        return;
      }
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
      const owned = await getOwnedSession(req, res);
      if (!owned) return;
      const data = await deps.engine.handleEvent(req.params.sessionId, payload);
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  router.post("/session/:sessionId/event/stream", async (req, res, next) => {
    let streamSignal: AbortSignal | null = null;
    try {
      const payload = req.body as EventApiRequest;
      if (!payload?.event?.type) {
        res.status(400).json({ ok: false, error: "event.type is required" });
        return;
      }
      const owned = await getOwnedSession(req, res);
      if (!owned) return;

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const controller = new AbortController();
      streamSignal = controller.signal;
      const cleanupAbortHandlers = attachSessionStreamAbortHandlers(req, res, controller);
      const write = (chunk: EventStreamChunk) => {
        if (!canWriteStreamResponse(res, controller.signal)) {
          return;
        }
        res.write(`${JSON.stringify(chunk)}\n`);
      };

      try {
        await deps.engine.handleEventStream(req.params.sessionId, payload, write, controller.signal);
        if (canWriteStreamResponse(res, controller.signal)) {
          res.end();
        }
      } finally {
        cleanupAbortHandlers();
      }
    } catch (error) {
      if (!res.headersSent) {
        next(error);
        return;
      }
      if (streamSignal?.aborted || res.destroyed || res.writableEnded) {
        return;
      }
      console.warn(
        "[session_stream_error] " +
          JSON.stringify({
            sessionId: req.params.sessionId,
            message: error instanceof Error ? error.message : "Unknown stream error"
          })
      );
      res.write(
        `${JSON.stringify({
          type: "error",
          error: GENERIC_STREAM_ERROR_MESSAGE
        })}\n`
      );
      res.end();
    }
  });

  return router;
}
