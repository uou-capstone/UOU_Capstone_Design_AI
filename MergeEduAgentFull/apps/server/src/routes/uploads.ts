import path from "node:path";
import { Router } from "express";
import { ServerDeps } from "../bootstrap.js";
import {
  requireAuth,
  requireLectureReadable,
  requireVerifiedEmail
} from "../middleware/auth.js";

export function uploadsRouter(deps: ServerDeps): Router {
  const router = Router();

  router.get("/uploads/:fileName", requireAuth, requireVerifiedEmail, async (req, res, next) => {
    try {
      const fileName = String(req.params.fileName ?? "");
      if (path.basename(fileName) !== fileName || path.extname(fileName).toLowerCase() !== ".pdf") {
        res.status(400).json({ ok: false, error: "Invalid PDF file name" });
        return;
      }
      const lecture = await deps.store.findLectureByPdfFileName(fileName);
      if (!lecture) {
        res.status(404).json({ ok: false, error: "PDF not found" });
        return;
      }
      const readable = await requireLectureReadable(deps, req, res, lecture.id);
      if (!readable) return;
      if (path.basename(readable.pdf.path) !== fileName) {
        res.status(404).json({ ok: false, error: "PDF not found" });
        return;
      }
      const uploadRoot = path.resolve(deps.store.getUploadDir());
      const resolvedPdfPath = path.resolve(readable.pdf.path);
      const relativePath = path.relative(uploadRoot, resolvedPdfPath);
      if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        res.status(404).json({ ok: false, error: "PDF not found" });
        return;
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.type("application/pdf");
      res.sendFile(resolvedPdfPath);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
