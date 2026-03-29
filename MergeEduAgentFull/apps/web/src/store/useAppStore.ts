import { create } from "zustand";
import { ChatMessage, QuizJson, SessionState } from "../types";

interface AppStore {
  session: SessionState | null;
  pdfUrl: string;
  quizModalOpen: boolean;
  activeQuiz: QuizJson | null;
  disableQuizClose: boolean;
  progressText: string;
  setSession: (session: SessionState) => void;
  setPdfUrl: (url: string) => void;
  appendMessages: (messages: ChatMessage[]) => void;
  setQuizState: (input: {
    open: boolean;
    quiz: QuizJson | null;
    disableClose: boolean;
  }) => void;
  setProgressText: (text: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  session: null,
  pdfUrl: "",
  quizModalOpen: false,
  activeQuiz: null,
  disableQuizClose: false,
  progressText: "",
  setSession: (session) => set({ session }),
  setPdfUrl: (url) => set({ pdfUrl: url }),
  appendMessages: (messages) =>
    set((state) => ({
      session: state.session
        ? {
            ...state.session,
            messages: [...state.session.messages, ...messages]
          }
        : state.session
    })),
  setQuizState: ({ open, quiz, disableClose }) =>
    set({
      quizModalOpen: open,
      activeQuiz: quiz,
      disableQuizClose: disableClose
    }),
  setProgressText: (text) => set({ progressText: text })
}));
