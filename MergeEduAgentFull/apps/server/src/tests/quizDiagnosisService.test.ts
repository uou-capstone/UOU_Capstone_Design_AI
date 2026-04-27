import { describe, expect, it } from "vitest";
import {
  buildRepairMemoryWrite,
  buildRepairQuestion,
  createQuizRepairIntervention
} from "../services/engine/QuizDiagnosisService.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { QuizRecord } from "../types/domain.js";

function makeQuizRecord(): QuizRecord {
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
          promptMarkdown: "분수 나눗셈에서 왜 뒤집어서 곱하는지 설명한 것을 고르세요.",
          points: 1,
          choices: [
            { id: "c1", textMarkdown: "A" },
            { id: "c2", textMarkdown: "B" }
          ],
          answer: { choiceId: "c1" }
        },
        {
          id: "q2",
          promptMarkdown: "분수 나눗셈 적용 순서를 고르세요.",
          points: 1,
          choices: [
            { id: "c1", textMarkdown: "A" },
            { id: "c2", textMarkdown: "B" }
          ],
          answer: { choiceId: "c1" }
        }
      ]
    },
    grading: {
      status: "GRADED",
      score: 0,
      maxScore: 2,
      scoreRatio: 0,
      items: [
        {
          questionId: "q1",
          score: 0,
          maxScore: 1,
          verdict: "WRONG",
          feedbackMarkdown: "적용 이유를 다시 확인해 보세요."
        },
        {
          questionId: "q2",
          score: 0,
          maxScore: 1,
          verdict: "WRONG",
          feedbackMarkdown: "순서를 다시 확인해 보세요."
        }
      ],
      summaryMarkdown: "분수 나눗셈 적용이 흔들립니다."
    }
  };
}

describe("QuizDiagnosisService", () => {
  it("creates a quiz repair intervention from graded wrong answers", () => {
    const intervention = createQuizRepairIntervention(
      makeQuizRecord(),
      createInitialIntegratedMemory(),
      new Date().toISOString()
    );

    expect(intervention?.mode).toBe("QUIZ_REPAIR");
    expect(intervention?.stage).toBe("AWAITING_DIAGNOSIS_REPLY");
    expect(intervention?.diagnosticPrompt).toContain("한 줄로 말해 주세요");
    expect(intervention?.wrongQuestionIds).toEqual(["q1", "q2"]);
    expect(intervention?.focusConcepts.length).toBeGreaterThan(0);
  });

  it("builds compact repair prompt and memory write from learner reply", () => {
    const intervention = createQuizRepairIntervention(
      makeQuizRecord(),
      createInitialIntegratedMemory(),
      new Date().toISOString()
    );
    expect(intervention).not.toBeNull();

    const repairQuestion = buildRepairQuestion(
      intervention!,
      "공식은 기억나는데 왜 그렇게 적용하는지가 헷갈렸어요."
    );
    const memoryWrite = buildRepairMemoryWrite(
      intervention!,
      "공식은 기억나는데 왜 그렇게 적용하는지가 헷갈렸어요."
    );

    expect(repairQuestion).toContain("오답 교정 모드");
    expect(repairQuestion).toContain("다시 확인:");
    expect(memoryWrite.shouldPersist).toBe(true);
    expect(memoryWrite.misconceptions?.join(" ")).toContain("적용");
  });

  it("marks repeated miss signal when similar low-score history exists", () => {
    const record = makeQuizRecord();
    const intervention = createQuizRepairIntervention(
      record,
      createInitialIntegratedMemory(),
      new Date().toISOString(),
      [
        {
          ...makeQuizRecord(),
          id: "quiz_prev",
          createdAt: new Date(Date.now() - 1_000).toISOString()
        }
      ]
    );

    expect(intervention?.diagnosticPrompt).toContain("최근에도");
    expect(intervention?.suspectedMisconceptions.join(" ")).toContain("반복");
  });
});
