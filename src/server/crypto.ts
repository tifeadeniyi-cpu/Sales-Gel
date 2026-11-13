import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM for integration credentials at rest. Key: 32 random bytes, base64, in INTEGRATIONS_ENCRYPTION_KEY. */
function key(): Buffer {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw) throw new Error("INTEGRATIONS_ENCRYPTION_KEY is not configured");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

export function encryptionConfigured() {
  try { key(); return true; } catch { return false; }
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptJson<T>(payload: string): T {
  const [v, iv, tag, body] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unrecognized credential format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8")) as T;
}

/** Constant-time comparison of two strings (false when lengths differ). */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmacSha256(secret: string, data: string | Buffer, encoding: "hex" | "base64") {
  return createHmac("sha256", secret).update(data).digest(encoding);
}
