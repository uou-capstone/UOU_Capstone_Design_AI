import path from "node:path";
import fs from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { appConfig } from "../config.js";
import { ServerDeps } from "../bootstrap.js";

function makeLectureId(): string {
  return `lec_${Math.random().toString(36).slice(2, 10)}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: appConfig.maxUploadMb * 1024 * 1024 }
});

export function lecturesRouter(deps: ServerDeps): Router {
  const router = Router();

  router.get("/weeks/:weekId/lectures", async (req, res, next) => {
    try {
      const data = await deps.store.listLecturesByWeek(req.params.weekId);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/weeks/:weekId/lectures",
    upload.single("pdf"),
    async (req, res, next) => {
      try {
        const file = req.file;
        const title = String(req.body?.title ?? "").trim();
        if (!title) {
          res.status(400).json({ ok: false, error: "title is required" });
          return;
        }
        if (!file) {
          res.status(400).json({ ok: false, error: "pdf is required" });
          return;
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== ".pdf" || file.mimetype !== "application/pdf") {
          res.status(400).json({ ok: false, error: "Only PDF file is allowed" });
          return;
        }

        await deps.pdfIngest.ensurePdfMagic(file.buffer);

        const lectureId = makeLectureId();
        const fullPdfPath = await deps.pdfIngest.savePdf(lectureId, file.buffer);
        const { numPages, indexPath } = await deps.pdfIngest.buildPageIndex(
          lectureId,
          file.buffer
        );

        let geminiFile: {
          fileName: string;
          fileUri: string;
          mimeType: string;
        };
        try {
          geminiFile = await deps.bridge.uploadPdf({
            lectureId,
            pdfPath: fullPdfPath,
            displayName: title
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Gemini PDF upload failed";
          await Promise.all([
            fs.unlink(fullPdfPath).catch(() => undefined),
            fs.unlink(indexPath).catch(() => undefined)
          ]);
          res.status(502).json({
            ok: false,
            error: `Gemini PDF upload failed: ${message}`
          });
          return;
        }

        const lecture = await deps.store.createLecture({
          id: lectureId,
          weekId: String(req.params.weekId),
          title,
          pdfPath: fullPdfPath,
          numPages,
          pageIndexPath: indexPath,
          geminiFile
        });

        res.status(201).json({ ok: true, data: lecture });
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete("/lectures/:lectureId", async (req, res, next) => {
    try {
      await deps.store.deleteLecture(req.params.lectureId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
