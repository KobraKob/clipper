import { NextRequest, NextResponse } from "next/server";
import { authIsConfigured, SESSION_COOKIE, verifySessionToken } from "./lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  if (!authIsConfigured()) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Clipper access control is not configured. Set CLIPPER_ACCESS_PASSWORD and CLIPPER_AUTH_SECRET." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.redirect(new URL("/login?setup=required", request.url));
  }

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

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
