import axios from "axios";
import { maybeEncryptJsonRequest } from "./requestEncryption";

export const api = axios.create({
  baseURL: "/api",
  timeout: 60_000,
  withCredentials: true
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
  }
}

api.interceptors.request.use(async (config) => {
  const contentType = String(config.headers?.["Content-Type"] ?? config.headers?.["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    return config;
  }

  const result = await maybeEncryptJsonRequest({
    method: config.method,
    baseURL: config.baseURL,
    url: config.url,
    data: config.data
  });
  if (result.encrypted) {
    config.data = result.data;
    config.headers = config.headers ?? {};
    config.headers["Content-Type"] = "application/json";
    config.headers["X-Request-Encryption"] = "req-v1";
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as
        | { error?: unknown; detail?: unknown; code?: unknown }
        | undefined;
      const serverError =
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.detail === "string" && payload.detail) ||
        error.message;

      throw new ApiError(
        serverError || "요청 처리 중 오류가 발생했습니다.",
        error.response?.status,
        typeof payload?.code === "string" ? payload.code : undefined
      );
    }

    throw error;
  }
);
