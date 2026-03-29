import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ChatMessage, QuizType } from "../../types";
import { BinaryChoice } from "./widgets/BinaryChoice";
import { QuizTypePicker } from "./widgets/QuizTypePicker";

const colorByAgent: Record<string, string> = {
  ORCHESTRATOR: "linear-gradient(130deg, #1f4d71, #285981)",
  EXPLAINER: "linear-gradient(130deg, #0e6655, #167d66)",
  QA: "linear-gradient(130deg, #364f6b, #425d7a)",
  QUIZ: "linear-gradient(130deg, #7b3f00, #8c4f0f)",
  GRADER: "linear-gradient(130deg, #5c2e91, #7742af)",
  SYSTEM: "linear-gradient(130deg, #334155, #475569)"
};

interface Props {
  message: ChatMessage;
  onQuizTypeSelect: (quizType: QuizType) => void;
  onBinaryDecision: (
    messageId: string,
    decisionType:
      | "START_EXPLANATION_DECISION"
      | "QUIZ_DECISION"
      | "NEXT_PAGE_DECISION"
      | "REVIEW_DECISION"
      | "RETEST_DECISION",
    accept: boolean
  ) => void;
}

export function ChatBubble({ message, onQuizTypeSelect, onBinaryDecision }: Props) {
  const isUser = message.role === "user";
  const isStreamingMessage = message.id.startsWith("stream_");
  const hasThought = Boolean(message.thoughtSummaryMarkdown?.trim());
  const answerReady = useMemo(() => {
    const normalized = message.contentMarkdown.trim();
    if (!normalized) return false;
    return (
      normalized !== "_응답 생성 중..._" &&
      normalized !== "_사고 요약 스트리밍 중..._"
    );
  }, [message.contentMarkdown]);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const autoCollapsedRef = useRef(false);

  useEffect(() => {
    if (!hasThought) {
      setThoughtOpen(false);
      autoCollapsedRef.current = false;
      return;
    }
    if (!isStreamingMessage) {
      setThoughtOpen(false);
      autoCollapsedRef.current = false;
      return;
    }
    if (!answerReady) {
      setThoughtOpen(true);
      return;
    }
    if (!autoCollapsedRef.current) {
      setThoughtOpen(false);
      autoCollapsedRef.current = true;
    }
  }, [answerReady, hasThought, isStreamingMessage, message.id]);

  return (
    <div
      className="fade-in"
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "92%",
        padding: 12,
        borderRadius: 14,
        background: isUser ? "linear-gradient(130deg, #1f8b4c, #3aaa66)" : colorByAgent[message.agent],
        color: "#f3f8ff"
      }}
    >
      {!isUser ? (
        <div style={{ fontSize: 12, opacity: 0.92, marginBottom: 6 }}>{message.agent}</div>
      ) : null}
      {message.thoughtSummaryMarkdown ? (
        <details
          className="thought-summary-toggle"
          style={{ marginBottom: 10 }}
          open={thoughtOpen}
          onToggle={(event) => setThoughtOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            사고 요약 보기
          </summary>
          <div style={{ marginTop: 8, padding: 8, borderRadius: 10, background: "rgba(255,255,255,0.12)" }}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {message.thoughtSummaryMarkdown}
            </ReactMarkdown>
          </div>
        </details>
      ) : null}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {message.contentMarkdown}
      </ReactMarkdown>
      {message.widget?.type === "QUIZ_TYPE_PICKER" && message.widget.options ? (
        <QuizTypePicker
          options={message.widget.options}
          recommendedId={message.widget.recommendedId}
          badgeText={message.widget.badgeText}
          onSelect={onQuizTypeSelect}
        />
      ) : null}
      {message.widget?.type === "BINARY_CHOICE" && message.widget.decisionType ? (
        <BinaryChoice
          onDecision={(accept) => onBinaryDecision(message.id, message.widget!.decisionType!, accept)}
        />
      ) : null}
    </div>
  );
}
