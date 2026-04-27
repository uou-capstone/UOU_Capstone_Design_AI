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
  value?: string;
  onChange: (value: string) => void;
  grading?: GradingItem;
  disabled?: boolean;
  answerUnavailable?: boolean;
}

export function McqRenderer({
  question,
  value,
  onChange,
  grading,
  disabled = false,
  answerUnavailable = false
}: Props) {
  const groupName = `quiz-mcq-${question.id}`;
  const promptId = `mcq-prompt-${question.id}`;
  const feedbackId = `quiz-feedback-${question.id}`;
  const presentation = grading ? getGradingPresentation(grading.verdict) : null;
  const choices = (question.choices ?? []).map((choice, index) => ({
    id: choice.id ?? `c${index + 1}`,
    textMarkdown: choice.textMarkdown ?? (choice as unknown as { text?: string }).text ?? `(선택지 ${index + 1})`
  }));
  const selectedChoice = choices.find((choice) => choice.id === value);

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
        className="quiz-options quiz-options-fieldset"
        aria-labelledby={promptId}
        aria-describedby={grading ? feedbackId : undefined}
      >
        <legend className="sr-only">객관식 선택지</legend>
        {choices.map((choice) => (
          <label
            key={choice.id}
            className={[
              "quiz-choice",
              value === choice.id ? "quiz-choice-selected" : "",
              value === choice.id && presentation ? presentation.selectedClass : ""
            ].filter(Boolean).join(" ")}
          >
            <input
              type="radio"
              name={groupName}
              checked={value === choice.id}
              disabled={disabled}
              onChange={() => onChange(choice.id)}
              aria-describedby={value === choice.id && grading ? feedbackId : undefined}
            />
            <QuizMarkdown className="quiz-choice-copy">
              {choice.textMarkdown}
            </QuizMarkdown>
          </label>
        ))}
        {choices.length === 0 ? (
          <div className="text-muted">
            선택지가 생성되지 않았습니다. 다시 생성해 주세요.
          </div>
        ) : null}
      </fieldset>
      {answerUnavailable ? <div className="text-muted quiz-answer-unavailable">제출 답안을 불러올 수 없습니다.</div> : null}
      {grading && selectedChoice ? (
        <div className="quiz-selected-answer-summary">
          <strong>선택한 답안</strong>
          <QuizMarkdown className="quiz-selected-answer-copy">
            {selectedChoice.textMarkdown}
          </QuizMarkdown>
        </div>
      ) : null}
      {grading ? <QuizFeedback id={feedbackId} grading={grading} /> : null}
    </div>
  );
}
