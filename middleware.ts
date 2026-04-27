import { NextResponse, type NextRequest } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  getDashboardAuthSetup,
  isPrivateApiPath,
  isProtectedUiPath,
  verifyDashboardSession,
} from "@/storage/auth/dashboard-session";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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
    request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value,
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
  matcher: ["/dashboard/:path*", "/settings/:path*", "/settings", "/api/:path*"],
};

