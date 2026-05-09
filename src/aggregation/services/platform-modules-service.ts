import { getDateRange, type DateRangeKey } from "@/aggregation/services/summary-service";
import { getWebsiteModeLabel, listSecondaryWebsiteSources, resolvePrimaryWebsiteSource } from "@/collection/tracking/website-sources";
import type { MetricDaily, Source, SourceStatus, SourceTypeKey, WebEvent } from "@/storage/db/schema";
import { aggregateMetrics, listMetrics } from "@/storage/repositories/metrics-repository";
import { findWebEvents } from "@/storage/repositories/events-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { endOfAppDateUtc, formatAppDateTime, startOfAppDateUtc } from "@/storage/runtime/app-time";

export type PlatformModule = {
  sourceId: string | null;
  sourceTypeKey: "website" | "supabase" | "vercel_project" | "shopify" | "tiktok" | "instagram" | "custom_api" | "custom_csv";
  displayName: string;
  platformLabel: string;
  status: "demo" | "needs_credentials" | "healthy" | "warning" | "error" | "disabled";
  syncMode: string;
  sourceModeLabel: string;
  primaryMetric: {
    key: string;
    label: string;
    value: number | string;
    unit: string;
    deltaPercent: number | null;
    deltaLabel: string;
  };
  secondaryMetrics: Array<{
    key: string;
    label: string;
    value: number | string;
    unit: string;
  }>;
  sparkline: Array<{
    date: string;
    value: number;
  }>;
  insights: Array<{
    label: string;
    value: string;
  }>;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  setupState: {
    label: string;
    severity: "ok" | "warning" | "error" | "demo";
    message: string;
  };
  actions: {
    canRunSync: boolean;
    canConfigure: boolean;
    canViewDetails: boolean;
  };
};

type ModuleKey = PlatformModule["sourceTypeKey"];

type MetricConfig = {
  primaryKey: string;
  primaryLabel: string;
  unit: string;
  secondary: Array<{ key: string; label: string; unit: string; mode?: "sum" | "latest" }>;
};

const platformOrder: ModuleKey[] = ["website", "supabase", "tiktok", "instagram", "shopify", "custom_api", "custom_csv"];

const platformLabels: Record<ModuleKey, string> = {
  website: "MoonArq Website / Vercel",
  supabase: "MoonArq Supabase",
  vercel_project: "MoonArq Vercel Project",
  shopify: "MoonArq Commerce",
  tiktok: "MoonArq TikTok",
  instagram: "MoonArq Instagram",
  custom_api: "MoonArq Custom API",
  custom_csv: "MoonArq Custom CSV",
};

function platformLabelFor(moduleKey: ModuleKey, dataSpaceName = "MoonArq") {
  if (dataSpaceName === "MoonArq") return platformLabels[moduleKey];
  if (moduleKey === "website") return `${dataSpaceName} Website / Vercel`;
  if (moduleKey === "supabase") return `${dataSpaceName} Supabase`;
  if (moduleKey === "vercel_project") return `${dataSpaceName} Vercel Project`;
  if (moduleKey === "shopify") return `${dataSpaceName} Commerce`;
  if (moduleKey === "custom_api") return `${dataSpaceName} Custom API`;
  if (moduleKey === "custom_csv") return `${dataSpaceName} Custom CSV`;
  return `${dataSpaceName} ${moduleKey === "tiktok" ? "TikTok" : "Instagram"}`;
}

const metricConfig: Record<ModuleKey, MetricConfig> = {
  website: {
    primaryKey: "unique_visitors",
    primaryLabel: "Unique visitors",
    unit: "count",
    secondary: [
      { key: "page_views", label: "Page views", unit: "count" },
      { key: "sessions", label: "Sessions", unit: "count" },
      { key: "custom_events", label: "Custom events", unit: "count" },
    ],
  },
  supabase: {
    primaryKey: "signups",
    primaryLabel: "New signups",
    unit: "count",
    secondary: [
      { key: "users_total", label: "Users total", unit: "count", mode: "latest" },
      { key: "confirmed_users", label: "Confirmed users", unit: "count", mode: "latest" },
      { key: "signups_by_provider", label: "Provider signups", unit: "count" },
    ],
  },
  tiktok: {
    primaryKey: "video_views",
    primaryLabel: "Video views",
    unit: "count",
    secondary: [
      { key: "likes", label: "Likes", unit: "count" },
      { key: "comments", label: "Comments", unit: "count" },
      { key: "shares", label: "Shares", unit: "count" },
      { key: "engagement_rate", label: "Engagement", unit: "percent", mode: "latest" },
    ],
  },
  instagram: {
    primaryKey: "instagram_media_reach",
    primaryLabel: "Reach",
    unit: "count",
    secondary: [
      { key: "instagram_followers", label: "Followers", unit: "count", mode: "latest" },
      { key: "instagram_media_likes", label: "Likes", unit: "count" },
      { key: "instagram_media_comments", label: "Comments", unit: "count" },
      { key: "instagram_engagement_rate", label: "Engagement", unit: "percent", mode: "latest" },
    ],
  },
  shopify: {
    primaryKey: "orders",
    primaryLabel: "Orders",
    unit: "count",
    secondary: [
      { key: "net_payment", label: "Net payment", unit: "usd" },
      { key: "gross_sales", label: "Gross sales", unit: "usd" },
      { key: "refunds", label: "Refunds", unit: "usd" },
    ],
  },
  vercel_project: {
    primaryKey: "deployment_count",
    primaryLabel: "Deployments",
    unit: "count",
    secondary: [{ key: "latest_deployment_status", label: "Latest status", unit: "status", mode: "latest" }],
  },
  custom_api: {
    primaryKey: "records_fetched",
    primaryLabel: "Records",
    unit: "count",
    secondary: [
      { key: "records_inserted", label: "Inserted", unit: "count" },
      { key: "records_updated", label: "Updated", unit: "count" },
    ],
  },
  custom_csv: {
    primaryKey: "rows_imported",
    primaryLabel: "Rows imported",
    unit: "count",
    secondary: [
      { key: "files_processed", label: "Files", unit: "count" },
      { key: "rows_rejected", label: "Rejected", unit: "count" },
    ],
  },
};

function toUtcDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function enumerateDays(startDate: string, endDate: string) {
  const days: string[] = [];
  const cursor = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  while (cursor <= end) {
    days.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function getPreviousRange(range: { startDate: string; endDate: string }) {
  const days = enumerateDays(range.startDate, range.endDate).length;
  const currentStart = toUtcDate(range.startDate);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { startDate: dateKey(previousStart), endDate: dateKey(previousEnd) };
}

function metricRowsFor(rows: MetricDaily[], source: Source | null, metricSourceTypeKey: SourceTypeKey, metricKey: string) {
  return rows.filter((row) => {
    if (row.metric_key !== metricKey) return false;
    if (row.source_type_key !== metricSourceTypeKey) return false;
    if (source && row.source_id !== source.id) return false;
    return true;
  });
}

function latestValue(rows: MetricDaily[], source: Source | null, metricSourceTypeKey: SourceTypeKey, metricKey: string) {
  const matches = metricRowsFor(rows, source, metricSourceTypeKey, metricKey).sort((a, b) => a.date.localeCompare(b.date));
  return matches.at(-1)?.metric_value ?? 0;
}

function metricValue(
  rows: MetricDaily[],
  source: Source | null,
  metricSourceTypeKey: SourceTypeKey,
  metricKey: string,
  mode: "sum" | "latest" = "sum",
  latestRows: MetricDaily[] = rows,
) {
  if (mode === "latest") return latestValue(latestRows, source, metricSourceTypeKey, metricKey);
  return metricRowsFor(rows, source, metricSourceTypeKey, metricKey).reduce((sum, row) => sum + row.metric_value, 0);
}

function sparkline(rows: MetricDaily[], source: Source | null, metricSourceTypeKey: SourceTypeKey, metricKey: string, startDate: string, endDate: string) {
  return enumerateDays(startDate, endDate).map((date) => ({
    date,
    value: metricRowsFor(rows, source, metricSourceTypeKey, metricKey)
      .filter((row) => row.date === date)
      .reduce((sum, row) => sum + row.metric_value, 0),
  }));
}

function deltaLabel(deltaPercent: number | null) {
  if (deltaPercent === null) return "No previous data";
  const sign = deltaPercent > 0 ? "+" : "";
  return `${sign}${deltaPercent.toFixed(1)}% vs previous period`;
}

export function calculateDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function latestSync(source: Source | null) {
  if (!source) return null;
  return source.last_success_at ?? source.last_webhook_sync_at ?? source.last_manual_sync_at ?? source.last_cron_sync_at;
}

function placeholderSourceStatus(sourceTypeKey: ModuleKey): SourceStatus {
  if (sourceTypeKey === "shopify" || sourceTypeKey === "custom_api" || sourceTypeKey === "custom_csv") {
    return "disabled";
  }
  return "demo";
}

function providerBreakdownText(rows: MetricDaily[], source: Source | null, metricSourceTypeKey: SourceTypeKey) {
  const providerRows = metricRowsFor(rows, source, metricSourceTypeKey, "signups_by_provider");
  if (providerRows.length === 0) return "Provider breakdown arrives after the first Supabase sync.";
  const totals = providerRows.reduce<Record<string, number>>((acc, row) => {
    const provider = typeof row.dimensions.provider === "string" ? row.dimensions.provider : "unknown";
    acc[provider] = (acc[provider] ?? 0) + row.metric_value;
    return acc;
  }, {});
  const [topProvider, value] = Object.entries(totals).sort((left, right) => right[1] - left[1])[0] ?? [];
  return topProvider ? `${topProvider} leads with ${value} signups in this range.` : "Provider breakdown arrives after the first Supabase sync.";
}

function topEntry(events: WebEvent[], selector: (event: WebEvent) => string | null | undefined, fallback: string) {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    const key = selector(event) || fallback;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const [label, value] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0] ?? [];
  return label ? `${label} (${value})` : "Waiting for live traffic";
}

function setupState(source: Source | null, moduleKey: ModuleKey, secondaryWebsiteSources: Source[] = [], dataSpaceName = "MoonArq"): PlatformModule["setupState"] {
  if (!source) {
    if (moduleKey === "website") {
      return {
        label: "Needs setup",
        severity: "warning",
        message: `Add a ${dataSpaceName} website source and choose either Vercel Drain or Website Tracker as the primary ingestion mode.`,
      };
    }
    if (moduleKey === "supabase") {
      return {
        label: "Needs setup",
        severity: "warning",
        message: `Add a ${dataSpaceName} Supabase project and save its service role key server-side for real signup and user metrics.`,
      };
    }
    return {
      label: "Future",
      severity: "demo",
      message: `${platformLabelFor(moduleKey, dataSpaceName)} is scaffolded for a future source in this data space.`,
    };
  }
  if (source.status === "healthy") {
    if (moduleKey === "website" && secondaryWebsiteSources.length > 0) {
      return {
        label: "Primary mode active",
        severity: "ok",
        message: `${getWebsiteModeLabel(source)} is the active website ingestion mode. Keep the secondary website source idle to avoid double counting.`,
      };
    }
    return { label: "Connected", severity: "ok", message: "This monitored MoonArq source is live and syncing through the shared engine." };
  }
  if (source.status === "needs_credentials") {
    return {
      label: "Needs credentials",
      severity: "warning",
      message:
        moduleKey === "supabase"
          ? "Save the MoonArq Supabase service role key server-side, or finish the public.profiles webhook setup."
          : moduleKey === "website"
            ? "Choose Vercel Drain or Website Tracker and finish that setup path so private website metrics can land."
            : "Finish the connector setup before expecting private metrics.",
    };
  }
  if (source.status === "error") {
    return { label: "Sync error", severity: "error", message: source.last_error ?? "The last sync failed. Review the source details and connector events." };
  }
  if (source.status === "disabled") {
    return { label: "Disabled", severity: "error", message: "This module is intentionally parked until the MoonArq source is ready." };
  }
  return {
    label: source.metadata.scaffoldOnly === true ? "Scaffold demo" : "Demo mode",
    severity: "demo",
    message:
      moduleKey === "website"
        ? "Showing demo website data until the live MoonArq website tracker or Vercel Drain is connected."
        : moduleKey === "supabase"
          ? "Showing demo user data until the live MoonArq Supabase source is connected."
          : source.metadata.scaffoldOnly === true
            ? "Connector shape is ready; real official API collection can be added later."
            : "Showing generated demo data until the real source is connected.",
  };
}

function sourceRank(source: Source) {
  if (source.status === "healthy" && source.metadata.oauth_connected === true) return 0;
  if (source.status === "healthy") return 1;
  if (source.status === "needs_credentials") return 2;
  if (source.status === "demo") return 4;
  return 3;
}

function primarySourceForModule(sources: Source[], moduleKey: ModuleKey) {
  return sources
    .filter((source) => source.source_type_key === moduleKey)
    .sort((left, right) => sourceRank(left) - sourceRank(right) || left.display_name.localeCompare(right.display_name))[0] ?? null;
}

function createModule(input: {
  moduleKey: ModuleKey;
  source: Source | null;
  metricSourceTypeKey: SourceTypeKey;
  currentRows: MetricDaily[];
  previousRows: MetricDaily[];
  latestRows: MetricDaily[];
  range: { startDate: string; endDate: string };
  insights?: Array<{ label: string; value: string }>;
  secondaryWebsiteSources?: Source[];
  displayName?: string;
  sourceModeLabel?: string;
  dataSpaceName?: string;
}): PlatformModule {
  const { moduleKey, source, metricSourceTypeKey, currentRows, previousRows, range } = input;
  const config = metricConfig[moduleKey];
  const status = source?.status ?? placeholderSourceStatus(moduleKey);
  const currentValue = metricValue(currentRows, source, metricSourceTypeKey, config.primaryKey);
  const previousValue = metricValue(previousRows, source, metricSourceTypeKey, config.primaryKey);
  const latestUsersTotal =
    moduleKey === "supabase" ? metricValue(currentRows, source, metricSourceTypeKey, "users_total", "latest", input.latestRows) : 0;
  const isHealthySupabaseNoSignupWindow = moduleKey === "supabase" && currentValue === 0 && latestUsersTotal > 0;
  const deltaPercent = isHealthySupabaseNoSignupWindow ? null : calculateDelta(currentValue, previousValue);

  const platformLabel = platformLabelFor(moduleKey, input.dataSpaceName);
  return {
    sourceId: source?.id ?? null,
    sourceTypeKey: moduleKey,
    displayName: input.displayName ?? source?.display_name ?? platformLabel,
    platformLabel,
    status,
    syncMode: source?.sync_mode ?? "manual",
    sourceModeLabel: input.sourceModeLabel ?? (moduleKey === "website" ? getWebsiteModeLabel(source) : source?.status === "demo" ? "Demo" : "Monitored Source"),
    primaryMetric: {
      key: config.primaryKey,
      label: config.primaryLabel,
      value: currentValue,
      unit: config.unit,
      deltaPercent,
      deltaLabel: isHealthySupabaseNoSignupWindow ? "No new signups" : deltaLabel(deltaPercent),
    },
    secondaryMetrics: config.secondary.slice(0, 4).map((item) => ({
      key: item.key,
      label: item.label,
      value: metricValue(currentRows, source, metricSourceTypeKey, item.key, item.mode ?? "sum", input.latestRows),
      unit: item.unit,
    })),
    sparkline: sparkline(currentRows, source, metricSourceTypeKey, config.primaryKey, range.startDate, range.endDate),
    insights: input.insights ?? [],
    lastSyncAt: latestSync(source),
    nextSyncAt: source?.next_sync_at ?? null,
    lastError: source?.last_error ?? null,
    setupState: setupState(source, moduleKey, input.secondaryWebsiteSources, input.dataSpaceName),
    actions: {
      canRunSync: Boolean(source && status !== "disabled"),
      canConfigure: Boolean(source),
      canViewDetails: Boolean(source),
    },
  };
}

export async function getPlatformModules(
  rangeKey: DateRangeKey = "30d",
  options: { dataSpaceId?: string; dataSpaceName?: string } = {},
): Promise<PlatformModule[]> {
  const range = getDateRange(rangeKey);
  const previousRange = getPreviousRange(range);
  const [sources, currentRows, previousRows, latestRows] = await Promise.all([
    listSources({ dataSpaceId: options.dataSpaceId }),
    listMetrics({ startDate: range.startDate, endDate: range.endDate, dataSpaceId: options.dataSpaceId }),
    listMetrics({ startDate: previousRange.startDate, endDate: previousRange.endDate, dataSpaceId: options.dataSpaceId }),
    listMetrics({ metricKeys: ["users_total", "confirmed_users", "followers", "engagement_rate", "latest_deployment_status"], dataSpaceId: options.dataSpaceId }),
  ]);

  const websiteSource = resolvePrimaryWebsiteSource(sources);
  const secondaryWebsiteSources = listSecondaryWebsiteSources(sources);
  const websiteEvents = websiteSource
    ? await findWebEvents({
        sourceId: websiteSource.id,
        startOccurredAt: startOfAppDateUtc(range.startDate),
        endOccurredAt: endOfAppDateUtc(range.endDate),
        limit: 2000,
        dataSpaceId: options.dataSpaceId,
      })
    : [];

  const websiteModule = createModule({
    moduleKey: "website",
    source: websiteSource,
    metricSourceTypeKey: websiteSource?.source_type_key ?? "website",
    currentRows,
    previousRows,
    latestRows,
    range,
    secondaryWebsiteSources,
    sourceModeLabel: getWebsiteModeLabel(websiteSource),
    displayName: websiteSource?.display_name ?? platformLabelFor("website", options.dataSpaceName),
    dataSpaceName: options.dataSpaceName,
    insights: [
      { label: "Top page", value: topEntry(websiteEvents, (event) => event.path, "/") },
      { label: "Top referrer", value: topEntry(websiteEvents, (event) => event.referrer, "direct") },
      { label: "Top country", value: topEntry(websiteEvents, (event) => event.country, "Unknown") },
      { label: "Top device", value: topEntry(websiteEvents, (event) => event.device_type, "Unknown") },
    ],
  });

  const supabaseSource = sources.find((source) => source.source_type_key === "supabase") ?? null;
  const modules: PlatformModule[] = [
    websiteModule,
    createModule({
      moduleKey: "supabase",
      source: supabaseSource,
      metricSourceTypeKey: "supabase",
      currentRows,
      previousRows,
      latestRows,
      range,
      sourceModeLabel: supabaseSource?.metadata.mode === "public_profiles_or_service_role" ? "Profiles or Service Role" : supabaseSource ? "Supabase Source" : "Needs setup",
      dataSpaceName: options.dataSpaceName,
      insights: [
        { label: "Provider mix", value: providerBreakdownText(currentRows, supabaseSource, "supabase") },
        {
          label: "Freshness",
          value: supabaseSource?.last_success_at ? `Last successful sync ${formatAppDateTime(supabaseSource.last_success_at)}` : "Waiting for first sync",
        },
      ],
    }),
  ];

  for (const moduleKey of platformOrder.filter((item) => item !== "website" && item !== "supabase")) {
    const source = primarySourceForModule(sources, moduleKey);
    modules.push(
      createModule({
        moduleKey,
        source,
        metricSourceTypeKey: moduleKey,
        currentRows,
        previousRows,
        latestRows,
        range,
        sourceModeLabel: source?.metadata.scaffoldOnly === true ? "Scaffold" : source ? "Monitored Source" : "Future",
        dataSpaceName: options.dataSpaceName,
      }),
    );
  }

  return modules;
}

export async function getGlobalPlatformHealth(rangeKey: DateRangeKey = "30d", options: { dataSpaceId?: string; dataSpaceName?: string } = {}) {
  const modules = await getPlatformModules(rangeKey, options);
  const connected = modules.filter((item) => item.sourceId && item.status !== "disabled");
  const errors = modules.filter((item) => item.status === "error" || item.lastError).length;
  const lastSuccessfulSync = connected
    .map((item) => item.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const sourceTotals = await listMetrics({ startDate: getDateRange(rangeKey).startDate, endDate: getDateRange(rangeKey).endDate, dataSpaceId: options.dataSpaceId });
  return {
    activeSources: connected.length,
    syncErrors: errors,
    lastSuccessfulSync,
    dataFreshness: lastSuccessfulSync ? "Fresh" : "No sync yet",
    modeLabel: modules.some((item) => item.status === "demo" || item.status === "needs_credentials") ? "Setup + live monitoring" : "Live monitoring",
    trackedEvents: aggregateMetrics(sourceTotals, "page_views") + aggregateMetrics(sourceTotals, "custom_events"),
  };
}
