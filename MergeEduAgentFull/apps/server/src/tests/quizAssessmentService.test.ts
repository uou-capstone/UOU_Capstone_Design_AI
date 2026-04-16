import { describe, expect, it } from "vitest";
import {
  buildQuizAssessment,
  markAssessmentsConsumed,
  preparePendingAssessmentHandoff
} from "../services/engine/QuizAssessmentService.js";
import { QuizRecord, SessionState } from "../types/domain.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";

function makeQuizRecord(input?: Partial<QuizRecord>): QuizRecord {
  return {
    id: "quiz_1",
    quizType: "MCQ",
    createdFromPage: 2,
    createdAt: new Date().toISOString(),
    quizJson: {
      schemaVersion: "1.0",
      quizId: "quiz_1",
      quizType: "MCQ",
      page: 2,
      questions: [
        {
          id: "q1",
          promptMarkdown: "분수 나눗셈에서 왜 역수를 곱하는지 고르세요.",
          points: 1,
          choices: [
            { id: "c1", textMarkdown: "정답" },
            { id: "c2", textMarkdown: "오답" }
          ],
          answer: { choiceId: "c1" }
        }
      ]
    },
    userAnswers: { q1: "c2" },
    grading: {
      status: "GRADED",
      score: 0,
      maxScore: 1,
      scoreRatio: 0,
      items: [
        {
          questionId: "q1",
          score: 0,
          maxScore: 1,
          verdict: "WRONG",
          feedbackMarkdown: "오답입니다."
        }
      ],
      summaryMarkdown: "총점 0/1"
    },
    ...input
  };
}

function makeState(quizAssessments: SessionState["quizAssessments"] = []): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_test",
    lectureId: "lec_test",
    currentPage: 2,
    pageStates: [{ page: 2, status: "QUIZ_GRADED", lastTouchedAt: new Date().toISOString() }],
    messages: [],
    quizzes: [],
    feedback: [],
    learnerModel: {
      level: "INTERMEDIATE",
      confidence: 0.5,
      weakConcepts: [],
      strongConcepts: []
    },
    integratedMemory: createInitialIntegratedMemory(),
    quizAssessments,
    activeIntervention: null,
    qaThread: createInitialQaThreadMemory(),
    conversationSummary: "",
    updatedAt: new Date().toISOString()
  };
}

describe("QuizAssessmentService", () => {
  it("builds deterministic low-score assessment with repeated weakness signal", () => {
    const previousLowQuiz = makeQuizRecord({
      id: "quiz_prev",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      grading: {
        status: "GRADED",
        score: 0,
        maxScore: 1,
        scoreRatio: 0,
        items: [
          {
            questionId: "q1",
            score: 0,
            maxScore: 1,
            verdict: "WRONG",
            feedbackMarkdown: "오답입니다."
          }
        ],
        summaryMarkdown: "총점 0/1"
      }
    });
    const currentQuiz = makeQuizRecord();

    const assessment = buildQuizAssessment({
      quiz: currentQuiz,
      grading: currentQuiz.grading!,
      recentQuizzes: [previousLowQuiz, currentQuiz],
      passScoreRatio: 0.7
    });

    expect(assessment.quizId).toBe("quiz_1");
    expect(assessment.readiness).toBe("REPAIR_REQUIRED");
    expect(assessment.deliveryStatus).toBe("PENDING");
    expect(assessment.weaknesses.join(" ")).toContain("개념 보강");
    expect(assessment.behaviorSignals.join(" ")).toContain("반복적으로");
    expect(assessment.memoryHint.targetDifficulty).toBe("FOUNDATIONAL");
  });

  it("prepares pending handoff and marks delivered assessments as consumed", () => {
    const first = buildQuizAssessment({
      quiz: makeQuizRecord({ id: "quiz_a", quizJson: { ...makeQuizRecord().quizJson, quizId: "quiz_a" } }),
      grading: makeQuizRecord().grading!,
      recentQuizzes: [makeQuizRecord()],
      passScoreRatio: 0.7
    });
    const second = {
      ...first,
      id: "asm_b",
      quizId: "quiz_b",
      createdAt: new Date(Date.now() + 1000).toISOString(),
      updatedAt: new Date(Date.now() + 1000).toISOString()
    };
    const consumed = {
      ...first,
      id: "asm_c",
      quizId: "quiz_c",
      deliveryStatus: "CONSUMED" as const,
      consumedAt: new Date().toISOString()
    };
    const state = makeState([first, second, consumed]);

    const handoff = preparePendingAssessmentHandoff(state);
    expect(handoff.assessmentIds).toEqual([first.id, second.id]);
    expect(handoff.digest).toContain("quiz=quiz_a");
    expect(handoff.digest).toContain("quiz=quiz_b");
    expect(handoff.digest).not.toContain("quiz=quiz_c");

    markAssessmentsConsumed(state, handoff.assessmentIds, "2026-04-16T00:00:00.000Z");
    expect(state.quizAssessments?.[0]?.deliveryStatus).toBe("CONSUMED");
    expect(state.quizAssessments?.[1]?.deliveryStatus).toBe("CONSUMED");
  });
});
