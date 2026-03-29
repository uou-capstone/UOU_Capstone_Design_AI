import { appConfig } from "../../config.js";
import { GradingResult, QuizJson } from "../../types/domain.js";
import { parseGrading } from "../llm/JsonSchemaGuards.js";
import { GeminiBridgeClient } from "../llm/GeminiBridgeClient.js";

export class GraderAgent {
  constructor(private readonly bridge: GeminiBridgeClient) {}

  async grade(input: {
    fileRef: { fileName: string; fileUri: string; mimeType: string };
    page: number;
    quiz: QuizJson;
    answers: Record<string, unknown>;
    learnerMemoryDigest: string;
  }): Promise<GradingResult> {
    const streamed = await this.gradeStream(input);
    return streamed.grading;
  }

  async gradeStream(
    input: {
      fileRef: { fileName: string; fileUri: string; mimeType: string };
      page: number;
      quiz: QuizJson;
      answers: Record<string, unknown>;
      learnerMemoryDigest: string;
    },
    onDelta?: (delta: { channel: "thought" | "answer"; text: string }) => void
  ): Promise<{ grading: GradingResult; thoughtSummary: string }> {
    const response = await this.bridge.gradeQuizStream(
      {
        model: appConfig.modelName,
        fileRef: input.fileRef,
        page: input.page,
        quiz: input.quiz,
        answers: input.answers,
        learnerMemoryDigest: input.learnerMemoryDigest
      },
      onDelta
    );
    return {
      grading: parseGrading(response.grading),
      thoughtSummary: response.thoughtSummary
    };
  }
}
