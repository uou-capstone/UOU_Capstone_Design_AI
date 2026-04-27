import { NextFunction, Request, Response } from "express";
import {
  RequestEncryptionEnvelope,
  RequestEncryptionError,
  RequestEncryptionService
} from "../services/security/RequestEncryptionService.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requestEncryptionMiddleware(service: RequestEncryptionService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!shouldConsiderRequest(req)) {
        next();
        return;
      }

      const encrypted =
        String(req.headers["x-request-encryption"] ?? "") === "req-v1" ||
        isEncryptedEnvelope(req.body);
      if (encrypted) {
        req.body = service.decryptEnvelope(
          req.body as RequestEncryptionEnvelope,
          req.method,
          req.originalUrl
        );
        next();
        return;
      }

      if (service.mode === "required" && service.isRequiredPath(req.originalUrl)) {
        res.status(400).json({
          ok: false,
          error: "Encrypted request body required",
          code: "REQUEST_ENCRYPTION_REQUIRED"
        });
        return;
      }

      next();
    } catch (error) {
      if (error instanceof RequestEncryptionError) {
        res.status(400).json({
          ok: false,
          error: error.message,
          code: error.code
        });
        return;
      }
      next(error);
    }
  };
}

function shouldConsiderRequest(req: Request): boolean {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return false;
  if (!req.is("application/json")) return false;
  if (!req.body || typeof req.body !== "object") return false;
  return Object.keys(req.body as Record<string, unknown>).length > 0;
}

function isEncryptedEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<RequestEncryptionEnvelope>;
  return body.enc === "req-v1" || body.alg === "RSA-OAEP-256+A256GCM";
}
