import Link from "next/link";
import { ArrowLeft, ArrowRight, Database, Search } from "lucide-react";
import { notFound } from "next/navigation";
import { getSourceDataExplorer, type ExplorerTab } from "@/aggregation/services/source-data-explorer-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { CopyJsonButton } from "@/presentation/components/copy-json-button";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

const tabs: Array<{ key: ExplorerTab; label: string }> = [
  { key: "website", label: "Website / Vercel" },
  { key: "supabase", label: "Supabase" },
  { key: "sync_runs", label: "Sync Runs" },
  { key: "raw_ingestions", label: "Raw Ingestions" },
  { key: "metrics_daily", label: "Metrics Daily" },
  { key: "connector_events", label: "Connector Events" },
  { key: "platform_change_events", label: "Change Events" },
];

function queryString(params: Record<string, string | number | undefined>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") next.set(key, String(value));
  }
  return next.toString();
}

function hrefFor(basePath: string, params: Record<string, string | number | undefined>) {
  const query = queryString(params);
  return `${basePath}/data${query ? `?${query}` : ""}`;
}

export default async function SourceDataExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<{ tab?: string; range?: string; sourceId?: string; page?: string }>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const tab = query?.tab ?? "website";
  const range = query?.range ?? "30d";
  const sourceId = query?.sourceId ?? "all";
  const page = Math.max(1, Number(query?.page ?? 1));
  const [sources, result] = await Promise.all([
    listSources({ dataSpaceId: dataSpace.id }),
    getSourceDataExplorer({ tab, range, sourceId, page, dataSpaceId: dataSpace.id }),
  ]);

  return (
    <div className="mx-auto grid max-w-[1600px] gap-6">
      <SectionHeader
        eyebrow="Source of truth"
        title={`${dataSpace.display_name} Source Data Explorer`}
        description="Inspect safe slices of this data space only. Rows are read-only, credentials are never shown, and all times are displayed in PT."
        action={
          <LinkButton href={`${basePath}/reports/daily`} variant="primary">
            Daily Report
            <ArrowRight className="h-4 w-4" />
          </LinkButton>
        }
      />

      <GlassPanel className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <Link key={item.key} href={hrefFor(basePath, { tab: item.key, range, sourceId })} className={`rounded-lg border px-3 py-2 text-sm transition ${result.tab === item.key ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"}`}>
                {item.label}
              </Link>
            ))}
          </div>

          <form className="grid gap-3 sm:grid-cols-[minmax(8rem,10rem)_minmax(12rem,18rem)_auto]">
            <input type="hidden" name="tab" value={result.tab} />
            <label className="grid gap-1 text-xs uppercase tracking-[0.12em] text-slate-500">
              Range
              <select name="range" defaultValue={range} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm normal-case tracking-normal text-slate-100">
                <option value="today">Today</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs uppercase tracking-[0.12em] text-slate-500">
              Source
              <select name="sourceId" defaultValue={sourceId} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm normal-case tracking-normal text-slate-100">
                <option value="all">All sources</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>{source.display_name}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary" className="self-end">
              <Search className="h-4 w-4" />
              Filter
            </Button>
          </form>
        </div>
      </GlassPanel>

      <GlassPanel className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-200" />
              <h2 className="font-semibold text-white">{tabs.find((item) => item.key === result.tab)?.label}</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">Page {result.page}. Safe JSON copies are redacted before display.</p>
          </div>
          <Badge tone="cyan">{result.rows.length} visible rows</Badge>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr>
                {result.columns.map((column) => <th key={column} className="px-4 py-3 font-semibold">{column.replaceAll("_", " ")}</th>)}
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-white/10">
                  {result.columns.map((column) => <td key={column} className="max-w-[18rem] truncate px-4 py-3 text-slate-300">{row.cells[column] ?? ""}</td>)}
                  <td className="px-4 py-3"><CopyJsonButton value={row.json} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-4 lg:hidden">
          {result.rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="grid gap-2">
                {result.columns.slice(0, 7).map((column) => (
                  <div key={column} className="grid gap-1">
                    <p className="text-[0.68rem] uppercase tracking-[0.12em] text-slate-500">{column.replaceAll("_", " ")}</p>
                    <p className="break-words text-sm text-slate-200">{row.cells[column] ?? ""}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3"><CopyJsonButton value={row.json} /></div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 p-4">
          <LinkButton href={hrefFor(basePath, { tab: result.tab, range, sourceId, page: Math.max(1, result.page - 1) })} variant="secondary" className={result.page <= 1 ? "pointer-events-none opacity-50" : ""}>
            <ArrowLeft className="h-4 w-4" />
            Previous
          </LinkButton>
          <LinkButton href={hrefFor(basePath, { tab: result.tab, range, sourceId, page: result.page + 1 })} variant="secondary" className={!result.hasNextPage ? "pointer-events-none opacity-50" : ""}>
            Next
            <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
      </GlassPanel>
    </div>
  );
}
