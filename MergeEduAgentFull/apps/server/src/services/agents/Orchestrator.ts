import { z } from "zod";
import {
  AppEvent,
  QuizDifficultyTarget,
  QuizType,
  SessionState
} from "../../types/domain.js";
import { orchestratorPlanSchema } from "../../types/guards.js";
import {
  OrchestratorAction,
  OrchestratorInput,
  OrchestratorPlan,
  ToolName
} from "../../types/orchestrator.js";
import {
  createInitialIntegratedMemory,
  buildIntegratedMemoryDigest,
  buildPageHistoryDigest
} from "../engine/LearnerMemoryService.js";

interface ToolCatalogEntry {
  tool: ToolName;
  purpose: string;
  args: string;
  runtimeEffect: string;
  example: string;
}

const QUIZ_OPTIONS = [
  { id: "MCQ", label: "객관식" },
  { id: "OX", label: "OX" },
  { id: "SHORT", label: "단답형" },
  { id: "ESSAY", label: "서술형" }
] as const;

const CORE_PAGE_KEYWORDS = [
  "핵심",
  "정의",
  "정리",
  "공식",
  "증명",
  "주의",
  "theorem",
  "definition",
  "important"
] as const;

export const ORCHESTRATOR_TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    tool: "APPEND_ORCHESTRATOR_MESSAGE",
    purpose: "간단한 안내 메시지 추가",
    args: "{ contentMarkdown }",
    runtimeEffect: "ORCHESTRATOR 메시지를 채팅에 추가한다.",
    example:
      '{"type":"CALL_TOOL","tool":"APPEND_ORCHESTRATOR_MESSAGE","args":{"contentMarkdown":"1페이지 설명을 시작합니다."}}'
  },
  {
    tool: "APPEND_SYSTEM_MESSAGE",
    purpose: "시스템 메시지 추가",
    args: "{ contentMarkdown }",
    runtimeEffect: "SYSTEM 메시지를 채팅에 추가한다.",
    example:
      '{"type":"CALL_TOOL","tool":"APPEND_SYSTEM_MESSAGE","args":{"contentMarkdown":"세션을 저장했습니다."}}'
  },
  {
    tool: "PROMPT_BINARY_DECISION",
    purpose: "예/아니오 의사결정 요청",
    args: "{ contentMarkdown, decisionType }",
    runtimeEffect: "예/아니오 버튼이 달린 ORCHESTRATOR 메시지를 추가한다.",
    example:
      '{"type":"CALL_TOOL","tool":"PROMPT_BINARY_DECISION","args":{"contentMarkdown":"복습을 진행할까요?","decisionType":"REVIEW_DECISION"}}'
  },
  {
    tool: "OPEN_QUIZ_TYPE_PICKER",
    purpose: "퀴즈 유형 선택기 표시",
    args: "{ contentMarkdown, recommendedId? }",
    runtimeEffect: "퀴즈 유형 선택 위젯이 달린 ORCHESTRATOR 메시지를 추가한다.",
    example:
      '{"type":"CALL_TOOL","tool":"OPEN_QUIZ_TYPE_PICKER","args":{"contentMarkdown":"퀴즈 유형을 선택해 주세요.","recommendedId":"MCQ"}}'
  },
  {
    tool: "SET_CURRENT_PAGE",
    purpose: "현재 페이지를 직접 이동",
    args: "{ page, contentMarkdown? }",
    runtimeEffect: "세션의 currentPage를 갱신하고 필요하면 전환 메시지도 남긴다.",
    example:
      '{"type":"CALL_TOOL","tool":"SET_CURRENT_PAGE","args":{"page":2,"contentMarkdown":"2페이지로 이동합니다."}}'
  },
  {
    tool: "EXPLAIN_PAGE",
    purpose: "설명 에이전트 호출",
    args: "{ page, detailLevel? }",
    runtimeEffect: "설명 스트림을 생성하고 페이지 설명 요약을 저장한다.",
    example:
      '{"type":"CALL_TOOL","tool":"EXPLAIN_PAGE","args":{"page":2,"detailLevel":"DETAILED"}}'
  },
  {
    tool: "ANSWER_QUESTION",
    purpose: "질문응답 에이전트 호출",
    args: "{ questionText, page }",
    runtimeEffect: "QA 응답을 생성한다.",
    example:
      '{"type":"CALL_TOOL","tool":"ANSWER_QUESTION","args":{"questionText":"왜 이렇게 되나요?","page":2}}'
  },
  {
    tool: "GENERATE_QUIZ_MCQ",
    purpose: "객관식 퀴즈 생성",
    args: "{ page }",
    runtimeEffect: "퀴즈 생성 후 퀴즈 모달을 연다.",
    example:
      '{"type":"CALL_TOOL","tool":"GENERATE_QUIZ_MCQ","args":{"page":3}}'
  },
  {
    tool: "GENERATE_QUIZ_OX",
    purpose: "OX 퀴즈 생성",
    args: "{ page }",
    runtimeEffect: "퀴즈 생성 후 퀴즈 모달을 연다.",
    example:
      '{"type":"CALL_TOOL","tool":"GENERATE_QUIZ_OX","args":{"page":1}}'
  },
  {
    tool: "GENERATE_QUIZ_SHORT",
    purpose: "단답형 퀴즈 생성",
    args: "{ page }",
    runtimeEffect: "퀴즈 생성 후 퀴즈 모달을 연다.",
    example:
      '{"type":"CALL_TOOL","tool":"GENERATE_QUIZ_SHORT","args":{"page":4}}'
  },
  {
    tool: "GENERATE_QUIZ_ESSAY",
    purpose: "서술형 퀴즈 생성",
    args: "{ page }",
    runtimeEffect: "퀴즈 생성 후 퀴즈 모달을 연다.",
    example:
      '{"type":"CALL_TOOL","tool":"GENERATE_QUIZ_ESSAY","args":{"page":5}}'
  },
  {
    tool: "AUTO_GRADE_MCQ_OX",
    purpose: "객관식/OX 자동 채점",
    args: "{ quizId, userAnswers }",
    runtimeEffect: "정답 비교 채점을 수행하고 필요하면 복습 유도 메시지를 낸다.",
    example:
      '{"type":"CALL_TOOL","tool":"AUTO_GRADE_MCQ_OX","args":{"quizId":"quiz_123","userAnswers":{"q1":"c1"}}}'
  },
  {
    tool: "GRADE_SHORT_OR_ESSAY",
    purpose: "단답형/서술형 LLM 채점",
    args: "{ quizId, userAnswers }",
    runtimeEffect: "LLM 채점을 수행하고 필요하면 복습 유도 메시지를 낸다.",
    example:
      '{"type":"CALL_TOOL","tool":"GRADE_SHORT_OR_ESSAY","args":{"quizId":"quiz_123","userAnswers":{"q1":"..."}}}'
  },
  {
    tool: "WRITE_FEEDBACK_ENTRY",
    purpose: "진행 메모 기록",
    args: "{ page, notesHint }",
    runtimeEffect: "학습 피드백 로그에 짧은 내부 기록을 추가한다.",
    example:
      '{"type":"CALL_TOOL","tool":"WRITE_FEEDBACK_ENTRY","args":{"page":2,"notesHint":"퀴즈 선택 대기"}}'
  }
];

function isNextPageCommand(text: string): boolean {
  return /(다음\s*페이지|다음으로|넘어가|다음\s*슬라이드|next\s*page|next\b)/i.test(text);
}

function isPreviousPageCommand(text: string): boolean {
  return /(이전\s*페이지|앞으로\s*돌아가|previous\s*page|prev\b)/i.test(text);
}

function recentScoreStats(session: SessionState): {
  count: number;
  avg: number;
  last: number;
} {
  const ratios = session.quizzes
    .filter((quiz) => quiz.grading?.status === "GRADED")
    .slice(-4)
    .map((quiz) => quiz.grading?.scoreRatio ?? 0);

  if (ratios.length === 0) {
    return { count: 0, avg: 0, last: 0 };
  }

  const avg = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  return { count: ratios.length, avg, last: ratios[ratios.length - 1] ?? 0 };
}

function isCorePage(input: OrchestratorInput, page: number): boolean {
  const pageState = input.session.pageStates.find((item) => item.page === page);
  const text = `${input.pageText}\n${pageState?.explainSummary ?? ""}\n${pageState?.explainMarkdown ?? ""}`.toLowerCase();
  const keywordHit = CORE_PAGE_KEYWORDS.some((keyword) => text.includes(keyword));
  const formulaLikeHit = /[=∑∫√]/.test(text);
  return keywordHit || formulaLikeHit || input.pageText.length > 600;
}

function memoryOf(session: SessionState) {
  return session.integratedMemory ?? createInitialIntegratedMemory();
}

function preferredQuizType(session: SessionState): QuizType | null {
  return memoryOf(session).preferredQuizTypes[0] ?? null;
}

function recommendQuizType(session: SessionState): QuizType {
  const preferred = preferredQuizType(session);
  if (preferred) return preferred;
  if (session.learnerModel.level === "BEGINNER") return "OX";
  if (session.learnerModel.level === "ADVANCED") return "SHORT";
  return "MCQ";
}

function recommendedDetailLevel(
  input: OrchestratorInput,
  page: number
): "NORMAL" | "DETAILED" {
  const memory = memoryOf(input.session);
  const stats = recentScoreStats(input.session);
  const lowPerformance =
    stats.count > 0 &&
    (stats.last < input.policy.passScoreRatio * 0.85 ||
      stats.avg < input.policy.passScoreRatio * 0.9);
  const weaknessHit = memory.weaknesses.some((concept) =>
    `${input.pageText}\n${memory.summaryMarkdown}`
      .toLowerCase()
      .includes(concept.toLowerCase())
  );
  if (memory.targetDifficulty === "FOUNDATIONAL") {
    return "DETAILED";
  }
  if (lowPerformance || weaknessHit) {
    return "DETAILED";
  }
  if (input.llmHint?.detailLevel === "DETAILED") {
    return "DETAILED";
  }
  return "NORMAL";
}

function shouldOfferQuiz(input: OrchestratorInput, page: number): boolean {
  const pageState = input.session.pageStates.find((item) => item.page === page);
  const stats = recentScoreStats(input.session);
  const lowPerformance =
    stats.count > 0 &&
    (stats.last < input.policy.passScoreRatio * 0.85 || stats.avg < input.policy.passScoreRatio);

  const attemptsOnPage = input.session.quizzes.filter(
    (quiz) => quiz.createdFromPage === page
  ).length;
  const hasStrongScore =
    (pageState?.quiz?.bestScoreRatio ?? 0) >= input.policy.passScoreRatio;

  if (hasStrongScore && !lowPerformance) {
    return false;
  }
  if (lowPerformance) {
    return attemptsOnPage < 2;
  }
  if (attemptsOnPage > 0) {
    return false;
  }
  return isCorePage(input, page) || page % 4 === 0;
}

function recentMessagesDigest(session: SessionState, recentN: number): string {
  return session.messages
    .slice(-recentN)
    .map((message) => `[${message.role}/${message.agent}] ${message.contentMarkdown.slice(0, 220)}`)
    .join("\n");
}

function recentQuizDigest(session: SessionState): string {
  return session.quizzes
    .slice(-4)
    .map((quiz) => {
      const score =
        quiz.grading?.status === "GRADED"
          ? `${quiz.grading.score}/${quiz.grading.maxScore} (${Math.round(
              (quiz.grading.scoreRatio ?? 0) * 100
            )}%)`
          : "미응시/미채점";
      return `quizId=${quiz.id}; page=${quiz.createdFromPage}; type=${quiz.quizType}; result=${score}; summary=${(quiz.grading?.summaryMarkdown ?? "").slice(0, 160)}`;
    })
    .join("\n");
}

function appendTool(tool: ToolName, args: Record<string, unknown>): OrchestratorAction {
  return {
    type: "CALL_TOOL",
    tool,
    args
  };
}

function promptBinaryDecision(
  contentMarkdown: string,
  decisionType:
    | "START_EXPLANATION_DECISION"
    | "QUIZ_DECISION"
    | "NEXT_PAGE_DECISION"
    | "REVIEW_DECISION"
    | "RETEST_DECISION"
): OrchestratorAction {
  return appendTool("PROMPT_BINARY_DECISION", {
    contentMarkdown,
    decisionType
  });
}

function openQuizTypePicker(
  session: SessionState,
  contentMarkdown = "퀴즈 유형을 선택해 주세요."
): OrchestratorAction {
  return appendTool("OPEN_QUIZ_TYPE_PICKER", {
    contentMarkdown,
    recommendedId: recommendQuizType(session)
  });
}

function pushExplainAndAutonomyFallback(
  actions: OrchestratorAction[],
  input: OrchestratorInput,
  page: number
): void {
  actions.push(
    appendTool("EXPLAIN_PAGE", {
      page,
      detailLevel: recommendedDetailLevel(input, page)
    })
  );

  if (shouldOfferQuiz(input, page)) {
    actions.push(
      promptBinaryDecision("현재 페이지 설명이 끝났습니다. 퀴즈를 진행할까요?", "QUIZ_DECISION")
    );
    return;
  }

  actions.push(
    promptBinaryDecision(
      "현재 페이지는 설명 로그를 저장했고, 퀴즈는 생략했습니다. 다음 페이지로 이동할까요?",
      "NEXT_PAGE_DECISION"
    )
  );
}

function buildFallbackPlan(input: OrchestratorInput): OrchestratorPlan {
  const eventType = input.event.type;
  const page = input.session.currentPage;
  const actions: OrchestratorAction[] = [];

  if (eventType === "SESSION_ENTERED") {
    actions.push(
      promptBinaryDecision(
        `학습 세션에 오신 것을 환영합니다. 현재 ${page}페이지입니다.\n\n바로 설명부터 시작할까요?`,
        "START_EXPLANATION_DECISION"
      )
    );
    return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
  }

  if (eventType === "START_EXPLANATION_DECISION") {
    const accept = Boolean(input.event.payload?.accept);
    if (!accept) {
      actions.push(
        appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
          contentMarkdown:
            "좋습니다. 준비되면 `예`를 눌러 설명을 시작하거나, 바로 질문을 입력해도 됩니다."
        })
      );
      return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
    }

    actions.push(
      appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
        contentMarkdown: `${page}페이지 설명을 시작합니다.`
      })
    );
    pushExplainAndAutonomyFallback(actions, input, page);
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "PAGE_CHANGED") {
    actions.push(
      appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
        contentMarkdown: `${page}페이지로 이동했습니다. 설명을 시작합니다.`
      })
    );
    pushExplainAndAutonomyFallback(actions, input, page);
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "USER_MESSAGE") {
    const text = String(input.event.payload?.text ?? "").trim();
    if (isNextPageCommand(text)) {
      if (page >= input.lectureNumPages) {
        actions.push(
          appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
            contentMarkdown:
              "이미 마지막 페이지입니다. 현재 페이지 질문 또는 복습을 진행해 주세요."
          })
        );
        return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
      }
      actions.push(
        appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
          contentMarkdown: `${page}페이지로 이동했습니다. 설명을 이어가겠습니다.`
        })
      );
      pushExplainAndAutonomyFallback(actions, input, page);
      return { schemaVersion: "1.0", actions, memoryWrite: null };
    }

    if (isPreviousPageCommand(text)) {
      const targetPage = Math.max(1, page - 1);
      actions.push(
        appendTool("SET_CURRENT_PAGE", {
          page: targetPage,
          contentMarkdown: `${targetPage}페이지로 돌아가겠습니다.`
        })
      );
      actions.push(
        appendTool("EXPLAIN_PAGE", {
          page: targetPage,
          detailLevel: "DETAILED"
        })
      );
      return { schemaVersion: "1.0", actions, memoryWrite: null };
    }

    if (/(퀴즈|시험|문제)/.test(text)) {
      actions.push(
        openQuizTypePicker(
          input.session,
          `좋습니다. 현재 ${page}페이지까지의 학습 내용(1~${page}페이지)을 기준으로 퀴즈를 만들겠습니다. 유형을 선택해 주세요.`
        )
      );
      actions.push(
        appendTool("WRITE_FEEDBACK_ENTRY", {
          page,
          notesHint: "퀴즈 선택 대기"
        })
      );
      return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
    }

    actions.push(
      appendTool("ANSWER_QUESTION", {
        questionText: text,
        page
      })
    );
    actions.push(
      promptBinaryDecision("이해하셨나요? 다음으로 넘어갈까요?", "NEXT_PAGE_DECISION")
    );
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "QUIZ_DECISION") {
    const accept = Boolean(input.event.payload?.accept);
    if (accept) {
      actions.push(openQuizTypePicker(input.session));
    } else {
      actions.push(
        promptBinaryDecision("퀴즈를 건너뛰겠습니다. 다음 페이지로 이동할까요?", "NEXT_PAGE_DECISION")
      );
    }
    return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
  }

  if (eventType === "NEXT_PAGE_DECISION") {
    const accept = Boolean(input.event.payload?.accept);
    if (!accept) {
      actions.push(
        appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
          contentMarkdown: "좋습니다. 현재 페이지를 유지합니다. 이어서 질문을 입력해 주세요."
        })
      );
      return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
    }

    const fromPage = Number(input.event.payload?.fromPage ?? page - 1);
    if (fromPage >= input.lectureNumPages) {
      actions.push(
        appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
          contentMarkdown: "이미 마지막 페이지입니다. 복습하거나 질문을 진행해 주세요."
        })
      );
      return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
    }

    actions.push(
      appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
        contentMarkdown: `${page}페이지로 이동했습니다. 설명을 이어가겠습니다.`
      })
    );
    pushExplainAndAutonomyFallback(actions, input, page);
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "QUIZ_TYPE_SELECTED") {
    const quizType = String(input.event.payload?.quizType ?? "MCQ").toUpperCase() as QuizType;
    const toolMap: Record<QuizType, ToolName> = {
      MCQ: "GENERATE_QUIZ_MCQ",
      OX: "GENERATE_QUIZ_OX",
      SHORT: "GENERATE_QUIZ_SHORT",
      ESSAY: "GENERATE_QUIZ_ESSAY"
    };
    actions.push(
      appendTool(toolMap[quizType] ?? "GENERATE_QUIZ_MCQ", {
        page
      })
    );
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "QUIZ_SUBMITTED") {
    const quizType = String(input.event.payload?.quizType ?? "MCQ").toUpperCase() as QuizType;
    actions.push(
      appendTool(
        quizType === "MCQ" || quizType === "OX"
          ? "AUTO_GRADE_MCQ_OX"
          : "GRADE_SHORT_OR_ESSAY",
        {
          quizId: String(input.event.payload?.quizId ?? ""),
          userAnswers: (input.event.payload?.answers ?? {}) as Record<string, unknown>
        }
      )
    );
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "REVIEW_DECISION") {
    const accept = Boolean(input.event.payload?.accept);
    if (accept) {
      actions.push(
        appendTool("EXPLAIN_PAGE", {
          page,
          detailLevel: "DETAILED"
        })
      );
      actions.push(
        promptBinaryDecision("복습을 완료했습니다. 재시험을 진행할까요?", "RETEST_DECISION")
      );
    } else {
      actions.push(
        appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
          contentMarkdown: "복습을 건너뛰었습니다. 다음 페이지로 진행 가능합니다."
        })
      );
    }
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "RETEST_DECISION") {
    const accept = Boolean(input.event.payload?.accept);
    if (accept) {
      actions.push(
        openQuizTypePicker(input.session, "재시험 유형을 선택해 주세요.")
      );
    } else {
      actions.push(
        appendTool("APPEND_ORCHESTRATOR_MESSAGE", {
          contentMarkdown: "재시험을 건너뛰었습니다. 다음 학습을 진행할 수 있습니다."
        })
      );
    }
    return { schemaVersion: "1.0", actions, memoryWrite: null };
  }

  if (eventType === "SAVE_AND_EXIT") {
    actions.push(
      appendTool("APPEND_SYSTEM_MESSAGE", {
        contentMarkdown: "세션을 저장했습니다."
      })
    );
    return { schemaVersion: "1.0", actions, stop: true, memoryWrite: null };
  }

  actions.push(
    appendTool("APPEND_SYSTEM_MESSAGE", {
      contentMarkdown: "요청을 이해하지 못했습니다. 다시 시도해 주세요."
    })
  );
  return { schemaVersion: "1.0", actions, memoryWrite: null };
}

function toolCatalogPromptText(): string {
  return ORCHESTRATOR_TOOL_CATALOG.map((entry) =>
    [
      `- ${entry.tool}`,
      `  목적: ${entry.purpose}`,
      `  인자: ${entry.args}`,
      `  효과: ${entry.runtimeEffect}`,
      `  예시: ${entry.example}`
    ].join("\n")
  ).join("\n");
}

function currentObjective(input: OrchestratorInput): string {
  const targetDifficulty = memoryOf(input.session).targetDifficulty;
  const difficultyLine: Record<QuizDifficultyTarget, string> = {
    FOUNDATIONAL: "기초를 다시 단단하게 다지는 방향",
    BALANCED: "이해와 적용의 균형을 맞추는 방향",
    CHALLENGING: "도전적이지만 감당 가능한 난도로 밀어주는 방향"
  };

  return [
    `현재 학습 목표 방향: ${difficultyLine[targetDifficulty]}`,
    "설명 에이전트는 학생 메모리를 참고해 쉬운 비유, 단계 분해, 오개념 교정, 압축 설명 여부를 스스로 조절해야 한다.",
    "시험 에이전트는 학생 메모리를 참고해 난이도, 약점 개념 비중, 문항 유형, 피드백 초점을 스스로 조절해야 한다.",
    "통합 메모리는 매번 쓰지 말고, 강한 증거가 있는 변화만 memoryWrite에 반영한다."
  ].join("\n");
}

export class Orchestrator {
  getToolCatalog(): ToolCatalogEntry[] {
    return ORCHESTRATOR_TOOL_CATALOG;
  }

  getResponseJsonSchema(): Record<string, unknown> {
    return z.toJSONSchema(orchestratorPlanSchema) as Record<string, unknown>;
  }

  buildPrompt(input: OrchestratorInput): string {
    const memory = memoryOf(input.session);
    const pageState = input.session.pageStates.find(
      (item) => item.page === input.session.currentPage
    );
    const stats = recentScoreStats(input.session);
    const recentMessages = recentMessagesDigest(
      input.session,
      input.policy.recentMessagesN
    );
    const recentQuizzes = recentQuizDigest(input.session);
    const pageHistoryDigest = buildPageHistoryDigest(
      input.session,
      input.session.currentPage
    );

    return [
      "너는 MergeEduAgent의 LLM 오케스트레이터다.",
      "반드시 한국어로 사고(thought)하고, 최종 answer 채널에는 JSON만 출력하라.",
      "answer 채널은 response_json_schema를 반드시 따라야 한다.",
      "이번 턴의 목표는 현재 이벤트에 대해 가장 적절한 tool call 시퀀스를 고르는 것이다.",
      "",
      "핵심 운영 규칙:",
      "- 액션은 최대 4개까지로 최소화한다.",
      "- 설명/퀴즈/복습/페이지 이동/질문응답을 모두 tool call로 결정한다.",
      "- 다음 페이지로 무조건 보내지 말고 이해도, 최근 점수, 현재 페이지 중요도를 함께 고려한다.",
      "- 퀴즈를 남발하지 말고, 핵심 페이지/저성취 구간/중요 학습 전환점에서 우선 고려한다.",
      "- 사용자가 명시적으로 질문하면 ANSWER_QUESTION을 우선 검토한다.",
      "- 사용자가 명시적으로 퀴즈를 원하면 OPEN_QUIZ_TYPE_PICKER 또는 직접 GENERATE_QUIZ_*를 선택할 수 있다.",
      "- 복습이 필요하면 EXPLAIN_PAGE(detailLevel=DETAILED) 또는 REVIEW_DECISION 프롬프트를 선택할 수 있다.",
      "- 강한 근거가 있을 때만 memoryWrite.shouldPersist=true 로 메모리를 갱신한다.",
      "- memoryWrite는 짧고 실용적으로 유지하고, 과잉 추론은 피한다.",
      "",
      currentObjective(input),
      "",
      `이벤트 타입: ${input.event.type}`,
      `이벤트 payload: ${JSON.stringify(input.event.payload ?? {}, null, 0)}`,
      `현재 페이지: ${input.session.currentPage}/${input.lectureNumPages}`,
      `현재 페이지 상태: ${pageState?.status ?? "NEW"}`,
      `현재 페이지 중요도 추정: ${isCorePage(input, input.session.currentPage) ? "CORE" : "NORMAL"}`,
      `최근 점수 통계: count=${stats.count}, avg=${stats.avg.toFixed(2)}, last=${stats.last.toFixed(2)}`,
      `권장 퀴즈 유형: ${recommendQuizType(input.session)}`,
      `권장 설명 깊이: ${recommendedDetailLevel(input, input.session.currentPage)}`,
      "",
      "현재 페이지 텍스트:",
      input.pageText.slice(0, 2400),
      "",
      "이전 페이지 참고:",
      input.neighborText.prev.slice(0, 800),
      "",
      "다음 페이지 참고:",
      input.neighborText.next.slice(0, 800),
      "",
      "통합 메모리:",
      buildIntegratedMemoryDigest({
        ...input.session,
        integratedMemory: memory
      }),
      "",
      "대화 요약:",
      input.session.conversationSummary || "(없음)",
      "",
      "최근 메시지:",
      recentMessages || "(없음)",
      "",
      "최근 퀴즈 기록:",
      recentQuizzes || "(없음)",
      "",
      "페이지 이력 요약:",
      pageHistoryDigest || "(없음)",
      "",
      "사용 가능한 tool mapping 표:",
      toolCatalogPromptText(),
      "",
      "판단 가이드:",
      "- direct autonomy 가 필요하면 SET_CURRENT_PAGE 후 EXPLAIN_PAGE를 사용할 수 있다.",
      "- 사용자의 명시적 동의가 더 자연스러운 순간에는 PROMPT_BINARY_DECISION을 먼저 사용한다.",
      "- 강의 시작 직후에는 START_EXPLANATION_DECISION을 우선 고려한다.",
      "- 사용자가 너무 못한 경우에는 바로 DETAILED 설명 또는 복습 제안을 사용할 수 있다.",
      "- quiz는 학생의 약점과 목표 난이도에 맞게 유형과 시점을 선택한다.",
      "- memoryWrite에는 strengths/weaknesses/misconceptions/explanationPreferences/preferredQuizTypes/targetDifficulty/nextCoachingGoals 중 꼭 필요한 것만 적는다.",
      "- answer에는 JSON 외 다른 텍스트를 절대 넣지 마라."
    ].join("\n");
  }

  fallback(input: OrchestratorInput): OrchestratorPlan {
    return buildFallbackPlan(input);
  }

  // Production requests go through OrchestrationEngine.planWithLlm().
  // This method remains as a deterministic fallback for tests and recovery.
  run(input: OrchestratorInput): OrchestratorPlan {
    return this.fallback(input);
  }
}
