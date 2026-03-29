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

export function EssayRenderer({ question, value, onChange, grading }: Props) {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {question.promptMarkdown}
      </ReactMarkdown>
      <textarea
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        placeholder="서술형 답안을 입력하세요"
        style={{ width: "100%" }}
      />
      {grading ? (
        <div style={{ marginTop: 8, color: "#ffd166" }}>
          {grading.verdict} ({grading.score}/{grading.maxScore}) - {grading.feedbackMarkdown}
        </div>
      ) : null}
    </div>
  );
}
