import { appConfig } from "../../config.js";
import { LearnerLevel, LectureItem } from "../../types/domain.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";

export class MisconceptionRepairAgent {
  constructor(private readonly bridge: GeminiBridgeClient) {}

  async runStream(input: {
    fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
    page: number;
    learnerLevel: LearnerLevel;
    pageText: string;
    neighborText: { prev: string; next: string };
    learnerMemoryDigest: string;
    repairQuestion: string;
  }, onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void, signal?: AbortSignal): Promise<{
    markdown: string;
    thoughtSummary: string;
  }> {
    const response = await this.bridge.answerQuestionStream(
      {
        model: appConfig.modelName,
        fileRef: input.fileRef,
        page: input.page,
        question: input.repairQuestion,
        learnerLevel: input.learnerLevel,
        pageText: input.pageText,
        neighborText: input.neighborText,
        learnerMemoryDigest: input.learnerMemoryDigest
      },
      onDelta,
      signal
    );

    return {
      markdown: response.markdown || "헷갈린 부분을 다시 짧게 정리했습니다.",
      thoughtSummary: response.thoughtSummary
    };
  }
}
