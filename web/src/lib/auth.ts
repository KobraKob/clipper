const SESSION_COOKIE = "clipper_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function authIsConfigured(): boolean {
  return Boolean(
    process.env.CLIPPER_ACCESS_PASSWORD &&
    process.env.CLIPPER_ACCESS_PASSWORD.length >= 16 &&
    process.env.CLIPPER_AUTH_SECRET &&
    process.env.CLIPPER_AUTH_SECRET.length >= 32,
  );
}

export function authCookieName(): string {
  return SESSION_COOKIE;
}

export async function verifyAccessPassword(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return constantTimeEqual(toHex(candidateHash), toHex(expectedHash));
}

export async function issueSessionToken(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!token || token.length > 256) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresText, nonce, suppliedSignature] = parts;
  if (!/^\d{10}$/.test(expiresText) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    return false;
  }
  const expiresAt = Number(expiresText);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || expiresAt > nowSeconds + SESSION_TTL_SECONDS + 60) {
    return false;
  }
  const payload = `${expiresText}.${nonce}`;
  const expectedSignature = await hmac(payload, secret);
  return constantTimeEqual(suppliedSignature, expectedSignature);
}
