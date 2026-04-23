import { ArrowRight, DatabaseZap, ShoppingBag, Video } from "lucide-react";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { getGlobalPlatformHealth, getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { PlatformTrendChart } from "@/presentation/charts/platform-trend-chart";
import { CommandCenterHeader } from "@/presentation/dashboard/command-center-header";
import { GlobalHealthStrip } from "@/presentation/dashboard/global-health-strip";
import { PlatformModuleCard } from "@/presentation/dashboard/platform-module-card";

function parseRange(value: string | undefined): DateRangeKey {
  if (value === "today" || value === "7d" || value === "30d") return value;
  return "30d";
}

function moduleSeries(modules: Awaited<ReturnType<typeof getPlatformModules>>) {
  const preferred = [
    { key: "website", color: "#38bdf8" },
    { key: "supabase", color: "#2dd4bf" },
    { key: "tiktok", color: "#fb7185" },
    { key: "instagram", color: "#818cf8" },
  ] as const;
  return preferred
    .map((item) => {
      const platformModule = modules.find((candidate) => candidate.sourceTypeKey === item.key);
      if (!platformModule) return null;
      return { key: platformModule.sourceTypeKey, label: platformModule.platformLabel, color: item.color, data: platformModule.sparkline };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function compactMetric(value: number | string, unit: string) {
  if (typeof value === "string") return value;
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "usd") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<{ range?: string }> }) {
  const params = await searchParams;
  const range = parseRange(params?.range);
  const [modules, health] = await Promise.all([getPlatformModules(range), getGlobalPlatformHealth(range)]);
  const websiteModule = modules.find((platformModule) => platformModule.sourceTypeKey === "website");
  const supabaseModule = modules.find((platformModule) => platformModule.sourceTypeKey === "supabase");
  const socialModules = modules.filter((platformModule) => platformModule.sourceTypeKey === "tiktok" || platformModule.sourceTypeKey === "instagram");
  const commerceModule = modules.find((platformModule) => platformModule.sourceTypeKey === "shopify");
  const futureModules = modules.filter((platformModule) => platformModule.sourceTypeKey === "custom_api" || platformModule.sourceTypeKey === "custom_csv");

  return (
    <div className="mx-auto grid max-w-[1600px] gap-6">
      <CommandCenterHeader modules={modules} range={range} />
      <GlobalHealthStrip health={health} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {websiteModule ? (
          <div className="grid gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Primary source</p>
                <h2 className="mt-1 text-xl font-semibold text-white">MoonArq Website / Vercel</h2>
              </div>
              <Badge tone="cyan">{websiteModule.sourceModeLabel}</Badge>
            </div>
            <PlatformModuleCard module={websiteModule} />
          </div>
        ) : null}
        {supabaseModule ? (
          <div className="grid gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200/80">Second source</p>
                <h2 className="mt-1 text-xl font-semibold text-white">MoonArq Supabase</h2>
              </div>
              <Badge tone="green">{supabaseModule.sourceModeLabel}</Badge>
            </div>
            <PlatformModuleCard module={supabaseModule} />
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.75fr)]">
        <PlatformTrendChart series={moduleSeries(modules)} />
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-5 flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-cyan-200" />
            <h2 className="text-base font-semibold text-white">MoonArq source posture</h2>
          </div>
          <div className="grid gap-3">
            {[websiteModule, supabaseModule, ...socialModules].filter(Boolean).map((platformModule) => (
              <div key={platformModule!.sourceId ?? platformModule!.sourceTypeKey} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-white">{platformModule!.platformLabel}</p>
                  <Badge tone={platformModule!.status === "healthy" ? "green" : platformModule!.status === "error" ? "rose" : platformModule!.status === "needs_credentials" ? "amber" : "cyan"}>
                    {platformModule!.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-slate-500">{platformModule!.primaryMetric.label}</p>
                <p className="text-lg font-semibold text-slate-100">{compactMetric(platformModule!.primaryMetric.value, platformModule!.primaryMetric.unit)}</p>
                <p className="mt-2 text-xs text-slate-500">{platformModule!.sourceModeLabel}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      <section className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Social accounts</p>
            <h2 className="mt-1 text-xl font-semibold text-white">MoonArq social accounts are scaffolded, not pretending to be live</h2>
          </div>
          <LinkButton href="/dashboard/content" variant="secondary">
            Content dashboard
            <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {socialModules.map((platformModule) => (
            <GlassPanel key={platformModule.sourceTypeKey} className="p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                    <Video className="h-5 w-5 text-cyan-100" />
                  </span>
                  <div>
                    <h3 className="font-semibold text-white">{platformModule.platformLabel}</h3>
                    <p className="text-xs text-slate-500">{platformModule.displayName}</p>
                  </div>
                </div>
                <Badge tone="cyan">{platformModule.setupState.label}</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 sm:col-span-1">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{platformModule.primaryMetric.label}</p>
                  <p className="mt-1 text-xl font-semibold text-white">{compactMetric(platformModule.primaryMetric.value, platformModule.primaryMetric.unit)}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm leading-6 text-slate-300 sm:col-span-2">
                  {platformModule.setupState.message}
                </div>
              </div>
            </GlassPanel>
          ))}
        </div>
      </section>

      {commerceModule ? (
        <section className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">Future commerce</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Shopify is present, but it does not dominate the MVP</h2>
            </div>
            <LinkButton href="/dashboard/commerce" variant="secondary">
              Commerce setup
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
          </div>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-amber-200/20 bg-amber-300/10">
                  <ShoppingBag className="h-5 w-5 text-amber-100" />
                </span>
                <div>
                  <h3 className="font-semibold text-white">{commerceModule.platformLabel}</h3>
                  <p className="text-sm leading-6 text-slate-400">{commerceModule.setupState.message}</p>
                </div>
              </div>
              <Badge tone="slate">future / disabled</Badge>
            </div>
          </GlassPanel>
        </section>
      ) : null}

      <section className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Other future MoonArq sources</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Custom sources stay visible without taking over the command center</h2>
          </div>
          <LinkButton href="/dashboard/sources" variant="secondary">
            Source management
            <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {futureModules.map((module) => (
            <PlatformModuleCard key={module.sourceTypeKey} module={module} />
          ))}
        </div>
      </section>
    </div>
  );
}
