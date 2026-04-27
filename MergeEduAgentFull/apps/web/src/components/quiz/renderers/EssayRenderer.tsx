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
  readOnly?: boolean;
  answerUnavailable?: boolean;
}

export function EssayRenderer({
  question,
  value,
  onChange,
  grading,
  readOnly = false,
  answerUnavailable = false
}: Props) {
  const promptId = `essay-prompt-${question.id}`;
  const inputId = `essay-answer-${question.id}`;
  const feedbackId = `quiz-feedback-${question.id}`;
  const presentation = grading ? getGradingPresentation(grading.verdict) : null;

  return (
    <div className={getQuestionCardClassName(grading)}>
      <div className="quiz-question-topline">
        <div id={promptId} className="quiz-question-prompt">
          <QuizMarkdown>
            {question.promptMarkdown}
          </QuizMarkdown>
        </div>
        {grading ? <QuizGradingBadge grading={grading} /> : null}
      </div>
      <label id={`${inputId}-label`} className="sr-only" htmlFor={inputId}>
        서술형 답안
      </label>
      <textarea
        id={inputId}
        className={[
          "quiz-answer",
          "quiz-answer-textarea",
          grading ? "quiz-answer-graded" : "",
          presentation ? presentation.answerClass : ""
        ].filter(Boolean).join(" ")}
        value={value ?? ""}
        aria-labelledby={`${inputId}-label ${promptId}`}
        aria-describedby={grading ? feedbackId : undefined}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        placeholder="서술형 답안을 입력하세요"
      />
      {answerUnavailable ? <div className="text-muted quiz-answer-unavailable">제출 답안을 불러올 수 없습니다.</div> : null}
      {grading ? <QuizFeedback id={feedbackId} grading={grading} /> : null}
    </div>
  );
}
