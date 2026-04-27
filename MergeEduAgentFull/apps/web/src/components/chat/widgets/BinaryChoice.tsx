import { useState } from "react";

interface Props {
  onDecision: (accept: boolean) => void;
}

export function BinaryChoice({ onDecision }: Props) {
  const [locked, setLocked] = useState(false);

  const decide = (accept: boolean) => {
    if (locked) return;
    setLocked(true);
    onDecision(accept);
  };

  return (
    <div className="widget-actions">
      <button className="btn" onClick={() => decide(true)} disabled={locked}>
        예
      </button>
      <button className="btn ghost" onClick={() => decide(false)} disabled={locked}>
        아니오
      </button>
    </div>
  );
}
