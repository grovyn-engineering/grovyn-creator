import { NextResponse, type NextRequest } from "next/server";

/**
 * Route protection at the edge.
 *
 * (Next 16 renamed this file convention from `middleware` to `proxy`; the
 * behaviour and the runtime are unchanged.)
 *
 * This checks only for the *presence* of the session cookie, not its validity —
 * it cannot verify a server-side session without a database round trip on every
 * navigation, which would put the database in front of every static asset
 * request.
 *
 * That is deliberate and safe, because this is not the security boundary. The
 * API validates the session on every request it serves; a forged cookie gets a
 * user past this redirect and then a 401 from every endpoint, which the client
 * turns into a redirect back to login. What this buys is that a signed-out
 * visitor sees the login page immediately rather than a dashboard shell that
 * empties itself a moment later.
 */

const SESSION_COOKIE = "sp_session";

/** Reachable without a session. */
const PUBLIC_PATHS = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserved so the user lands where they were headed after signing in,
    // rather than always on the dashboard.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next's internals, the favicon, and static files.
     * Running this on asset requests would add a redirect check to every image
     * and font the page loads.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
