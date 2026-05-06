import { BuiltInStudentCompetencyKey } from "../../types/domain.js";

export interface BuiltInReportCriterionDefinition {
  key: BuiltInStudentCompetencyKey;
  name: string;
  description: string;
}

export const REPORT_BUILT_IN_CRITERIA = [
  {
    key: "CONCEPT_UNDERSTANDING",
    name: "개념 이해도",
    description: "핵심 개념을 정확히 파악하고 연결해서 이해하는 힘"
  },
  {
    key: "QUESTION_QUALITY",
    name: "질문 구체성",
    description: "수업 중 질문이 구체적이고 학습 병목을 잘 드러내는 정도"
  },
  {
    key: "PROBLEM_SOLVING",
    name: "문제 해결력",
    description: "퀴즈와 문항 풀이에서 답을 구성해내는 능력"
  },
  {
    key: "APPLICATION_TRANSFER",
    name: "응용·전이력",
    description: "배운 내용을 새로운 문제나 문맥에 연결하는 능력"
  },
  {
    key: "QUIZ_ACCURACY",
    name: "퀴즈 정확도",
    description: "시험·퀴즈에서 실제 정답률로 드러난 성취도"
  },
  {
    key: "LEARNING_PERSISTENCE",
    name: "학습 지속성",
    description: "페이지 이동, 누적 세션, 반복 학습에서 보이는 꾸준함"
  },
  {
    key: "SELF_REFLECTION",
    name: "오답 성찰력",
    description: "피드백과 약점 메모를 바탕으로 스스로 보완하는 힘"
  },
  {
    key: "CLASS_PARTICIPATION",
    name: "수업 참여도",
    description: "질문, 응답, 세션 활동량으로 확인되는 참여 수준"
  },
  {
    key: "CONFIDENCE_GROWTH",
    name: "학습 자신감",
    description: "학습자 모델 confidence와 반응 흐름에서 보이는 자신감"
  },
  {
    key: "IMPROVEMENT_MOMENTUM",
    name: "성장 모멘텀",
    description: "최근 흐름이 좋아지고 있는지, 다음 상승 여지가 있는지"
  }
] satisfies ReadonlyArray<BuiltInReportCriterionDefinition>;

export const REPORT_BUILT_IN_CRITERION_NAMES = REPORT_BUILT_IN_CRITERIA.map(
  (criterion) => criterion.name
);

const REPORT_BUILT_IN_CRITERION_NAME_SET = new Set(
  REPORT_BUILT_IN_CRITERION_NAMES.map(normalizeReportCriterionName)
);

export function normalizeReportCriterionName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function isBuiltInReportCriterionName(value: string): boolean {
  return REPORT_BUILT_IN_CRITERION_NAME_SET.has(normalizeReportCriterionName(value));
}
