import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { GradingItem, QuizQuestion } from "../../../types";

interface Props {
  question: QuizQuestion;
  value?: string;
  onChange: (value: string) => void;
  grading?: GradingItem;
}

export function McqRenderer({ question, value, onChange, grading }: Props) {
  const choices = (question.choices ?? []).map((choice, index) => ({
    id: choice.id ?? `c${index + 1}`,
    textMarkdown: choice.textMarkdown ?? (choice as unknown as { text?: string }).text ?? `(선택지 ${index + 1})`
  }));

  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {question.promptMarkdown || (question as unknown as { prompt?: string }).prompt || "문항"}
      </ReactMarkdown>
      <div style={{ display: "grid", gap: 6 }}>
        {choices.map((choice) => (
          <label key={choice.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="radio"
              checked={value === choice.id}
              onChange={() => onChange(choice.id)}
            />
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {choice.textMarkdown}
            </ReactMarkdown>
          </label>
        ))}
        {choices.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            선택지가 생성되지 않았습니다. 다시 생성해 주세요.
          </div>
        ) : null}
      </div>
      {grading ? (
        <div style={{ marginTop: 8, color: "#ffd166" }}>
          {grading.verdict} ({grading.score}/{grading.maxScore}) - {grading.feedbackMarkdown}
        </div>
      ) : null}
    </div>
  );
}
