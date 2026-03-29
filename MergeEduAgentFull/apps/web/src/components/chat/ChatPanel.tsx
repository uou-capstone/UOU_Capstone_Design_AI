import { useEffect, useRef } from "react";
import { ChatMessage, QuizType } from "../../types";
import { ChatBubble } from "./ChatBubble";

interface Props {
  messages: ChatMessage[];
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

export function ChatPanel({ messages, onQuizTypeSelect, onBinaryDecision }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rafId = requestAnimationFrame(() => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ block: "end" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [messages]);

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", overflow: "auto", paddingBottom: 10 }}
    >
      {messages.map((message) => (
        <ChatBubble
          key={message.id}
          message={message}
          onQuizTypeSelect={onQuizTypeSelect}
          onBinaryDecision={onBinaryDecision}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
