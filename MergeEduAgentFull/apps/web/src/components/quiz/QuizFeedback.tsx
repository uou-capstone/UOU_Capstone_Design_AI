import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import type { ReactNode } from "react";
import { GradingItem } from "../../types";

type GradingTone = "correct" | "wrong" | "partial";

interface GradingPresentation {
  tone: GradingTone;
  label: string;
  symbol: string;
  cardClass: string;
  answerClass: string;
  selectedClass: string;
  badgeClass: string;
  ariaLabel: string;
}

function toMarkdownString(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toMarkdownString).join("");
  return "";
}

export function QuizMarkdown({
  children,
  className
}: {
  children?: ReactNode;
  className?: string;
}) {
  const markdown = toMarkdownString(children);
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function getGradingPresentation(verdict: GradingItem["verdict"]): GradingPresentation {
  if (verdict === "CORRECT") {
    return {
      tone: "correct",
      label: "정답",
      symbol: "O",
      cardClass: "quiz-question-card-correct",
      answerClass: "quiz-answer-correct",
      selectedClass: "quiz-choice-correct",
      badgeClass: "quiz-grading-badge-correct",
      ariaLabel: "채점 결과: 정답"
    };
  }

  if (verdict === "PARTIAL") {
    return {
      tone: "partial",
      label: "부분 정답",
      symbol: "△",
      cardClass: "quiz-question-card-partial",
      answerClass: "quiz-answer-partial",
      selectedClass: "quiz-choice-partial",
      badgeClass: "quiz-grading-badge-partial",
      ariaLabel: "채점 결과: 부분 정답"
    };
  }

  return {
    tone: "wrong",
    label: "오답",
    symbol: "X",
    cardClass: "quiz-question-card-wrong",
    answerClass: "quiz-answer-wrong",
    selectedClass: "quiz-choice-wrong",
    badgeClass: "quiz-grading-badge-wrong",
    ariaLabel: "채점 결과: 오답"
  };
}

export function getQuestionCardClassName(grading?: GradingItem) {
  if (!grading) return "card quiz-question-card";
  const presentation = getGradingPresentation(grading.verdict);
  return `card quiz-question-card quiz-question-card-graded ${presentation.cardClass}`;
}

export function QuizFeedback({
  grading,
  id
}: {
  grading: GradingItem;
  id: string;
}) {
  const presentation = getGradingPresentation(grading.verdict);

  return (
    <div
      id={id}
      className={`quiz-feedback quiz-feedback-${presentation.tone}`}
    >
      <QuizMarkdown className="quiz-feedback-copy">
        {grading.feedbackMarkdown}
      </QuizMarkdown>
    </div>
  );
}

export function QuizGradingBadge({ grading }: { grading: GradingItem }) {
  const presentation = getGradingPresentation(grading.verdict);

  return (
    <span
      className={`quiz-grading-badge ${presentation.badgeClass}`}
      aria-label={presentation.ariaLabel}
    >
      <span aria-hidden="true">{presentation.symbol}</span>
      <span>{presentation.label}</span>
    </span>
  );
}
