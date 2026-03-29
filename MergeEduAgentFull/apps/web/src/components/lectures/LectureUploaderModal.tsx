import { FormEvent, useCallback, useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; file: File }) => Promise<void>;
}

export function LectureUploaderModal({ open, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const closeModal = useCallback(() => {
    if (loading) return;
    setTitle("");
    setFile(null);
    setError("");
    onClose();
  }, [loading, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeModal]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !file) {
      setError("강의 이름과 PDF 파일을 입력해 주세요.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("PDF 파일만 업로드 가능합니다.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await onSubmit({ title: title.trim(), file });
      setTitle("");
      setFile(null);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "업로드 실패";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
    >
      <div className="card modal">
        <h3>세부 강의 추가</h3>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <input
            className="input"
            placeholder="강의 이름"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="input"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {error ? <div style={{ color: "#ff9ca5" }}>{error}</div> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={closeModal} disabled={loading}>
              취소
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? "업로드 중..." : "업로드"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
