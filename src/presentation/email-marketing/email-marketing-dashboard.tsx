"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Clock3,
  Database,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  MailPlus,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildDailyEmailSignupSeries,
  buildPromoStatusBreakdown,
  buildSignupSourceBreakdown,
  classifyPromoStatus,
  DEFAULT_EMAIL_MARKETING_FILTERS,
  filterAndSortEmailSignups,
  type EmailMarketingFilters,
  type EmailMarketingRecord,
  type EmailMarketingSortKey,
} from "@/aggregation/services/email-marketing-analytics";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { KpiCard } from "@/presentation/dashboard/kpi-card";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";
import {
  chartActiveDot,
  chartCursor,
  chartGridStroke,
  chartTick,
  chartTooltipLabelStyle,
  chartTooltipStyle,
} from "@/presentation/charts/chart-theme";
import {
  EMAIL_MARKETING_REFRESH_INTERVAL_MS,
  type EmailMarketingLoadState,
  useEmailMarketingData,
} from "@/presentation/email-marketing/use-email-marketing-data";

const TABLE_PAGE_SIZE = 25;
const initialChartDimension = { width: 720, height: 260 } as const;
const tooltipContentStyle = chartTooltipStyle;

type ViewProps = EmailMarketingLoadState & {
  dataSpaceName: string;
  dataSpaceSlug: string;
  refresh: () => Promise<void>;
};

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function displayText(value: string | null, fallback = "—") {
  return value || fallback;
}

function ConsentBadge({ consented }: { consented: boolean }) {
  return <Badge tone={consented ? "green" : "slate"}>{consented ? "Consented" : "Not consented"}</Badge>;
}

function PromoBadge({ row }: { row: EmailMarketingRecord }) {
  const status = classifyPromoStatus(row);
  return (
    <Badge tone={status === "sent" ? "green" : status === "pending" ? "amber" : "slate"}>
      {status === "sent" ? "Sent" : status === "pending" ? "Pending" : "Not eligible"}
    </Badge>
  );
}

function ShopifyValue({ customerId }: { customerId: string | null }) {
  if (!customerId) return <Badge tone="slate">Not linked</Badge>;
  return (
    <div className="min-w-0">
      <Badge tone="green">Linked</Badge>
      <p className="mt-1 max-w-44 truncate font-mono text-[11px] text-label-secondary" title={customerId}>{customerId}</p>
    </div>
  );
}

function StatusStrip({ snapshot, isRefreshing, isStale }: Pick<ViewProps, "snapshot" | "isRefreshing" | "isStale">) {
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="grid gap-3 md:grid-cols-3 md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformIcon sourceTypeKey="supabase" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">Authoritative source</p>
            <p className="truncate text-sm font-medium text-label">moonarq-web · public.email_signups</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 md:justify-center">
          <Clock3 className="h-4 w-4 shrink-0 text-tint-text" />
          <div>
            <p className="text-xs font-medium text-muted">Visible-page cadence</p>
            <p className="text-sm text-label">Every {EMAIL_MARKETING_REFRESH_INTERVAL_MS / 1_000} seconds · pauses when hidden</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 md:justify-end">
          <ShieldCheck className="h-4 w-4 shrink-0 text-positive" />
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium text-muted">Last updated</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 md:justify-end">
              <p className="text-sm text-label">{snapshot ? formatAppDateTime(snapshot.fetchedAt) : "Waiting for first load"}</p>
              {isRefreshing ? <Badge tone="cyan">Refreshing</Badge> : null}
              {isStale ? <Badge tone="amber">Stale</Badge> : null}
            </div>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}

function FirstLoadState() {
  return (
    <GlassPanel className="grid min-h-72 place-items-center p-6 text-center" role="status" aria-live="polite">
      <div>
        <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-tint-text motion-reduce:animate-none" />
        <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.018em] text-label">Loading marketing email signups</h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-label-secondary">Reading the protected MoonArq website Supabase source. No rows are being changed.</p>
      </div>
    </GlassPanel>
  );
}

function ErrorState({ error, refresh }: { error: string; refresh: () => Promise<void> }) {
  return (
    <GlassPanel className="border-negative-fill/25 p-5 sm:p-6" role="alert">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-negative" />
          <div>
            <h2 className="font-semibold text-negative">Email marketing data is unavailable</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-negative">{error}</p>
            <p className="mt-2 text-xs text-muted">This read failed safely; no Supabase row or Zapier workflow was modified.</p>
          </div>
        </div>
        <Button type="button" variant="secondary" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      </div>
    </GlassPanel>
  );
}

function EmptyState({ refresh }: { refresh: () => Promise<void> }) {
  return (
    <GlassPanel className="grid min-h-72 place-items-center p-6 text-center" role="status">
      <div>
        <Inbox className="mx-auto h-8 w-8 text-muted" />
        <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.018em] text-label">No marketing email signups yet</h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-label-secondary">The protected <code className="text-label-secondary">moonarq-web.public.email_signups</code> source returned no rows.</p>
        <Button type="button" variant="secondary" className="mt-4" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
    </GlassPanel>
  );
}

function LockedState({ dataSpaceSlug }: { dataSpaceSlug: string }) {
  const nextPath = dashboardPath(dataSpaceSlug, "/supabase/email-marketing");
  return (
    <div className="mx-auto grid min-h-[60vh] w-full max-w-2xl place-items-center">
      <GlassPanel className="w-full border-warning-fill/25 p-6 text-center sm:p-8" role="alert" aria-live="assertive">
        <LockKeyhole className="mx-auto h-8 w-8 text-warning" />
        <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.022em] text-label">Email Marketing is locked</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-label-secondary">
          Your private dashboard session is no longer authorized. Protected marketing data has been cleared from this page.
        </p>
        <LinkButton href={`/login?next=${encodeURIComponent(nextPath)}`} variant="primary" className="mt-5">
          Return to private login
        </LinkButton>
      </GlassPanel>
    </div>
  );
}

function TrendChart({ rows, days }: { rows: EmailMarketingRecord[]; days: number }) {
  const data = useMemo(() => buildDailyEmailSignupSeries(rows, days), [days, rows]);
  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5 xl:col-span-2">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Signup velocity</p>
          <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Email signups by day</h2>
        </div>
        <Badge tone="cyan" className="self-start sm:self-auto">Last {days} days · PT</Badge>
      </div>
      <div className="h-64 min-w-0 overflow-hidden rounded-2xl bg-fill p-2" role="img" aria-label={`Email signups by day for the last ${days} days`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
          <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="emailSignupArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} axisLine={false} tickLine={false} minTickGap={24} tick={chartTick} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={chartTick} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={chartTooltipLabelStyle} cursor={chartCursor} labelFormatter={(value) => `Date ${String(value)}`} formatter={(value) => [formatCount(Number(value)), "Signups"]} />
            <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill="url(#emailSignupArea)" activeDot={chartActiveDot} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassPanel>
  );
}

function PromoStatusChart({ rows }: { rows: EmailMarketingRecord[] }) {
  const data = useMemo(() => buildPromoStatusBreakdown(rows), [rows]);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5">
      <p className="eyebrow">Delivery queue</p>
      <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Promo email status</h2>
      <p className="mt-1 text-xs leading-5 text-muted">Sent versus pending among eligible marketing records.</p>
      <div className="mt-4 h-56 min-w-0" role="img" aria-label="Promo email sent versus pending chart">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="82%" paddingAngle={3} isAnimationActive={false}>
                <Cell fill="var(--positive-fill)" stroke="var(--glass-strong)" strokeWidth={2} />
                <Cell fill="var(--warning-fill)" stroke="var(--glass-strong)" strokeWidth={2} />
              </Pie>
              <Tooltip contentStyle={tooltipContentStyle} formatter={(value) => formatCount(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-center text-sm text-muted">No consented promo records yet.</div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {data.map((item) => (
          <div key={item.key} className="rounded-xl bg-fill p-3">
            <p className="text-xs text-muted">{item.label}</p>
            <p className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">{formatCount(item.value)}</p>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

function SourceChart({ rows }: { rows: EmailMarketingRecord[] }) {
  const data = useMemo(() => buildSignupSourceBreakdown(rows), [rows]);
  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5">
      <p className="eyebrow">Acquisition</p>
      <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">UTM or signup source</h2>
      <p className="mt-1 text-xs leading-5 text-muted">Uses `utm_source` first, then the captured signup source.</p>
      <div className="mt-4 h-72 min-w-0" role="img" aria-label="Signup source breakdown chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 4" horizontal={false} />
            <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={chartTick} />
            <YAxis type="category" dataKey="label" width={92} axisLine={false} tickLine={false} tick={chartTick} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={chartTooltipLabelStyle} cursor={{ fill: "var(--fill-hover)" }} formatter={(value) => [formatCount(Number(value)), "Signups"]} />
            <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassPanel>
  );
}

const columns: Array<{ key: EmailMarketingSortKey; label: string }> = [
  { key: "email", label: "Email" },
  { key: "consent_email_marketing", label: "Marketing consent" },
  { key: "discount_code", label: "Discount code" },
  { key: "promo_email_sent", label: "Promo email" },
  { key: "zapier_sent_at", label: "Zapier sent" },
  { key: "shopify_customer_id", label: "Shopify customer" },
  { key: "source", label: "Source" },
  { key: "utm_source", label: "UTM source" },
  { key: "utm_medium", label: "UTM medium" },
  { key: "utm_campaign", label: "UTM campaign" },
  { key: "created_at", label: "Created" },
  { key: "updated_at", label: "Updated" },
];

function DesktopCell({ row, column }: { row: EmailMarketingRecord; column: EmailMarketingSortKey }) {
  if (column === "consent_email_marketing") return <ConsentBadge consented={row.consent_email_marketing} />;
  if (column === "promo_email_sent") return <PromoBadge row={row} />;
  if (column === "shopify_customer_id") return <ShopifyValue customerId={row.shopify_customer_id} />;
  if (column === "zapier_sent_at" || column === "created_at" || column === "updated_at") {
    return <span className="whitespace-nowrap">{formatAppDateTime(row[column], "—")}</span>;
  }
  const value = row[column];
  return <span className="block max-w-56 truncate" title={typeof value === "string" ? value : undefined}>{displayText(typeof value === "string" ? value : null)}</span>;
}

function MobileRow({ row }: { row: EmailMarketingRecord }) {
  return (
    <article className="inset-surface rounded-[18px] p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-all text-sm font-semibold text-label">{row.email}</p>
          <p className="mt-1 text-xs text-muted">Created {formatAppDateTime(row.created_at, "time unavailable")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConsentBadge consented={row.consent_email_marketing} />
          <PromoBadge row={row} />
        </div>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><dt className="text-[11px] text-muted">Discount code</dt><dd className="mt-1 break-words text-sm text-label">{displayText(row.discount_code)}</dd></div>
        <div><dt className="text-[11px] text-muted">Zapier sent</dt><dd className="mt-1 text-sm text-label">{formatAppDateTime(row.zapier_sent_at, "Not sent")}</dd></div>
        <div><dt className="text-[11px] text-muted">Shopify customer</dt><dd className="mt-1"><ShopifyValue customerId={row.shopify_customer_id} /></dd></div>
        <div><dt className="text-[11px] text-muted">Source</dt><dd className="mt-1 break-words text-sm text-label">{displayText(row.source)}</dd></div>
        <div><dt className="text-[11px] text-muted">UTM source</dt><dd className="mt-1 break-words text-sm text-label">{displayText(row.utm_source)}</dd></div>
        <div><dt className="text-[11px] text-muted">UTM medium</dt><dd className="mt-1 break-words text-sm text-label">{displayText(row.utm_medium)}</dd></div>
        <div><dt className="text-[11px] text-muted">UTM campaign</dt><dd className="mt-1 break-words text-sm text-label">{displayText(row.utm_campaign)}</dd></div>
        <div><dt className="text-[11px] text-muted">Updated</dt><dd className="mt-1 text-sm text-label">{formatAppDateTime(row.updated_at, "—")}</dd></div>
      </dl>
    </article>
  );
}

function EmailSignupTable({ rows }: { rows: EmailMarketingRecord[] }) {
  const [filters, setFilters] = useState<EmailMarketingFilters>(DEFAULT_EMAIL_MARKETING_FILTERS);
  const [page, setPage] = useState(1);
  const filteredRows = useMemo(() => filterAndSortEmailSignups(rows, filters), [filters, rows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * TABLE_PAGE_SIZE, safePage * TABLE_PAGE_SIZE);

  function updateFilter<Key extends keyof EmailMarketingFilters>(key: Key, value: EmailMarketingFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function toggleSort(sortKey: EmailMarketingSortKey) {
    setFilters((current) => ({
      ...current,
      sortKey,
      sortDirection: current.sortKey === sortKey && current.sortDirection === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  }

  function resetFilters() {
    setFilters(DEFAULT_EMAIL_MARKETING_FILTERS);
    setPage(1);
  }

  return (
    <GlassPanel className="overflow-hidden">
      <div className="border-b border-separator p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Read-only records</p>
            <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Marketing email signups</h2>
            <p className="mt-1 text-xs text-muted">Default sort: newest created time first. Display timezone: America/Los_Angeles.</p>
          </div>
          <Badge tone="slate">{formatCount(filteredRows.length)} of {formatCount(rows.length)} rows</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="relative grid gap-1 text-xs font-medium text-muted md:col-span-2 xl:col-span-2">
            Search email
            <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted" />
            <input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="name@example.com"
              className="field h-10 min-w-0 pl-9 font-normal"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted">Promo status
            <select value={filters.promoStatus} onChange={(event) => updateFilter("promoStatus", event.target.value as EmailMarketingFilters["promoStatus"])} className="field h-10 font-normal">
              <option value="all">All</option><option value="sent">Sent</option><option value="pending">Pending</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted">Consent
            <select value={filters.consent} onChange={(event) => updateFilter("consent", event.target.value as EmailMarketingFilters["consent"])} className="field h-10 font-normal">
              <option value="all">All</option><option value="consented">Consented</option><option value="not_consented">Not consented</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted">Shopify link
            <select value={filters.shopify} onChange={(event) => updateFilter("shopify", event.target.value as EmailMarketingFilters["shopify"])} className="field h-10 font-normal">
              <option value="all">All</option><option value="linked">Linked</option><option value="not_linked">Not linked</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted">Created range
            <select value={filters.dateRange} onChange={(event) => updateFilter("dateRange", event.target.value as EmailMarketingFilters["dateRange"])} className="field h-10 font-normal">
              <option value="all">All time</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="ghost" className="min-h-9 px-3 text-xs" onClick={resetFilters}>Clear filters</Button>
        </div>
      </div>

      {pageRows.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1700px] text-left text-sm">
              <thead className="bg-fill text-[11px] text-muted">
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-3 font-semibold">
                      <button type="button" className="inline-flex items-center gap-1.5 whitespace-nowrap transition hover:text-label" onClick={() => toggleSort(column.key)} aria-label={`Sort by ${column.label}`}>
                        {column.label}<ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} className="border-t border-separator align-top transition hover:bg-fill">
                    {columns.map((column) => <td key={column.key} className="px-4 py-3 text-label-secondary"><DesktopCell row={row} column={column.key} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-4 lg:hidden">{pageRows.map((row) => <MobileRow key={row.id} row={row} />)}</div>
        </>
      ) : (
        <div className="grid min-h-48 place-items-center p-6 text-center" role="status">
          <div><Search className="mx-auto h-6 w-6 text-muted" /><p className="mt-3 text-sm font-medium text-label">No signups match these filters</p><p className="mt-1 text-xs text-muted">Clear or adjust the filters to restore rows.</p></div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-separator p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">Page {safePage} of {totalPages} · {TABLE_PAGE_SIZE} rows per page</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="min-h-9 px-3 text-xs" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ArrowLeft className="h-3.5 w-3.5" />Previous</Button>
          <Button type="button" variant="secondary" className="min-h-9 px-3 text-xs" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next<ArrowRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </GlassPanel>
  );
}

export function EmailMarketingDashboardView({
  dataSpaceName,
  dataSpaceSlug,
  snapshot,
  isLoading,
  isRefreshing,
  isStale,
  isAuthLocked,
  error,
  refresh,
}: ViewProps) {
  const [chartDays, setChartDays] = useState(30);
  if (isAuthLocked) return <LockedState dataSpaceSlug={dataSpaceSlug} />;
  const basePath = dashboardPath(dataSpaceSlug);

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-5">
      <SectionHeader
        eyebrow="Supabase / Email Marketing"
        title={`${dataSpaceName} Email Marketing`}
        description="A live, read-only view of marketing consent, promo delivery, Zapier status, Shopify linkage, and acquisition data from the MoonArq website Supabase project. Source timestamps stay in UTC; displayed times use America/Los_Angeles (PT)."
        action={
          <>
            <LinkButton href={`${basePath}/data?tab=supabase`} variant="secondary"><Database className="h-4 w-4" />Supabase data</LinkButton>
            <Button type="button" variant="primary" disabled={isLoading || isRefreshing} onClick={() => void refresh()}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
          </>
        }
      />

      <StatusStrip snapshot={snapshot} isRefreshing={isRefreshing} isStale={isStale} />

      {error && snapshot ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning-fill/25 bg-warning-fill/10 p-4 text-sm text-warning sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="flex min-w-0 gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p className="leading-6"><span className="font-semibold">Showing the last successful dataset.</span> {error}</p></div>
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Retry</Button>
        </div>
      ) : null}

      {isLoading && !snapshot ? <FirstLoadState /> : null}
      {!isLoading && error && !snapshot ? <ErrorState error={error} refresh={refresh} /> : null}
      {!isLoading && snapshot && snapshot.rows.length === 0 ? <EmptyState refresh={refresh} /> : null}

      {snapshot && snapshot.rows.length > 0 ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Email marketing KPIs">
            <KpiCard label="Total email signups" value={snapshot.kpis.totalSignups} source="email_signups" />
            <KpiCard label="Marketing-consented signups" value={snapshot.kpis.consentedSignups} source="consent" />
            <KpiCard label="Promo emails sent" value={snapshot.kpis.promoEmailsSent} source="Supabase" />
            <KpiCard label="Pending promo emails" value={snapshot.kpis.pendingPromoEmails} source="consented + unsent" />
            <KpiCard label="Promo email send rate" value={formatPercent(snapshot.kpis.promoEmailSendRate)} source="eligible sent / consented" />
            <KpiCard label="Shopify-linked customers" value={snapshot.kpis.shopifyLinkedCustomers} source="Shopify ID" />
            <KpiCard label="Signups in last 24 hours" value={snapshot.kpis.signupsLast24Hours} source="created_at" />
            <KpiCard label="Signups in last 7 days" value={snapshot.kpis.signupsLast7Days} source="created_at" />
          </section>

          <div className="flex justify-end">
            <label className="grid gap-1 text-xs font-medium text-muted">Chart range
              <select value={chartDays} onChange={(event) => setChartDays(Number(event.target.value))} className="field h-10 font-normal">
                <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
              </select>
            </label>
          </div>
          <section className="grid min-w-0 gap-4 xl:grid-cols-2" aria-label="Email marketing visualizations">
            <TrendChart rows={snapshot.rows} days={chartDays} />
            <PromoStatusChart rows={snapshot.rows} />
            <SourceChart rows={snapshot.rows} />
          </section>
          <EmailSignupTable rows={snapshot.rows} />
        </>
      ) : null}

      <p className="flex items-center gap-2 text-xs leading-5 text-muted"><MailPlus className="h-3.5 w-3.5 shrink-0" />Read-only view. It never calls Zapier update endpoints or writes `email_signups` rows.</p>
    </div>
  );
}

export function EmailMarketingDashboard({ dataSpaceName, dataSpaceSlug }: { dataSpaceName: string; dataSpaceSlug: string }) {
  const state = useEmailMarketingData(dataSpaceSlug);
  return <EmailMarketingDashboardView dataSpaceName={dataSpaceName} dataSpaceSlug={dataSpaceSlug} {...state} />;
}
