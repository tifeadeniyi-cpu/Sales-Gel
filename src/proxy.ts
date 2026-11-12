import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic check only: bounce visitors without a session cookie to sign-in.
 * Real authentication and org membership are verified server-side on every request
 * (requireUser / requireOrgContext); this file never grants access.
 */
export function proxy(request: NextRequest) {
  const hasSession = getSessionCookie(request, { cookiePrefix: "crm" });
  if (!hasSession) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/o/:path*", "/onboarding"],
};
