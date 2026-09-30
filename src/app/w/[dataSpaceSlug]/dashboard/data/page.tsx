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
  const requestedPage = Number.parseInt(query?.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const [sources, result] = await Promise.all([
    listSources({ dataSpaceId: dataSpace.id }),
    getSourceDataExplorer({ tab, range, sourceId, page, dataSpaceId: dataSpace.id }),
  ]);

  return (
    <div className="mx-auto grid max-w-[1600px] gap-5">
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
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <nav className="segmented max-w-full flex-nowrap overflow-x-auto rounded-[20px]" aria-label="Data explorer tables">
            {tabs.map((item) => (
              <Link
                key={item.key}
                href={hrefFor(basePath, { tab: item.key, range, sourceId })}
                aria-current={result.tab === item.key ? "page" : undefined}
                className="segmented-item min-h-10 shrink-0 rounded-[16px]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <form className="grid gap-3 sm:w-fit sm:grid-cols-[minmax(8rem,10rem)_minmax(12rem,18rem)_auto]">
            <input type="hidden" name="tab" value={result.tab} />
            <label className="grid min-w-0 grid-cols-1 gap-1.5 text-xs font-medium text-muted">
              Range
              <select name="range" defaultValue={range} className="field h-10 w-full min-w-0">
                <option value="today">Today</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <label className="grid min-w-0 grid-cols-1 gap-1.5 text-xs font-medium text-muted">
              Source
              <select name="sourceId" defaultValue={sourceId} className="field h-10 w-full min-w-0">
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
        <div className="flex flex-col gap-2 border-b border-separator p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-tint" />
              <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">{tabs.find((item) => item.key === result.tab)?.label}</h2>
            </div>
            <p className="mt-1 text-sm text-muted">Page {result.page}. Safe JSON copies are redacted before display.</p>
          </div>
          <Badge tone="cyan">{result.rows.length} visible rows</Badge>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-fill text-xs text-muted">
              <tr>
                {result.columns.map((column) => <th key={column} className="px-4 py-3 font-medium capitalize first:pl-5">{column.replaceAll("_", " ")}</th>)}
                <th className="px-4 py-3 pr-5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-separator transition-colors hover:bg-fill">
                  {result.columns.map((column) => <td key={column} className="max-w-[18rem] truncate px-4 py-3 text-label-secondary first:pl-5 first:font-medium first:text-label">{row.cells[column] ?? ""}</td>)}
                  <td className="px-4 py-3 pr-5"><CopyJsonButton value={row.json} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-4 lg:hidden">
          {result.rows.map((row) => (
            <div key={row.id} className="inset-surface p-3.5">
              <div className="grid gap-2">
                {result.columns.slice(0, 7).map((column) => (
                  <div key={column} className="grid gap-1">
                    <p className="text-[11px] font-medium capitalize text-muted">{column.replaceAll("_", " ")}</p>
                    <p className="break-words text-sm text-label">{row.cells[column] ?? ""}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3"><CopyJsonButton value={row.json} /></div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-separator p-4">
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
