import { QuizType } from "../../../types";

interface Props {
  options: { id: QuizType; label: string }[];
  recommendedId?: string;
  badgeText?: string;
  onSelect: (quizType: QuizType) => void;
}

export function QuizTypePicker({ options, recommendedId, badgeText, onSelect }: Props) {
  return (
    <div className="quiz-type-grid">
      {options.map((option) => {
        const recommended = option.id === recommendedId;
        return (
          <button
            key={option.id}
            className={`btn ghost quiz-type-option ${recommended ? "recommended" : ""}`}
            onClick={() => onSelect(option.id)}
          >
            {option.label}
            {recommended && badgeText ? (
              <span className="quiz-recommended-badge">
                {badgeText}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
