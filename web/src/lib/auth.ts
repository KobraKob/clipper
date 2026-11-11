import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "clipper_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function authIsConfigured(): boolean {
  return Boolean(
    process.env.CLIPPER_ACCESS_PASSWORD &&
    process.env.CLIPPER_ACCESS_PASSWORD.length >= 16 &&
    process.env.CLIPPER_AUTH_SECRET &&
    process.env.CLIPPER_AUTH_SECRET.length >= 32,
  );
}

function sessionSecret(): string {
  const secret = process.env.CLIPPER_AUTH_SECRET || "";
  if (secret.length < 32) throw new Error("CLIPPER_AUTH_SECRET must contain at least 32 characters.");
  return secret;
}

export function verifyAccessPassword(candidate: string): boolean {
  const expected = process.env.CLIPPER_ACCESS_PASSWORD || "";
  if (expected.length < 16 || typeof candidate !== "string" || candidate.length > 1024) return false;
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export function issueSessionToken(now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${signature(payload, sessionSecret())}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresText, nonce, suppliedSignature] = parts;
  if (!/^\d{10}$/.test(expiresText) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return false;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  try {
    const expected = Buffer.from(signature(`${expiresText}.${nonce}`, sessionSecret()));
    const supplied = Buffer.from(suppliedSignature);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}
