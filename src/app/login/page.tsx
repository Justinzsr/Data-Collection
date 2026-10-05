import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { Callout, GlassPanel } from "@/presentation/components/ui/panel";
import { WorkspaceIcon } from "@/presentation/layout/workspace-icon";
import { ThemeToggle } from "@/presentation/theme/theme-toggle";
import { hasDashboardSession } from "@/storage/auth/dashboard-access";
import { getDashboardAuthSetup } from "@/storage/auth/dashboard-session";
import { getGoogleLoginSetup, safeGoogleLoginNextPath } from "@/storage/auth/google-login";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in · DataHub",
  robots: { index: false, follow: false },
};

const LOGIN_ERRORS: Record<string, string> = {
  invalid: "Invalid dashboard password.",
  google_unavailable: "Google sign-in is currently unavailable. You can still use the dashboard password.",
  google_invalid: "Your Google sign-in could not be verified. Please try again or use the dashboard password.",
  google_cancelled: "Google sign-in was cancelled. You can try again or use the dashboard password.",
  google_not_allowed: "This Google account does not have direct access. Use the dashboard password to continue, or try another Google account.",
  google_failed: "Google sign-in could not be completed. Please try again or use the dashboard password.",
};

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string; next?: string; setup?: string }> }) {
  const params = await searchParams;
  const setup = getDashboardAuthSetup();
  const google = getGoogleLoginSetup();
  const nextPath = safeGoogleLoginNextPath(params?.next);
  // Keep the explicit local bypass visible; a real session skips repeated login.
  if (!setup.bypass && await hasDashboardSession()) redirect(nextPath);
  const error = typeof params?.error === "string" && Object.hasOwn(LOGIN_ERRORS, params.error)
    ? LOGIN_ERRORS[params.error]
    : undefined;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-8 sm:py-7">
      <nav aria-label="Sign-in navigation" className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton href="/demo" variant="ghost"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to demo</LinkButton>
        <ThemeToggle />
      </nav>
      <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1fr_440px] lg:gap-16">
        <section className="mx-auto max-w-lg lg:mx-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tint-text">DataHub · Private workspaces</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-label sm:text-5xl">Sign in to DataHub</h1>
          <p className="mt-5 max-w-md text-base leading-7 text-label-secondary">
            Your platforms. One clear picture. Sign in to explore your connected workspaces and their latest data.
          </p>
          <div className="mt-8 flex items-start gap-3 text-sm leading-6 text-label-secondary">
            <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-positive" aria-hidden="true" />
            <p>The public demo uses sample data. Real workspace data is only available after you sign in.</p>
          </div>
          <LinkButton href="/demo" variant="secondary" className="mt-6">Just exploring? View the demo<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
        </section>

        <GlassPanel className="mx-auto w-full max-w-md rounded-[32px] p-6 sm:p-8">
          <WorkspaceIcon slug="moonarq" className="h-12 w-12 rounded-2xl [&_svg]:h-6 [&_svg]:w-6" />
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-label">Welcome back</h2>
          <p className="mt-2 text-sm leading-6 text-label-secondary">The owner can continue with Google. Everyone else can use the dashboard password.</p>
          {error ? <div role="alert" className="mt-5"><Callout tone="danger">{error}</Callout></div> : null}

          {setup.bypass ? (
            <div className="mt-7 text-center">
              <LinkButton href={nextPath} variant="primary" className="min-h-11 w-full">Enter with dev bypass</LinkButton>
              <p className="mt-3 text-xs leading-5 text-warning">DEV_AUTH_BYPASS is only honored outside production.</p>
            </div>
          ) : setup.configured ? (
            <>
              <form action="/api/auth/google/start" method="post" className="mt-6">
                <input type="hidden" name="next" value={nextPath} />
                <Button type="submit" disabled={!google.enabled} variant="secondary" className="min-h-12 w-full text-sm">
                  <span aria-hidden="true" className="font-semibold">G</span>Continue with Google
                </Button>
                {!google.enabled ? <p className="mt-2 text-xs leading-5 text-label-secondary">Google sign-in is not available yet. Use the password below.</p> : null}
              </form>
              <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-border" />or use a password<span className="h-px flex-1 bg-border" /></div>
              <form action="/api/auth/login" method="post" className="grid gap-4">
                <input type="hidden" name="next" value={nextPath} />
                <label className="grid gap-2 text-sm font-medium text-label">
                  Admin password
                  <input name="password" type="password" autoComplete="current-password" required className="field min-h-12 text-base" />
                </label>
                <Button type="submit" variant="primary" className="min-h-12 w-full text-sm">Enter command center</Button>
              </form>
            </>
          ) : (
            <Callout tone="warning" className="mt-6">Private sign-in is not available right now. The public demo is still open.</Callout>
          )}
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />Private, source-scoped data</p>
        </GlassPanel>
      </div>
    </main>
  );
}
