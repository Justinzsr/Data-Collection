import { ShieldCheck } from "lucide-react";
import { LinkButton } from "@/presentation/components/ui/button";
import { Callout, GlassPanel } from "@/presentation/components/ui/panel";
import { WorkspaceIcon } from "@/presentation/layout/workspace-icon";
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
      <GlassPanel className="w-full max-w-md rounded-[32px] p-7 sm:p-8">
        <WorkspaceIcon slug="moonarq" className="mx-auto h-16 w-16 rounded-[18px] [&_svg]:h-8 [&_svg]:w-8" />
        <h1 className="mt-5 text-center text-[26px] font-bold tracking-[-0.028em] text-label">MoonArq private login</h1>
        <p className="mt-2 text-center text-sm leading-6 text-label-secondary">
          This Data Hub is a private MoonArq command center. Production access uses a signed, httpOnly dashboard session.
        </p>
        {setup.bypass ? (
          <div className="mt-7 text-center">
            <LinkButton href={nextPath} variant="primary" className="min-h-11 w-full">Enter with dev bypass</LinkButton>
            <p className="mt-3 text-xs leading-5 text-warning">DEV_AUTH_BYPASS is only honored outside production.</p>
          </div>
        ) : setup.configured ? (
          <form action="/api/auth/login" method="post" className="mt-7 grid gap-4">
            <input type="hidden" name="next" value={nextPath} />
            <label className="grid gap-2 text-sm font-medium text-label">
              Admin password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="field min-h-12 text-[15px]"
              />
            </label>
            {params?.error === "invalid" ? (
              <Callout tone="danger">Invalid dashboard password.</Callout>
            ) : null}
            <button type="submit" className="min-h-12 rounded-full bg-tint px-4 text-[15px] font-semibold text-on-tint shadow-(--tint-shadow) transition hover:bg-tint-hover focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 active:scale-[0.98]">
              Enter command center
            </button>
          </form>
        ) : (
          <Callout tone="warning" className="mt-7" icon={<ShieldCheck className="h-4 w-4" />}>
            Dashboard access is not configured. Add <span className="font-mono">DASHBOARD_ADMIN_PASSWORD</span> and{" "}
            <span className="font-mono">DASHBOARD_SESSION_SECRET</span> in Vercel, then redeploy.
          </Callout>
        )}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
          Private, source-scoped data
        </p>
      </GlassPanel>
    </main>
  );
}
