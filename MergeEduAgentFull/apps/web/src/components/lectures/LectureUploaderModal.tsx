import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../ui/useDialogFocus";

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialogRef, backdropRef);

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

  return createPortal(
    <div
      ref={backdropRef}
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="card modal-panel upload-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lecture-upload-title"
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <h3 id="lecture-upload-title">강의 자료 업로드</h3>
            <p className="modal-subcopy">PDF 파일을 세부 강의 자료로 등록합니다.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-field">
            <label htmlFor="lecture-title">강의 이름</label>
            <input
              id="lecture-title"
              className="input"
              placeholder="예: 1주차 학습자료"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="lecture-file">PDF 파일</label>
            <div className="upload-dropzone">
              <span className="upload-dropzone-icon" aria-hidden="true">↑</span>
              <strong>PDF 파일 선택</strong>
              <span>강의 자료로 사용할 PDF만 업로드할 수 있습니다.</span>
              <input
                id="lecture-file"
                className="input"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? <span className="upload-file-chip">{file.name}</span> : null}
            </div>
          </div>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={closeModal} disabled={loading}>
              취소
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? "업로드 중..." : "업로드"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
