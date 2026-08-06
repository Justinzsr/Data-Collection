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
import { KpiCard } from "@/presentation/dashboard/kpi-card";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";
import {
  EMAIL_MARKETING_REFRESH_INTERVAL_MS,
  type EmailMarketingLoadState,
  useEmailMarketingData,
} from "@/presentation/email-marketing/use-email-marketing-data";

const TABLE_PAGE_SIZE = 25;
const initialChartDimension = { width: 720, height: 260 } as const;
const tooltipContentStyle = {
  background: "rgba(8,12,18,0.98)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  color: "#e2e8f0",
  fontSize: "12px",
} as const;

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
      <p className="mt-1 max-w-44 truncate font-mono text-[11px] text-slate-400" title={customerId}>{customerId}</p>
    </div>
  );
}

function StatusStrip({ snapshot, isRefreshing, isStale }: Pick<ViewProps, "snapshot" | "isRefreshing" | "isStale">) {
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="grid gap-3 md:grid-cols-3 md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-300/20 bg-teal-300/10">
            <Database className="h-4 w-4 text-teal-100" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Authoritative source</p>
            <p className="truncate text-sm font-medium text-slate-100">moonarq-web · public.email_signups</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 md:justify-center">
          <Clock3 className="h-4 w-4 shrink-0 text-cyan-200/75" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Visible-page cadence</p>
            <p className="text-sm text-slate-200">Every {EMAIL_MARKETING_REFRESH_INTERVAL_MS / 1_000} seconds · pauses when hidden</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 md:justify-end">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-200/75" />
          <div className="min-w-0 md:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Last updated</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 md:justify-end">
              <p className="text-sm text-slate-200">{snapshot ? formatAppDateTime(snapshot.fetchedAt) : "Waiting for first load"}</p>
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
        <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-cyan-200 motion-reduce:animate-none" />
        <h2 className="mt-4 text-base font-semibold text-white">Loading marketing email signups</h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">Reading the protected MoonArq website Supabase source. No rows are being changed.</p>
      </div>
    </GlassPanel>
  );
}

function ErrorState({ error, refresh }: { error: string; refresh: () => Promise<void> }) {
  return (
    <GlassPanel className="border-rose-300/20 p-5 sm:p-6" role="alert">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" />
          <div>
            <h2 className="font-semibold text-rose-50">Email marketing data is unavailable</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-rose-100/75">{error}</p>
            <p className="mt-2 text-xs text-slate-500">This read failed safely; no Supabase row or Zapier workflow was modified.</p>
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
        <Inbox className="mx-auto h-8 w-8 text-slate-500" />
        <h2 className="mt-4 text-base font-semibold text-white">No marketing email signups yet</h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">The protected <code className="text-slate-300">moonarq-web.public.email_signups</code> source returned no rows.</p>
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
      <GlassPanel className="w-full border-amber-300/20 p-6 text-center sm:p-8" role="alert" aria-live="assertive">
        <LockKeyhole className="mx-auto h-8 w-8 text-amber-100" />
        <h1 className="mt-4 text-xl font-semibold text-white">Email Marketing is locked</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-300">
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-teal-200/75">Signup velocity</p>
          <h2 className="mt-1 text-base font-semibold text-white">Email signups by day</h2>
        </div>
        <Badge tone="cyan" className="self-start sm:self-auto">Last {days} days · PT</Badge>
      </div>
      <div className="h-64 min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2" role="img" aria-label={`Email signups by day for the last ${days} days`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
          <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="emailSignupArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5eead4" stopOpacity={0.38} />
                <stop offset="100%" stopColor="#5eead4" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.11)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} axisLine={false} tickLine={false} minTickGap={24} tick={{ fill: "#64748b", fontSize: 10 }} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
            <Tooltip contentStyle={tooltipContentStyle} labelFormatter={(value) => `Date ${String(value)}`} formatter={(value) => [formatCount(Number(value)), "Signups"]} />
            <Area type="monotone" dataKey="value" stroke="#5eead4" strokeWidth={2} fill="url(#emailSignupArea)" isAnimationActive={false} />
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-cyan-200/70">Delivery queue</p>
      <h2 className="mt-1 text-base font-semibold text-white">Promo email status</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">Sent versus pending among eligible marketing records.</p>
      <div className="mt-4 h-56 min-w-0" role="img" aria-label="Promo email sent versus pending chart">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="82%" paddingAngle={3} isAnimationActive={false}>
                <Cell fill="#34d399" />
                <Cell fill="#fbbf24" />
              </Pie>
              <Tooltip contentStyle={tooltipContentStyle} formatter={(value) => formatCount(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-center text-sm text-slate-500">No consented promo records yet.</div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {data.map((item) => (
          <div key={item.key} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-white">{formatCount(item.value)}</p>
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-indigo-200/70">Acquisition</p>
      <h2 className="mt-1 text-base font-semibold text-white">UTM or signup source</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">Uses `utm_source` first, then the captured signup source.</p>
      <div className="mt-4 h-72 min-w-0" role="img" aria-label="Signup source breakdown chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.1)" strokeDasharray="3 4" horizontal={false} />
            <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
            <YAxis type="category" dataKey="label" width={92} axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
            <Tooltip contentStyle={tooltipContentStyle} formatter={(value) => [formatCount(Number(value)), "Signups"]} />
            <Bar dataKey="value" fill="#818cf8" radius={[0, 5, 5, 0]} isAnimationActive={false} />
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
    <article className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-all text-sm font-semibold text-white">{row.email}</p>
          <p className="mt-1 text-xs text-slate-500">Created {formatAppDateTime(row.created_at, "time unavailable")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConsentBadge consented={row.consent_email_marketing} />
          <PromoBadge row={row} />
        </div>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">Discount code</dt><dd className="mt-1 break-words text-sm text-slate-200">{displayText(row.discount_code)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">Zapier sent</dt><dd className="mt-1 text-sm text-slate-200">{formatAppDateTime(row.zapier_sent_at, "Not sent")}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">Shopify customer</dt><dd className="mt-1"><ShopifyValue customerId={row.shopify_customer_id} /></dd></div>
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">Source</dt><dd className="mt-1 break-words text-sm text-slate-200">{displayText(row.source)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">UTM source</dt><dd className="mt-1 break-words text-sm text-slate-200">{displayText(row.utm_source)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">UTM medium</dt><dd className="mt-1 break-words text-sm text-slate-200">{displayText(row.utm_medium)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">UTM campaign</dt><dd className="mt-1 break-words text-sm text-slate-200">{displayText(row.utm_campaign)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[0.13em] text-slate-500">Updated</dt><dd className="mt-1 text-sm text-slate-200">{formatAppDateTime(row.updated_at, "—")}</dd></div>
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
      <div className="border-b border-white/10 p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-cyan-200/70">Read-only records</p>
            <h2 className="mt-1 text-base font-semibold text-white">Marketing email signups</h2>
            <p className="mt-1 text-xs text-slate-500">Default sort: newest created time first. Display timezone: America/Los_Angeles.</p>
          </div>
          <Badge tone="slate">{formatCount(filteredRows.length)} of {formatCount(rows.length)} rows</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="relative grid gap-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500 md:col-span-2 xl:col-span-2">
            Search email
            <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-slate-500" />
            <input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="name@example.com"
              className="h-10 min-w-0 rounded-lg border border-white/10 bg-slate-950/80 pl-9 pr-3 text-sm font-normal normal-case tracking-normal text-slate-100 placeholder:text-slate-600 focus:border-cyan-300/35 focus:outline-none"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">Promo status
            <select value={filters.promoStatus} onChange={(event) => updateFilter("promoStatus", event.target.value as EmailMarketingFilters["promoStatus"])} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-normal normal-case tracking-normal text-slate-100">
              <option value="all">All</option><option value="sent">Sent</option><option value="pending">Pending</option>
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">Consent
            <select value={filters.consent} onChange={(event) => updateFilter("consent", event.target.value as EmailMarketingFilters["consent"])} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-normal normal-case tracking-normal text-slate-100">
              <option value="all">All</option><option value="consented">Consented</option><option value="not_consented">Not consented</option>
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">Shopify link
            <select value={filters.shopify} onChange={(event) => updateFilter("shopify", event.target.value as EmailMarketingFilters["shopify"])} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-normal normal-case tracking-normal text-slate-100">
              <option value="all">All</option><option value="linked">Linked</option><option value="not_linked">Not linked</option>
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">Created range
            <select value={filters.dateRange} onChange={(event) => updateFilter("dateRange", event.target.value as EmailMarketingFilters["dateRange"])} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-normal normal-case tracking-normal text-slate-100">
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
              <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.13em] text-slate-500">
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-3 font-semibold">
                      <button type="button" className="inline-flex items-center gap-1.5 whitespace-nowrap transition hover:text-slate-200" onClick={() => toggleSort(column.key)} aria-label={`Sort by ${column.label}`}>
                        {column.label}<ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} className="border-t border-white/10 align-top transition hover:bg-white/[0.025]">
                    {columns.map((column) => <td key={column.key} className="px-4 py-3 text-slate-300"><DesktopCell row={row} column={column.key} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-4 lg:hidden">{pageRows.map((row) => <MobileRow key={row.id} row={row} />)}</div>
        </>
      ) : (
        <div className="grid min-h-48 place-items-center p-6 text-center" role="status">
          <div><Search className="mx-auto h-6 w-6 text-slate-600" /><p className="mt-3 text-sm font-medium text-slate-200">No signups match these filters</p><p className="mt-1 text-xs text-slate-500">Clear or adjust the filters to restore rows.</p></div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">Page {safePage} of {totalPages} · {TABLE_PAGE_SIZE} rows per page</p>
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
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-50 sm:flex-row sm:items-center sm:justify-between" role="alert">
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
            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">Chart range
              <select value={chartDays} onChange={(event) => setChartDays(Number(event.target.value))} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-normal normal-case tracking-normal text-slate-100">
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

      <p className="flex items-center gap-2 text-xs leading-5 text-slate-500"><MailPlus className="h-3.5 w-3.5 shrink-0" />Read-only view. It never calls Zapier update endpoints or writes `email_signups` rows.</p>
    </div>
  );
}

export function EmailMarketingDashboard({ dataSpaceName, dataSpaceSlug }: { dataSpaceName: string; dataSpaceSlug: string }) {
  const state = useEmailMarketingData(dataSpaceSlug);
  return <EmailMarketingDashboardView dataSpaceName={dataSpaceName} dataSpaceSlug={dataSpaceSlug} {...state} />;
}
