import { ChatMessage, PageState, SessionState } from "../../types/domain.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function ensurePageState(state: SessionState, page: number): PageState {
  let pageState = state.pageStates.find((p) => p.page === page);
  if (!pageState) {
    pageState = {
      page,
      status: "NEW",
      lastTouchedAt: nowIso()
    };
    state.pageStates.push(pageState);
  }
  return pageState;
}

export function appendMessage(state: SessionState, message: Omit<ChatMessage, "id" | "createdAt">): ChatMessage {
  const item: ChatMessage = {
    ...message,
    id: makeId("msg"),
    createdAt: nowIso()
  };
  state.messages.push(item);
  state.updatedAt = nowIso();
  return item;
}

export function progressText(page: number): string {
  return `~${page}페이지까지 진행`;
}
