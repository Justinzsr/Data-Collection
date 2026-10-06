import "server-only";

import { cookies } from "next/headers";
import {
  getDashboardAuthSetup,
  getDashboardSessionCookieName,
  verifyDashboardSession,
} from "@/storage/auth/dashboard-session";

/** Read only the private session; public pages never need a data repository. */
export async function hasDashboardSession() {
  const setup = getDashboardAuthSetup();
  if (setup.bypass) return true;
  if (!setup.configured) return false;
  const cookieStore = await cookies();
  return verifyDashboardSession(
    cookieStore.get(getDashboardSessionCookieName())?.value,
    process.env.DASHBOARD_SESSION_SECRET,
  );
}
