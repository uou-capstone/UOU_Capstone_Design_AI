import {
  ReportCriteriaAssistantMethod,
  ReportCriteriaAssistantProposal,
  StudentReportCustomCriterion
} from "../../types/domain.js";
import {
  REPORT_BUILT_IN_CRITERIA,
  isBuiltInReportCriterionName,
  normalizeReportCriterionName
} from "./reportCriteriaCatalog.js";

export type ReportCriteriaAssistantStage =
  | "UNDERSTANDING_REQUEST"
  | "CHECKING_CRITERIA"
  | "GENERATING_CRITERION"
  | "VALIDATING_APPLICABILITY"
  | "READY_TO_APPLY"
  | "COMPLETE";

export interface ReportCriteriaAssistantMessage {
  role: "user" | "assistant";
  contentMarkdown: string;
}

export interface ReportCriteriaAssistantCriterionDraft {
  name: string;
  description: string;
}

export const REPORT_CRITERIA_ASSISTANT_SAFE_THOUGHT_DELTA =
  "AI가 평가 항목 요청과 현재 분석 기준을 안전한 JSON 구조로 정리하고 있습니다.";

export const REPORT_CRITERIA_ASSISTANT_SAFE_THOUGHT_SUMMARY =
  "AI가 평가 항목 제안과 적용 가능성을 JSON으로 정리했습니다.";

export const REPORT_CRITERIA_ASSISTANT_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyMarkdown: { type: "string" },
    operation: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: {
          type: "string",
          enum: [
            "messageOnly",
            "draftCriterion",
            "reviseCriterion",
            "createCriterion",
            "updateCriterion",
            "deleteCriterion"
          ]
        },
        params: {
          type: "object",
          additionalProperties: false,
          properties: {
            criterion: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" }
              },
              required: ["name", "description"]
            },
            targetCriterionId: { type: "string" },
            targetCriterionName: { type: "string" },
            targetCriterionDescription: { type: "string" },
            targetCriterionUpdatedAt: { type: "string" },
            rationale: { type: "string" },
            summaryCards: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  body: { type: "string" }
                },
                required: ["title", "body"]
              }
            }
          }
        }
      },
      required: ["method"]
    },
    source: { type: "string", enum: ["AI", "AI_UNAVAILABLE"] },
    fallback: { type: "boolean" }
  },
  required: ["replyMarkdown", "operation"]
} as const;

const APPLY_INTENT_REGEX =
  /(반영|적용|저장|등록|apply|save)|((이|그|방금|현재|위|해당)\s*(항목|제안|내용)?\s*(을|를)?\s*(추가|넣어|add))|((항목|목록|관리|기준)\s*(에|으로)?\s*(추가|넣어|add))/i;
const NEGATED_APPLY_INTENT_REGEX =
  /(반영|적용|저장|등록|추가|넣어|apply|save|add)\s*(은|는|이|가|을|를|도|만)?\s*(하지\s*(는|도)?(?=$|\s|[.,!?])|하지\s*(는|도)?\s*(마|말|말고|않)|안\s*해|말아|보류|취소|금지|no|not|never)|do\s+not\s+(apply|save|add)|don't\s+(apply|save|add)|dont\s+(apply|save|add)|not\s+(apply|save|add)/i;

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trim() : trimmed;
}

function safeString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? truncate(value, maxLength) : "";
}

function compactCriterionText(value: string): string {
  return normalizeReportCriterionName(value).replace(/\s+/g, "");
}

const REPORT_CRITERION_MENTION_SUFFIXES = [
  "을",
  "를",
  "은",
  "는",
  "이",
  "가",
  "도",
  "만",
  "의",
  "에",
  "에서",
  "으로",
  "로",
  "와",
  "과",
  "랑",
  "하고",
  "관련",
  "내용",
  "설명",
  "항목",
  "기준",
  "부분",
  "대상",
  "삭제",
  "제거",
  "수정",
  "변경",
  "고쳐",
  "바꿔",
  "반영",
  "적용",
  "저장",
  "좀",
  "해",
  "해줘",
  "해주세요",
  "줘",
  "주세요"
];

const REPORT_CRITERION_MENTION_PREFIXES = [
  "그",
  "이",
  "저",
  "위",
  "해당",
  "현재",
  "방금",
  "기존",
  "추가",
  "의"
];

function isReportCriterionMentionedInMessage(message: string, criterionName: string): boolean {
  const messageCompact = compactCriterionText(message);
  const criterionCompact = compactCriterionText(criterionName);
  if (criterionCompact.length < 2) return false;
  let searchIndex = 0;
  while (searchIndex < messageCompact.length) {
    const index = messageCompact.indexOf(criterionCompact, searchIndex);
    if (index === -1) return false;
    const leading = messageCompact.slice(0, index);
    const trailing = messageCompact.slice(index + criterionCompact.length);
    const hasLeadingBoundary =
      !leading ||
      /[^0-9a-z가-힣]$/i.test(leading) ||
      REPORT_CRITERION_MENTION_PREFIXES.some((prefix) => leading.endsWith(prefix));
    if (!hasLeadingBoundary) {
      searchIndex = index + criterionCompact.length;
      continue;
    }
    if (
      !trailing ||
      /^[^0-9a-z가-힣]/i.test(trailing) ||
      REPORT_CRITERION_MENTION_SUFFIXES.some((suffix) => trailing.startsWith(suffix))
    ) {
      return true;
    }
    searchIndex = index + criterionCompact.length;
  }
  return false;
}

function sanitizeCriterion(value: unknown): ReportCriteriaAssistantCriterionDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const name = safeString(candidate.name, 60);
  const description = safeString(candidate.description, 600);
  if (!name || !description) return null;
  return { name, description };
}

function fallbackCriterionFromMessage(message: string): ReportCriteriaAssistantCriterionDraft {
  if (/발표|말하기|프레젠테이션/i.test(message)) {
    return {
      name: "발표 논리력",
      description: "발표나 답변에서 주장, 근거, 예시를 연결해 설득력 있게 표현하는 정도를 평가합니다."
    };
  }
  if (/협업|팀|모둠|참여/i.test(message)) {
    return {
      name: "협업 태도",
      description: "모둠 활동과 토론에서 역할을 수행하고 다른 학생의 의견을 학습 흐름에 연결하는 정도를 평가합니다."
    };
  }
  if (/질문|탐구|호기심/i.test(message)) {
    return {
      name: "탐구 확장성",
      description: "기본 개념을 넘어 추가 질문을 만들고 자료나 예시를 통해 이해를 확장하는 정도를 평가합니다."
    };
  }
  return {
    name: "학습 조절력",
    description: "피드백과 학습 기록을 바탕으로 다음 학습 행동을 스스로 조정하고 실행하는 정도를 평가합니다."
  };
}

function findBuiltInMention(message: string, targetCriterionName = ""): boolean {
  const targetNameNormalized = normalizeReportCriterionName(targetCriterionName);
  return REPORT_BUILT_IN_CRITERIA.some((criterion) => {
    return (
      normalizeReportCriterionName(criterion.name) === targetNameNormalized ||
      isReportCriterionMentionedInMessage(message, criterion.name)
    );
  });
}

function findMessageCriterionMatches(
  message: string,
  customCriteria: StudentReportCustomCriterion[]
): StudentReportCustomCriterion[] {
  return customCriteria.filter((criterion) =>
    isReportCriterionMentionedInMessage(message, criterion.name)
  );
}

function uniqueById(
  criteria: StudentReportCustomCriterion[]
): StudentReportCustomCriterion[] {
  return Array.from(new Map(criteria.map((criterion) => [criterion.id, criterion])).values());
}

function exactTargetNameMatches(
  targetCriterionName: string,
  customCriteria: StudentReportCustomCriterion[]
): StudentReportCustomCriterion[] {
  const normalizedTargetName = normalizeReportCriterionName(targetCriterionName);
  if (!normalizedTargetName) return [];
  return customCriteria.filter(
    (criterion) => normalizeReportCriterionName(criterion.name) === normalizedTargetName
  );
}

function hasDuplicateCustomCriterionName(
  customCriteria: StudentReportCustomCriterion[],
  name: string,
  excludingCriterionId = ""
): boolean {
  const normalizedName = normalizeReportCriterionName(name);
  return customCriteria.some(
    (criterion) =>
      criterion.id !== excludingCriterionId &&
      normalizeReportCriterionName(criterion.name) === normalizedName
  );
}

function resolveAssistantTargetCriterion(context: {
  message: string;
  paramsCandidate: Record<string, unknown>;
  customCriteria: StudentReportCustomCriterion[];
}): {
  target?: StudentReportCustomCriterion;
  downgradeReason?: string;
  builtInBlocked?: boolean;
} {
  const targetCriterionId = safeString(context.paramsCandidate.targetCriterionId, 120);
  const targetCriterionName = safeString(context.paramsCandidate.targetCriterionName, 120);
  if (findBuiltInMention(context.message, targetCriterionName)) {
    return { downgradeReason: "built_in_target", builtInBlocked: true };
  }

  const messageMatches = uniqueById(
    findMessageCriterionMatches(context.message, context.customCriteria)
  );

  if (targetCriterionId) {
    const idMatch = context.customCriteria.find((criterion) => criterion.id === targetCriterionId);
    if (!idMatch) {
      return { downgradeReason: "unknown_target" };
    }
    if (targetCriterionName) {
      if (
        normalizeReportCriterionName(idMatch.name) !==
        normalizeReportCriterionName(targetCriterionName)
      ) {
        return { downgradeReason: "target_id_name_mismatch" };
      }
      if (messageMatches.length === 1 && messageMatches[0].id !== idMatch.id) {
        return { downgradeReason: "target_message_mismatch" };
      }
      if (messageMatches.length > 1) {
        return { downgradeReason: "ambiguous_target" };
      }
      return { target: idMatch };
    }
    if (messageMatches.length === 1 && messageMatches[0].id === idMatch.id) {
      return { target: idMatch };
    }
    if (messageMatches.length > 1) {
      return { downgradeReason: "ambiguous_target" };
    }
    return { downgradeReason: "target_name_required" };
  }

  if (targetCriterionName) {
    const targetNameMatches = exactTargetNameMatches(targetCriterionName, context.customCriteria);
    if (targetNameMatches.length === 1) {
      if (messageMatches.length === 1 && messageMatches[0].id !== targetNameMatches[0].id) {
        return { downgradeReason: "target_message_mismatch" };
      }
      if (messageMatches.length > 1) {
        return { downgradeReason: "ambiguous_target" };
      }
      return { target: targetNameMatches[0] };
    }
    return {
      downgradeReason: targetNameMatches.length > 1 ? "ambiguous_target" : "unknown_target"
    };
  }

  if (messageMatches.length === 1) {
    return { target: messageMatches[0] };
  }
  return {
    downgradeReason: messageMatches.length > 1 ? "ambiguous_target" : "target_name_required"
  };
}

export class ReportCriteriaAssistantService {
  readonly stages: Array<{
    stage: ReportCriteriaAssistantStage;
    label: string;
    progress: number;
    detail?: string;
  }> = [
    {
      stage: "UNDERSTANDING_REQUEST",
      label: "요청 이해",
      progress: 0.12,
      detail: "교사가 원하는 평가 관점을 정리하고 있습니다."
    },
    {
      stage: "CHECKING_CRITERIA",
      label: "기본/추가 항목 검토",
      progress: 0.32,
      detail: "현재 평가 기준과 겹치지 않는지 확인합니다."
    },
    {
      stage: "GENERATING_CRITERION",
      label: "새 항목 초안 생성",
      progress: 0.56,
      detail: "리포트 분석에 넣을 항목 이름과 설명을 작성합니다."
    },
    {
      stage: "VALIDATING_APPLICABILITY",
      label: "적용 가능성 확인",
      progress: 0.76,
      detail: "중복, 길이, 분석 기준 적합성을 검토합니다."
    },
    {
      stage: "READY_TO_APPLY",
      label: "항목 추가 준비 완료",
      progress: 0.9,
      detail: "검토 후 항목에 반영할 수 있습니다."
    },
    {
      stage: "COMPLETE",
      label: "완료",
      progress: 1
    }
  ];

  sanitizeMessage(value: unknown): { message?: string; error?: string } {
    const message = typeof value === "string" ? value.trim() : "";
    if (!message) return { error: "message is required" };
    if (message.length > 2000) return { error: "message must be 2000 characters or fewer" };
    return { message };
  }

  sanitizeHistory(value: unknown): ReportCriteriaAssistantMessage[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const role = candidate.role === "user" || candidate.role === "assistant"
          ? candidate.role
          : null;
        const contentMarkdown = safeString(candidate.contentMarkdown, 1200);
        if (!role || !contentMarkdown) return null;
        return { role, contentMarkdown };
      })
      .filter((item): item is ReportCriteriaAssistantMessage => Boolean(item))
      .slice(-8);
  }

  sanitizeCurrentProposal(value: unknown): ReportCriteriaAssistantCriterionDraft | null {
    return sanitizeCriterion(value);
  }

  hasExplicitApplyIntent(message: string): boolean {
    return APPLY_INTENT_REGEX.test(message) && !NEGATED_APPLY_INTENT_REGEX.test(message);
  }

  buildBridgeInput(input: {
    model: string;
    message: string;
    history: ReportCriteriaAssistantMessage[];
    currentProposal: ReportCriteriaAssistantCriterionDraft | null;
    customCriteria: StudentReportCustomCriterion[];
  }): Record<string, unknown> {
    return {
      model: input.model,
      message: input.message,
      history: input.history,
      currentProposal: input.currentProposal,
      builtInCriteria: REPORT_BUILT_IN_CRITERIA.map((criterion) => ({
        key: criterion.key,
        name: criterion.name,
        description: criterion.description
      })),
      customCriteria: input.customCriteria.map((criterion) => ({
        id: criterion.id,
        name: criterion.name,
        description: criterion.description,
        updatedAt: criterion.updatedAt
      })),
      responseJsonSchema: REPORT_CRITERIA_ASSISTANT_RESPONSE_JSON_SCHEMA
    };
  }

  sanitizeProposal(
    value: unknown,
    context: {
      message: string;
      currentProposal: ReportCriteriaAssistantCriterionDraft | null;
      customCriteria: StudentReportCustomCriterion[];
      fallback?: boolean;
    }
  ): ReportCriteriaAssistantProposal {
    const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const operationCandidate =
      candidate.operation && typeof candidate.operation === "object"
        ? candidate.operation as Record<string, unknown>
        : {};
    const paramsCandidate =
      operationCandidate.params && typeof operationCandidate.params === "object"
        ? operationCandidate.params as Record<string, unknown>
        : {};

    const rawMethod = typeof operationCandidate.method === "string"
      ? operationCandidate.method
      : "messageOnly";
    const method: ReportCriteriaAssistantMethod =
      rawMethod === "draftCriterion" ||
      rawMethod === "reviseCriterion" ||
      rawMethod === "createCriterion" ||
      rawMethod === "updateCriterion" ||
      rawMethod === "deleteCriterion" ||
      rawMethod === "messageOnly"
        ? rawMethod
        : "messageOnly";

    const summaryCards = Array.isArray(paramsCandidate.summaryCards)
      ? paramsCandidate.summaryCards
          .map((item) => {
            const card = item && typeof item === "object" ? item as Record<string, unknown> : {};
            const title = safeString(card.title, 40);
            const body = safeString(card.body, 110);
            return title && body ? { title, body } : null;
          })
          .filter((item): item is { title: string; body: string } => Boolean(item))
          .slice(0, 3)
      : [];

    const proposedCriterion = sanitizeCriterion(paramsCandidate.criterion);
    const isCreateLikeMethod =
      method === "draftCriterion" || method === "reviseCriterion" || method === "createCriterion";
    const isUpdateMethod = method === "updateCriterion";
    const isDeleteMethod = method === "deleteCriterion";
    const currentCriterion = isCreateLikeMethod ? context.currentProposal : null;
    const fallbackCriterion =
      isCreateLikeMethod && method !== "createCriterion"
        ? fallbackCriterionFromMessage(context.message)
        : null;
    const criterion = isUpdateMethod
      ? proposedCriterion
      : proposedCriterion ?? currentCriterion ?? fallbackCriterion;
    const criterionSource = proposedCriterion
      ? "proposal"
      : currentCriterion
        ? "current"
        : fallbackCriterion
          ? "fallback"
          : "none";

    let finalMethod: ReportCriteriaAssistantMethod =
      isDeleteMethod ? "deleteCriterion" : criterion ? method : "messageOnly";
    let targetCriterion: StudentReportCustomCriterion | undefined;
    let downgradeReason = "";

    if (isUpdateMethod || isDeleteMethod) {
      const targetResolution = resolveAssistantTargetCriterion({
        message: context.message,
        paramsCandidate,
        customCriteria: context.customCriteria
      });
      downgradeReason = targetResolution.downgradeReason ?? "";
      targetCriterion = targetResolution.target;
      if (targetResolution.builtInBlocked) {
        finalMethod = "messageOnly";
      } else if (!targetCriterion) {
        finalMethod = "messageOnly";
      } else if (isUpdateMethod && !proposedCriterion) {
        finalMethod = "messageOnly";
        downgradeReason = "missing_update_criterion";
      }
    }
    if (criterionSource === "fallback" && finalMethod !== "messageOnly") {
      finalMethod = "draftCriterion";
    }
    if (finalMethod === "createCriterion" && !this.hasExplicitApplyIntent(context.message)) {
      finalMethod = criterion ? "draftCriterion" : "messageOnly";
    }
    if (
      finalMethod === "createCriterion" &&
      (context.fallback || (criterionSource !== "proposal" && criterionSource !== "current"))
    ) {
      finalMethod = "draftCriterion";
    }

    const duplicate =
      criterion &&
      (isBuiltInReportCriterionName(criterion.name) ||
        context.customCriteria.some(
          (item) =>
            item.id !== targetCriterion?.id &&
            normalizeReportCriterionName(item.name) === normalizeReportCriterionName(criterion.name)
        ));

    const downgradeReplyMarkdown =
      downgradeReason === "built_in_target"
        ? "기본 평가 항목은 수정하거나 삭제할 수 없습니다. 추가 평가 항목 중에서 변경할 항목을 알려 주세요."
        : downgradeReason
          ? "어떤 추가 평가 항목을 수정하거나 삭제할지 정확히 확인해 주세요."
          : "";
    const replyMarkdown =
      downgradeReplyMarkdown ||
      safeString(candidate.replyMarkdown, 900) ||
      (isDeleteMethod && targetCriterion
          ? `${targetCriterion.name} 항목을 제거할지 확인해 주세요.`
        : isUpdateMethod && targetCriterion && criterion
          ? `${targetCriterion.name} 항목을 수정한 초안을 준비했습니다. 검토한 뒤 수정하기를 눌러 주세요.`
        : criterion
        ? `${criterion.name} 항목 초안을 만들었습니다. 검토한 뒤 항목에 반영해 주세요.`
            : "요청을 이해했습니다. 추가로 평가하고 싶은 학생 행동이나 근거를 알려 주세요.");

    const includeMessageOnlyMetadata = finalMethod !== "messageOnly";
    const includeCriterion = includeMessageOnlyMetadata && Boolean(criterion);
    const includeTarget =
      finalMethod === "updateCriterion" || finalMethod === "deleteCriterion";
    const params =
      includeCriterion ||
      includeTarget ||
      (includeMessageOnlyMetadata && summaryCards.length) ||
      (includeMessageOnlyMetadata && paramsCandidate.rationale)
        ? {
            ...(includeCriterion && criterion ? { criterion } : {}),
            ...(includeTarget && targetCriterion
              ? {
                  targetCriterionId: targetCriterion.id,
                  targetCriterionName: targetCriterion.name,
                  targetCriterionDescription: targetCriterion.description,
                  targetCriterionUpdatedAt: targetCriterion.updatedAt
                }
              : {}),
            ...(includeMessageOnlyMetadata && paramsCandidate.rationale
              ? { rationale: safeString(paramsCandidate.rationale, 240) }
              : {}),
            ...(includeMessageOnlyMetadata && summaryCards.length ? { summaryCards } : {})
          }
        : undefined;

    return {
      replyMarkdown,
      operation: {
        method: finalMethod,
        ...(params ? { params } : {})
      },
      source: context.fallback ? "AI_UNAVAILABLE" : "AI",
      ...(context.fallback ? { fallback: true } : {}),
      ...(downgradeReason ? { downgradeReason } : {}),
      ...(duplicate
        ? {
            replyMarkdown:
              `${replyMarkdown}\n\n이미 있는 평가 항목과 이름이 겹칠 수 있어 반영 전 이름을 조정해 주세요.`
          }
        : {})
    };
  }

  fallbackProposal(context: {
    message: string;
    currentProposal: ReportCriteriaAssistantCriterionDraft | null;
    customCriteria: StudentReportCustomCriterion[];
  }): ReportCriteriaAssistantProposal {
    const criterion = context.currentProposal ?? fallbackCriterionFromMessage(context.message);
    return this.sanitizeProposal(
      {
        replyMarkdown:
          "AI 응답을 안정적으로 가져오지 못해 안전한 기본 초안을 준비했습니다. 내용을 확인한 뒤 직접 반영해 주세요.",
        operation: {
          method: "draftCriterion",
          params: {
            criterion,
            rationale: "현재 요청에서 드러난 평가 관점을 바탕으로 중복되지 않는 개인화 기준을 제안했습니다.",
            summaryCards: [
              {
                title: "중복 항목 확인",
                body: "기본 평가 항목과 겹치지 않도록 이름을 검토했습니다."
              },
              {
                title: "의도 파악",
                body: "교사가 보고 싶은 학생 행동을 평가 기준으로 압축했습니다."
              },
              {
                title: "설명 생성",
                body: "리포트 분석에 바로 사용할 수 있는 설명 문장으로 정리했습니다."
              }
            ]
          }
        }
      },
      {
        ...context,
        fallback: true
      }
    );
  }
}
