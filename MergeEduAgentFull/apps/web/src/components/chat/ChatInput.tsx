import { FormEvent, useState } from "react";

interface Props {
  disabled?: boolean;
  onSend: (text: string) => Promise<void>;
}

export function ChatInput({ disabled, onSend }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || loading || disabled) return;

    setLoading(true);
    try {
      await onSend(text.trim());
      setText("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button type="button" className="btn ghost" title="attach" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 11.5L12.7 19.8a6 6 0 11-8.5-8.5l9.2-9.2a4 4 0 115.7 5.6L9.9 16.9a2 2 0 11-2.8-2.8l8.5-8.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <input
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="질문 또는 요청을 입력하세요"
        style={{ flex: 1 }}
        disabled={loading || disabled}
      />
      <button type="submit" className="btn" disabled={loading || disabled}>
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
    </form>
  );
}
