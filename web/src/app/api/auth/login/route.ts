import { NextResponse } from "next/server";
import {
  authCookieName,
  authIsConfigured,
  issueSessionToken,
  SESSION_TTL_SECONDS,
  verifyAccessPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 10_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function pruneAttempts(now: number): void {
  for (const [key, value] of attempts) {
    if (value.resetAt <= now) attempts.delete(key);
  }
  while (attempts.size >= MAX_TRACKED_CLIENTS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

function clientKey(request: Request): string {
  // Prefer the platform-provided client address; use the left-most forwarded
  // address only when the hosting proxy supplies no direct address header.
  return request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function readJsonBodyLimited(request: Request, maximumBytes: number): Promise<unknown> {
  if (!request.body) throw new Error("Request body is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("Request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin login requests are not allowed." }, { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "Expected a JSON request." }, { status: 415 });
  }
  const contentLengthHeader = request.headers.get("content-length");
  if (
    contentLengthHeader !== null &&
    (!/^\d+$/.test(contentLengthHeader) || Number(contentLengthHeader) > 4096)
  ) {
    return NextResponse.json({ error: "Request is too large or has an invalid Content-Length." }, { status: 413 });
  }
  if (!authIsConfigured()) {
    return NextResponse.json(
      { error: "Configure CLIPPER_ACCESS_PASSWORD (16+ characters) and CLIPPER_AUTH_SECRET (32+ characters) before enabling production access." },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  const now = Date.now();
  pruneAttempts(now);
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)) } },
    );
  }
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
  }

  let password = "";
  try {
    const body = await readJsonBodyLimited(request, 4096) as { password?: unknown };
    if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 512) {
      return NextResponse.json({ error: "Enter a valid access password." }, { status: 400 });
    }
    password = body.password;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON request.";
    const status = message === "Request is too large." ? 413 : 400;
    return NextResponse.json({ error: status === 413 ? message : "Invalid JSON request." }, { status });
  }

  const expected = process.env.CLIPPER_ACCESS_PASSWORD!;
  if (!(await verifyAccessPassword(password, expected))) {
    const state = attempts.get(key)!;
    state.count += 1;
    attempts.set(key, state);
    return NextResponse.json({ error: "Incorrect access password." }, { status: 401 });
  }

  attempts.delete(key);
  const token = await issueSessionToken(process.env.CLIPPER_AUTH_SECRET!);
  const response = NextResponse.json({ success: true });
  response.cookies.set(authCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
