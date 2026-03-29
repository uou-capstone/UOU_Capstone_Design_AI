import { appConfig } from "../../config.js";
import { LearnerLevel } from "../../types/domain.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";

export class QaAgent {
  constructor(private readonly bridge: GeminiBridgeClient) {}

  async run(input: {
    fileRef: { fileName: string; fileUri: string; mimeType: string };
    page: number;
    question: string;
    learnerLevel: LearnerLevel;
    pageText: string;
    neighborText: { prev: string; next: string };
    learnerMemoryDigest: string;
  }): Promise<string> {
    const response = await this.runStream(input);
    return response.markdown || "현재 질문에 대한 답변을 생성하지 못했습니다.";
  }

  async runStream(
    input: {
      fileRef: { fileName: string; fileUri: string; mimeType: string };
      page: number;
      question: string;
      learnerLevel: LearnerLevel;
      pageText: string;
      neighborText: { prev: string; next: string };
      learnerMemoryDigest: string;
    },
    onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void
  ): Promise<{ markdown: string; thoughtSummary: string }> {
    const response = await this.bridge.answerQuestionStream(
      {
        model: appConfig.modelName,
        fileRef: input.fileRef,
        page: input.page,
        question: input.question,
        learnerLevel: input.learnerLevel,
        pageText: input.pageText,
        neighborText: input.neighborText,
        learnerMemoryDigest: input.learnerMemoryDigest
      },
      onDelta
    );
    return {
      markdown: response.markdown || "현재 질문에 대한 답변을 생성하지 못했습니다.",
      thoughtSummary: response.thoughtSummary
    };
  }
}
