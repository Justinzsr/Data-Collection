import { ShieldCheck } from "lucide-react";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import {
  getDashboardAuthSetup,
  safeDashboardRedirectPath,
} from "@/storage/auth/dashboard-session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string; next?: string; setup?: string }> }) {
  const params = await searchParams;
  const setup = getDashboardAuthSetup();
  const nextPath = safeDashboardRedirectPath(params?.next);
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <GlassPanel className="w-full max-w-md p-6">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-200/20 bg-cyan-300/10">
          <ShieldCheck className="h-6 w-6 text-cyan-100" />
        </div>
        <h1 className="mt-5 text-center text-2xl font-semibold text-white">MoonArq private login</h1>
        <p className="mt-3 text-center text-sm leading-6 text-slate-400">
          This Data Hub is a private MoonArq command center. Production access uses a signed, httpOnly dashboard session.
        </p>
        {setup.bypass ? (
          <div className="mt-6 text-center">
            <LinkButton href={nextPath} variant="primary">Enter with dev bypass</LinkButton>
            <p className="mt-3 text-xs leading-5 text-amber-100">DEV_AUTH_BYPASS is only honored outside production.</p>
          </div>
        ) : setup.configured ? (
          <form action="/api/auth/login" method="post" className="mt-6 grid gap-4">
            <input type="hidden" name="next" value={nextPath} />
            <label className="grid gap-2 text-sm font-medium text-slate-200">
              Admin password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="min-h-11 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-white outline-none ring-cyan-300/30 transition placeholder:text-slate-600 focus:ring-2"
              />
            </label>
            {params?.error === "invalid" ? (
              <p className="rounded-lg border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">Invalid dashboard password.</p>
            ) : null}
            <button type="submit" className="min-h-11 rounded-lg border border-cyan-200/20 bg-cyan-300/15 px-4 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25">
              Enter command center
            </button>
          </form>
        ) : (
          <div className="mt-6 rounded-lg border border-amber-300/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            Dashboard access is not configured. Add <span className="font-mono">DASHBOARD_ADMIN_PASSWORD</span> and{" "}
            <span className="font-mono">DASHBOARD_SESSION_SECRET</span> in Vercel, then redeploy.
          </div>
        )}
      </GlassPanel>
    </main>
  );
}
