import { QuizType } from "../../../types";

interface Props {
  options: { id: QuizType; label: string }[];
  recommendedId?: string;
  badgeText?: string;
  onSelect: (quizType: QuizType) => void;
}

export function QuizTypePicker({ options, recommendedId, badgeText, onSelect }: Props) {
  const getIconLabel = (id: QuizType) => {
    if (id === "MCQ") return "MC";
    if (id === "OX") return "O";
    if (id === "SHORT") return "A";
    return "E";
  };

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
            <span className="quiz-type-icon" aria-hidden="true">
              {getIconLabel(option.id)}
            </span>
            <span className="quiz-type-label">{option.label}</span>
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
