import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";

export default function SettingsPage() {
  return (
    <div className="relative min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-6">
        <SectionHeader eyebrow="Settings" title="Private system settings" description="Profile, auth status, default sync cadence, retention, and production safety controls." />
        <div className="grid gap-5 md:grid-cols-2">
          <GlassPanel className="p-5">
            <h2 className="text-base font-semibold text-white">Auth status</h2>
            <p className="mt-3 text-sm text-slate-400">DEV_AUTH_BYPASS: {String(process.env.DEV_AUTH_BYPASS ?? "true")}</p>
            <p className="mt-2 text-sm text-slate-400">Allowed emails: {process.env.ALLOWED_EMAILS ?? "not configured"}</p>
            <div className="mt-4"><Badge tone="amber">switch off dev bypass before deployment</Badge></div>
          </GlassPanel>
          <GlassPanel className="p-5">
            <h2 className="text-base font-semibold text-white">Defaults</h2>
            <p className="mt-3 text-sm text-slate-400">Default sync frequency: 60 minutes</p>
            <p className="mt-2 text-sm text-slate-400">Theme: dark command center</p>
            <p className="mt-2 text-sm text-slate-400">Data retention: placeholder for production policy</p>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
