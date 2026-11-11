import { NextRequest, NextResponse } from "next/server";
import {
  authCookieName,
  authIsConfigured,
  verifySessionToken,
} from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Keep health checks and the authentication endpoints reachable without a session.
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health"
  ) {
    return NextResponse.next();
  }

  const authEnabled =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.CLIPPER_ACCESS_PASSWORD || process.env.CLIPPER_AUTH_SECRET);

  if (!authEnabled) return NextResponse.next();

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== request.nextUrl.origin) || fetchSite === "cross-site") {
      return NextResponse.json(
        { error: "Cross-origin requests are not allowed." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (!authIsConfigured()) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Server access control is not configured. Set CLIPPER_ACCESS_PASSWORD and CLIPPER_AUTH_SECRET." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = "/login";
    setupUrl.search = "?setup=required";
    return NextResponse.redirect(setupUrl);
  }

  const secret = process.env.CLIPPER_AUTH_SECRET!;
  const token = request.cookies.get(authCookieName())?.value;
  if (await verifySessionToken(token, secret)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
