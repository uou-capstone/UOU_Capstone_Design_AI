import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ChatMessage, QuizType } from "../../types";
import { BinaryChoice } from "./widgets/BinaryChoice";
import { QuizTypePicker } from "./widgets/QuizTypePicker";

const markdownRemarkPlugins = [remarkGfm, remarkMath];
const markdownRehypePlugins = [rehypeKatex];

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

export const ChatBubble = memo(function ChatBubble({ message, onQuizTypeSelect, onBinaryDecision }: Props) {
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
      className={`chat-bubble fade-in ${isUser ? "user" : `agent-${message.agent.toLowerCase()}`}`}
    >
      {!isUser ? (
        <div className="chat-agent-label">{message.agent}</div>
      ) : null}
      {message.thoughtSummaryMarkdown ? (
        <details
          className="thought-summary-toggle"
          open={thoughtOpen}
          onToggle={(event) => setThoughtOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            사고 요약 보기
          </summary>
          <div className="thought-summary-body">
            <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={markdownRehypePlugins}>
              {message.thoughtSummaryMarkdown}
            </ReactMarkdown>
          </div>
        </details>
      ) : null}
      <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={markdownRehypePlugins}>
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
});
