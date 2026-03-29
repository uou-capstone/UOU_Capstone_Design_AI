import { useMemo, useState } from "react";
import { GradingItem, QuizJson, QuizRecord } from "../../types";
import { EssayRenderer } from "./renderers/EssayRenderer";
import { McqRenderer } from "./renderers/McqRenderer";
import { OxRenderer } from "./renderers/OxRenderer";
import { ShortRenderer } from "./renderers/ShortRenderer";

interface Props {
  open: boolean;
  quiz: QuizJson | null;
  disableClose: boolean;
  gradedRecord?: QuizRecord;
  gradingInsight?: {
    open: boolean;
    thoughtMarkdown: string;
    answerMarkdown: string;
  };
  onCloseInsight?: () => void;
  onClose: () => void;
  onSubmit: (quizId: string, quizType: string, answers: Record<string, unknown>) => Promise<QuizRecord | undefined>;
}

export function QuizModal({
  open,
  quiz,
  disableClose,
  gradedRecord,
  gradingInsight,
  onCloseInsight,
  onClose,
  onSubmit
}: Props) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localRecord, setLocalRecord] = useState<QuizRecord | undefined>();

  const record = localRecord ?? gradedRecord;
  const gradingMap = useMemo(() => {
    const map = new Map<string, GradingItem>();
    record?.grading?.items.forEach((item) => map.set(item.questionId, item));
    return map;
  }, [record]);

  if (!open || !quiz) return null;

  const allAnswered = quiz.questions.every((q) => {
    const value = answers[q.id];
    if (quiz.quizType === "MCQ") return typeof value === "string";
    if (quiz.quizType === "OX") return typeof value === "boolean";
    return typeof value === "string" && value.trim().length > 0;
  });

  const canClose = !disableClose;
  const alreadyGraded = record?.grading?.status === "GRADED";

  const submit = async () => {
    if (!allAnswered) {
      setError("모든 문항에 답변한 뒤 채점할 수 있습니다.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await onSubmit(quiz.quizId, quiz.quizType, answers);
      setLocalRecord(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "채점 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="card modal">
        {gradingInsight?.open ? (
          <div className="card grading-insight-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong>채점 에이전트 스트리밍</strong>
              <button className="btn ghost" onClick={onCloseInsight} type="button">
                닫기
              </button>
            </div>
            <details open style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>사고 요약 스트림</summary>
              <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontFamily: "inherit" }}>
                {gradingInsight.thoughtMarkdown || "사고 요약 스트림 수신 중..."}
              </pre>
            </details>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>채점 응답 스트림</summary>
              <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontFamily: "inherit" }}>
                {gradingInsight.answerMarkdown || "채점 결과 생성 중..."}
              </pre>
            </details>
          </div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{quiz.title ?? `${quiz.page}페이지 퀴즈`}</h3>
          <button className="btn ghost" disabled={!canClose} onClick={onClose}>
            X
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {quiz.questions.map((question) => {
            const grading = gradingMap.get(question.id);
            if (quiz.quizType === "MCQ") {
              return (
                <McqRenderer
                  key={question.id}
                  question={question}
                  value={answers[question.id] as string | undefined}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                  grading={grading}
                />
              );
            }
            if (quiz.quizType === "OX") {
              return (
                <OxRenderer
                  key={question.id}
                  question={question}
                  value={answers[question.id] as boolean | undefined}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                  grading={grading}
                />
              );
            }
            if (quiz.quizType === "SHORT") {
              return (
                <ShortRenderer
                  key={question.id}
                  question={question}
                  value={answers[question.id] as string | undefined}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                  grading={grading}
                />
              );
            }
            return (
              <EssayRenderer
                key={question.id}
                question={question}
                value={answers[question.id] as string | undefined}
                onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                grading={grading}
              />
            );
          })}
        </div>

        {record?.grading ? (
          <div className="card" style={{ padding: 12, marginTop: 8, borderColor: "var(--accent)" }}>
            <strong>
              총점 {record.grading.score}/{record.grading.maxScore}
            </strong>
            <p style={{ marginBottom: 0 }}>{record.grading.summaryMarkdown}</p>
          </div>
        ) : null}

        {error ? <div style={{ color: "#ff9ca5", marginTop: 8 }}>{error}</div> : null}

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={submit} disabled={loading || alreadyGraded}>
            {alreadyGraded ? "채점 완료" : loading ? "채점 중..." : "채점하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
