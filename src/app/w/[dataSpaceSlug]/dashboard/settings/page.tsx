import { notFound } from "next/navigation";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { getDashboardAuthSetup } from "@/storage/auth/dashboard-session";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const auth = getDashboardAuthSetup();

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <SectionHeader
        eyebrow="Settings"
        title={`${dataSpace.display_name} settings`}
        description="Profile, auth status, default sync cadence, retention, and production safety controls."
      />
      <div className="grid gap-5 md:grid-cols-2">
        <GlassPanel className="p-5">
          <h2 className="text-base font-semibold text-white">Auth status</h2>
          <p className="mt-3 text-sm text-slate-400">DEV_AUTH_BYPASS: {String(process.env.DEV_AUTH_BYPASS ?? "false")}</p>
          <p className="mt-2 text-sm text-slate-400">Dashboard password configured: {auth.configured ? "yes" : "no"}</p>
          <p className="mt-2 text-sm text-slate-400">Missing: {auth.missing.length ? auth.missing.join(", ") : "none"}</p>
          <div className="mt-4">
            <Badge tone={auth.configured ? "green" : "amber"}>{auth.configured ? "session gate ready" : "production setup required"}</Badge>
          </div>
          <form action="/api/auth/logout" method="post" className="mt-4">
            <button className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]">
              Logout
            </button>
          </form>
        </GlassPanel>
        <GlassPanel className="p-5">
          <h2 className="text-base font-semibold text-white">Defaults</h2>
          <p className="mt-3 text-sm text-slate-400">Workspace: {dataSpace.display_name}</p>
          <p className="mt-2 text-sm text-slate-400">Default sync frequency: 60 minutes</p>
          <p className="mt-2 text-sm text-slate-400">Theme: dark command center</p>
          <p className="mt-2 text-sm text-slate-400">Data retention: placeholder for production policy</p>
        </GlassPanel>
      </div>
    </div>
  );
}
