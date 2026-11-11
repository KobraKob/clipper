import { NextRequest, NextResponse } from "next/server";
import { authIsConfigured, issueSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, verifyAccessPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 10_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  return request.headers.get("x-real-ip") || "unknown";
}

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

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== request.nextUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-origin login is not allowed." }, { status: 403 });
  }
  if (!authIsConfigured()) {
    return NextResponse.json(
      { error: "Access control is not configured. Set CLIPPER_ACCESS_PASSWORD and CLIPPER_AUTH_SECRET." },
      { status: 503 },
    );
  }

  const now = Date.now();
  const key = clientKey(request);
  pruneAttempts(now);
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many login attempts. Try again in 15 minutes." }, { status: 429 });
  }

  let password = "";
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 4096) return NextResponse.json({ error: "Invalid login request." }, { status: 413 });
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid login request." }, { status: 400 });
  }

  if (!verifyAccessPassword(password)) {
    attempts.set(key, {
      count: current && current.resetAt > now ? current.count + 1 : 1,
      resetAt: current && current.resetAt > now ? current.resetAt : now + WINDOW_MS,
    });
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  attempts.delete(key);
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: issueSessionToken(now),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
