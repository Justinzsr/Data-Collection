import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_TTL_SECONDS,
  getDashboardAuthSetup,
  signDashboardSession,
} from "@/storage/auth/dashboard-session";

export const runtime = "nodejs";

function safeNextPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function redirect(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), { status: 303 });
}

function timingSafePasswordMatches(candidate: string, expected: string) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const setup = getDashboardAuthSetup();
  if (setup.bypass) return redirect(request, "/dashboard");

  if (!setup.configured || !process.env.DASHBOARD_ADMIN_PASSWORD || !process.env.DASHBOARD_SESSION_SECRET) {
    return redirect(request, "/login?setup=missing");
  }

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const nextPath = safeNextPath(form.get("next"));
  if (!timingSafePasswordMatches(password, process.env.DASHBOARD_ADMIN_PASSWORD)) {
    return redirect(request, `/login?error=invalid&next=${encodeURIComponent(nextPath)}`);
  }

  const response = redirect(request, nextPath);
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: await signDashboardSession(process.env.DASHBOARD_SESSION_SECRET),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DASHBOARD_SESSION_TTL_SECONDS,
  });
  return response;
}
