import path from "node:path";
import fs from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { appConfig } from "../config.js";
import { ServerDeps } from "../bootstrap.js";
import { LectureItem } from "../types/domain.js";
import {
  requireAuth,
  requireLectureWritable,
  requireTeacher,
  requireVerifiedEmail,
  requireWeekReadable,
  requireWeekWritable
} from "../middleware/auth.js";

function makeLectureId(): string {
  return `lec_${Math.random().toString(36).slice(2, 10)}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: appConfig.maxUploadMb * 1024 * 1024 }
});

export function lecturesRouter(deps: ServerDeps): Router {
  const router = Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.get("/weeks/:weekId/lectures", async (req, res, next) => {
    try {
      const week = await requireWeekReadable(deps, req, res, req.params.weekId);
      if (!week) return;
      const data = await deps.store.listLecturesByWeek(req.params.weekId);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/weeks/:weekId/lectures",
    requireTeacher,
    async (req, res, next) => {
      try {
        const week = await requireWeekWritable(deps, req, res, String(req.params.weekId));
        if (!week) return;
        next();
      } catch (error) {
        next(error);
      }
    },
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

        try {
          await deps.pdfIngest.ensurePdfMagic(file.buffer);
        } catch {
          res.status(400).json({
            ok: false,
            error: "유효한 PDF 파일을 업로드해 주세요."
          });
          return;
        }

        const lectureId = makeLectureId();
        const fullPdfPath = await deps.pdfIngest.savePdf(lectureId, file.buffer);
        let numPages = 1;
        let indexPath = "";
        try {
          const built = await deps.pdfIngest.buildPageIndex(
            lectureId,
            file.buffer
          );
          numPages = built.numPages;
          indexPath = built.indexPath;
        } catch (error) {
          await fs.unlink(fullPdfPath).catch(() => undefined);
          console.warn(
            "[lecture_upload_pdf_index_error] " +
              JSON.stringify({
                lectureId,
                message: error instanceof Error ? error.message : "unknown pdf index error"
              })
          );
          res.status(400).json({
            ok: false,
            error: "PDF 텍스트를 읽지 못했습니다. 다른 PDF 파일을 업로드해 주세요."
          });
          return;
        }

        let geminiFile: LectureItem["pdf"]["geminiFile"];
        try {
          geminiFile = await deps.bridge.uploadPdf({
            lectureId,
            pdfPath: fullPdfPath,
            displayName: title
          });
        } catch (error) {
          await Promise.all([
            fs.unlink(fullPdfPath).catch(() => undefined),
            indexPath ? fs.unlink(indexPath).catch(() => undefined) : Promise.resolve()
          ]);
          console.warn(
            "[lecture_upload_ai_error] " +
              JSON.stringify({
                lectureId,
                message: error instanceof Error ? error.message : "unknown Gemini upload error"
              })
          );
          res.status(502).json({
            ok: false,
            error:
              "Gemini PDF 업로드에 실패했습니다. API 키와 AI bridge 설정을 확인한 뒤 다시 업로드해 주세요."
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

  router.delete("/lectures/:lectureId", requireTeacher, async (req, res, next) => {
    try {
      const lectureId = String(req.params.lectureId);
      const lecture = await requireLectureWritable(deps, req, res, lectureId);
      if (!lecture) return;
      await deps.store.deleteLecture(lectureId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
