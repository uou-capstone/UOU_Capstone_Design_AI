import { AppEvent, QuizRecord, QuizType, SessionState } from "../../types/domain.js";
import { getPageCommandIntent } from "./PageCommandIntent.js";
import { resetQaThread } from "./QaThreadService.js";
import { appendMessage, ensurePageState, nowIso } from "./utils.js";

function clearActiveIntervention(state: SessionState): void {
  state.activeIntervention = null;
}

function findLatestQuizRecord(
  state: SessionState,
  quizId: string,
  quizType?: QuizType | string
): QuizRecord | undefined {
  for (let index = state.quizzes.length - 1; index >= 0; index -= 1) {
    const quiz = state.quizzes[index];
    if (quiz?.id !== quizId) continue;
    if (quizType && quiz.quizType !== quizType) continue;
    return quiz;
  }
  return undefined;
}

export class StateReducer {
  reduce(state: SessionState, event: AppEvent, clientPage?: number): SessionState {
    const next: SessionState = structuredClone(state);

    if (
      event.type !== "QUIZ_SUBMITTED" &&
      typeof clientPage === "number" &&
      Number.isFinite(clientPage) &&
      clientPage > 0
    ) {
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
          clearActiveIntervention(next);
          resetQaThread(next);
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
          const pageIntent = getPageCommandIntent(text);
          if (pageIntent) {
            next.currentPage =
              pageIntent === "NEXT" ? next.currentPage + 1 : Math.max(1, next.currentPage - 1);
            const pageState = ensurePageState(next, next.currentPage);
            pageState.lastTouchedAt = nowIso();
            if (pageState.status === "NEW") {
              pageState.status = "EXPLAINING";
            }
            clearActiveIntervention(next);
            resetQaThread(next);
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
          clearActiveIntervention(next);
          resetQaThread(next);
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
          clearActiveIntervention(next);
          resetQaThread(next);
        } else {
          const pageState = ensurePageState(next, next.currentPage);
          pageState.lastTouchedAt = nowIso();
        }
        break;
      }
      case "QUIZ_SUBMITTED": {
        const quizId = String(event.payload?.quizId ?? "");
        const quizType = String(event.payload?.quizType ?? "").toUpperCase();
        const submittedQuiz = findLatestQuizRecord(next, quizId, quizType);
        if (submittedQuiz && Number.isFinite(submittedQuiz.createdFromPage)) {
          next.currentPage = Math.max(1, Math.floor(submittedQuiz.createdFromPage));
        }
        const pageState = ensurePageState(next, next.currentPage);
        pageState.lastTouchedAt = nowIso();
        break;
      }
      case "REVIEW_DECISION": {
        const accept = Boolean(event.payload?.accept);
        const pageState = ensurePageState(next, next.currentPage);
        pageState.status = accept ? "REVIEW_IN_PROGRESS" : "DONE";
        pageState.lastTouchedAt = nowIso();
        if (accept) {
          resetQaThread(next);
        }
        clearActiveIntervention(next);
        break;
      }
      case "RETEST_DECISION": {
        const accept = Boolean(event.payload?.accept);
        const pageState = ensurePageState(next, next.currentPage);
        pageState.status = accept ? "QUIZ_IN_PROGRESS" : "DONE";
        pageState.lastTouchedAt = nowIso();
        clearActiveIntervention(next);
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
