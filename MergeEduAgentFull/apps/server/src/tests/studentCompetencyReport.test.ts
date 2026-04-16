import { describe, expect, it, vi } from "vitest";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { StudentCompetencyReportService } from "../services/report/StudentCompetencyReportService.js";
import { GeminiBridgeClient } from "../services/llm/GeminiBridgeClient.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import { SessionState } from "../types/domain.js";

const competencyKeys = [
  "CONCEPT_UNDERSTANDING",
  "QUESTION_QUALITY",
  "PROBLEM_SOLVING",
  "APPLICATION_TRANSFER",
  "QUIZ_ACCURACY",
  "LEARNING_PERSISTENCE",
  "SELF_REFLECTION",
  "CLASS_PARTICIPATION",
  "CONFIDENCE_GROWTH",
  "IMPROVEMENT_MOMENTUM"
] as const;

function makeSession(): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_lec_1",
    lectureId: "lec_1",
    currentPage: 3,
    pageStates: [
      { page: 1, status: "EXPLAINED", lastTouchedAt: new Date().toISOString() },
      { page: 2, status: "QUIZ_GRADED", lastTouchedAt: new Date().toISOString() },
      { page: 3, status: "EXPLAINING", lastTouchedAt: new Date().toISOString() }
    ],
    messages: [
      {
        id: "m1",
        role: "user",
        agent: "SYSTEM",
        contentMarkdown: "이 개념이 왜 이렇게 되는지 다시 설명해 주세요?",
        createdAt: new Date().toISOString()
      }
    ],
    quizzes: [
      {
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
              promptMarkdown: "문제",
              points: 1,
              choices: [{ id: "a", textMarkdown: "A" }],
              answer: { choiceId: "a" }
            }
          ]
        },
        grading: {
          status: "GRADED",
          score: 1,
          maxScore: 1,
          scoreRatio: 1,
          items: [
            {
              questionId: "q1",
              score: 1,
              maxScore: 1,
              verdict: "CORRECT",
              feedbackMarkdown: "정답"
            }
          ],
          summaryMarkdown: "아주 좋습니다."
        }
      }
    ],
    feedback: [
      {
        id: "fb_1",
        createdAt: new Date().toISOString(),
        page: 2,
        progressText: "~2페이지까지 진행",
        learnerLevel: "INTERMEDIATE",
        notesMarkdown: "- 함수 연결은 잘하지만 정의 설명이 짧습니다."
      }
    ],
    learnerModel: {
      level: "INTERMEDIATE",
      confidence: 0.72,
      weakConcepts: ["정의 설명"],
      strongConcepts: ["함수 연결"]
    },
    integratedMemory: {
      ...createInitialIntegratedMemory(),
      summaryMarkdown: "함수 연결은 강하고 정의 설명이 약합니다.",
      strengths: ["함수 연결"],
      weaknesses: ["정의 설명"],
      nextCoachingGoals: ["정의 설명을 문장으로 말하기"],
      lastUpdatedAt: new Date().toISOString()
    },
    conversationSummary: "",
    updatedAt: new Date().toISOString()
  };
}

describe("StudentCompetencyReportService", () => {
  it("builds heuristic sparse report when there is no evidence", async () => {
    const bridge = {
      analyzeStudentCompetencyReport: vi.fn()
    } as unknown as GeminiBridgeClient;
    const store = {
      listClassrooms: async () => [
        {
          id: "cls_1",
          title: "테스트 강의실",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      listWeeksByClassroom: async () => [
        {
          id: "wk_1",
          classroomId: "cls_1",
          weekIndex: 1,
          title: "1주차",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      listLecturesByWeek: async () => [
        {
          id: "lec_1",
          weekId: "wk_1",
          title: "1강",
          pdf: {
            path: "/tmp/sample.pdf",
            numPages: 4,
            pageIndexPath: "/tmp/sample.pageIndex.json"
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      getSessionByLecture: async () => null
    } as unknown as JsonStore;

    const service = new StudentCompetencyReportService(store, bridge);
    const report = await service.buildClassroomReport("cls_1");

    expect(report?.analysisStatus).toBe("SPARSE_DATA");
    expect(report?.generationMode).toBe("HEURISTIC_FALLBACK");
    expect(report?.competencies).toHaveLength(10);
    expect(bridge.analyzeStudentCompetencyReport).not.toHaveBeenCalled();
  });

  it("uses AI analysis when evidence exists", async () => {
    const bridge = {
      analyzeStudentCompetencyReport: vi.fn(async () => ({
        report: {
          schemaVersion: "1.0",
          classroomId: "cls_1",
          classroomTitle: "테스트 강의실",
          studentLabel: "현재 학습자",
          generatedAt: new Date().toISOString(),
          analysisStatus: "READY",
          generationMode: "AI_ANALYZED",
          headline: "좋은 흐름입니다.",
          summaryMarkdown: "- 요약",
          overallScore: 88,
          overallLevel: "ADVANCED",
          competencies: competencyKeys.map((key) => ({
            key,
            label: key,
            score: 80,
            trend: "UP",
            summary: "좋습니다.",
            evidence: ["근거"]
          })),
          strengths: ["함수 연결"],
          growthAreas: ["정의 설명"],
          coachingInsights: ["짧은 설명형 답변을 더 늘리세요."],
          recommendedActions: [
            {
              title: "정의 설명 보강",
              description: "짧은 서술형을 더 자주 풉니다."
            }
          ],
          lectureInsights: [],
          sourceStats: {
            lectureCount: 1,
            sessionCount: 1,
            completedPageCount: 3,
            pageCoverageRatio: 0.75,
            questionCount: 1,
            quizCount: 1,
            gradedQuizCount: 1,
            averageQuizScore: 100,
            feedbackCount: 1,
            memoryRefreshCount: 1
          },
          dataQualityNote: "충분합니다."
        },
        thoughtSummary: "ok"
      }))
    } as unknown as GeminiBridgeClient;

    const store = {
      listClassrooms: async () => [
        {
          id: "cls_1",
          title: "테스트 강의실",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      listWeeksByClassroom: async () => [
        {
          id: "wk_1",
          classroomId: "cls_1",
          weekIndex: 1,
          title: "1주차",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      listLecturesByWeek: async () => [
        {
          id: "lec_1",
          weekId: "wk_1",
          title: "1강",
          pdf: {
            path: "/tmp/sample.pdf",
            numPages: 4,
            pageIndexPath: "/tmp/sample.pageIndex.json"
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      getSessionByLecture: async () => makeSession()
    } as unknown as JsonStore;

    const service = new StudentCompetencyReportService(store, bridge);
    const report = await service.buildClassroomReport("cls_1");

    expect(report?.generationMode).toBe("AI_ANALYZED");
    expect(report?.overallScore).toBe(88);
    expect(report?.lectureInsights[0]?.lectureTitle).toBe("1강");
    expect(bridge.analyzeStudentCompetencyReport).toHaveBeenCalledOnce();
  });
});
