import { AppEvent, SessionState } from "../../types/domain.js";
import { appendMessage, ensurePageState, nowIso } from "./utils.js";

function isNextPageCommand(text: string): boolean {
  return /(다음\s*페이지|다음으로|넘어가|다음\s*슬라이드|next\s*page|next\b)/i.test(text);
}

export class StateReducer {
  reduce(state: SessionState, event: AppEvent, clientPage?: number): SessionState {
    const next: SessionState = structuredClone(state);

    if (typeof clientPage === "number" && Number.isFinite(clientPage) && clientPage > 0) {
      next.currentPage = Math.floor(clientPage);
      ensurePageState(next, next.currentPage).lastTouchedAt = nowIso();
    }

    switch (event.type) {
      case "SESSION_ENTERED": {
        const pageState = ensurePageState(next, next.currentPage);
        pageState.lastTouchedAt = nowIso();
        if (pageState.status === "DONE") {
          pageState.status = "EXPLAINED";
        }
        break;
      }
      case "START_EXPLANATION_DECISION": {
        const accept = Boolean(event.payload?.accept);
        const pageState = ensurePageState(next, next.currentPage);
        pageState.lastTouchedAt = nowIso();
        if (accept) {
          if (pageState.status === "NEW" || pageState.status === "DONE") {
            pageState.status = "EXPLAINING";
          }
        } else if (pageState.status === "EXPLAINING") {
          pageState.status = "NEW";
        }
        break;
      }
      case "USER_MESSAGE": {
        const text = String(event.payload?.text ?? "").trim();
        if (text) {
          appendMessage(next, {
            role: "user",
            agent: "SYSTEM",
            contentMarkdown: text
          });
          if (isNextPageCommand(text)) {
            next.currentPage += 1;
            const pageState = ensurePageState(next, next.currentPage);
            pageState.lastTouchedAt = nowIso();
            if (pageState.status === "NEW") {
              pageState.status = "EXPLAINING";
            }
          }
        }
        break;
      }
      case "PAGE_CHANGED": {
        const page = Number(event.payload?.page);
        if (Number.isFinite(page) && page > 0) {
          next.currentPage = Math.floor(page);
          const pageState = ensurePageState(next, next.currentPage);
          pageState.lastTouchedAt = nowIso();
          if (pageState.status === "NEW") {
            pageState.status = "EXPLAINING";
          }
        }
        break;
      }
      case "QUIZ_DECISION": {
        const accept = Boolean(event.payload?.accept);
        const pageState = ensurePageState(next, next.currentPage);
        pageState.status = accept ? "QUIZ_TYPE_PENDING" : "EXPLAINED";
        pageState.lastTouchedAt = nowIso();
        break;
      }
      case "QUIZ_TYPE_SELECTED": {
        const pageState = ensurePageState(next, next.currentPage);
        pageState.status = "QUIZ_IN_PROGRESS";
        pageState.lastTouchedAt = nowIso();
        break;
      }
      case "NEXT_PAGE_DECISION": {
        const accept = Boolean(event.payload?.accept);
        if (accept) {
          const fromPageRaw = Number(event.payload?.fromPage);
          const fromPage =
            Number.isFinite(fromPageRaw) && fromPageRaw > 0
              ? Math.floor(fromPageRaw)
              : next.currentPage;
          next.currentPage = fromPage + 1;
          const nextPageState = ensurePageState(next, next.currentPage);
          nextPageState.lastTouchedAt = nowIso();
          if (nextPageState.status === "NEW") {
            nextPageState.status = "EXPLAINING";
          }
        } else {
          const pageState = ensurePageState(next, next.currentPage);
          pageState.lastTouchedAt = nowIso();
        }
        break;
      }
      case "QUIZ_SUBMITTED": {
        const pageState = ensurePageState(next, next.currentPage);
        pageState.status = "QUIZ_GRADED";
        pageState.lastTouchedAt = nowIso();
        break;
      }
      case "REVIEW_DECISION": {
        const accept = Boolean(event.payload?.accept);
        const pageState = ensurePageState(next, next.currentPage);
        pageState.status = accept ? "REVIEW_IN_PROGRESS" : "DONE";
        pageState.lastTouchedAt = nowIso();
        break;
      }
      case "RETEST_DECISION": {
        const accept = Boolean(event.payload?.accept);
        const pageState = ensurePageState(next, next.currentPage);
        pageState.status = accept ? "QUIZ_IN_PROGRESS" : "DONE";
        pageState.lastTouchedAt = nowIso();
        break;
      }
      case "SAVE_AND_EXIT": {
        next.updatedAt = nowIso();
        break;
      }
      default:
        break;
    }

    next.updatedAt = nowIso();
    return next;
  }
}
