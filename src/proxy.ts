import { NextResponse, type NextRequest } from "next/server";
import {
  getDashboardAuthSetup,
  getDashboardSessionCookieName,
  isPrivateApiPath,
  isProtectedUiPath,
  verifyDashboardSession,
} from "@/storage/auth/dashboard-session";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `/w/moonarq${pathname}`;
    return NextResponse.redirect(redirectUrl);
  }
  const protectedUi = isProtectedUiPath(pathname);
  const privateApi = isPrivateApiPath(pathname);
  if (!protectedUi && !privateApi) return NextResponse.next();

  const setup = getDashboardAuthSetup();
  if (setup.bypass) return NextResponse.next();

  if (!setup.configured) {
    if (privateApi) {
      return NextResponse.json(
        {
          error: "Dashboard access is not configured.",
          missing: setup.missing,
        },
        { status: 503 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("setup", "missing");
    return NextResponse.redirect(loginUrl);
  }

  const authenticated = await verifyDashboardSession(
    request.cookies.get(getDashboardSessionCookieName())?.value,
    process.env.DASHBOARD_SESSION_SECRET,
  );
  if (authenticated) return NextResponse.next();

  if (privateApi) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/w/:path*", "/settings/:path*", "/settings", "/api/:path*"],
};
