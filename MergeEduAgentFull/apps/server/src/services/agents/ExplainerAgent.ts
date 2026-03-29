import { appConfig } from "../../config.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";

export class ExplainerAgent {
  constructor(private readonly bridge: GeminiBridgeClient) {}

  async run(input: {
    fileRef: { fileName: string; fileUri: string; mimeType: string };
    page: number;
    pageText: string;
    neighborText: { prev: string; next: string };
    detailLevel?: "NORMAL" | "DETAILED";
    learnerLevel: string;
    learnerMemoryDigest: string;
  }): Promise<string> {
    const response = await this.runStream(input);
    return response.markdown || `${input.page}페이지 핵심을 정리했습니다.`;
  }

  async runStream(
    input: {
      fileRef: { fileName: string; fileUri: string; mimeType: string };
      page: number;
      pageText: string;
      neighborText: { prev: string; next: string };
      detailLevel?: "NORMAL" | "DETAILED";
      learnerLevel: string;
      learnerMemoryDigest: string;
    },
    onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void
  ): Promise<{ markdown: string; thoughtSummary: string }> {
    const response = await this.bridge.explainPageStream(
      {
        model: appConfig.modelName,
        fileRef: input.fileRef,
        page: input.page,
        pageText: input.pageText,
        neighborText: input.neighborText,
        detailLevel: input.detailLevel ?? "NORMAL",
        learnerLevel: input.learnerLevel,
        learnerMemoryDigest: input.learnerMemoryDigest
      },
      onDelta
    );
    return {
      markdown: response.markdown || `${input.page}페이지 핵심을 정리했습니다.`,
      thoughtSummary: response.thoughtSummary
    };
  }
}
