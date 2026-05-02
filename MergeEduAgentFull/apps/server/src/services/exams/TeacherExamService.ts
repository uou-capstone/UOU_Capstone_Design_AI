import { appConfig } from "../../config.js";
import {
  ClassroomEnrollment,
  ExamStudioOperation,
  ExamStudioProposal,
  TeacherExam,
  TeacherExamAttempt,
  TeacherExamGrading,
  TeacherExamQuestion,
  TeacherExamRevision,
  User
} from "../../types/domain.js";
import { JsonStore } from "../storage/JsonStore.js";
import { ExamClock } from "./ExamClock.js";
import { ExamLogger } from "./ExamLogger.js";
import { TeacherExamGradingService } from "./TeacherExamGradingService.js";

export class ExamServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "EXAM_ERROR"
  ) {
    super(message);
  }
}

export interface TeacherExamDraftInput {
  title?: unknown;
  descriptionMarkdown?: unknown;
  availableFrom?: unknown;
  availableUntil?: unknown;
  timeLimitMinutes?: unknown;
  passScoreRatio?: unknown;
  aiGradingEnabled?: unknown;
  questions?: unknown;
}

interface ExamStudioProposalContext {
  allowLegacyMutationFields?: boolean;
}

function makeQuestionId(): string {
  return `q_${Math.random().toString(36).slice(2, 9)}`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asLimitedString(value: unknown, maxLength: number, fallback = ""): string {
  return asString(value, fallback).slice(0, maxLength);
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asIso(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function asStrictZonedIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/
  );
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00", msText = "0", zone] = match;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return undefined;

  const expected = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
    millisecond: Number(msText.padEnd(3, "0"))
  };
  const zoneOffsetMinutes =
    zone === "Z"
      ? 0
      : (zone.startsWith("-") ? -1 : 1) *
        (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const zoned = new Date(time + zoneOffsetMinutes * 60 * 1000);
  const isSameWallClock =
    zoned.getUTCFullYear() === expected.year &&
    zoned.getUTCMonth() + 1 === expected.month &&
    zoned.getUTCDate() === expected.day &&
    zoned.getUTCHours() === expected.hour &&
    zoned.getUTCMinutes() === expected.minute &&
    zoned.getUTCSeconds() === expected.second &&
    zoned.getUTCMilliseconds() === expected.millisecond;
  return isSameWallClock ? new Date(time).toISOString() : undefined;
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function addSeconds(dateIso: string, seconds: number): string {
  return new Date(new Date(dateIso).getTime() + seconds * 1000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function totalPoints(revision: TeacherExamRevision | undefined): number {
  return revision?.questions.reduce((sum, question) => sum + question.points, 0) ?? 0;
}

function stripSensitiveQuestions(questions: TeacherExamQuestion[], includeExplanations: boolean) {
  return questions.map((question) => ({
    id: question.id,
    type: question.type,
    promptMarkdown: question.promptMarkdown,
    points: question.points,
    choices: question.type === "MCQ" ? question.choices ?? [] : undefined,
    ...(includeExplanations ? { explanationMarkdown: question.explanationMarkdown } : {})
  }));
}

function attemptSummary(attempt: TeacherExamAttempt | null) {
  if (!attempt) return null;
  return {
    id: attempt.id,
    examId: attempt.examId,
    status: attempt.status,
    examVersion: attempt.examVersion,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt,
    gradedAt: attempt.gradedAt,
    lastSavedAt: attempt.lastSavedAt,
    answers: attempt.answers,
    grading: attempt.grading
  };
}

export class TeacherExamService {
  constructor(
    private readonly store: JsonStore,
    private readonly grading: TeacherExamGradingService,
    private readonly clock: ExamClock,
    private readonly logger: ExamLogger
  ) {}

  nowIso(): string {
    return this.clock.now().toISOString();
  }

  normalizeDraft(input: TeacherExamDraftInput, existing?: TeacherExamRevision): Omit<TeacherExamRevision, "version" | "createdAt" | "updatedAt"> {
    const now = this.nowIso();
    const rawQuestions = Array.isArray(input.questions) ? input.questions : existing?.questions ?? [];
    const questions = rawQuestions
      .map((raw): TeacherExamQuestion | null => {
        if (!raw || typeof raw !== "object") return null;
        const item = raw as Record<string, unknown>;
        const type = String(item.type ?? "MCQ").toUpperCase();
        if (!["MCQ", "OX", "SHORT", "ESSAY"].includes(type)) return null;
        const choices = Array.isArray(item.choices)
          ? item.choices
              .map((choice, index) => {
                if (!choice || typeof choice !== "object") return null;
                const typed = choice as Record<string, unknown>;
                return {
                  id: asString(typed.id, `c${index + 1}`),
                  textMarkdown: asString(typed.textMarkdown ?? typed.text, "")
                };
              })
              .filter((choice): choice is { id: string; textMarkdown: string } => Boolean(choice))
          : undefined;
        const answer = item.answer && typeof item.answer === "object" ? (item.answer as Record<string, unknown>) : {};
        const answerValue =
          typeof answer.value === "boolean"
            ? answer.value
            : typeof answer.value === "string" && ["true", "false"].includes(answer.value.toLowerCase())
              ? answer.value.toLowerCase() === "true"
              : undefined;
        const referenceAnswer =
          item.referenceAnswer && typeof item.referenceAnswer === "object"
            ? (item.referenceAnswer as Record<string, unknown>)
            : {};
        return {
          id: asString(item.id, makeQuestionId()),
          type: type as TeacherExamQuestion["type"],
          promptMarkdown: asString(item.promptMarkdown, ""),
          points: Math.max(0.5, Math.min(100, asNumber(item.points, 1))),
          ...(choices ? { choices } : {}),
          answer: {
            choiceId: asString(answer.choiceId, ""),
            ...(answerValue !== undefined ? { value: answerValue } : {})
          },
          referenceAnswer: {
            text: asString(referenceAnswer.text, "")
          },
          rubricMarkdown: asString(item.rubricMarkdown, ""),
          modelAnswerMarkdown: asString(item.modelAnswerMarkdown, ""),
          explanationMarkdown: asString(item.explanationMarkdown, "")
        };
      })
      .filter((question): question is TeacherExamQuestion => Boolean(question));

    const startFallback = existing?.availableFrom ?? now;
    const untilFallback = existing?.availableUntil ?? addDays(7);
    return {
      title: asString(input.title, existing?.title ?? "새 시험"),
      descriptionMarkdown: asString(input.descriptionMarkdown, existing?.descriptionMarkdown ?? ""),
      availableFrom: asIso(input.availableFrom, startFallback),
      availableUntil: asIso(input.availableUntil, untilFallback),
      timeLimitMinutes: Math.round(Math.max(1, Math.min(240, asNumber(input.timeLimitMinutes, existing?.timeLimitMinutes ?? 30)))),
      passScoreRatio: Math.max(0, Math.min(1, asNumber(input.passScoreRatio, existing?.passScoreRatio ?? appConfig.passScoreRatio))),
      aiGradingEnabled: Boolean(input.aiGradingEnabled ?? existing?.aiGradingEnabled ?? true),
      questions
    };
  }

  validatePublish(draft: Omit<TeacherExamRevision, "version" | "createdAt" | "updatedAt">): string[] {
    const errors: string[] = [];
    if (!draft.title) errors.push("시험 제목을 입력해 주세요.");
    if (draft.title.length > 100) errors.push("시험 제목은 100자 이하로 입력해 주세요.");
    if (new Date(draft.availableFrom).getTime() >= new Date(draft.availableUntil).getTime()) {
      errors.push("응시 시작 시간은 종료 시간보다 빨라야 합니다.");
    }
    if (!Number.isInteger(draft.timeLimitMinutes) || draft.timeLimitMinutes < 1 || draft.timeLimitMinutes > 240) {
      errors.push("제한 시간은 1~240분 사이의 정수여야 합니다.");
    }
    if (draft.questions.length === 0) errors.push("문항을 1개 이상 추가해 주세요.");
    const ids = new Set<string>();
    for (const question of draft.questions) {
      if (ids.has(question.id)) errors.push(`중복 문항 ID가 있습니다: ${question.id}`);
      ids.add(question.id);
      if (!question.promptMarkdown) errors.push("모든 문항에 지문을 입력해 주세요.");
      if (!Number.isFinite(question.points) || question.points <= 0) {
        errors.push("모든 문항 배점은 0보다 커야 합니다.");
      }
      if (question.type === "MCQ") {
        if (!question.choices || question.choices.length < 2 || question.choices.length > 6) {
          errors.push("객관식 문항은 선택지를 2~6개 입력해야 합니다.");
        }
        if (question.choices?.some((choice) => !choice.textMarkdown.trim())) {
          errors.push("객관식 문항의 모든 선택지 내용을 입력해 주세요.");
        }
        if (!question.answer?.choiceId || !question.choices?.some((choice) => choice.id === question.answer?.choiceId)) {
          errors.push("객관식 문항의 정답 선택지를 지정해 주세요.");
        }
      }
      if (question.type === "OX" && typeof question.answer?.value !== "boolean") {
        errors.push("OX 문항의 정답을 지정해 주세요.");
      }
      if (question.type === "SHORT" && !question.referenceAnswer?.text && !question.rubricMarkdown) {
        errors.push("단답형 문항에는 기준 답안 또는 채점 기준이 필요합니다.");
      }
      if (question.type === "ESSAY" && !question.rubricMarkdown) {
        errors.push("서술형 문항에는 채점 기준이 필요합니다.");
      }
    }
    return errors;
  }

  private isValidRawProposalQuestion(raw: unknown, seenIds: Set<string>): boolean {
    const question = asRecord(raw);
    const id = typeof question.id === "string" ? question.id.trim() : "";
    const type = typeof question.type === "string" ? question.type.toUpperCase() : "";
    const prompt = typeof question.promptMarkdown === "string" ? question.promptMarkdown.trim() : "";
    const points = typeof question.points === "number" ? question.points : Number.NaN;
    if (!id || seenIds.has(id)) return false;
    if (!["MCQ", "OX", "SHORT", "ESSAY"].includes(type)) return false;
    if (!prompt || !Number.isFinite(points) || points <= 0) return false;
    const answer = asRecord(question.answer);

    if (type === "MCQ") {
      if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 6) {
        return false;
      }
      const choiceIds = new Set<string>();
      for (const rawChoice of question.choices) {
        const choice = asRecord(rawChoice);
        const choiceId = typeof choice.id === "string" ? choice.id.trim() : "";
        const text = typeof choice.textMarkdown === "string" ? choice.textMarkdown.trim() : "";
        if (!choiceId || choiceIds.has(choiceId) || !text) return false;
        choiceIds.add(choiceId);
      }
      if (typeof answer.choiceId !== "string" || !choiceIds.has(answer.choiceId)) return false;
    }
    if (type === "OX" && typeof answer.value !== "boolean") return false;
    if (type === "SHORT") {
      const reference = asRecord(question.referenceAnswer);
      const referenceText = typeof reference.text === "string" ? reference.text.trim() : "";
      const rubric = typeof question.rubricMarkdown === "string" ? question.rubricMarkdown.trim() : "";
      if (!referenceText && !rubric) return false;
    }
    if (type === "ESSAY") {
      const rubric = typeof question.rubricMarkdown === "string" ? question.rubricMarkdown.trim() : "";
      if (!rubric) return false;
    }
    seenIds.add(id);
    return true;
  }

  private sanitizeExamStudioSettingsPatch(raw: unknown): NonNullable<ExamStudioProposal["settingsPatch"]> {
    const settings = asRecord(raw);
    const settingsPatch: ExamStudioProposal["settingsPatch"] = {};
    const title = asLimitedString(settings.title, 100);
    const descriptionMarkdown = asLimitedString(settings.descriptionMarkdown, 5000);
    if (title) settingsPatch.title = title;
    if (descriptionMarkdown) settingsPatch.descriptionMarkdown = descriptionMarkdown;
    const availableFrom = asStrictZonedIso(settings.availableFrom);
    if (availableFrom) settingsPatch.availableFrom = availableFrom;
    const availableUntil = asStrictZonedIso(settings.availableUntil);
    if (availableUntil) settingsPatch.availableUntil = availableUntil;
    if (settings.timeLimitMinutes !== undefined) {
      const timeLimit = Number(settings.timeLimitMinutes);
      if (Number.isFinite(timeLimit)) {
        settingsPatch.timeLimitMinutes = Math.round(Math.max(1, Math.min(240, timeLimit)));
      }
    }
    if (settings.passScoreRatio !== undefined) {
      settingsPatch.passScoreRatio = Math.max(0, Math.min(1, asNumber(settings.passScoreRatio, appConfig.passScoreRatio)));
    }
    if (typeof settings.aiGradingEnabled === "boolean") {
      settingsPatch.aiGradingEnabled = settings.aiGradingEnabled;
    }
    return settingsPatch;
  }

  private sanitizeProposalQuestionBatch(
    rawQuestions: unknown,
    seenQuestionIds: Set<string>,
    limit: number
  ): TeacherExamQuestion[] {
    if (!Array.isArray(rawQuestions)) return [];
    const accepted = rawQuestions
      .filter((question) => this.isValidRawProposalQuestion(question, seenQuestionIds))
      .slice(0, limit);
    return accepted.length > 0 ? this.normalizeDraft({ questions: accepted }).questions : [];
  }

  sanitizeExamStudioProposal(
    raw: unknown,
    currentDraft?: TeacherExamDraftInput,
    context: ExamStudioProposalContext = {}
  ): ExamStudioProposal {
    const data = asRecord(raw);
    const answerMarkdown = asLimitedString(data.answerMarkdown, 3000);
    const legacyReplyMarkdown = asLimitedString(data.replyMarkdown, 3000);
    const replyMarkdown = answerMarkdown || legacyReplyMarkdown || "AI 제안을 정리했습니다.";
    if (data.fallback === true || data.source === "AI_UNAVAILABLE") {
      const proposal: ExamStudioProposal = {
        replyMarkdown: asLimitedString(
          data.replyMarkdown,
          3000,
          "AI 제안을 가져오지 못했습니다. 왼쪽 편집 도구로 계속 작성할 수 있습니다."
        ),
        fallback: true,
        source: "AI_UNAVAILABLE"
      };
      this.logger.event("[exam_studio_proposal_sanitized]", {
        operationMethods: [],
        operationCount: 0,
        droppedOperationCount: Array.isArray(data.operations) ? data.operations.length : 0,
        fallback: true
      });
      return proposal;
    }

    const allowLegacyMutationFields = context.allowLegacyMutationFields === true;
    const settingsPatch = allowLegacyMutationFields
      ? this.sanitizeExamStudioSettingsPatch(data.settingsPatch)
      : {};

    const currentQuestionIds = new Set(
      this.normalizeDraft(currentDraft ?? { questions: [] }).questions.map((question) => question.id)
    );
    let replaceQuestionId =
      allowLegacyMutationFields && typeof data.replaceQuestionId === "string" && currentQuestionIds.has(data.replaceQuestionId)
        ? data.replaceQuestionId.slice(0, 100)
        : undefined;
    const seenQuestionIds = new Set(currentQuestionIds);
    if (replaceQuestionId) seenQuestionIds.delete(replaceQuestionId);
    const appendQuestionList = allowLegacyMutationFields
      ? this.sanitizeProposalQuestionBatch(data.appendQuestions, seenQuestionIds, 20)
      : [];
    const questionOperations: ExamStudioOperation[] = [];
    if (replaceQuestionId && appendQuestionList[0]) {
      questionOperations.push({
        method: "replaceQuestion",
        params: { replaceQuestionId, question: appendQuestionList[0] }
      });
      if (appendQuestionList.length > 1) {
        questionOperations.push({
          method: "appendQuestions",
          params: { questions: appendQuestionList.slice(1) }
        });
      }
    } else if (appendQuestionList.length > 0) {
      questionOperations.push({
        method: "appendQuestions",
        params: { questions: appendQuestionList }
      });
    }

    let droppedOperationCount = 0;
    const rawOperations = Array.isArray(data.operations) ? data.operations : [];
    for (const rawOperation of rawOperations) {
      const operation = asRecord(rawOperation);
      const method = operation.method;
      const params = asRecord(operation.params);
      if (method === "patchExamSettings") {
        const patch = this.sanitizeExamStudioSettingsPatch(params);
        if (Object.keys(patch).length === 0) {
          droppedOperationCount += 1;
          continue;
        }
        Object.assign(settingsPatch, patch);
        continue;
      }
      if (method === "appendQuestions") {
        const questions = this.sanitizeProposalQuestionBatch(params.questions, seenQuestionIds, 20);
        if (questions.length === 0) {
          droppedOperationCount += 1;
          continue;
        }
        questionOperations.push({ method: "appendQuestions", params: { questions } });
        continue;
      }
      if (method === "replaceQuestion") {
        const targetId = typeof params.replaceQuestionId === "string" ? params.replaceQuestionId.slice(0, 100) : "";
        const question = asRecord(params.question);
        if (!targetId || !currentQuestionIds.has(targetId)) {
          droppedOperationCount += 1;
          continue;
        }
        seenQuestionIds.delete(targetId);
        const questions = this.sanitizeProposalQuestionBatch([question], seenQuestionIds, 1);
        if (!questions[0]) {
          seenQuestionIds.add(targetId);
          droppedOperationCount += 1;
          continue;
        }
        replaceQuestionId = replaceQuestionId ?? targetId;
        questionOperations.push({ method: "replaceQuestion", params: { replaceQuestionId: targetId, question: questions[0] } });
        continue;
      }
      droppedOperationCount += 1;
    }

    const operations: ExamStudioOperation[] = [
      ...(Object.keys(settingsPatch).length > 0
        ? [{ method: "patchExamSettings" as const, params: settingsPatch }]
        : []),
      ...questionOperations
    ];
    const appendQuestions = questionOperations.flatMap((operation) =>
      operation.method === "appendQuestions"
        ? operation.params.questions
        : operation.method === "replaceQuestion"
          ? [operation.params.question]
          : []
    );
    const proposal: ExamStudioProposal = {
      answerMarkdown: answerMarkdown || replyMarkdown,
      replyMarkdown,
      ...(operations.length > 0 ? { operations } : {}),
      ...(Object.keys(settingsPatch).length > 0 ? { settingsPatch } : {}),
      ...(appendQuestions.length > 0 ? { appendQuestions } : {}),
      ...(replaceQuestionId ? { replaceQuestionId } : {}),
      ...(data.fallback === true ? { fallback: true } : {}),
      ...(data.source === "AI_UNAVAILABLE" ? { source: "AI_UNAVAILABLE" as const } : { source: "AI" as const })
    };
    this.logger.event("[exam_studio_proposal_sanitized]", {
      operationMethods: operations.map((operation) => operation.method),
      operationCount: operations.length,
      droppedOperationCount,
      fallback: proposal.fallback === true
    });
    return proposal;
  }

  async createExam(weekId: string, classroomId: string, input: TeacherExamDraftInput): Promise<TeacherExam> {
    const draft = this.normalizeDraft(input);
    const exam = await this.store.createTeacherExam({ weekId, classroomId, draftRevision: draft });
    if (!exam) throw new ExamServiceError(404, "주차 또는 강의실을 찾을 수 없습니다.", "NOT_FOUND");
    return exam;
  }

  async updateDraft(examId: string, input: TeacherExamDraftInput): Promise<TeacherExam> {
    const exam = await this.store.getTeacherExam(examId);
    if (!exam) throw new ExamServiceError(404, "시험을 찾을 수 없습니다.", "NOT_FOUND");
    const draft = this.normalizeDraft(input, exam.draftRevision);
    const updated = await this.store.updateTeacherExamDraft(examId, draft);
    if (!updated) throw new ExamServiceError(404, "시험을 찾을 수 없습니다.", "NOT_FOUND");
    return updated;
  }

  async publish(examId: string, input?: TeacherExamDraftInput): Promise<TeacherExam> {
    const exam = await this.store.getTeacherExam(examId);
    if (!exam) throw new ExamServiceError(404, "시험을 찾을 수 없습니다.", "NOT_FOUND");
    const draft = this.normalizeDraft(input ?? exam.draftRevision, exam.draftRevision);
    const errors = this.validatePublish(draft);
    if (errors.length > 0) {
      throw new ExamServiceError(400, errors.join("\n"), "VALIDATION_ERROR");
    }
    const published = await this.store.publishTeacherExam(examId, draft);
    if (!published) throw new ExamServiceError(404, "시험을 찾을 수 없습니다.", "NOT_FOUND");
    return published;
  }

  teacherDto(exam: TeacherExam) {
    return {
      ...exam,
      totalPoints: totalPoints(exam.draftRevision),
      publishedTotalPoints: totalPoints(exam.publishedRevision)
    };
  }

  async studentMetadataDto(exam: TeacherExam, studentUserId: string) {
    if (exam.status !== "PUBLISHED" || !exam.publishedRevision) {
      throw new ExamServiceError(404, "시험을 찾을 수 없습니다.", "NOT_PUBLISHED");
    }
    const attempt = await this.store.getTeacherExamAttemptForStudent(exam.id, studentUserId);
    const resolvedAttempt = attempt ? await this.finalizeExpiredOrRecover(attempt) : null;
    const revision = exam.publishedRevision;
    return {
      id: exam.id,
      classroomId: exam.classroomId,
      weekId: exam.weekId,
      status: exam.status,
      activePublishedVersion: exam.activePublishedVersion,
      title: revision.title,
      descriptionMarkdown: revision.descriptionMarkdown,
      availableFrom: revision.availableFrom,
      availableUntil: revision.availableUntil,
      timeLimitMinutes: revision.timeLimitMinutes,
      passScoreRatio: revision.passScoreRatio,
      totalPoints: totalPoints(revision),
      questionCount: revision.questions.length,
      attempt: attemptSummary(resolvedAttempt)
    };
  }

  attemptDto(attempt: TeacherExamAttempt, includeQuestions: boolean) {
    return {
      ...attemptSummary(attempt),
      questions: includeQuestions
        ? stripSensitiveQuestions(attempt.examSnapshot.questions, attempt.status === "GRADED")
        : []
    };
  }

  async attemptDtoForRead(attempt: TeacherExamAttempt, includeQuestions: boolean) {
    return this.attemptDto(await this.finalizeExpiredOrRecover(attempt), includeQuestions);
  }

  private async gradeAndCommit(input: {
    attemptId: string;
    actorUserId: string;
    attempt: TeacherExamAttempt;
    submissionId: string;
  }): Promise<TeacherExamAttempt> {
    const grading = await this.grading.grade({
      model: appConfig.modelName,
      exam: input.attempt.examSnapshot,
      answers: input.attempt.answers,
      aiEnabled: input.attempt.settingsSnapshot.aiGradingEnabled
    });
    if (grading.fallback) {
      this.logger.event("[exam_ai_grade_fallback]", {
        examId: input.attempt.examId,
        actorUserId: input.actorUserId,
        attemptId: input.attemptId,
        submissionId: input.submissionId,
        examVersion: input.attempt.examVersion
      });
    }
    const committed = await this.store.commitExamAttemptGrading(
      input.attemptId,
      input.submissionId,
      grading,
      this.nowIso()
    );
    const attempt = committed ?? input.attempt;
    this.logger.event("[exam_grade]", {
      examId: attempt.examId,
      actorUserId: input.actorUserId,
      attemptId: input.attemptId,
      submissionId: input.submissionId,
      examVersion: attempt.examVersion,
      gradingSource: grading.gradingSource
    });
    return attempt;
  }

  private async finalizeExpiredOrRecover(attempt: TeacherExamAttempt): Promise<TeacherExamAttempt> {
    const recovered = await this.ensureGradingRecovered(attempt);
    if (recovered.status !== "IN_PROGRESS") return recovered;
    if (this.nowIso() <= addSeconds(recovered.deadlineAt, 5)) return recovered;
    const claim = await this.store.claimExamAttemptSubmission(
      recovered.id,
      recovered.studentUserId,
      undefined,
      this.nowIso()
    );
    if (!claim.ok) return recovered;
    if (!claim.shouldGrade) return this.ensureGradingRecovered(claim.attempt);
    this.logger.event("[exam_submit]", {
      examId: claim.attempt.examId,
      actorUserId: recovered.studentUserId,
      attemptId: recovered.id,
      submissionId: claim.submissionId,
      examVersion: claim.attempt.examVersion,
      accepted: claim.accepted,
      reason: "DEADLINE_EXPIRED"
    });
    return this.gradeAndCommit({
      attemptId: recovered.id,
      actorUserId: recovered.studentUserId,
      attempt: claim.attempt,
      submissionId: claim.submissionId!
    });
  }

  async startAttempt(examId: string, studentUserId: string) {
    const at = this.nowIso();
    const result = await this.store.getOrCreateExamAttemptForStudent(examId, studentUserId, at);
    if (!result.ok) {
      const status = result.reason === "NOT_FOUND" ? 404 : result.reason === "UNAVAILABLE" ? 409 : 403;
      throw new ExamServiceError(status, "응시할 수 없는 시험입니다.", result.reason);
    }
    this.logger.event("[exam_start]", {
      examId,
      weekId: result.exam.weekId,
      classroomId: result.exam.classroomId,
      actorUserId: studentUserId,
      attemptId: result.attempt.id,
      examVersion: result.attempt.examVersion
    });
    const recovered = await this.finalizeExpiredOrRecover(result.attempt);
    return this.attemptDto(recovered, true);
  }

  async saveAnswers(attemptId: string, studentUserId: string, answers: Record<string, unknown>) {
    const at = this.nowIso();
    const saved = await this.store.saveExamAttemptAnswers(attemptId, studentUserId, answers, at);
    if (!saved.ok) {
      throw new ExamServiceError(saved.reason === "FORBIDDEN" ? 403 : 404, "시험 응답을 저장할 수 없습니다.", saved.reason);
    }
    this.logger.event("[exam_answers_save]", {
      examId: saved.attempt.examId,
      actorUserId: studentUserId,
      attemptId,
      examVersion: saved.attempt.examVersion,
      reason: saved.reason
    });
    if (saved.reason === "LATE_AFTER_GRACE") {
      return this.submitAttempt(attemptId, studentUserId, undefined);
    }
    return this.attemptDto(saved.attempt, true);
  }

  async submitAttempt(
    attemptId: string,
    studentUserId: string,
    answers: Record<string, unknown> | undefined
  ) {
    const at = this.nowIso();
    const claim = await this.store.claimExamAttemptSubmission(attemptId, studentUserId, answers, at);
    if (!claim.ok) {
      if (claim.reason === "LATE_AFTER_GRACE") {
        this.logger.event("[exam_late_reject]", {
          actorUserId: studentUserId,
          attemptId,
          reason: claim.reason
        });
      }
      const status = claim.reason === "FORBIDDEN" ? 403 : claim.reason === "LATE_AFTER_GRACE" ? 409 : 404;
      throw new ExamServiceError(status, "시험을 제출할 수 없습니다.", claim.reason);
    }
    if (!claim.shouldGrade) {
      return this.attemptDto(await this.ensureGradingRecovered(claim.attempt), true);
    }
    this.logger.event("[exam_submit]", {
      examId: claim.attempt.examId,
      actorUserId: studentUserId,
      attemptId,
      submissionId: claim.submissionId,
      examVersion: claim.attempt.examVersion,
      accepted: claim.accepted
    });
    const attempt = await this.gradeAndCommit({
      attemptId,
      actorUserId: studentUserId,
      attempt: claim.attempt,
      submissionId: claim.submissionId!
    });
    return this.attemptDto(attempt, true);
  }

  async ensureGradingRecovered(attempt: TeacherExamAttempt): Promise<TeacherExamAttempt> {
    if (attempt.status !== "GRADING") return attempt;
    const lease = attempt.gradingLeaseExpiresAt ? new Date(attempt.gradingLeaseExpiresAt).getTime() : 0;
    if (lease > this.clock.now().getTime()) return attempt;
    const submissionId = attempt.submissionId;
    if (!submissionId) return attempt;
    return this.gradeAndCommit({
      attemptId: attempt.id,
      actorUserId: attempt.studentUserId,
      attempt,
      submissionId
    });
  }

  async report(exam: TeacherExam) {
    const attempts = await Promise.all(
      (await this.store.listTeacherExamAttemptsByExam(exam.id)).map((attempt) =>
        this.finalizeExpiredOrRecover(attempt)
      )
    );
    const enrollments = await this.store.listEnrollmentsByClassroom(exam.classroomId);
    const students = await Promise.all(
      enrollments.map(async (enrollment: ClassroomEnrollment) => ({
        enrollment,
        user: await this.store.getUser(enrollment.studentUserId)
      }))
    );
    const graded = attempts.filter((attempt) => attempt.status === "GRADED" && attempt.grading);
    const averageScore =
      graded.length > 0
        ? graded.reduce((sum, attempt) => sum + (attempt.grading?.totalScore ?? 0), 0) / graded.length
        : 0;
    const questionStats = new Map<string, { questionId: string; maxScore: number; averageScore: number; attempts: number }>();
    for (const attempt of graded) {
      for (const item of attempt.grading?.items ?? []) {
        const current = questionStats.get(item.questionId) ?? {
          questionId: item.questionId,
          maxScore: item.maxScore,
          averageScore: 0,
          attempts: 0
        };
        current.averageScore =
          (current.averageScore * current.attempts + item.score) / (current.attempts + 1);
        current.attempts += 1;
        questionStats.set(item.questionId, current);
      }
    }
    return {
      exam: this.teacherDto(exam),
      summary: {
        enrolledCount: enrollments.length,
        attemptCount: attempts.length,
        gradedCount: graded.length,
        averageScore,
        maxScore: totalPoints(exam.publishedRevision),
        completionRatio: enrollments.length > 0 ? attempts.length / enrollments.length : 0
      },
      students: students.map(({ enrollment, user }: { enrollment: ClassroomEnrollment; user: User | null }) => {
        const attempt = attempts.find((item) => item.studentUserId === enrollment.studentUserId) ?? null;
        return {
          studentUserId: enrollment.studentUserId,
          displayName: user?.displayName ?? "알 수 없는 학생",
          status: attempt?.status ?? "NOT_STARTED",
          attempt: attempt ? this.attemptDto(attempt, false) : null
        };
      }),
      questionStats: Array.from(questionStats.values())
    };
  }
}
