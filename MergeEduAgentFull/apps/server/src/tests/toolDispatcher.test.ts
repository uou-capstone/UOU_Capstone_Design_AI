import { describe, expect, it } from "vitest";
import { ExplainerAgent } from "../services/agents/ExplainerAgent.js";
import { GraderAgent } from "../services/agents/GraderAgent.js";
import { MisconceptionRepairAgent } from "../services/agents/MisconceptionRepairAgent.js";
import { QaAgent } from "../services/agents/QaAgent.js";
import { QuizAgents } from "../services/agents/QuizAgents.js";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { createInitialQaThreadMemory } from "../services/engine/QaThreadService.js";
import { ToolDispatcher } from "../services/engine/ToolDispatcher.js";
import { SessionState } from "../types/domain.js";

function makeState(): SessionState {
  return {
    schemaVersion: "1.0",
    sessionId: "ses_test",
    lectureId: "lec_test",
    currentPage: 1,
    pageStates: [{ page: 1, status: "EXPLAINING", lastTouchedAt: new Date().toISOString() }],
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
    activeIntervention: null,
    qaThread: createInitialQaThreadMemory(),
    conversationSummary: "",
    updatedAt: new Date().toISOString()
  };
}

function makeDispatchContext() {
  return {
    lecture: {
      id: "lec_test",
      weekId: "wk_test",
      title: "테스트",
      pdf: {
        path: "uploads/lec_test.pdf",
        numPages: 1,
        pageIndexPath: "uploads/lec_test.pageIndex.json",
        geminiFile: {
          fileName: "f",
          fileUri: "u",
          mimeType: "application/pdf"
        }
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    basePage: 1,
    pageContext: {
      pageText: "분수 나눗셈은 나누는 수의 역수를 곱하는 방식으로 계산한다.",
      prev: "",
      next: ""
    },
    eventPayload: undefined,
    resolvePageContext: async () => ({
      pageText: "분수 나눗셈은 나누는 수의 역수를 곱하는 방식으로 계산한다.",
      prev: "",
      next: ""
    })
  };
}

function makeDispatchContextWithoutGeminiFile() {
  return {
    ...makeDispatchContext(),
    lecture: {
      ...makeDispatchContext().lecture,
      pdf: {
        ...makeDispatchContext().lecture.pdf,
        geminiFile: undefined
      }
    },
    resolvePageContext: async () => {
      throw new Error("resolvePageContext should not be called for deterministic MCQ/OX grading");
    }
  };
}

function makeLocalFallbackDispatchContext() {
  const base = makeDispatchContext();
  return {
    ...base,
    lecture: {
      ...base.lecture,
      pdf: {
        ...base.lecture.pdf,
        numPages: 2,
        geminiFile: undefined
      }
    },
    pageContext: {
      pageText: "1페이지는 IoT 센서 데이터와 산업 현장 모니터링의 핵심 개념을 설명한다.",
      prev: "",
      next: "2페이지는 다른 주제를 다룬다."
    },
    resolvePageContext: async (page: number) =>
      page === 1
        ? {
            pageText: "1페이지는 IoT 센서 데이터와 산업 현장 모니터링의 핵심 개념을 설명한다.",
            prev: "",
            next: "2페이지는 다른 주제를 다룬다."
          }
        : {
            pageText: "2페이지는 현재 채점 답안과 무관한 네트워크 보안 사례를 설명한다.",
            prev: "1페이지는 IoT 센서 데이터와 산업 현장 모니터링의 핵심 개념을 설명한다.",
            next: ""
          }
  };
}

describe("ToolDispatcher soft failure", () => {
  it("keeps event flow and appends SYSTEM message when tool execution fails", async () => {
    const bridge = {
      explainPage: async () => {
        throw new Error("bridge timeout");
      },
      explainPageStream: async () => {
        throw new Error("bridge timeout");
      },
      answerQuestion: async () => ({ markdown: "ok", content: null }),
      answerQuestionStream: async () => ({ markdown: "ok", thoughtSummary: "", content: null }),
      generateQuiz: async () => {
        throw new Error("not used");
      },
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuiz: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();

    const result = await dispatcher.dispatch(
      state,
      [
        { type: "CALL_TOOL", tool: "EXPLAIN_PAGE", args: { page: 1 } },
        {
          type: "CALL_TOOL",
          tool: "APPEND_ORCHESTRATOR_MESSAGE",
          args: { contentMarkdown: "다음 단계로 진행합니다." }
        }
      ],
      makeDispatchContext()
    );

    const systemFailure = result.newMessages.find((msg) => msg.agent === "SYSTEM");
    const orchestratorMsg = result.newMessages.find((msg) => msg.agent === "ORCHESTRATOR");

    expect(systemFailure?.contentMarkdown).toContain("AI 도구 실행 중 문제가 발생했습니다");
    expect(systemFailure?.contentMarkdown).toContain("EXPLAIN_PAGE");
    expect(systemFailure?.contentMarkdown).not.toContain("bridge timeout");
    expect(orchestratorMsg?.contentMarkdown).toBe("다음 단계로 진행합니다.");
  });

  it("stores QA-only follow-up thread after answering a question", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async (input: { qaThreadDigest?: string }) => ({
        markdown: input.qaThreadDigest ? "이전 질문을 이어서 답변합니다." : "첫 질문에 답변합니다.",
        thoughtSummary: ""
      }),
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();

    await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "ANSWER_QUESTION",
          args: {
            page: 1,
            questionText: "첫 질문입니다.",
            threadMode: "START_NEW"
          }
        }
      ],
      makeDispatchContext()
    );

    expect(state.qaThread?.turns).toHaveLength(1);
    expect(state.qaThread?.turns[0]?.question).toBe("첫 질문입니다.");
  });

  it("does not fake QA when Gemini file is missing", async () => {
    const bridge = {
      explainPageStream: async () => {
        throw new Error("bridge should not be called");
      },
      answerQuestionStream: async () => {
        throw new Error("bridge should not be called");
      },
      generateQuizStream: async () => {
        throw new Error("bridge should not be called");
      },
      gradeQuizStream: async () => {
        throw new Error("bridge should not be called");
      }
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const result = await dispatcher.dispatch(
      makeState(),
      [
        {
          type: "CALL_TOOL",
          tool: "ANSWER_QUESTION",
          args: {
            page: 1,
            questionText: "주식 시장 금리 전망은 어떤가요?"
          }
        }
      ],
      makeLocalFallbackDispatchContext()
    );

    expect(result.newMessages[0]?.agent).toBe("SYSTEM");
    expect(result.newMessages[0]?.contentMarkdown).toContain("Gemini PDF 파일 연결");
  });

  it("clamps tool page arguments before mutating page state", async () => {
    const bridge = {
      explainPageStream: async (input: { page: number }) => ({
        markdown: `${input.page}페이지 설명`,
        thoughtSummary: ""
      }),
      answerQuestionStream: async () => ({ markdown: "답변", thoughtSummary: "" }),
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const state = makeState();

    await dispatcher.dispatch(
      state,
      [{ type: "CALL_TOOL", tool: "EXPLAIN_PAGE", args: { page: 999 } }],
      makeDispatchContext()
    );

    expect(state.pageStates.some((page) => page.page === 999)).toBe(false);
    expect(state.pageStates.find((page) => page.page === 1)?.status).toBe("EXPLAINED");
  });

  it("does not stream raw quiz JSON as chat answer text while generating a quiz", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async () => ({ markdown: "답변", thoughtSummary: "" }),
      generateQuizStream: async (
        _input: unknown,
        onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void
      ) => {
        onDelta?.({ channel: "thought", text: "퀴즈 구성을 점검합니다." });
        onDelta?.({ channel: "answer", text: "{\"schemaVersion\":\"1.0\"}" });
        return {
          quiz: {
            schemaVersion: "1.0",
            quizId: "quiz_stream_hidden",
            quizType: "MCQ",
            page: 1,
            questions: [
              {
                id: "q1",
                promptMarkdown: "정답을 고르세요.",
                choices: [
                  { id: "c1", textMarkdown: "정답" },
                  { id: "c2", textMarkdown: "오답" }
                ],
                answer: { choiceId: "c1" }
              }
            ]
          },
          thoughtSummary: "퀴즈 생성 완료"
        };
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const events: Array<{ channel: "thought" | "answer"; text: string }> = [];
    const result = await dispatcher.dispatch(
      makeState(),
      [{ type: "CALL_TOOL", tool: "GENERATE_QUIZ_MCQ", args: { page: 1 } }],
      makeDispatchContext(),
      {
        onStreamEvent: (event) => events.push({ channel: event.channel, text: event.text })
      }
    );

    expect(events).toEqual([{ channel: "thought", text: "퀴즈 구성을 점검합니다." }]);
    expect(result.ui.openQuizModal).toBe(true);
    expect(result.newMessages[0]?.contentMarkdown).toContain("퀴즈가 생성되었습니다");
  });

  it("replaces duplicate generated quiz ids with a session-unique id", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async () => ({ markdown: "답변", thoughtSummary: "" }),
      generateQuizStream: async () => ({
        quiz: {
          schemaVersion: "1.0",
          quizId: "quiz_duplicate",
          quizType: "SHORT",
          page: 1,
          questions: [
            {
              id: "q1",
              promptMarkdown: "핵심을 쓰세요.",
              points: 2,
              referenceAnswer: { text: "핵심 정의" },
              rubricMarkdown: "핵심 정의 포함"
            }
          ]
        },
        thoughtSummary: "단답형 생성"
      }),
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const state = makeState();
    state.quizzes.push({
      id: "quiz_duplicate",
      quizType: "SHORT",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_duplicate",
        quizType: "SHORT",
        page: 1,
        questions: [
          {
            id: "q_old",
            promptMarkdown: "예전 문항",
            referenceAnswer: { text: "예전 답" }
          }
        ]
      },
      grading: {
        status: "GRADED",
        score: 2,
        maxScore: 2,
        scoreRatio: 1,
        items: [],
        summaryMarkdown: "예전 채점"
      }
    });

    const result = await dispatcher.dispatch(
      state,
      [{ type: "CALL_TOOL", tool: "GENERATE_QUIZ_SHORT", args: { page: 1 } }],
      makeDispatchContext()
    );

    expect(state.quizzes).toHaveLength(2);
    const latest = state.quizzes.at(-1);
    expect(latest?.id).toBeTruthy();
    expect(latest?.id).not.toBe("quiz_duplicate");
    expect(latest?.quizJson.quizId).toBe(latest?.id);
    expect(result.ui.quiz?.quizId).toBe(latest?.id);
    expect(state.pageStates[0]?.quiz?.lastQuizId).toBe(latest?.id);
  });

  it("opens diagnosis-first flow on low quiz score", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async () => ({ markdown: "교정 설명", thoughtSummary: "" }),
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();
    state.quizzes.push({
      id: "quiz_1",
      quizType: "MCQ",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_1",
        quizType: "MCQ",
        page: 1,
        questions: [
          {
            id: "q1",
            promptMarkdown: "분수 나눗셈에서 왜 뒤집어서 곱하는지 고르세요.",
            points: 1,
            choices: [
              { id: "c1", textMarkdown: "정답" },
              { id: "c2", textMarkdown: "오답" }
            ],
            answer: { choiceId: "c1" }
          }
        ]
      }
    });

    const result = await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "AUTO_GRADE_MCQ_OX",
          args: {
            quizId: "quiz_1",
            userAnswers: { q1: "c2" }
          }
        }
      ],
      makeDispatchContext()
    );

    expect(state.activeIntervention?.stage).toBe("AWAITING_DIAGNOSIS_REPLY");
    expect(state.pageStates[0]?.status).toBe("REVIEW_IN_PROGRESS");
    expect(state.quizAssessments).toHaveLength(1);
    expect(state.quizAssessments?.[0]?.deliveryStatus).toBe("PENDING");
    const feedback = state.quizzes[0]?.grading?.items[0]?.feedbackMarkdown ?? "";
    expect(feedback).toContain("정답은 정답 입니다.");
    expect(feedback).not.toContain("c1");
    expect(
      result.newMessages.some(
        (message) =>
          message.agent === "ORCHESTRATOR" &&
          message.contentMarkdown.includes("한 줄로 말해 주세요")
      )
    ).toBe(true);
  });

  it("repairs misconception and stores focused memory after learner reply", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async () => ({
        markdown: "헷갈린 지점을 짚고 짧게 다시 설명합니다.\n\n다시 확인: 왜 역수를 곱하나요?",
        thoughtSummary: "교정 설명 생성"
      }),
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();
    state.activeIntervention = {
      mode: "QUIZ_REPAIR",
      page: 1,
      quizId: "quiz_1",
      scoreRatio: 0.1,
      wrongQuestionIds: ["q1"],
      focusConcepts: ["분수 나눗셈"],
      suspectedMisconceptions: ["분수 나눗셈 적용 이유를 혼동함"],
      diagnosticPrompt: "어디가 헷갈렸는지 말해 주세요.",
      stage: "AWAITING_DIAGNOSIS_REPLY",
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString()
    };

    const result = await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "REPAIR_MISCONCEPTION",
          args: {
            page: 1,
            studentReply: "공식은 기억나는데 적용 이유가 헷갈렸어요."
          }
        }
      ],
      makeDispatchContext()
    );

    expect(state.activeIntervention?.stage).toBe("REPAIR_DELIVERED");
    expect(state.pageStates[0]?.status).toBe("REVIEW_DONE");
    expect(state.integratedMemory.misconceptions.join(" ")).toContain("적용");
    expect(
      result.newMessages.some(
        (message) =>
          message.agent === "ORCHESTRATOR" && message.widget?.decisionType === "RETEST_DECISION"
      )
    ).toBe(true);
  });

  it("stores deterministic assessment after essay grading without breaking pass flow", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async () => ({ markdown: "교정 설명", thoughtSummary: "" }),
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => ({
        grading: {
          schemaVersion: "1.0",
          quizId: "quiz_essay",
          type: "GRADING_RESULT",
          totalScore: 3,
          maxScore: 4,
          items: [
            {
              questionId: "q1",
              score: 3,
              maxScore: 4,
              verdict: "PARTIAL",
              feedbackMarkdown: "핵심 개념은 맞지만 근거 연결이 조금 약합니다."
            }
          ],
          summaryMarkdown: "개념은 이해했지만 이유 연결을 조금 더 또렷하게 쓰면 좋습니다."
        },
        thoughtSummary: "essay grading"
      })
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();
    state.quizzes.push({
      id: "quiz_essay",
      quizType: "ESSAY",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_essay",
        quizType: "ESSAY",
        page: 1,
        questions: [
          {
            id: "q1",
            promptMarkdown: "분수 나눗셈에서 역수를 곱하는 이유를 설명하세요.",
            points: 4,
            modelAnswerMarkdown: "나눗셈을 곱셈으로 바꾸기 위해서입니다.",
            rubricMarkdown: "핵심 원리를 설명하면 부분 점수"
          }
        ]
      },
      userAnswers: {
        q1: "나눗셈을 곱셈처럼 바꾸는 건 알겠는데 왜 역수가 되는지는 조금 헷갈립니다. 그래도 계산 흐름은 알고 있습니다."
      }
    });

    await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "GRADE_SHORT_OR_ESSAY",
          args: {
            quizId: "quiz_essay",
            userAnswers: state.quizzes[0]?.userAnswers ?? {}
          }
        }
      ],
      makeDispatchContext()
    );

    expect(state.activeIntervention).toBeNull();
    expect(state.quizAssessments).toHaveLength(1);
    expect(state.quizAssessments?.[0]?.quizId).toBe("quiz_essay");
    expect(state.quizAssessments?.[0]?.behaviorSignals.join(" ")).toContain("서술형");
    expect(state.quizAssessments?.[0]?.deliveryStatus).toBe("PENDING");
  });

  it("treats blank OX submissions as unanswered instead of correct", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async () => ({ markdown: "교정 설명", thoughtSummary: "" }),
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();
    state.quizzes.push({
      id: "quiz_ox",
      quizType: "OX",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_ox",
        quizType: "OX",
        page: 1,
        questions: [
          {
            id: "q1",
            promptMarkdown: "이 명제는 거짓인가요?",
            points: 1,
            answer: { value: false }
          }
        ]
      }
    });

    await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "AUTO_GRADE_MCQ_OX",
          args: {
            quizId: "quiz_ox",
            userAnswers: {}
          }
        }
      ],
      makeDispatchContext()
    );

    expect(state.quizzes[0]?.grading?.score).toBe(0);
    expect(state.quizzes[0]?.grading?.items[0]?.feedbackMarkdown).toContain("미응답");
  });

  it("grades MCQ/OX without Gemini file or page context resolution", async () => {
    const bridge = {
      explainPageStream: async () => {
        throw new Error("not used");
      },
      answerQuestionStream: async () => {
        throw new Error("not used");
      },
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();
    state.quizzes.push({
      id: "quiz_no_file_ref",
      quizType: "MCQ",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_no_file_ref",
        quizType: "MCQ",
        page: 1,
        questions: [
          {
            id: "q1",
            promptMarkdown: "정답을 고르세요.",
            points: 1,
            choices: [
              { id: "c1", textMarkdown: "정답" },
              { id: "c2", textMarkdown: "오답" }
            ],
            answer: { choiceId: "c1" }
          }
        ]
      }
    });

    await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "AUTO_GRADE_MCQ_OX",
          args: {
            quizId: "quiz_no_file_ref",
            userAnswers: { q1: "c1" }
          }
        }
      ],
      makeDispatchContextWithoutGeminiFile()
    );

    expect(state.quizzes[0]?.grading?.status).toBe("GRADED");
    expect(state.quizzes[0]?.grading?.scoreRatio).toBe(1);
    expect(state.quizAssessments).toHaveLength(1);
  });

  it("does not fake an explanation when Gemini file is missing", async () => {
    const bridge = {
      explainPageStream: async () => {
        throw new Error("bridge should not be called");
      },
      answerQuestionStream: async () => {
        throw new Error("bridge should not be called");
      },
      generateQuizStream: async () => {
        throw new Error("bridge should not be called");
      },
      gradeQuizStream: async () => {
        throw new Error("bridge should not be called");
      }
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const state = makeState();

    const result = await dispatcher.dispatch(
      state,
      [{ type: "CALL_TOOL", tool: "EXPLAIN_PAGE", args: { page: 1 } }],
      makeLocalFallbackDispatchContext()
    );

    expect(result.newMessages[0]?.agent).toBe("SYSTEM");
    expect(result.newMessages[0]?.contentMarkdown).toContain("Gemini PDF 파일 연결");
    expect(state.pageStates.find((page) => page.page === 1)?.status).toBe("EXPLAINING");
  });

  it("runs local-only feedback writes without Gemini file", async () => {
    const bridge = {
      explainPageStream: async () => {
        throw new Error("bridge should not be called");
      },
      answerQuestionStream: async () => {
        throw new Error("bridge should not be called");
      },
      generateQuizStream: async () => {
        throw new Error("bridge should not be called");
      },
      gradeQuizStream: async () => {
        throw new Error("bridge should not be called");
      }
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const state = makeState();

    const result = await dispatcher.dispatch(
      state,
      [{ type: "CALL_TOOL", tool: "WRITE_FEEDBACK_ENTRY", args: { notesHint: "퀴즈 선택 대기" } }],
      makeDispatchContextWithoutGeminiFile()
    );

    expect(state.feedback[0]?.notesMarkdown).toContain("퀴즈 선택 대기");
    expect(result.newMessages.some((message) => message.agent === "SYSTEM")).toBe(false);
  });

  it("does not fake a quiz when Gemini file is missing", async () => {
    const bridge = {
      explainPageStream: async () => {
        throw new Error("bridge should not be called");
      },
      answerQuestionStream: async () => {
        throw new Error("bridge should not be called");
      },
      generateQuizStream: async () => {
        throw new Error("bridge should not be called");
      },
      gradeQuizStream: async () => {
        throw new Error("bridge should not be called");
      }
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const state = makeState();

    const result = await dispatcher.dispatch(
      state,
      [{ type: "CALL_TOOL", tool: "GENERATE_QUIZ_MCQ", args: { page: 1 } }],
      makeLocalFallbackDispatchContext()
    );

    expect(result.ui.openQuizModal).toBe(false);
    expect(result.ui.quiz).toBeNull();
    expect(state.quizzes).toHaveLength(0);
    expect(result.newMessages[0]?.agent).toBe("SYSTEM");
    expect(result.newMessages[0]?.contentMarkdown).toContain("Gemini PDF 파일 연결");
  });

  it("does not fake subjective grading when Gemini file is missing", async () => {
    const bridge = {
      explainPageStream: async () => {
        throw new Error("bridge should not be called");
      },
      answerQuestionStream: async () => {
        throw new Error("bridge should not be called");
      },
      generateQuizStream: async () => {
        throw new Error("bridge should not be called");
      },
      gradeQuizStream: async () => {
        throw new Error("bridge should not be called");
      }
    } as any;
    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );
    const state = makeState();
    state.currentPage = 2;
    state.quizzes.push({
      id: "quiz_local_short",
      quizType: "SHORT",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_local_short",
        quizType: "SHORT",
        page: 1,
        questions: [
          {
            id: "q1",
            promptMarkdown: "1페이지의 핵심 내용을 요약하세요.",
            points: 2,
            referenceAnswer: { text: "" },
            rubricMarkdown: ""
          }
        ]
      }
    });

    await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "GRADE_SHORT_OR_ESSAY",
          args: {
            quizId: "quiz_local_short",
            userAnswers: { q1: "IoT 센서 데이터와 산업 현장 모니터링" }
          }
        }
      ],
      makeLocalFallbackDispatchContext()
    );

    expect(state.quizzes[0]?.grading).toBeUndefined();
    expect(state.pageStates.find((page) => page.page === 1)?.status).not.toBe("QUIZ_GRADED");
    expect(state.pageStates.find((page) => page.page === 2)?.status).not.toBe("QUIZ_GRADED");
  });

  it("refuses deterministic auto grading for non-objective quiz records", async () => {
    const bridge = {
      explainPageStream: async () => {
        throw new Error("not used");
      },
      answerQuestionStream: async () => {
        throw new Error("not used");
      },
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();
    state.quizzes.push({
      id: "quiz_essay_not_auto",
      quizType: "ESSAY",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_essay_not_auto",
        quizType: "ESSAY",
        page: 1,
        questions: [
          {
            id: "q1",
            promptMarkdown: "설명하세요.",
            points: 1,
            modelAnswerMarkdown: "모범 답안",
            rubricMarkdown: "루브릭"
          }
        ]
      }
    });

    const result = await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "AUTO_GRADE_MCQ_OX",
          args: {
            quizId: "quiz_essay_not_auto",
            userAnswers: { q1: "essay answer" }
          }
        }
      ],
      makeDispatchContextWithoutGeminiFile()
    );

    expect(state.quizzes[0]?.grading).toBeUndefined();
    expect(result.newMessages.some((message) => message.agent === "SYSTEM")).toBe(true);
  });

  it("keeps grading and repair flow alive even if assessment construction fails", async () => {
    const bridge = {
      explainPageStream: async () => ({ markdown: "설명", thoughtSummary: "" }),
      answerQuestionStream: async () => ({ markdown: "교정 설명", thoughtSummary: "" }),
      generateQuizStream: async () => {
        throw new Error("not used");
      },
      gradeQuizStream: async () => {
        throw new Error("not used");
      }
    } as any;

    const dispatcher = new ToolDispatcher(
      new ExplainerAgent(bridge),
      new QaAgent(bridge),
      new QuizAgents(bridge),
      new GraderAgent(bridge),
      new MisconceptionRepairAgent(bridge)
    );

    const state = makeState();
    state.integratedMemory.nextCoachingGoals = [
      { broken: true } as unknown as string
    ];
    state.quizzes.push({
      id: "quiz_bad_assessment",
      quizType: "MCQ",
      createdFromPage: 1,
      createdAt: new Date().toISOString(),
      quizJson: {
        schemaVersion: "1.0",
        quizId: "quiz_bad_assessment",
        quizType: "MCQ",
        page: 1,
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
      }
    });

    await dispatcher.dispatch(
      state,
      [
        {
          type: "CALL_TOOL",
          tool: "AUTO_GRADE_MCQ_OX",
          args: {
            quizId: "quiz_bad_assessment",
            userAnswers: { q1: "c2" }
          }
        }
      ],
      makeDispatchContext()
    );

    expect(state.quizzes[0]?.grading?.status).toBe("GRADED");
    expect(state.activeIntervention?.stage).toBe("AWAITING_DIAGNOSIS_REPLY");
    expect(state.quizAssessments ?? []).toHaveLength(0);
  });
});
