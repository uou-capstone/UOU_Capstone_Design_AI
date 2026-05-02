import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { appConfig } from "../config.js";
import { ServerDeps } from "../bootstrap.js";
import {
  requireAuth,
  requireClassroomReadable,
  requireVerifiedEmail,
  requireWeekReadable,
  requireWeekWritable
} from "../middleware/auth.js";
import { ConsoleExamLogger } from "../services/exams/ExamLogger.js";
import { SystemExamClock } from "../services/exams/ExamClock.js";
import { TeacherExamGradingService } from "../services/exams/TeacherExamGradingService.js";
import { ExamServiceError, TeacherExamService } from "../services/exams/TeacherExamService.js";
import { ExamStudioProposal, TeacherExam } from "../types/domain.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: appConfig.maxUploadMb * 1024 * 1024 }
});

function examService(deps: ServerDeps): TeacherExamService {
  if (deps.examService) return deps.examService;
  const clock = deps.examClock ?? new SystemExamClock();
  const logger = deps.examLogger ?? new ConsoleExamLogger();
  const grading = deps.examGradingService ?? new TeacherExamGradingService(deps.bridge);
  return new TeacherExamService(deps.store, grading, clock, logger);
}

function handleExamError(error: unknown, res: import("express").Response, next: (error: unknown) => void) {
  if (error instanceof ExamServiceError) {
    res.status(error.status).json({ ok: false, error: error.message, code: error.code });
    return;
  }
  next(error);
}

type ExamStudioStreamStage =
  | "PREPARING"
  | "ANALYZING_SOURCE"
  | "AI_THINKING"
  | "VALIDATING_JSON"
  | "APPLYING_TO_STUDIO"
  | "COMPLETE";

const EXAM_STUDIO_SAFE_THOUGHT_DELTA = "AI가 요청한 시간 설정과 시험 편집 명령을 JSON 구조로 정리하고 있습니다.";
const EXAM_STUDIO_SAFE_THOUGHT_SUMMARY = "AI가 요청사항을 시험 설정과 문항 편집 JSON으로 정리했습니다.";
const EXAM_STUDIO_TIME_ZONE = "Asia/Seoul";
const EXAM_STUDIO_CHOICE_JSON_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    textMarkdown: { type: "string" }
  },
  required: ["id", "textMarkdown"]
};
const EXAM_STUDIO_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    choiceId: { type: "string" },
    value: { type: "boolean" }
  }
};
const EXAM_STUDIO_QUESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: ["MCQ", "OX", "SHORT", "ESSAY"] },
    promptMarkdown: { type: "string" },
    points: { type: "number" },
    choices: {
      type: "array",
      items: EXAM_STUDIO_CHOICE_JSON_SCHEMA
    },
    answer: EXAM_STUDIO_ANSWER_JSON_SCHEMA,
    referenceAnswer: {
      type: "object",
      properties: {
        text: { type: "string" }
      }
    },
    rubricMarkdown: { type: "string" },
    modelAnswerMarkdown: { type: "string" },
    explanationMarkdown: { type: "string" }
  },
  required: ["id", "type", "promptMarkdown", "points"]
};
const EXAM_STUDIO_OPERATION_PARAMS_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    descriptionMarkdown: { type: "string" },
    availableFrom: { type: "string" },
    availableUntil: { type: "string" },
    timeLimitMinutes: { type: "number" },
    passScoreRatio: { type: "number" },
    aiGradingEnabled: { type: "boolean" },
    questions: {
      type: "array",
      items: EXAM_STUDIO_QUESTION_JSON_SCHEMA
    },
    replaceQuestionId: { type: "string" },
    question: EXAM_STUDIO_QUESTION_JSON_SCHEMA
  }
};
const EXAM_STUDIO_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    answerMarkdown: { type: "string" },
    replyMarkdown: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          method: {
            type: "string",
            enum: ["patchExamSettings", "appendQuestions", "replaceQuestion"]
          },
          params: EXAM_STUDIO_OPERATION_PARAMS_JSON_SCHEMA
        },
        required: ["method", "params"]
      }
    },
    source: { type: "string", enum: ["AI"] }
  },
  required: ["answerMarkdown", "operations"]
} as const;

function currentKstIso(date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+09:00");
}

function examStudioFallbackProposal(): ExamStudioProposal {
  return {
    replyMarkdown: "AI 제안을 가져오지 못했습니다. 왼쪽 편집 도구로 계속 작성할 수 있습니다.",
    fallback: true,
    source: "AI_UNAVAILABLE"
  };
}

function logAccessDenied(deps: ServerDeps, req: import("express").Request, action: string, reason = "FORBIDDEN") {
  deps.examLogger?.event("[exam_access_denied]", {
    actorUserId: req.authUser?.id,
    role: req.authUser?.role,
    action,
    reason: reason as any
  });
}

function requireExamTeacher(deps: ServerDeps, action: string) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (req.authUser?.role !== "teacher") {
      logAccessDenied(deps, req, action, "FORBIDDEN");
      res.status(403).json({ ok: false, error: "Teacher role required", code: "TEACHER_ONLY" });
      return;
    }
    next();
  };
}

function logForbiddenIfNeeded(deps: ServerDeps, req: import("express").Request, res: import("express").Response, action: string) {
  if (res.statusCode === 403) {
    logAccessDenied(deps, req, action, "FORBIDDEN");
  }
}

async function readExamOr404(deps: ServerDeps, res: import("express").Response, examId: string): Promise<TeacherExam | null> {
  const exam = await deps.store.getTeacherExam(examId);
  if (!exam) {
    res.status(404).json({ ok: false, error: "Exam not found" });
    return null;
  }
  return exam;
}

export function examsRouter(deps: ServerDeps): Router {
  const router = Router();
  const service = examService(deps);

  router.use(requireAuth, requireVerifiedEmail);

  router.get("/weeks/:weekId/exams", async (req, res, next) => {
    try {
      const week = await requireWeekReadable(deps, req, res, String(req.params.weekId));
      if (!week) return;
      const exams = await deps.store.listTeacherExamsByWeek(week.id);
      if (req.authUser!.role === "teacher") {
        res.json({ ok: true, data: exams.map((exam) => service.teacherDto(exam)) });
        return;
      }
      const data = await Promise.all(
        exams
          .filter((exam) => exam.status === "PUBLISHED")
          .map((exam) => service.studentMetadataDto(exam, req.authUser!.id))
      );
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/weeks/:weekId/exams", requireExamTeacher(deps, "exam_create"), async (req, res, next) => {
    try {
      const week = await requireWeekWritable(deps, req, res, String(req.params.weekId));
      if (!week) {
        logForbiddenIfNeeded(deps, req, res, "exam_create");
        return;
      }
      const data = await service.createExam(week.id, week.classroomId, req.body ?? {});
      res.status(201).json({ ok: true, data: service.teacherDto(data) });
    } catch (error) {
      handleExamError(error, res, next);
    }
  });

  router.get("/exams/:examId", async (req, res, next) => {
    try {
      const exam = await readExamOr404(deps, res, String(req.params.examId));
      if (!exam) return;
      const classroom = await requireClassroomReadable(deps, req, res, exam.classroomId);
      if (!classroom) return;
      if (req.authUser!.role === "teacher") {
        res.json({ ok: true, data: service.teacherDto(exam) });
        return;
      }
      res.json({ ok: true, data: await service.studentMetadataDto(exam, req.authUser!.id) });
    } catch (error) {
      handleExamError(error, res, next);
    }
  });

  router.put("/exams/:examId", requireExamTeacher(deps, "exam_update"), async (req, res, next) => {
    try {
      const exam = await readExamOr404(deps, res, String(req.params.examId));
      if (!exam) return;
      const week = await requireWeekWritable(deps, req, res, exam.weekId);
      if (!week) {
        logForbiddenIfNeeded(deps, req, res, "exam_update");
        return;
      }
      const data = await service.updateDraft(exam.id, req.body ?? {});
      res.json({ ok: true, data: service.teacherDto(data) });
    } catch (error) {
      handleExamError(error, res, next);
    }
  });

  router.post("/exams/:examId/publish", requireExamTeacher(deps, "exam_publish"), async (req, res, next) => {
    try {
      const exam = await readExamOr404(deps, res, String(req.params.examId));
      if (!exam) return;
      const week = await requireWeekWritable(deps, req, res, exam.weekId);
      if (!week) {
        logForbiddenIfNeeded(deps, req, res, "exam_publish");
        return;
      }
      const data = await service.publish(exam.id, req.body ?? undefined);
      res.json({ ok: true, data: service.teacherDto(data) });
    } catch (error) {
      handleExamError(error, res, next);
    }
  });

  router.delete("/exams/:examId", requireExamTeacher(deps, "exam_delete"), async (req, res, next) => {
    try {
      const exam = await readExamOr404(deps, res, String(req.params.examId));
      if (!exam) return;
      const week = await requireWeekWritable(deps, req, res, exam.weekId);
      if (!week) {
        logForbiddenIfNeeded(deps, req, res, "exam_delete");
        return;
      }
      await deps.store.deleteTeacherExam(exam.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/exams/:examId/start", async (req, res, next) => {
    try {
      if (req.authUser!.role !== "student") {
        logAccessDenied(deps, req, "exam_start");
        res.status(403).json({ ok: false, error: "Student role required" });
        return;
      }
      const exam = await readExamOr404(deps, res, String(req.params.examId));
      if (!exam) return;
      const classroom = await requireClassroomReadable(deps, req, res, exam.classroomId);
      if (!classroom) return;
      const data = await service.startAttempt(exam.id, req.authUser!.id);
      res.json({ ok: true, data });
    } catch (error) {
      handleExamError(error, res, next);
    }
  });

  router.get("/exams/:examId/attempts/me", async (req, res, next) => {
    try {
      if (req.authUser!.role !== "student") {
        logAccessDenied(deps, req, "exam_attempt_me");
        res.status(403).json({ ok: false, error: "Student role required" });
        return;
      }
      const exam = await readExamOr404(deps, res, String(req.params.examId));
      if (!exam) return;
      const classroom = await requireClassroomReadable(deps, req, res, exam.classroomId);
      if (!classroom) return;
      const attempt = await deps.store.getTeacherExamAttemptForStudent(exam.id, req.authUser!.id);
      res.json({ ok: true, data: attempt ? await service.attemptDtoForRead(attempt, true) : null });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/exam-attempts/:attemptId/answers", async (req, res, next) => {
    try {
      if (req.authUser!.role !== "student") {
        logAccessDenied(deps, req, "exam_answers_save");
        res.status(403).json({ ok: false, error: "Student role required" });
        return;
      }
      const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
      const data = await service.saveAnswers(String(req.params.attemptId), req.authUser!.id, answers);
      res.json({ ok: true, data });
    } catch (error) {
      handleExamError(error, res, next);
    }
  });

  router.post("/exam-attempts/:attemptId/submit", async (req, res, next) => {
    try {
      if (req.authUser!.role !== "student") {
        logAccessDenied(deps, req, "exam_submit");
        res.status(403).json({ ok: false, error: "Student role required" });
        return;
      }
      const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : undefined;
      const data = await service.submitAttempt(String(req.params.attemptId), req.authUser!.id, answers);
      res.json({ ok: true, data });
    } catch (error) {
      handleExamError(error, res, next);
    }
  });

  router.get("/exams/:examId/report", requireExamTeacher(deps, "exam_report"), async (req, res, next) => {
    try {
      const exam = await readExamOr404(deps, res, String(req.params.examId));
      if (!exam) return;
      const week = await requireWeekWritable(deps, req, res, exam.weekId);
      if (!week) {
        logForbiddenIfNeeded(deps, req, res, "exam_report");
        return;
      }
      const data = await service.report(exam);
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/weeks/:weekId/exam-studio/pdf-context",
    requireExamTeacher(deps, "exam_pdf_context"),
    async (req, res, next) => {
      try {
        const week = await requireWeekWritable(deps, req, res, String(req.params.weekId));
        if (!week) {
          logForbiddenIfNeeded(deps, req, res, "exam_pdf_context");
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
    },
    upload.single("pdf"),
    async (req, res, next) => {
      try {
        const file = req.file;
        if (!file) {
          res.status(400).json({ ok: false, error: "PDF 파일을 업로드해 주세요.", code: "PDF_REQUIRED" });
          return;
        }
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== ".pdf" || file.mimetype !== "application/pdf") {
          res.status(400).json({ ok: false, error: "PDF 파일만 업로드할 수 있습니다.", code: "PDF_INVALID" });
          return;
        }
        try {
          await deps.pdfIngest.ensurePdfMagic(file.buffer);
          const extracted = await deps.pdfIngest.extractBoundedTextFromBuffer(file.buffer, {
            maxChars: Math.min(appConfig.contextMaxChars * 2, 24_000),
            maxPages: 20,
            timeoutMs: 8_000
          });
          if (!extracted.text.trim()) {
            deps.examLogger?.event("[exam_pdf_context_fallback]", {
              weekId: String(req.params.weekId),
              actorUserId: req.authUser!.id,
              reason: "PDF_EMPTY"
            });
            res.status(400).json({
              ok: false,
              error: "PDF에서 텍스트를 찾지 못했습니다. 텍스트를 직접 붙여넣어 주세요.",
              code: "PDF_EMPTY"
            });
            return;
          }
          res.json({ ok: true, data: extracted });
        } catch {
          deps.examLogger?.event("[exam_pdf_context_fallback]", {
            weekId: String(req.params.weekId),
            actorUserId: req.authUser!.id,
            reason: "PDF_UNREADABLE"
          });
          res.status(400).json({
            ok: false,
            error: "PDF 텍스트를 읽지 못했습니다. 다른 PDF를 올리거나 텍스트를 직접 붙여넣어 주세요.",
            code: "PDF_UNREADABLE"
          });
        }
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/weeks/:weekId/exam-studio/chat/stream",
    requireExamTeacher(deps, "exam_studio_chat_stream"),
    async (req, res, next) => {
      let week: Awaited<ReturnType<typeof requireWeekWritable>> | null = null;
      let streamStarted = false;
      const startedAt = Date.now();
      const abortController = new AbortController();

      try {
        week = await requireWeekWritable(deps, req, res, String(req.params.weekId));
        if (!week) {
          logForbiddenIfNeeded(deps, req, res, "exam_studio_chat_stream");
          return;
        }
        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!message) {
          res.status(400).json({ ok: false, error: "message is required" });
          return;
        }

        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        if (typeof res.flushHeaders === "function") {
          res.flushHeaders();
        }
        streamStarted = true;

        res.on("close", () => {
          if (!res.writableEnded) {
            abortController.abort();
          }
        });

        const write = (payload: Record<string, unknown>) => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(`${JSON.stringify(payload)}\n`);
          }
        };

        const writeStage = (
          stage: ExamStudioStreamStage,
          label: string,
          progress: number,
          detail?: string
        ) => {
          write({ type: "stage", stage, label, progress, ...(detail ? { detail } : {}) });
        };

        deps.examLogger?.event("[exam_ai_studio_stream_start]", {
          weekId: week.id,
          classroomId: week.classroomId,
          actorUserId: req.authUser!.id,
          stage: "PREPARING"
        });

        writeStage("PREPARING", "요청 정리", 0.1, "현재 draft와 메시지를 정리하고 있습니다.");
        writeStage(
          "ANALYZING_SOURCE",
          "자료 분석",
          0.24,
          req.body?.sourceText ? "첨부 자료를 시험 설계 문맥으로 압축하고 있습니다." : "첨부 자료 없이 현재 draft를 기준으로 분석합니다."
        );
        writeStage("AI_THINKING", "사고 요약 스트리밍", 0.42, "AI가 JSON 작업 계획을 구성하고 있습니다.");

        let safeThoughtDeltaSent = false;
        const requestCurrentKstIso = currentKstIso();
        const result = await deps.bridge.examStudioChatStream(
          {
            model: appConfig.modelName,
            message,
            currentDraft: req.body?.currentDraft ?? {},
            currentKstIso: requestCurrentKstIso,
            timeZone: EXAM_STUDIO_TIME_ZONE,
            sourceText: typeof req.body?.sourceText === "string" ? req.body.sourceText.slice(0, 24_000) : "",
            responseJsonSchema: EXAM_STUDIO_RESPONSE_JSON_SCHEMA
          },
          (delta) => {
            if (delta.channel === "thought" && !safeThoughtDeltaSent) {
              safeThoughtDeltaSent = true;
              write({
                type: "thought_delta",
                text: EXAM_STUDIO_SAFE_THOUGHT_DELTA
              });
            }
          },
          abortController.signal
        );

        writeStage("VALIDATING_JSON", "JSON 검증", 0.76, "LLM 응답을 시험 스튜디오 명령으로 검증합니다.");
        const proposal = service.sanitizeExamStudioProposal(result.proposal, req.body?.currentDraft ?? {});
        write({ type: "proposal", data: proposal, thoughtSummary: EXAM_STUDIO_SAFE_THOUGHT_SUMMARY });
        writeStage("APPLYING_TO_STUDIO", "스튜디오 반영", 0.92, "브라우저에서 왼쪽 draft에 반영할 준비를 마쳤습니다.");
        writeStage("COMPLETE", "완료", 1);
        write({ type: "done" });
        deps.examLogger?.event("[exam_ai_studio_stream_complete]", {
          weekId: week.id,
          classroomId: week.classroomId,
          actorUserId: req.authUser!.id,
          operationCount: proposal.operations?.length ?? 0,
          fallback: proposal.fallback === true,
          elapsedMs: Date.now() - startedAt
        });
        res.end();
      } catch (error) {
        if (!streamStarted || !res.headersSent) {
          next(error);
          return;
        }
        if (res.destroyed || res.writableEnded || abortController.signal.aborted) {
          return;
        }
        const fallback = service.sanitizeExamStudioProposal(examStudioFallbackProposal(), req.body?.currentDraft ?? {});
        deps.examLogger?.event("[exam_ai_studio_stream_fallback]", {
          weekId: week?.id,
          classroomId: week?.classroomId,
          actorUserId: req.authUser?.id,
          reason: "AI_UNAVAILABLE",
          fallback: true,
          elapsedMs: Date.now() - startedAt
        });
        res.write(
          `${JSON.stringify({
            type: "stage",
            stage: "VALIDATING_JSON",
            label: "복구 응답 준비",
            progress: 0.86,
            detail: error instanceof Error ? error.message : "AI stream failed"
          })}\n`
        );
        res.write(`${JSON.stringify({ type: "proposal", data: fallback, thoughtSummary: "" })}\n`);
        res.write(
          `${JSON.stringify({
            type: "stage",
            stage: "COMPLETE",
            label: "완료",
            progress: 1,
            detail: "AI 제안을 가져오지 못해 fallback으로 종료했습니다."
          })}\n`
        );
        res.write(`${JSON.stringify({ type: "done" })}\n`);
        res.end();
      }
    }
  );

  router.post("/weeks/:weekId/exam-studio/chat", requireExamTeacher(deps, "exam_studio_chat"), async (req, res, next) => {
    try {
      const week = await requireWeekWritable(deps, req, res, String(req.params.weekId));
      if (!week) {
        logForbiddenIfNeeded(deps, req, res, "exam_studio_chat");
        return;
      }
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (!message) {
        res.status(400).json({ ok: false, error: "message is required" });
        return;
      }
      try {
        const requestCurrentKstIso = currentKstIso();
        const result = await deps.bridge.examStudioChat({
          model: appConfig.modelName,
          message,
          currentDraft: req.body?.currentDraft ?? {},
          currentKstIso: requestCurrentKstIso,
          timeZone: EXAM_STUDIO_TIME_ZONE,
          sourceText: typeof req.body?.sourceText === "string" ? req.body.sourceText.slice(0, 24_000) : "",
          responseJsonSchema: EXAM_STUDIO_RESPONSE_JSON_SCHEMA
        });
        res.json({
          ok: true,
          data: service.sanitizeExamStudioProposal(result.proposal, req.body?.currentDraft ?? {}),
          thoughtSummary: EXAM_STUDIO_SAFE_THOUGHT_SUMMARY
        });
      } catch {
        deps.examLogger?.event("[exam_ai_studio_fallback]", {
          weekId: week.id,
          classroomId: week.classroomId,
          actorUserId: req.authUser!.id,
          reason: "AI_UNAVAILABLE"
        });
        res.json({
          ok: true,
          data: service.sanitizeExamStudioProposal({
            replyMarkdown: "AI 제안을 가져오지 못했습니다. 왼쪽 편집 도구로 계속 작성할 수 있습니다.",
            proposal: null,
            fallback: true,
            source: "AI_UNAVAILABLE"
          })
        });
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
