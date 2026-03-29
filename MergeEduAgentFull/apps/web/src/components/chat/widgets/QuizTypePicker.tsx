import { QuizType } from "../../../types";

interface Props {
  options: { id: QuizType; label: string }[];
  recommendedId?: string;
  badgeText?: string;
  onSelect: (quizType: QuizType) => void;
}

export function QuizTypePicker({ options, recommendedId, badgeText, onSelect }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, marginTop: 10 }}>
      {options.map((option) => {
        const recommended = option.id === recommendedId;
        return (
          <button
            key={option.id}
            className="btn ghost"
            style={{
              position: "relative",
              border: recommended ? "1px solid var(--accent)" : undefined,
              boxShadow: recommended ? "0 0 16px rgba(255,183,3,0.65)" : undefined,
              animation: recommended ? "fadeIn 0.6s ease-out" : undefined
            }}
            onClick={() => onSelect(option.id)}
          >
            {option.label}
            {recommended && badgeText ? (
              <span
                style={{
                  position: "absolute",
                  top: -8,
                  right: -6,
                  fontSize: 11,
                  background: "var(--accent)",
                  color: "#3d2a00",
                  borderRadius: 999,
                  padding: "2px 6px"
                }}
              >
                {badgeText}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
