import { CompositionEvent, FormEvent, KeyboardEvent, useRef, useState } from "react";

interface Props {
  disabled?: boolean;
  onSend: (text: string) => Promise<void>;
}

export function ChatInput({ disabled, onSend }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submittingRef = useRef(false);
  const composingRef = useRef(false);

  const send = async () => {
    const submittedText = text.trim();
    if (!submittedText || submittingRef.current || disabled) return;

    submittingRef.current = true;
    setLoading(true);
    setText("");
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    try {
      await onSend(submittedText);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await send();
  };

  const handleKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent<HTMLTextAreaElement>["nativeEvent"] & {
      keyCode?: number;
    };
    const isComposing = nativeEvent.isComposing || nativeEvent.keyCode === 229 || composingRef.current;
    if (event.key !== "Enter" || event.shiftKey || isComposing) return;
    event.preventDefault();
    await send();
  };

  const handleCompositionStart = (_event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (_event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
  };

  return (
    <form onSubmit={submit} className="chat-input" aria-busy={loading}>
      <label className="sr-only" htmlFor="session-chat-input">
        질문 또는 요청
      </label>
      <textarea
        ref={textareaRef}
        id="session-chat-input"
        className="input chat-textarea"
        aria-label="질문 또는 요청"
        aria-busy={loading}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        placeholder="질문 또는 요청을 입력하세요"
        disabled={disabled}
        readOnly={loading}
        rows={1}
      />
      <button
        type="submit"
        className="btn"
        aria-label={loading ? "전송 중" : "전송"}
        disabled={loading || disabled}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M22 2L11 13"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M22 2L15 22L11 13L2 9L22 2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {loading ? "전송 중입니다" : ""}
      </span>
    </form>
  );
}
