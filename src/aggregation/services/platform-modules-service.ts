import { getDateRange, type DateRangeKey } from "@/aggregation/services/summary-service";
import type { MetricDaily, Source, SourceStatus, SourceTypeKey } from "@/storage/db/schema";
import { aggregateMetrics, listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";

export type PlatformModule = {
  sourceId: string | null;
  sourceTypeKey:
    | "website"
    | "supabase"
    | "vercel_project"
    | "shopify"
    | "tiktok"
    | "instagram"
    | "custom_api"
    | "custom_csv";
  displayName: string;
  platformLabel: string;
  status: "demo" | "needs_credentials" | "healthy" | "warning" | "error" | "disabled";
  syncMode: string;
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

type MetricConfig = {
  primaryKey: string;
  primaryLabel: string;
  unit: string;
  secondary: Array<{ key: string; label: string; unit: string; mode?: "sum" | "latest" }>;
};

const platformOrder: SourceTypeKey[] = [
  "website",
  "supabase",
  "tiktok",
  "instagram",
  "shopify",
  "vercel_project",
  "custom_api",
  "custom_csv",
];

const platformLabels: Record<SourceTypeKey, string> = {
  website: "Website / Vercel Site",
  supabase: "Supabase",
  vercel_project: "Vercel Project",
  shopify: "Shopify",
  tiktok: "TikTok",
  instagram: "Instagram",
  custom_api: "Custom API",
  custom_csv: "Custom CSV",
};

const metricConfig: Record<SourceTypeKey, MetricConfig> = {
  website: {
    primaryKey: "page_views",
    primaryLabel: "Page views",
    unit: "count",
    secondary: [
      { key: "unique_visitors", label: "Unique visitors", unit: "count" },
      { key: "sessions", label: "Sessions", unit: "count" },
      { key: "custom_events", label: "Custom events", unit: "count" },
    ],
  },
  supabase: {
    primaryKey: "signups",
    primaryLabel: "Signups",
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
    primaryKey: "reach",
    primaryLabel: "Reach",
    unit: "count",
    secondary: [
      { key: "impressions", label: "Impressions", unit: "count" },
      { key: "followers", label: "Followers", unit: "count", mode: "latest" },
      { key: "profile_views", label: "Profile views", unit: "count" },
      { key: "engagement_rate", label: "Engagement", unit: "percent", mode: "latest" },
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
    secondary: [
      { key: "latest_deployment_status", label: "Latest status", unit: "status", mode: "latest" },
      { key: "build_errors", label: "Build errors", unit: "count" },
    ],
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

function metricRowsFor(rows: MetricDaily[], source: Source | null, sourceTypeKey: SourceTypeKey, metricKey: string) {
  return rows.filter((row) => {
    if (row.metric_key !== metricKey) return false;
    if (row.source_type_key !== sourceTypeKey) return false;
    if (source && row.source_id !== source.id) return false;
    return true;
  });
}

function latestValue(rows: MetricDaily[], source: Source | null, sourceTypeKey: SourceTypeKey, metricKey: string) {
  const matches = metricRowsFor(rows, source, sourceTypeKey, metricKey).sort((a, b) => a.date.localeCompare(b.date));
  return matches.at(-1)?.metric_value ?? 0;
}

function metricValue(rows: MetricDaily[], source: Source | null, sourceTypeKey: SourceTypeKey, metricKey: string, mode: "sum" | "latest" = "sum") {
  if (mode === "latest") return latestValue(rows, source, sourceTypeKey, metricKey);
  return metricRowsFor(rows, source, sourceTypeKey, metricKey).reduce((sum, row) => sum + row.metric_value, 0);
}

function sparkline(rows: MetricDaily[], source: Source | null, sourceTypeKey: SourceTypeKey, metricKey: string, startDate: string, endDate: string) {
  return enumerateDays(startDate, endDate).map((date) => ({
    date,
    value: metricRowsFor(rows, source, sourceTypeKey, metricKey)
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

function setupState(source: Source | null, sourceTypeKey: SourceTypeKey): PlatformModule["setupState"] {
  if (!source) {
    return {
      label: "Future",
      severity: "demo",
      message: `${platformLabels[sourceTypeKey]} is scaffolded and ready to configure when this platform becomes active.`,
    };
  }
  if (source.status === "healthy") {
    return { label: "Connected", severity: "ok", message: "Real source is connected and syncs through the shared engine." };
  }
  if (source.status === "needs_credentials") {
    return {
      label: "Needs credentials",
      severity: "warning",
      message: "The link identifies the source. Add encrypted API credentials, webhook setup, or tracking snippet for private metrics.",
    };
  }
  if (source.status === "error") {
    return { label: "Sync error", severity: "error", message: source.last_error ?? "The last sync failed. Check credentials and connector events." };
  }
  if (source.status === "disabled") {
    return { label: "Disabled", severity: "error", message: "This source is disabled or future-only and will not run sync jobs." };
  }
  return {
    label: source.metadata.scaffoldOnly === true ? "Scaffold demo" : "Demo mode",
    severity: "demo",
    message:
      source.metadata.scaffoldOnly === true
        ? "Connector shape is ready; real official API collection can be added later."
        : "Showing generated demo data until real credentials or tracking events are connected.",
  };
}

function latestSync(source: Source | null) {
  if (!source) return null;
  return source.last_success_at ?? source.last_manual_sync_at ?? source.last_cron_sync_at ?? source.last_webhook_sync_at;
}

function placeholderSourceStatus(sourceTypeKey: SourceTypeKey): SourceStatus {
  if (sourceTypeKey === "shopify" || sourceTypeKey === "custom_api" || sourceTypeKey === "custom_csv" || sourceTypeKey === "vercel_project") {
    return "disabled";
  }
  return "demo";
}

function createModule(source: Source | null, sourceTypeKey: SourceTypeKey, currentRows: MetricDaily[], previousRows: MetricDaily[], range: { startDate: string; endDate: string }): PlatformModule {
  const config = metricConfig[sourceTypeKey];
  const status = source?.status ?? placeholderSourceStatus(sourceTypeKey);
  const currentValue = metricValue(currentRows, source, sourceTypeKey, config.primaryKey);
  const previousValue = metricValue(previousRows, source, sourceTypeKey, config.primaryKey);
  const deltaPercent = calculateDelta(currentValue, previousValue);
  return {
    sourceId: source?.id ?? null,
    sourceTypeKey,
    displayName: source?.display_name ?? platformLabels[sourceTypeKey],
    platformLabel: platformLabels[sourceTypeKey],
    status,
    syncMode: source?.sync_mode ?? "manual",
    primaryMetric: {
      key: config.primaryKey,
      label: config.primaryLabel,
      value: currentValue,
      unit: config.unit,
      deltaPercent,
      deltaLabel: deltaLabel(deltaPercent),
    },
    secondaryMetrics: config.secondary.slice(0, 4).map((item) => ({
      key: item.key,
      label: item.label,
      value: metricValue(currentRows, source, sourceTypeKey, item.key, item.mode ?? "sum"),
      unit: item.unit,
    })),
    sparkline: sparkline(currentRows, source, sourceTypeKey, config.primaryKey, range.startDate, range.endDate),
    lastSyncAt: latestSync(source),
    nextSyncAt: source?.next_sync_at ?? null,
    lastError: source?.last_error ?? null,
    setupState: setupState(source, sourceTypeKey),
    actions: {
      canRunSync: Boolean(source && status !== "disabled"),
      canConfigure: Boolean(source),
      canViewDetails: Boolean(source),
    },
  };
}

export async function getPlatformModules(rangeKey: DateRangeKey = "30d"): Promise<PlatformModule[]> {
  const range = getDateRange(rangeKey);
  const previousRange = getPreviousRange(range);
  const [sources, currentRows, previousRows] = await Promise.all([
    listSources(),
    listMetrics({ startDate: range.startDate, endDate: range.endDate }),
    listMetrics({ startDate: previousRange.startDate, endDate: previousRange.endDate }),
  ]);
  const existingModules = sources.map((source) => createModule(source, source.source_type_key, currentRows, previousRows, range));
  const missingModules = platformOrder
    .filter((sourceTypeKey) => !sources.some((source) => source.source_type_key === sourceTypeKey))
    .map((sourceTypeKey) => createModule(null, sourceTypeKey, currentRows, previousRows, range));
  return [...existingModules, ...missingModules].sort((a, b) => {
    const orderA = platformOrder.indexOf(a.sourceTypeKey);
    const orderB = platformOrder.indexOf(b.sourceTypeKey);
    if (orderA !== orderB) return orderA - orderB;
    return a.displayName.localeCompare(b.displayName);
  });
}

export async function getGlobalPlatformHealth(rangeKey: DateRangeKey = "30d") {
  const modules = await getPlatformModules(rangeKey);
  const connected = modules.filter((item) => item.sourceId && item.status !== "disabled");
  const errors = modules.filter((item) => item.status === "error" || item.lastError).length;
  const lastSuccessfulSync = connected
    .map((item) => item.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const demoModules = modules.filter((item) => item.status === "demo").length;
  const sourceTotals = await listMetrics({ startDate: getDateRange(rangeKey).startDate, endDate: getDateRange(rangeKey).endDate });
  return {
    activeSources: connected.length,
    syncErrors: errors,
    lastSuccessfulSync,
    dataFreshness: lastSuccessfulSync ? "Fresh within current demo window" : "No successful sync yet",
    modeLabel: demoModules > 0 ? "Demo + setup mode" : "Real mode",
    trackedEvents: aggregateMetrics(sourceTotals, "page_views") + aggregateMetrics(sourceTotals, "custom_events"),
  };
}
