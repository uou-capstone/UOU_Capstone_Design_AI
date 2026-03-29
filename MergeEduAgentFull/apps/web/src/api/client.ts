import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  timeout: 60_000
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as
        | { error?: unknown; detail?: unknown }
        | undefined;
      const serverError =
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.detail === "string" && payload.detail) ||
        error.message;

      throw new Error(serverError || "요청 처리 중 오류가 발생했습니다.");
    }

    throw error;
  }
);
