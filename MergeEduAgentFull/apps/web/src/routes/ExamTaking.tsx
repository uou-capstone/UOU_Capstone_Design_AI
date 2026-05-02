import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getExam,
  getMyExamAttempt,
  saveExamAttemptAnswers,
  startTeacherExam,
  submitExamAttempt
} from "../api/endpoints";
import { StudentExamMetadata, TeacherExamAttemptSummary } from "../types";

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

export function ExamTakingRoute() {
  const { examId } = useParams<{ examId: string }>();
  const [metadata, setMetadata] = useState<StudentExamMetadata | null>(null);
  const [attempt, setAttempt] = useState<TeacherExamAttemptSummary | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const exam = (await getExam(examId!)) as StudentExamMetadata;
        const existing = await getMyExamAttempt(examId!);
        if (cancelled) return;
        setMetadata(exam);
        setAttempt(existing);
        setAnswers(existing?.answers ?? {});
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "시험을 불러오지 못했습니다.");
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
    if (!attempt?.deadlineAt || attempt.status !== "IN_PROGRESS") {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(new Date(attempt.deadlineAt).getTime() - nowMs());
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [attempt?.deadlineAt, attempt?.status]);

  useEffect(() => {
    if (!attempt || attempt.status !== "IN_PROGRESS" || remainingMs === null || remainingMs > 0 || submitting) {
      return;
    }
    onSubmit().catch(console.error);
  }, [attempt, remainingMs, submitting]);

  useEffect(() => {
    if (!attempt || attempt.status !== "IN_PROGRESS") return;
    const handle = window.setTimeout(() => {
      saveExamAttemptAnswers(attempt.id, answers).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [answers, attempt]);

  const questions = useMemo(() => attempt?.questions ?? [], [attempt?.questions]);

  async function onStart() {
    if (!examId) return;
    setError("");
    try {
      const started = await startTeacherExam(examId);
      setRemainingMs(null);
      setAttempt(started);
      setAnswers(started.answers ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "시험을 시작하지 못했습니다.");
    }
  }

  async function onSubmit() {
    if (!attempt || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const submitted = await submitExamAttempt(attempt.id, answers);
      setAttempt(submitted);
      setAnswers(submitted.answers ?? answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "시험을 제출하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  if (loading) {
    return <main className="page-shell card" data-testid="exam-taking-page">시험 정보를 불러오는 중...</main>;
  }

  return (
    <main className="page-shell exam-taking-page" data-testid="exam-taking-page">
      <section className="classroom-hero">
        <div>
          <span className="eyebrow">EXAM</span>
          <h1 className="page-title">{metadata?.title ?? "시험"}</h1>
          <p className="page-subtitle">{metadata?.descriptionMarkdown}</p>
        </div>
        <div className="classroom-hero-meta">
          <span>
            <strong>{metadata?.totalPoints ?? 0}</strong>
            <small>점</small>
          </span>
          <span>
            <strong>{metadata?.timeLimitMinutes ?? 0}</strong>
            <small>분</small>
          </span>
        </div>
      </section>

      {error ? <section className="card alert alert-error">{error}</section> : null}

      {!attempt ? (
        <section className="card exam-start-card">
          <p>시작 버튼을 누르면 타이머가 시작되고 문항이 공개됩니다.</p>
          <button className="btn" data-testid="exam-start-button" onClick={onStart}>
            시험 시작
          </button>
        </section>
      ) : null}

      {attempt ? (
        <section className="exam-taking-surface">
          <div className="card exam-countdown-card">
            <span>남은 시간</span>
            <strong data-testid="exam-countdown">{formatRemaining(remainingMs ?? 0)}</strong>
          </div>

          {questions.map((question, index) => (
            <article key={question.id} className="card exam-answer-card">
              <div className="quiz-question-topline">
                <span>{index + 1}. {question.type}</span>
                <strong>{question.points}점</strong>
              </div>
              <p>{question.promptMarkdown}</p>
              {question.type === "MCQ" ? (
                <div className="exam-choice-options">
                  {(question.choices ?? []).map((choice) => (
                    <label key={choice.id} className="exam-choice-option" data-testid="exam-choice-option" data-question-id={question.id} data-choice-id={choice.id}>
                      <input
                        type="radio"
                        name={`answer-${question.id}`}
                        checked={(answers[question.id] as any)?.choiceId === choice.id}
                        disabled={attempt.status !== "IN_PROGRESS"}
                        onChange={() => setAnswer(question.id, { choiceId: choice.id })}
                      />
                      {choice.textMarkdown}
                    </label>
                  ))}
                </div>
              ) : null}
              {question.type === "OX" ? (
                <select
                  className="input"
                  data-testid="exam-answer-input"
                  data-question-id={question.id}
                  disabled={attempt.status !== "IN_PROGRESS"}
                  value={String((answers[question.id] as any)?.value ?? "")}
                  onChange={(event) => setAnswer(question.id, { value: event.target.value === "true" })}
                >
                  <option value="">선택</option>
                  <option value="true">O</option>
                  <option value="false">X</option>
                </select>
              ) : null}
              {question.type === "SHORT" || question.type === "ESSAY" ? (
                <textarea
                  className="input"
                  rows={question.type === "ESSAY" ? 6 : 2}
                  data-testid="exam-answer-input"
                  data-question-id={question.id}
                  disabled={attempt.status !== "IN_PROGRESS"}
                  value={String(answers[question.id] ?? "")}
                  onChange={(event) => setAnswer(question.id, event.target.value)}
                />
              ) : null}
              {attempt.grading ? (
                <div className="exam-feedback">
                  {attempt.grading.items.find((item) => item.questionId === question.id)?.feedbackMarkdown}
                </div>
              ) : null}
            </article>
          ))}

          {attempt.grading ? (
            <section className="card exam-score-summary" data-testid="exam-score-summary">
              <strong>{attempt.grading.totalScore} / {attempt.grading.maxScore}점</strong>
              <p>{attempt.grading.summaryMarkdown}</p>
            </section>
          ) : (
            <button className="btn" data-testid="exam-submit-button" disabled={submitting} onClick={onSubmit}>
              {submitting ? "제출 중..." : "제출"}
            </button>
          )}
        </section>
      ) : null}

      <Link className="btn ghost" to={metadata ? `/classrooms/${metadata.classroomId}` : "/"}>
        강의실로 돌아가기
      </Link>
    </main>
  );
}
