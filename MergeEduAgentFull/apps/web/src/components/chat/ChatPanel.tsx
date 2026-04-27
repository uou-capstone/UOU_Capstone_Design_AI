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
  const pinnedToBottomRef = useRef(true);

  const lastMessage = messages[messages.length - 1];
  const scrollSignature = lastMessage
    ? `${messages.length}:${lastMessage.id}:${lastMessage.contentMarkdown.length}:${lastMessage.thoughtSummaryMarkdown?.length ?? 0}`
    : "empty";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!pinnedToBottomRef.current) return;
    const rafId = requestAnimationFrame(() => {
      if (!pinnedToBottomRef.current) return;
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ block: "end" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [scrollSignature]);

  return (
    <div
      ref={containerRef}
      onScroll={(event) => {
        const target = event.currentTarget;
        const distanceFromBottom =
          target.scrollHeight - target.scrollTop - target.clientHeight;
        pinnedToBottomRef.current = distanceFromBottom < 80;
      }}
      className="chat-panel"
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
