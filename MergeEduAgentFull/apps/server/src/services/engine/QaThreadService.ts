import { QaThreadMemory, QaThreadMode, SessionState } from "../../types/domain.js";

const MAX_QA_THREAD_TURNS = 6;

export function createInitialQaThreadMemory(): QaThreadMemory {
  return {
    page: null,
    turns: [],
    lastUpdatedAt: new Date().toISOString()
  };
}

export function hasActiveQaThreadForPage(state: SessionState, page: number): boolean {
  return Boolean(
    state.qaThread &&
      state.qaThread.page === page &&
      Array.isArray(state.qaThread.turns) &&
      state.qaThread.turns.length > 0
  );
}

export function resetQaThread(state: SessionState, page: number | null = null): void {
  state.qaThread = {
    page,
    turns: [],
    lastUpdatedAt: new Date().toISOString()
  };
}

export function buildQaThreadDigest(state: SessionState, page: number): string {
  if (!hasActiveQaThreadForPage(state, page)) {
    return "";
  }

  return (state.qaThread?.turns ?? [])
    .slice(-MAX_QA_THREAD_TURNS)
    .map(
      (turn, index) =>
        `이전 질문 ${index + 1}: ${turn.question}\n이전 답변 ${index + 1}: ${turn.answerMarkdown}`
    )
    .join("\n\n");
}

export function appendQaThreadTurn(
  state: SessionState,
  input: {
    page: number;
    question: string;
    answerMarkdown: string;
    threadMode: QaThreadMode;
  }
): void {
  const shouldReset =
    input.threadMode === "START_NEW" ||
    !state.qaThread ||
    state.qaThread.page !== input.page;

  if (shouldReset) {
    resetQaThread(state, input.page);
  }

  const current = state.qaThread ?? createInitialQaThreadMemory();
  current.page = input.page;
  current.turns = [
    ...current.turns,
    {
      page: input.page,
      question: input.question.trim(),
      answerMarkdown: input.answerMarkdown.trim(),
      createdAt: new Date().toISOString()
    }
  ].slice(-MAX_QA_THREAD_TURNS);
  current.lastUpdatedAt = new Date().toISOString();
  state.qaThread = current;
}
