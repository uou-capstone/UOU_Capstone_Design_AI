import { GradingItem, QuizQuestion } from "../../../types";
import {
  getGradingPresentation,
  getQuestionCardClassName,
  QuizFeedback,
  QuizGradingBadge,
  QuizMarkdown
} from "../QuizFeedback";

interface Props {
  question: QuizQuestion;
  value?: boolean;
  onChange: (value: boolean) => void;
  grading?: GradingItem;
  disabled?: boolean;
  answerUnavailable?: boolean;
}

export function OxRenderer({
  question,
  value,
  onChange,
  grading,
  disabled = false,
  answerUnavailable = false
}: Props) {
  const promptId = `ox-prompt-${question.id}`;
  const feedbackId = `quiz-feedback-${question.id}`;
  const presentation = grading ? getGradingPresentation(grading.verdict) : null;

  const choiceClassName = (choiceValue: boolean) =>
    [
      "quiz-ox-choice",
      value === choiceValue ? "active quiz-choice-selected" : "",
      value === choiceValue && presentation ? presentation.selectedClass : ""
    ].filter(Boolean).join(" ");

  return (
    <div className={getQuestionCardClassName(grading)}>
      <div className="quiz-question-topline">
        <div id={promptId} className="quiz-question-prompt">
          <QuizMarkdown>
            {question.promptMarkdown || (question as unknown as { prompt?: string }).prompt || "문항"}
          </QuizMarkdown>
        </div>
        {grading ? <QuizGradingBadge grading={grading} /> : null}
      </div>
      <fieldset
        className="quiz-ox-options"
        aria-labelledby={promptId}
        aria-describedby={grading ? feedbackId : undefined}
      >
        <legend>정답 선택</legend>
        <label className={choiceClassName(true)}>
          <input
            type="radio"
            name={`quiz-ox-${question.id}`}
            checked={value === true}
            disabled={disabled}
            onChange={() => onChange(true)}
            aria-describedby={value === true && grading ? feedbackId : undefined}
          />
          <span>O</span>
        </label>
        <label className={choiceClassName(false)}>
          <input
            type="radio"
            name={`quiz-ox-${question.id}`}
            checked={value === false}
            disabled={disabled}
            onChange={() => onChange(false)}
            aria-describedby={value === false && grading ? feedbackId : undefined}
          />
          <span>X</span>
        </label>
      </fieldset>
      {answerUnavailable ? <div className="text-muted quiz-answer-unavailable">제출 답안을 불러올 수 없습니다.</div> : null}
      {grading && typeof value === "boolean" ? (
        <div className="quiz-selected-answer-summary quiz-selected-answer-summary-compact">
          <strong>선택한 답안</strong>
          <span>{value ? "O" : "X"}</span>
        </div>
      ) : null}
      {grading ? <QuizFeedback id={feedbackId} grading={grading} /> : null}
    </div>
  );
}
