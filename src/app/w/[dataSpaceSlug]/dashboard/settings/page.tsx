import { LogOut, Palette, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { IconTile } from "@/presentation/components/ui/platform-icon";
import { ThemeToggle } from "@/presentation/theme/theme-toggle";
import { getDashboardAuthSetup } from "@/storage/auth/dashboard-session";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";

export const dynamic = "force-dynamic";

function SettingsRow({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-[14px] text-label">{label}</span>
      {children ?? <span className="min-w-0 break-words text-right text-[14px] text-label-secondary">{value}</span>}
    </div>
  );
}

function SettingsGroup({
  title,
  icon,
  tone,
  footer,
  children,
}: {
  title: string;
  icon: typeof Palette;
  tone: "tint" | "positive" | "indigo" | "neutral";
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2.5 px-1">
        <IconTile icon={icon} tone={tone} size="sm" />
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-label">{title}</h2>
      </div>
      <GlassPanel className="divide-y divide-separator overflow-hidden rounded-[22px]">{children}</GlassPanel>
      {footer ? <p className="px-4 text-xs leading-5 text-muted">{footer}</p> : null}
    </section>
  );
}

export default async function SettingsPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const auth = getDashboardAuthSetup();

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <SectionHeader
        eyebrow="Settings"
        title={`${dataSpace.display_name} settings`}
        description="Appearance, auth status, default sync cadence, retention, and production safety controls."
      />

      <SettingsGroup title="Appearance" icon={Palette} tone="indigo" footer="Automatic follows your device's light or dark setting. The choice is saved in this browser.">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[14px] text-label">Theme</span>
          <ThemeToggle showLabels className="w-full sm:w-auto" />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Auth status" icon={ShieldCheck} tone="positive">
        <SettingsRow label="DEV_AUTH_BYPASS" value={String(process.env.DEV_AUTH_BYPASS ?? "false")} />
        <SettingsRow label="Dashboard password configured" value={auth.configured ? "yes" : "no"} />
        <SettingsRow label="Missing" value={auth.missing.length ? auth.missing.join(", ") : "none"} />
        <SettingsRow label="Session gate">
          <Badge tone={auth.configured ? "green" : "amber"} dot>{auth.configured ? "session gate ready" : "production setup required"}</Badge>
        </SettingsRow>
        <form action="/api/auth/logout" method="post" className="px-2 py-1.5">
          <button className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-[14px] font-medium text-negative transition hover:bg-fill-hover focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Logout
          </button>
        </form>
      </SettingsGroup>

      <SettingsGroup title="Defaults" icon={SlidersHorizontal} tone="neutral">
        <SettingsRow label="Workspace" value={dataSpace.display_name} />
        <SettingsRow label="Default sync frequency" value="60 minutes" />
        <SettingsRow label="Data retention" value="Placeholder for production policy" />
      </SettingsGroup>
    </div>
  );
}
