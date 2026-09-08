import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request });
  const { pathname } = request.nextUrl;

  // Not authenticated — redirect to login
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin routes — require ADMIN role
  if (pathname.startsWith("/admin") && token.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

/**
 * An allowlist, and the omissions are as deliberate as the entries.
 *
 * `/tg` and `/api/tg` -- the Telegram Mini App -- must stay out of it. They authenticate with a
 * signed `initData` header rather than a NextAuth session, and redirecting Telegram's webview to
 * `/login` would strand it: the login form needs a cookie a third-party iframe will not carry.
 * They gate themselves through `getTelegramUserId`. `src/middleware.test.ts` pins this list so the
 * absence cannot be tidied away by someone who reads it as an oversight.
 */
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/transactions/:path*",
    "/bills/:path*",
    "/categories/:path*",
    "/profile/:path*",
    "/admin/:path*",
  ],
};
