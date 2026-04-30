import crypto from "node:crypto";
import { appConfig } from "../../config.js";

export interface RequestKeyInfo {
  kid: string;
  alg: "RSA-OAEP-256+A256GCM";
  publicKeyJwk: Record<string, unknown>;
  expiresAt: string;
  mode: "off" | "optional" | "required";
  requiredPaths: string[];
}

export interface RequestEncryptionEnvelope {
  enc: "req-v1";
  kid: string;
  alg: "RSA-OAEP-256+A256GCM";
  ek: string;
  iv: string;
  ts: number;
  nonce: string;
  ciphertext: string;
}

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;

export class RequestEncryptionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "REQUEST_ENCRYPTION_REQUIRED"
      | "REQUEST_ENCRYPTION_INVALID"
      | "REQUEST_ENCRYPTION_REPLAY"
      | "REQUEST_ENCRYPTION_STALE"
  ) {
    super(message);
  }
}

export class RequestEncryptionService {
  private readonly keyPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001
  });
  private readonly kid = crypto.randomBytes(12).toString("base64url");
  private readonly createdAt = Date.now();
  private readonly nonces = new Map<string, number>();

  get mode(): "off" | "optional" | "required" {
    return appConfig.requestEncryptionMode;
  }

  get requiredPaths(): string[] {
    return appConfig.requestEncryptionRequiredPaths;
  }

  getRequestKeyInfo(): RequestKeyInfo {
    return {
      kid: this.kid,
      alg: "RSA-OAEP-256+A256GCM",
      publicKeyJwk: this.keyPair.publicKey.export({ format: "jwk" }) as Record<string, unknown>,
      expiresAt: new Date(this.createdAt + 60 * 60 * 1000).toISOString(),
      mode: this.mode,
      requiredPaths: this.requiredPaths
    };
  }

  isRequiredPath(originalUrl: string): boolean {
    const pathname = normalizePath(originalUrl.split("?")[0]);
    return this.requiredPaths.some((requiredPath) => pathname === normalizePath(requiredPath));
  }

  decryptEnvelope(envelope: RequestEncryptionEnvelope, method: string, originalUrl: string): unknown {
    if (
      envelope.enc !== "req-v1" ||
      envelope.alg !== "RSA-OAEP-256+A256GCM" ||
      envelope.kid !== this.kid
    ) {
      throw new RequestEncryptionError("Invalid encrypted request", "REQUEST_ENCRYPTION_INVALID");
    }

    const now = Date.now();
    if (!Number.isFinite(envelope.ts) || Math.abs(now - envelope.ts) > MAX_CLOCK_SKEW_MS) {
      throw new RequestEncryptionError("Encrypted request timestamp is stale", "REQUEST_ENCRYPTION_STALE");
    }

    this.pruneNonces(now);
    const nonceKey = `${envelope.kid}:${envelope.nonce}`;
    if (!envelope.nonce || this.nonces.has(nonceKey)) {
      throw new RequestEncryptionError("Encrypted request was replayed", "REQUEST_ENCRYPTION_REPLAY");
    }

    try {
      const aesKey = crypto.privateDecrypt(
        {
          key: this.keyPair.privateKey,
          oaepHash: "sha256",
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
        },
        base64UrlDecode(envelope.ek)
      );
      const iv = base64UrlDecode(envelope.iv);
      const combined = base64UrlDecode(envelope.ciphertext);
      if (combined.length <= 16) {
        throw new Error("Ciphertext is too short");
      }
      const ciphertext = combined.subarray(0, combined.length - 16);
      const tag = combined.subarray(combined.length - 16);
      const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
      decipher.setAAD(Buffer.from(buildAad(method, originalUrl, envelope.ts, envelope.nonce)));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed = JSON.parse(plaintext.toString("utf-8")) as unknown;
      this.nonces.set(nonceKey, now + NONCE_TTL_MS);
      return parsed;
    } catch {
      throw new RequestEncryptionError("Encrypted request could not be decrypted", "REQUEST_ENCRYPTION_INVALID");
    }
  }

  private pruneNonces(now: number): void {
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt <= now) {
        this.nonces.delete(nonce);
      }
    }
  }
}

export function buildAad(method: string, originalUrl: string, ts: number, nonce: string): string {
  return `${method.toUpperCase()} ${originalUrl} ${ts} ${nonce}`;
}

function normalizePath(pathname: string): string {
  if (pathname.length <= 1) return pathname || "/";
  return pathname.replace(/\/+$/, "");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
