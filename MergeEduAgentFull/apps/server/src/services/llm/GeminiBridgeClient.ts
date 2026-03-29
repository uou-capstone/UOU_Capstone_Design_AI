import axios from "axios";
import { appConfig } from "../../config.js";
import { GradingResult, LectureItem, QuizJson, QuizType } from "../../types/domain.js";

interface BridgeContentPart {
  text?: string;
  thought?: boolean;
  inline_data?: {
    mime_type: string;
    data: string;
  };
}

interface BridgeContent {
  role?: string;
  parts?: BridgeContentPart[];
}

interface BridgeResponse<TData = unknown> {
  ok: boolean;
  content: BridgeContent | null;
  thoughtSummary?: string;
  data?: TData;
}

interface BridgeStreamLine<TData = unknown> {
  type: "thought_delta" | "answer_delta" | "done" | "error";
  text?: string;
  error?: string;
  content?: BridgeContent | null;
  answerText?: string;
  thoughtSummary?: string;
  data?: TData;
}

type StreamChannel = "thought" | "answer";

function contentToMarkdown(content: BridgeContent | null): string {
  if (!content?.parts?.length) return "";
  return content.parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getErrorMessage(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;
  if (typeof data.error === "string") return data.error;
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.message === "string") return data.message;
  if (data.error && typeof data.error === "object") {
    const nested = data.error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }
  return null;
}

interface BridgeClientError extends Error {
  statusCode?: number;
  code?: string;
  source?: "bridge" | "gemini";
}

export class GeminiBridgeClient {
  private readonly http = axios.create({
    baseURL: appConfig.aiBridgeUrl,
    timeout: 60_000
  });

  private throwClientError(
    action: string,
    statusCode: number,
    message: string,
    source: "bridge" | "gemini"
  ): never {
    const error = new Error(`AI ${action} 실패: ${message}`) as BridgeClientError;
    error.statusCode = statusCode;
    error.code = `AI_${action.toUpperCase()}_FAILED`;
    error.source = source;
    throw error;
  }

  private rethrowBridgeError(action: string, error: unknown): never {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status ?? 502;
      const message =
        getErrorMessage(error.response?.data) ??
        error.message ??
        "AI bridge request failed";
      const source: "bridge" | "gemini" = statusCode >= 500 ? "bridge" : "gemini";
      this.throwClientError(action, statusCode, message, source);
    }

    if (error instanceof Error) {
      this.throwClientError(action, 500, error.message, "bridge");
    }

    this.throwClientError(action, 500, "Unknown AI bridge error", "bridge");
  }

  private async streamBridge<TData = unknown>(
    action: string,
    path: string,
    input: Record<string, unknown>,
    onDelta?: (delta: { channel: StreamChannel; text: string }) => void,
    timeoutMs?: number
  ): Promise<{ content: BridgeContent | null; answerText: string; thoughtSummary: string; data?: TData }> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      if (timeoutMs && timeoutMs > 0) {
        timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
      }
      const response = await fetch(new URL(path, appConfig.aiBridgeUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        let message = text || `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const candidate =
            (typeof parsed.error === "string" && parsed.error) ||
            (typeof parsed.detail === "string" && parsed.detail);
          if (candidate) {
            message = candidate;
          }
        } catch {
          // no-op
        }
        this.throwClientError(action, response.status, message, response.status >= 500 ? "bridge" : "gemini");
      }

      if (!response.body) {
        this.throwClientError(action, 502, "AI bridge stream body is empty", "bridge");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalDone: BridgeStreamLine<TData> | null = null;
      let thoughtSummary = "";
      let answerText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let lineEnd = buffer.indexOf("\n");
        while (lineEnd >= 0) {
          const rawLine = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          lineEnd = buffer.indexOf("\n");
          if (!rawLine) continue;

          const line = JSON.parse(rawLine) as BridgeStreamLine<TData>;
          if (line.type === "error") {
            this.throwClientError(action, 502, line.error ?? "AI bridge stream failed", "bridge");
          }
          if (line.type === "thought_delta") {
            const text = String(line.text ?? "");
            thoughtSummary += text;
            onDelta?.({ channel: "thought", text });
            continue;
          }
          if (line.type === "answer_delta") {
            const text = String(line.text ?? "");
            answerText += text;
            onDelta?.({ channel: "answer", text });
            continue;
          }
          if (line.type === "done") {
            finalDone = line;
          }
        }
      }

      if (buffer.trim()) {
        const line = JSON.parse(buffer.trim()) as BridgeStreamLine<TData>;
        if (line.type === "done") {
          finalDone = line;
        }
      }

      if (!finalDone) {
        this.throwClientError(action, 502, "AI bridge stream did not send final done event", "bridge");
      }

      return {
        content: finalDone.content ?? null,
        answerText: (finalDone.answerText ?? answerText).trim(),
        thoughtSummary: (finalDone.thoughtSummary ?? thoughtSummary).trim(),
        data: finalDone.data
      };
    } catch (error) {
      this.rethrowBridgeError(action, error);
      throw new Error("Unreachable");
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async uploadPdf(
    input: { lectureId: string; pdfPath: string; displayName: string }
  ): Promise<NonNullable<LectureItem["pdf"]["geminiFile"]>> {
    try {
      const response = await this.http.post<
        BridgeResponse<{ file_name: string; file_uri: string; mime_type: string }>
      >(
        "/bridge/upload_pdf",
        input
      );
      if (!response.data.ok || !response.data.data) {
        this.throwClientError("upload_pdf", 502, "AI bridge failed to upload PDF", "bridge");
      }
      return {
        fileName: response.data.data.file_name,
        fileUri: response.data.data.file_uri,
        mimeType: response.data.data.mime_type
      };
    } catch (error) {
      this.rethrowBridgeError("upload_pdf", error);
    }
  }

  async explainPage(input: {
    model: string;
    fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
    page: number;
    pageText: string;
    neighborText: { prev: string; next: string };
    detailLevel?: "NORMAL" | "DETAILED";
    learnerLevel?: string;
    learnerMemoryDigest?: string;
  }): Promise<{ markdown: string; thoughtSummary: string; content: BridgeContent | null }> {
    try {
      const response = await this.http.post<BridgeResponse>("/bridge/explain_page", input);
      return {
        markdown: contentToMarkdown(response.data.content),
        thoughtSummary: String(response.data.thoughtSummary ?? ""),
        content: response.data.content
      };
    } catch (error) {
      this.rethrowBridgeError("explain_page", error);
    }
  }

  async explainPageStream(
    input: {
      model: string;
      fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
      page: number;
      pageText: string;
      neighborText: { prev: string; next: string };
      detailLevel?: "NORMAL" | "DETAILED";
      learnerLevel?: string;
      learnerMemoryDigest?: string;
    },
    onDelta?: (delta: { channel: StreamChannel; text: string }) => void
  ): Promise<{ markdown: string; thoughtSummary: string; content: BridgeContent | null }> {
    const streamed = await this.streamBridge("explain_page_stream", "/bridge/explain_page_stream", input, onDelta);
    return {
      markdown: streamed.answerText || contentToMarkdown(streamed.content),
      thoughtSummary: streamed.thoughtSummary,
      content: streamed.content
    };
  }

  async answerQuestion(input: {
    model: string;
    fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
    page: number;
    question: string;
    learnerLevel: string;
    pageText: string;
    neighborText: { prev: string; next: string };
    learnerMemoryDigest?: string;
  }): Promise<{ markdown: string; thoughtSummary: string; content: BridgeContent | null }> {
    try {
      const response = await this.http.post<BridgeResponse>("/bridge/answer_question", input);
      return {
        markdown: contentToMarkdown(response.data.content),
        thoughtSummary: String(response.data.thoughtSummary ?? ""),
        content: response.data.content
      };
    } catch (error) {
      this.rethrowBridgeError("answer_question", error);
    }
  }

  async answerQuestionStream(
    input: {
      model: string;
      fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
      page: number;
      question: string;
      learnerLevel: string;
      pageText: string;
      neighborText: { prev: string; next: string };
      learnerMemoryDigest?: string;
    },
    onDelta?: (delta: { channel: StreamChannel; text: string }) => void
  ): Promise<{ markdown: string; thoughtSummary: string; content: BridgeContent | null }> {
    const streamed = await this.streamBridge("answer_question_stream", "/bridge/answer_question_stream", input, onDelta);
    return {
      markdown: streamed.answerText || contentToMarkdown(streamed.content),
      thoughtSummary: streamed.thoughtSummary,
      content: streamed.content
    };
  }

  async generateQuiz(input: {
    model: string;
    fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
    page: number;
    pageText: string;
    quizType: QuizType;
    coverageStartPage?: number;
    coverageEndPage?: number;
    questionCount: number;
    learnerLevel?: string;
    learnerMemoryDigest?: string;
    targetDifficulty?: string;
  }): Promise<QuizJson> {
    try {
      const response = await this.http.post<BridgeResponse<QuizJson>>("/bridge/generate_quiz", input);
      if (!response.data.data) {
        this.throwClientError("generate_quiz", 502, "AI bridge failed to generate quiz JSON", "bridge");
      }
      return response.data.data;
    } catch (error) {
      this.rethrowBridgeError("generate_quiz", error);
    }
  }

  async generateQuizStream(
    input: {
      model: string;
      fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
      page: number;
      pageText: string;
      quizType: QuizType;
      coverageStartPage?: number;
      coverageEndPage?: number;
      questionCount: number;
      learnerLevel?: string;
      learnerMemoryDigest?: string;
      targetDifficulty?: string;
    },
    onDelta?: (delta: { channel: StreamChannel; text: string }) => void
  ): Promise<{ quiz: QuizJson; thoughtSummary: string }> {
    const streamed = await this.streamBridge<QuizJson>("generate_quiz_stream", "/bridge/generate_quiz_stream", input, onDelta);
    if (!streamed.data) {
      this.throwClientError("generate_quiz_stream", 502, "AI bridge failed to generate quiz JSON", "bridge");
    }
    return {
      quiz: streamed.data,
      thoughtSummary: streamed.thoughtSummary
    };
  }

  async gradeQuiz(input: {
    model: string;
    fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
    page: number;
    quiz: QuizJson;
    answers: Record<string, unknown>;
    learnerMemoryDigest?: string;
  }): Promise<GradingResult> {
    try {
      const response = await this.http.post<BridgeResponse<GradingResult>>("/bridge/grade_quiz", input);
      if (!response.data.data) {
        this.throwClientError("grade_quiz", 502, "AI bridge failed to grade quiz", "bridge");
      }
      return response.data.data;
    } catch (error) {
      this.rethrowBridgeError("grade_quiz", error);
    }
  }

  async gradeQuizStream(
    input: {
      model: string;
      fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
      page: number;
      quiz: QuizJson;
      answers: Record<string, unknown>;
      learnerMemoryDigest?: string;
    },
    onDelta?: (delta: { channel: StreamChannel; text: string }) => void
  ): Promise<{ grading: GradingResult; thoughtSummary: string }> {
    const streamed = await this.streamBridge<GradingResult>("grade_quiz_stream", "/bridge/grade_quiz_stream", input, onDelta);
    if (!streamed.data) {
      this.throwClientError("grade_quiz_stream", 502, "AI bridge failed to grade quiz", "bridge");
    }
    return {
      grading: streamed.data,
      thoughtSummary: streamed.thoughtSummary
    };
  }

  async orchestratorThoughtStream(
    input: {
      model: string;
      fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
      prompt: string;
    },
    onDelta?: (delta: { channel: StreamChannel; text: string }) => void
  ): Promise<{ thoughtSummary: string; answerText: string }> {
    const streamed = await this.streamBridge(
      "orchestrator_thought_stream",
      "/bridge/orchestrator_thought_stream",
      input,
      onDelta,
      appConfig.orchestratorThinkTimeoutMs
    );
    return {
      thoughtSummary: streamed.thoughtSummary,
      answerText: streamed.answerText
    };
  }

  async orchestrateSessionStream(
    input: {
      model: string;
      fileRef: NonNullable<LectureItem["pdf"]["geminiFile"]>;
      prompt: string;
      responseJsonSchema: Record<string, unknown>;
    },
    onDelta?: (delta: { channel: StreamChannel; text: string }) => void
  ): Promise<{ plan: unknown; thoughtSummary: string }> {
    const streamed = await this.streamBridge(
      "orchestrate_session_stream",
      "/bridge/orchestrate_session_stream",
      input,
      onDelta,
      appConfig.orchestratorThinkTimeoutMs
    );
    let parsed: unknown = streamed.data;
    if (parsed === undefined) {
      parsed = JSON.parse(streamed.answerText);
    }
    return {
      plan: parsed,
      thoughtSummary: streamed.thoughtSummary
    };
  }
}
