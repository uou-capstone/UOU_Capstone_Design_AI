import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GradingItem, QuizJson, QuizRecord } from "../../types";
import { EssayRenderer } from "./renderers/EssayRenderer";
import { McqRenderer } from "./renderers/McqRenderer";
import { OxRenderer } from "./renderers/OxRenderer";
import { ShortRenderer } from "./renderers/ShortRenderer";
import { useDialogFocus } from "../ui/useDialogFocus";
import { QuizMarkdown } from "./QuizFeedback";

interface Props {
  open: boolean;
  quiz: QuizJson | null;
  disableClose: boolean;
  passScoreRatio?: number;
  gradedRecord?: QuizRecord;
  gradingInsight?: {
    open: boolean;
    thoughtMarkdown: string;
    answerMarkdown: string;
  };
  onCloseInsight?: () => void;
  onClose: () => void;
  onSubmit: (quizId: string, quizType: string, answers: Record<string, unknown>) => Promise<QuizRecord | undefined>;
}

interface SubmittedAnswersSnapshot {
  quizId: string;
  answers: Record<string, unknown>;
}

type QuizGrading = NonNullable<QuizRecord["grading"]>;

function isBoundedRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getEffectiveScoreRatio(grading: QuizGrading) {
  if (isBoundedRatio(grading.scoreRatio)) {
    return grading.scoreRatio;
  }
  if (
    Number.isFinite(grading.score) &&
    Number.isFinite(grading.maxScore) &&
    grading.maxScore > 0
  ) {
    return clampRatio(grading.score / grading.maxScore);
  }
  return 0;
}

function getSafePassScoreRatio(value: unknown) {
  return isBoundedRatio(value) ? value : 0.7;
}

function getStringAnswer(answers: Record<string, unknown> | undefined, questionId: string) {
  const value = answers?.[questionId];
  return typeof value === "string" ? value : undefined;
}

function getBooleanAnswer(answers: Record<string, unknown> | undefined, questionId: string) {
  const value = answers?.[questionId];
  return typeof value === "boolean" ? value : undefined;
}

export function QuizModal({
  open,
  quiz,
  disableClose,
  passScoreRatio = 0.7,
  gradedRecord,
  gradingInsight,
  onCloseInsight,
  onClose,
  onSubmit
}: Props) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localRecord, setLocalRecord] = useState<QuizRecord | undefined>();
  const [submittedAnswersSnapshot, setSubmittedAnswersSnapshot] = useState<SubmittedAnswersSnapshot | undefined>();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialogRef, backdropRef);

  useEffect(() => {
    setAnswers({});
    setError("");
    setLocalRecord(undefined);
    setSubmittedAnswersSnapshot(undefined);
  }, [quiz?.quizId]);

  useEffect(() => {
    if (open) return;
    setSubmittedAnswersSnapshot(undefined);
  }, [open]);

  const record = localRecord ?? gradedRecord;
  const gradingMap = useMemo(() => {
    const map = new Map<string, GradingItem>();
    record?.grading?.items.forEach((item) => map.set(item.questionId, item));
    return map;
  }, [record]);

  if (!open || !quiz) return null;

  const allAnswered = quiz.questions.every((q) => {
    const value = answers[q.id];
    if (quiz.quizType === "MCQ") return typeof value === "string";
    if (quiz.quizType === "OX") return typeof value === "boolean";
    return typeof value === "string" && value.trim().length > 0;
  });

  const canClose = !disableClose;
  const alreadyGraded = record?.grading?.status === "GRADED";
  const displayAnswers = (() => {
    if (!alreadyGraded) return answers;
    if (record?.userAnswers) return record.userAnswers;
    if (
      localRecord &&
      submittedAnswersSnapshot?.quizId === quiz.quizId &&
      localRecord.id === quiz.quizId
    ) {
      return submittedAnswersSnapshot.answers;
    }
    return undefined;
  })();
  const controlsLocked = loading || alreadyGraded;
  const updateAnswer = (questionId: string, value: unknown) => {
    if (controlsLocked) return;
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };
  const isAnswerUnavailable = (questionId: string) => {
    if (!alreadyGraded) return false;
    if (!displayAnswers) return true;
    const value = displayAnswers[questionId];
    if (quiz.quizType === "OX") return typeof value !== "boolean";
    return typeof value !== "string";
  };

  const submit = async () => {
    if (!allAnswered) {
      setError("모든 문항에 답변한 뒤 채점할 수 있습니다.");
      return;
    }
    const snapshot: SubmittedAnswersSnapshot = {
      quizId: quiz.quizId,
      answers: { ...answers }
    };
    setError("");
    setLoading(true);
    setSubmittedAnswersSnapshot(snapshot);
    try {
      const result = await onSubmit(quiz.quizId, quiz.quizType, snapshot.answers);
      setLocalRecord(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "채점 실패");
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" ref={backdropRef}>
      <div
        ref={dialogRef}
        className="card modal-panel quiz-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-modal-title"
        tabIndex={-1}
      >
        {gradingInsight?.open ? (
          <div className="card grading-insight-modal">
            <div className="toolbar">
              <strong>채점 에이전트 스트리밍</strong>
              <button className="btn ghost" onClick={onCloseInsight} type="button">
                닫기
              </button>
            </div>
            <details open>
              <summary>사고 요약 스트림</summary>
              <pre className="quiz-stream-pre">
                {gradingInsight.thoughtMarkdown || "사고 요약 스트림 수신 중..."}
              </pre>
            </details>
            <details>
              <summary>채점 응답 스트림</summary>
              <pre className="quiz-stream-pre">
                {gradingInsight.answerMarkdown || "채점 결과 생성 중..."}
              </pre>
            </details>
          </div>
        ) : null}
        <div className="modal-head quiz-modal-head">
          <h3 id="quiz-modal-title">{quiz.title ?? `${quiz.page}페이지 퀴즈`}</h3>
          <button
            className="btn ghost"
            type="button"
            aria-label="퀴즈 모달 닫기"
            disabled={!canClose}
            onClick={onClose}
          >
            X
          </button>
        </div>

        <div className="quiz-modal-scroll">
          <div className="modal-body quiz-modal-body">
            {quiz.questions.map((question) => {
              const grading = gradingMap.get(question.id);
              if (quiz.quizType === "MCQ") {
                return (
                  <McqRenderer
                    key={question.id}
                    question={question}
                    value={getStringAnswer(displayAnswers, question.id)}
                    onChange={(value) => updateAnswer(question.id, value)}
                    grading={grading}
                    disabled={controlsLocked}
                    answerUnavailable={isAnswerUnavailable(question.id)}
                  />
                );
              }
              if (quiz.quizType === "OX") {
                return (
                  <OxRenderer
                    key={question.id}
                    question={question}
                    value={getBooleanAnswer(displayAnswers, question.id)}
                    onChange={(value) => updateAnswer(question.id, value)}
                    grading={grading}
                    disabled={controlsLocked}
                    answerUnavailable={isAnswerUnavailable(question.id)}
                  />
                );
              }
              if (quiz.quizType === "SHORT") {
                return (
                  <ShortRenderer
                    key={question.id}
                    question={question}
                    value={getStringAnswer(displayAnswers, question.id)}
                    onChange={(value) => updateAnswer(question.id, value)}
                    grading={grading}
                    readOnly={controlsLocked}
                    answerUnavailable={isAnswerUnavailable(question.id)}
                  />
                );
              }
              return (
                <EssayRenderer
                  key={question.id}
                  question={question}
                  value={getStringAnswer(displayAnswers, question.id)}
                  onChange={(value) => updateAnswer(question.id, value)}
                  grading={grading}
                  readOnly={controlsLocked}
                  answerUnavailable={isAnswerUnavailable(question.id)}
                />
              );
            })}
          </div>

          <div className="quiz-modal-footer">
            {record?.grading ? (
              <div
                className={`card quiz-result-panel ${
                  getEffectiveScoreRatio(record.grading) >= getSafePassScoreRatio(passScoreRatio)
                    ? "quiz-result-panel-passed"
                    : "quiz-result-panel-review"
                }`}
                aria-live="polite"
              >
                <div className="quiz-result-head">
                  <span className="quiz-result-eyebrow">최종 점수</span>
                  <span className="quiz-result-status">
                    {getEffectiveScoreRatio(record.grading) >= getSafePassScoreRatio(passScoreRatio)
                      ? "통과"
                      : "보완 필요"}
                  </span>
                </div>
                <div className="quiz-result-score">
                  <strong>{Math.round(getEffectiveScoreRatio(record.grading) * 100)}점</strong>
                  <span>
                    총점 {record.grading.score}/{record.grading.maxScore}
                  </span>
                </div>
                <QuizMarkdown className="quiz-result-summary">
                  {record.grading.summaryMarkdown}
                </QuizMarkdown>
              </div>
            ) : null}

            {!allAnswered && !alreadyGraded ? (
              <div className="text-muted" aria-live="polite">
                모든 문항에 답변하면 채점 버튼이 활성화됩니다.
              </div>
            ) : null}
            {error ? <div className="form-error" role="alert">{error}</div> : null}

            <div className="quiz-modal-actions">
              <button
                className="btn"
                type="button"
                onClick={submit}
                disabled={!allAnswered || loading || alreadyGraded}
              >
                {alreadyGraded ? "채점 완료" : loading ? "채점 중..." : "채점하기"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
