import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getExam,
  getMyExamAttempt,
  saveExamAttemptAnswers,
  startTeacherExam,
  submitExamAttempt
} from "../api/endpoints";
import { StudentExamMetadata, TeacherExamAttemptSummary, TeacherExamQuestionType } from "../types";

declare global {
  interface Window {
    __MERGE_EDU_TEST_CLOCK_NOW__?: number | (() => number);
  }
}

function nowMs(): number {
  const override = window.__MERGE_EDU_TEST_CLOCK_NOW__;
  if (typeof override === "function") return override();
  if (typeof override === "number") return override;
  return Date.now();
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type ExamTakingIconName = "arrowLeft" | "check" | "clock" | "document" | "pen" | "play" | "send" | "star";

function ExamTakingIcon({ name, className = "" }: { name: ExamTakingIconName; className?: string }) {
  const common = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false
  };

  if (name === "clock") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (name === "arrowLeft") {
    return (
      <svg {...common}>
        <path d="M19 12H5" />
        <path d="m12 5-7 7 7 7" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...common}>
        <path d="m5 12 4 4 10-10" />
      </svg>
    );
  }

  if (name === "play") {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <path d="M8 5.5v13l10-6.5-10-6.5Z" />
      </svg>
    );
  }

  if (name === "pen") {
    return (
      <svg {...common}>
        <path d="m16.5 3.5 4 4L8 20l-5 1 1-5L16.5 3.5Z" />
        <path d="m14 6 4 4" />
      </svg>
    );
  }

  if (name === "send") {
    return (
      <svg {...common}>
        <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        <path d="M22 2 11 13" />
      </svg>
    );
  }

  if (name === "star") {
    return (
      <svg {...common}>
        <path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9L12 3Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M7 3.5h7l3 3V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
      <path d="M14 3.5V7h3.5" />
      <path d="M9 11h6" />
      <path d="M9 15h6" />
    </svg>
  );
}

const QUESTION_TYPE_LABELS: Record<TeacherExamQuestionType, string> = {
  MCQ: "객관식",
  OX: "OX 문제",
  SHORT: "단답식",
  ESSAY: "서술형"
};

function isSupportedQuestionType(type: string): type is TeacherExamQuestionType {
  return type === "MCQ" || type === "OX" || type === "SHORT" || type === "ESSAY";
}

function getQuestionTypeLabel(type: string): string {
  return isSupportedQuestionType(type) ? QUESTION_TYPE_LABELS[type] : "지원되지 않는 유형";
}

function getQuestionTypeClass(type: string): string {
  if (!isSupportedQuestionType(type)) return "unknown";
  return type.toLowerCase();
}

function getQuestionHelper(type: string): string {
  if (type === "SHORT") return "숫자만 입력하세요.";
  if (type === "ESSAY") return "핵심 내용을 중심으로 작성해 주세요.";
  return "";
}

function getChoiceNumber(index: number): string {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
  return circled[index] ?? String(index + 1);
}

function getMcqChoiceId(value: unknown): string {
  if (value && typeof value === "object" && "choiceId" in value) {
    const choiceId = (value as { choiceId?: unknown }).choiceId;
    return typeof choiceId === "string" ? choiceId : "";
  }
  return "";
}

function getOxValue(value: unknown): boolean | null {
  if (value && typeof value === "object" && "value" in value) {
    const oxValue = (value as { value?: unknown }).value;
    return typeof oxValue === "boolean" ? oxValue : null;
  }
  return null;
}

function getTextAnswer(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function ExamTakingRoute() {
  const { examId } = useParams<{ examId: string }>();
  const examIdRef = useRef(examId);
  const submitInFlightAttemptIdRef = useRef<string | null>(null);
  const [metadata, setMetadata] = useState<StudentExamMetadata | null>(null);
  const [attempt, setAttempt] = useState<TeacherExamAttemptSummary | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const currentAttempt = attempt?.examId === examId ? attempt : null;

  useEffect(() => {
    examIdRef.current = examId;
  }, [examId]);

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      submitInFlightAttemptIdRef.current = null;
      setSubmitting(false);
      setMetadata(null);
      setAttempt(null);
      setAnswers({});
      setRemainingMs(null);
      try {
        const exam = (await getExam(examId!)) as StudentExamMetadata;
        const existing = await getMyExamAttempt(examId!);
        if (cancelled) return;
        setMetadata(exam);
        setAttempt(existing);
        setAnswers(existing?.answers ?? {});
      } catch (err) {
        if (!cancelled) {
          setMetadata(null);
          setAttempt(null);
          setAnswers({});
          setRemainingMs(null);
          setSubmitting(false);
          setError(err instanceof Error ? err.message : "시험을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [examId]);

  useEffect(() => {
    if (!currentAttempt?.deadlineAt || currentAttempt.status !== "IN_PROGRESS") {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(new Date(currentAttempt.deadlineAt).getTime() - nowMs());
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [currentAttempt?.deadlineAt, currentAttempt?.status]);

  useEffect(() => {
    if (!currentAttempt || currentAttempt.status !== "IN_PROGRESS" || remainingMs === null || remainingMs > 0 || submitting) {
      return;
    }
    onSubmit().catch(console.error);
  }, [currentAttempt, remainingMs, submitting]);

  useEffect(() => {
    if (
      !currentAttempt ||
      currentAttempt.status !== "IN_PROGRESS" ||
      submitting ||
      submitInFlightAttemptIdRef.current === currentAttempt.id
    ) {
      return;
    }
    const handle = window.setTimeout(() => {
      saveExamAttemptAnswers(currentAttempt.id, answers).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [answers, currentAttempt, submitting]);

  const questions = useMemo(() => currentAttempt?.questions ?? [], [currentAttempt?.questions]);
  const isInProgress = currentAttempt?.status === "IN_PROGRESS";
  const answerControlsDisabled =
    !isInProgress || submitting || Boolean(currentAttempt && submitInFlightAttemptIdRef.current === currentAttempt.id);
  const totalDurationMs = Math.max(0, (metadata?.timeLimitMinutes ?? 0) * 60_000);
  const remainingRatio =
    totalDurationMs > 0 && remainingMs !== null ? Math.max(0, Math.min(1, remainingMs / totalDurationMs)) : 0;

  async function onStart() {
    if (!examId) return;
    const targetExamId = examId;
    setError("");
    try {
      const started = await startTeacherExam(targetExamId);
      if (examIdRef.current !== targetExamId || started.examId !== targetExamId) return;
      setRemainingMs(null);
      submitInFlightAttemptIdRef.current = null;
      setAttempt(started);
      setAnswers(started.answers ?? {});
    } catch (err) {
      if (examIdRef.current === targetExamId) {
        setError(err instanceof Error ? err.message : "시험을 시작하지 못했습니다.");
      }
    }
  }

  async function onSubmit() {
    if (!currentAttempt || currentAttempt.status !== "IN_PROGRESS" || submitting) return;
    const targetExamId = currentAttempt.examId;
    const targetAttemptId = currentAttempt.id;
    if (submitInFlightAttemptIdRef.current === targetAttemptId) return;
    submitInFlightAttemptIdRef.current = targetAttemptId;
    setSubmitting(true);
    setError("");
    const answerSnapshot = answers;
    try {
      const submitted = await submitExamAttempt(targetAttemptId, answerSnapshot);
      if (examIdRef.current !== targetExamId || submitted.examId !== targetExamId) return;
      setAttempt(submitted);
      setAnswers(submitted.answers ?? answerSnapshot);
    } catch (err) {
      if (examIdRef.current === targetExamId) {
        setError(err instanceof Error ? err.message : "시험을 제출하지 못했습니다.");
      }
    } finally {
      if (submitInFlightAttemptIdRef.current === targetAttemptId) {
        submitInFlightAttemptIdRef.current = null;
      }
      if (examIdRef.current === targetExamId) {
        setSubmitting(false);
      }
    }
  }

  function setAnswer(questionId: string, value: unknown) {
    if (
      !currentAttempt ||
      currentAttempt.status !== "IN_PROGRESS" ||
      submitting ||
      submitInFlightAttemptIdRef.current === currentAttempt.id
    ) {
      return;
    }
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  if (loading || (metadata && metadata.id !== examId)) {
    return (
      <main className="page-shell card" data-testid="app-shell-content">
        <span data-testid="exam-taking-page">시험 정보를 불러오는 중...</span>
      </main>
    );
  }

  const examDescription = metadata?.descriptionMarkdown?.trim() || "시작 버튼을 누르면 문항이 공개됩니다.";
  const classroomPath = metadata ? `/classrooms/${metadata.classroomId}` : "/";

  return (
    <main className="page-shell exam-taking-page" data-testid="app-shell-content">
      <div data-testid="exam-taking-page">
      {metadata && error ? <section className="card alert alert-error">{error}</section> : null}

      {!metadata ? (
        <section className="card exam-start-error-card">
          <p>{error || "시험 정보를 불러오지 못했습니다."}</p>
        </section>
      ) : null}

      {metadata && !currentAttempt ? (
        <section className="exam-start-dashboard" data-testid="exam-start-dashboard">
          <section className="exam-start-hero" data-testid="exam-start-hero">
            <div className="exam-start-hero-copy">
              <span className="exam-start-eyebrow">EXAM</span>
              <h1 className="exam-start-title">{metadata.title}</h1>
              <p className="exam-start-subtitle">{examDescription}</p>
            </div>
            <div className="exam-start-stat-card" aria-label="시험 정보" data-testid="exam-start-stat-card">
              <div className="exam-start-stat">
                <span className="exam-start-stat-icon">
                  <ExamTakingIcon name="star" />
                </span>
                <strong>{metadata.totalPoints}</strong>
                <small>점</small>
              </div>
              <div className="exam-start-stat">
                <span className="exam-start-stat-icon exam-start-stat-icon-clock">
                  <ExamTakingIcon name="clock" />
                </span>
                <strong>{metadata.timeLimitMinutes ?? 0}</strong>
                <small>분</small>
              </div>
            </div>
          </section>

          <section className="exam-start-card" data-testid="exam-start-card">
            <span className="exam-start-card-icon">
              <ExamTakingIcon name="document" />
            </span>
            <div className="exam-start-card-main">
              <p>시작 버튼을 누르면 타이머가 시작되고 문항이 공개됩니다.</p>
              <div className="exam-start-actions">
                <button className="exam-start-primary-btn" data-testid="exam-start-button" onClick={onStart}>
                  <ExamTakingIcon name="play" />
                  <span>시험 시작</span>
                </button>
                <Link className="exam-start-secondary-btn" data-testid="exam-back-link" to={classroomPath}>
                  강의실로 돌아가기
                </Link>
              </div>
            </div>
          </section>
        </section>
      ) : null}

      {metadata && currentAttempt ? (
        <section className="exam-taking-dashboard" data-testid="exam-taking-dashboard">
          <section className="exam-taking-hero" data-testid="exam-taking-hero">
            <div className="exam-taking-hero-copy">
              <span className="exam-taking-eyebrow">EXAM</span>
              <h1 className="exam-taking-title">{metadata.title}</h1>
              <p className="exam-taking-subtitle">{examDescription}</p>
            </div>
            <div className="exam-taking-hero-stats" aria-label="시험 정보">
              <span className="exam-taking-stat-icon">
                <ExamTakingIcon name="star" />
              </span>
              <div className="exam-taking-stat-copy">
                <strong>{metadata.totalPoints}점</strong>
                <small>총 배점</small>
              </div>
              <span className="exam-taking-stat-divider" aria-hidden="true" />
              <span className="exam-taking-stat-icon exam-taking-stat-icon-clock">
                <ExamTakingIcon name="clock" />
              </span>
              <div className="exam-taking-stat-copy">
                <strong>{metadata.timeLimitMinutes ?? 0}분</strong>
                <small>제한 시간</small>
              </div>
            </div>
            <div className="exam-taking-illustration" aria-hidden="true">
              <span className="exam-taking-illustration-paper">
                <i />
                <i />
                <i />
              </span>
              <span className="exam-taking-illustration-pen">
                <ExamTakingIcon name="pen" />
              </span>
            </div>
          </section>

          <section className="exam-taking-timer" aria-label="남은 시간">
            <span className="exam-taking-timer-label">남은 시간</span>
            <div className="exam-taking-progress-track" aria-hidden="true">
              <span className="exam-taking-progress-fill" style={{ width: `${remainingRatio * 100}%` }} />
            </div>
            <strong className="exam-taking-timer-value" data-testid="exam-countdown">
              {formatRemaining(remainingMs ?? 0)}
            </strong>
          </section>

          <section className="exam-question-list" aria-label="시험 문항">
            {questions.length === 0 ? (
              <article className="exam-taking-empty-card" data-testid="exam-taking-empty-questions">
                <span className="exam-taking-empty-icon">
                  <ExamTakingIcon name="document" />
                </span>
                <strong>문항을 불러오지 못했습니다.</strong>
                <p>잠시 후 다시 시도하거나 선생님에게 문의해 주세요.</p>
              </article>
            ) : null}

            {questions.map((question, index) => {
              const questionType = question.type as string;
              const questionTypeClass = getQuestionTypeClass(questionType);
              const feedback = currentAttempt.grading?.items.find((item) => item.questionId === question.id);
              const textAnswer = getTextAnswer(answers[question.id]);
              const oxValue = getOxValue(answers[question.id]);
              const selectedChoiceId = getMcqChoiceId(answers[question.id]);
              const helperText = getQuestionHelper(questionType);

              return (
                <article
                  key={question.id}
                  className="exam-taking-question-card"
                  data-testid="exam-taking-question-card"
                  data-question-type={questionType}
                >
                  <div className="exam-taking-question-prompt">
                    <div className="exam-taking-question-meta">
                      <strong>{index + 1}번</strong>
                      <span
                        className={`exam-taking-type-badge exam-taking-type-badge-${questionTypeClass}`}
                        data-testid="exam-question-type-badge"
                      >
                        {getQuestionTypeLabel(questionType)}
                      </span>
                      <small>{question.points}점</small>
                    </div>
                    <p>{question.promptMarkdown}</p>
                    {helperText ? <span className="exam-taking-question-helper">{helperText}</span> : null}
                  </div>

                  <div className="exam-taking-answer-panel">
                    {questionType === "OX" ? (
                      <div className="exam-ox-options" role="group" aria-label={`${index + 1}번 OX 답안`}>
                        {[
                          { label: "O", value: true },
                          { label: "X", value: false }
                        ].map((option) => {
                          const selected = oxValue === option.value;
                          return (
                            <button
                              key={option.label}
                              type="button"
                              className={`exam-ox-option${selected ? " is-selected" : ""}`}
                              data-testid="exam-ox-option"
                              data-question-id={question.id}
                              data-value={String(option.value)}
                              disabled={answerControlsDisabled}
                              onClick={() => {
                                if (answerControlsDisabled) return;
                                setAnswer(question.id, selected ? "" : { value: option.value });
                              }}
                            >
                              {selected ? (
                                <span className="exam-selected-check" aria-hidden="true">
                                  <ExamTakingIcon name="check" />
                                </span>
                              ) : null}
                              <span>{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {questionType === "MCQ" ? (
                      <div className="exam-mcq-options" role="group" aria-label={`${index + 1}번 객관식 답안`}>
                        {(question.choices ?? []).map((choice, choiceIndex) => {
                          const selected = selectedChoiceId === choice.id;
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              className={`exam-choice-option exam-mcq-option${selected ? " is-selected" : ""}`}
                              data-testid="exam-choice-option"
                              data-question-id={question.id}
                              data-choice-id={choice.id}
                              disabled={answerControlsDisabled}
                              onClick={() => {
                                if (answerControlsDisabled) return;
                                setAnswer(question.id, { choiceId: choice.id });
                              }}
                            >
                              {selected ? (
                                <span className="exam-selected-check" aria-hidden="true">
                                  <ExamTakingIcon name="check" />
                                </span>
                              ) : (
                                <span className="exam-choice-number">{getChoiceNumber(choiceIndex)}</span>
                              )}
                              <span>{choice.textMarkdown}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {questionType === "SHORT" ? (
                      <label className="exam-text-answer-field">
                        <span>답안</span>
                        <input
                          className="exam-text-answer-input"
                          data-testid="exam-answer-input"
                          data-question-id={question.id}
                          disabled={answerControlsDisabled}
                          value={textAnswer}
                          onChange={(event) => setAnswer(question.id, event.target.value)}
                        />
                      </label>
                    ) : null}

                    {questionType === "ESSAY" ? (
                      <label className="exam-text-answer-field">
                        <span>답안</span>
                        <textarea
                          className="exam-text-answer-input exam-essay-answer"
                          rows={5}
                          data-testid="exam-answer-input"
                          data-question-id={question.id}
                          disabled={answerControlsDisabled}
                          value={textAnswer}
                          onChange={(event) => setAnswer(question.id, event.target.value)}
                        />
                        <small className="exam-essay-counter" data-testid="exam-essay-counter">
                          {textAnswer.length} / 1000
                        </small>
                      </label>
                    ) : null}

                    {!isSupportedQuestionType(questionType) ? (
                      <div className="exam-taking-unsupported" data-testid="exam-taking-unsupported-question">
                        지원되지 않는 문항 유형입니다.
                      </div>
                    ) : null}
                  </div>

                  {feedback ? <div className="exam-feedback">{feedback.feedbackMarkdown}</div> : null}
                </article>
              );
            })}
          </section>

          {currentAttempt.grading ? (
            <section className="exam-score-summary" data-testid="exam-score-summary">
              <strong>
                {currentAttempt.grading.totalScore} / {currentAttempt.grading.maxScore}점
              </strong>
              <p>{currentAttempt.grading.summaryMarkdown}</p>
            </section>
          ) : currentAttempt.status === "GRADING" ? (
            <section className="exam-taking-status-card" data-testid="exam-submit-status-card">
              채점 중입니다.
            </section>
          ) : currentAttempt.status === "GRADED" ? (
            <section className="exam-taking-status-card" data-testid="exam-submit-status-card">
              제출된 시험입니다. 결과를 불러오는 중입니다.
            </section>
          ) : null}

          <div className="exam-taking-actions">
            <Link className="exam-taking-back-btn" data-testid="exam-back-link" to={classroomPath}>
              <ExamTakingIcon name="arrowLeft" />
              <span>강의실로 돌아가기</span>
            </Link>
            {isInProgress && !currentAttempt.grading && questions.length > 0 ? (
              <button
                className="exam-taking-submit-btn"
                data-testid="exam-submit-button"
                disabled={submitting}
                onClick={onSubmit}
              >
                <ExamTakingIcon name="send" />
                <span>{submitting ? "제출 중..." : "제출"}</span>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      </div>
    </main>
  );
}
