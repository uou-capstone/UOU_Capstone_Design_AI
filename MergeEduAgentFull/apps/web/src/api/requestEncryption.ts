interface RequestKeyInfo {
  kid: string;
  alg: "RSA-OAEP-256+A256GCM";
  publicKeyJwk: JsonWebKey;
  expiresAt: string;
  mode: "off" | "optional" | "required";
  requiredPaths: string[];
}

interface RequestEncryptionEnvelope {
  enc: "req-v1";
  kid: string;
  alg: "RSA-OAEP-256+A256GCM";
  ek: string;
  iv: string;
  ts: number;
  nonce: string;
  ciphertext: string;
}

let cachedKey: { info: RequestKeyInfo; cryptoKey: CryptoKey } | null = null;

export async function maybeEncryptJsonRequest(input: {
  method?: string;
  baseURL?: string;
  url?: string;
  data: unknown;
}): Promise<{
  data: unknown;
  encrypted: boolean;
  required: boolean;
}> {
  const method = (input.method ?? "GET").toUpperCase();
  const originalUrl = buildOriginalUrl(input.baseURL, input.url);

  if (!canEncrypt(method, input.data)) {
    return { data: input.data, encrypted: false, required: false };
  }

  try {
    const key = await getRequestKey();
    const required = isRequiredCandidate(method, originalUrl, key.info);
    if (key.info.mode === "off") {
      return { data: input.data, encrypted: false, required };
    }
    const envelope = await encryptJson(input.data, key.info, key.cryptoKey, method, originalUrl);
    return { data: envelope, encrypted: true, required };
  } catch (error) {
    const required = cachedKey ? isRequiredCandidate(method, originalUrl, cachedKey.info) : false;
    if (required) {
      throw error;
    }
    return { data: input.data, encrypted: false, required };
  }
}

function canEncrypt(method: string, data: unknown): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  if (!data || typeof data !== "object") return false;
  if (data instanceof FormData) return false;
  if (data instanceof URLSearchParams) return false;
  if (data instanceof Blob) return false;
  if (data instanceof ArrayBuffer) return false;
  if (ArrayBuffer.isView(data)) return false;
  if ((data as Record<string, unknown>).enc === "req-v1") return false;
  return Object.getPrototypeOf(data) === Object.prototype || Object.getPrototypeOf(data) === null;
}

function isRequiredCandidate(method: string, originalUrl: string, info: RequestKeyInfo): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  return info.mode === "required" && info.requiredPaths.some((path) => originalUrl.split("?")[0] === path);
}

async function getRequestKey(): Promise<{ info: RequestKeyInfo; cryptoKey: CryptoKey }> {
  if (cachedKey && Date.parse(cachedKey.info.expiresAt) - Date.now() > 60_000) {
    return cachedKey;
  }
  const response = await fetch("/api/crypto/request-key", {
    credentials: "include"
  });
  if (!response.ok) {
    throw new Error("요청 암호화 키를 불러오지 못했습니다.");
  }
  const payload = (await response.json()) as { data: RequestKeyInfo };
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    payload.data.publicKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  cachedKey = { info: payload.data, cryptoKey };
  return cachedKey;
}

async function encryptJson(
  data: unknown,
  info: RequestKeyInfo,
  publicKey: CryptoKey,
  method: string,
  originalUrl: string
): Promise<RequestEncryptionEnvelope> {
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt"
  ]);
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const ts = Date.now();
  const aad = new TextEncoder().encode(`${method} ${originalUrl} ${ts} ${nonce}`);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad,
      tagLength: 128
    },
    aesKey,
    plaintext
  );
  const encryptedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    rawAesKey
  );

  return {
    enc: "req-v1",
    kid: info.kid,
    alg: "RSA-OAEP-256+A256GCM",
    ek: base64Url(new Uint8Array(encryptedKey)),
    iv: base64Url(iv),
    ts,
    nonce,
    ciphertext: base64Url(new Uint8Array(ciphertext))
  };
}

function buildOriginalUrl(baseURL?: string, url?: string): string {
  const base = baseURL || "";
  const next = url || "";
  if (/^https?:\/\//i.test(next)) {
    const parsed = new URL(next);
    return `${parsed.pathname}${parsed.search}`;
  }
  const joined = `${base.replace(/\/$/, "")}/${next.replace(/^\//, "")}`;
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
