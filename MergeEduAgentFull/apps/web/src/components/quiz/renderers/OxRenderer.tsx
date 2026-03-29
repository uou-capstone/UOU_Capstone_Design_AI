import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { GradingItem, QuizQuestion } from "../../../types";

interface Props {
  question: QuizQuestion;
  value?: boolean;
  onChange: (value: boolean) => void;
  grading?: GradingItem;
}

export function OxRenderer({ question, value, onChange, grading }: Props) {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {question.promptMarkdown || (question as unknown as { prompt?: string }).prompt || "문항"}
      </ReactMarkdown>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn ghost" onClick={() => onChange(true)} style={{ border: value === true ? "1px solid var(--accent)" : undefined }}>
          O
        </button>
        <button className="btn ghost" onClick={() => onChange(false)} style={{ border: value === false ? "1px solid var(--accent)" : undefined }}>
          X
        </button>
      </div>
      {grading ? (
        <div style={{ marginTop: 8, color: "#ffd166" }}>
          {grading.verdict} ({grading.score}/{grading.maxScore}) - {grading.feedbackMarkdown}
        </div>
      ) : null}
    </div>
  );
}
