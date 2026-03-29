import { NextFunction, Request, Response } from "express";

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const appError = (err instanceof Error ? err : new Error("Unknown server error")) as AppError;
  const statusCode =
    typeof appError.statusCode === "number" && appError.statusCode >= 400
      ? appError.statusCode
      : 500;

  res.status(statusCode).json({
    ok: false,
    error: appError.message,
    code: appError.code
  });
}
