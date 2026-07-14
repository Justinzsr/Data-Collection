import { ChevronDown, RotateCw } from "lucide-react";
import { notFound } from "next/navigation";
import { getSystemHealth } from "@/aggregation/services/health-service";
import {
  getConnector,
  getCredentialSetupBlockReason,
  getSourceOperationBlockReason,
} from "@/collection/connectors/registry";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { RunAllDueButton, SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { formatAppDateTime } from "@/storage/runtime/app-time";
import type { SyncRun } from "@/storage/db/schema";

export const dynamic = "force-dynamic";

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function MobileSyncRunCard({ run }: { run: SyncRun }) {
  return (
    <GlassPanel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{humanize(run.source_type_key ?? "unknown_source")}</p>
          <p className="mt-1 text-xs text-slate-500">{humanize(run.trigger)} · {formatAppDateTime(run.started_at ?? run.created_at)}</p>
        </div>
        <Badge tone={statusTone(run.status)}>{humanize(run.status)}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-slate-500">Duration</dt><dd className="mt-1 text-slate-200">{run.duration_ms ? `${run.duration_ms}ms` : "—"}</dd></div>
        <div><dt className="text-slate-500">Records</dt><dd className="mt-1 text-slate-200">{run.records_fetched}</dd></div>
        <div><dt className="text-slate-500">Metrics</dt><dd className="mt-1 text-slate-200">{run.metrics_upserted}</dd></div>
      </dl>
      {run.error_message ? <p className="mt-3 break-words text-xs leading-5 text-rose-200">{run.error_message}</p> : null}
    </GlassPanel>
  );
}

export default async function SyncPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const [health, sources] = await Promise.all([
    getSystemHealth({ dataSpaceId: dataSpace.id }),
    listSources({ dataSpaceId: dataSpace.id }),
  ]);
  const runnableSources = (
    await Promise.all(sources.map(async (source) => {
      const connector = getConnector(source.source_type_key);
      const credentials = await listCredentialHints(source.id);
      const blocked = getSourceOperationBlockReason(source)
        ?? getCredentialSetupBlockReason(connector, credentials.map((credential) => credential.field_key));
      return { source, connector, blocked };
    }))
  )
    .filter(({ connector, blocked }) => !blocked && connector.capabilities.supportsManualSync)
    .map(({ source }) => source);
  const visibleMobileRuns = health.recentRuns.slice(0, 5);
  const olderMobileRuns = health.recentRuns.slice(5);
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Sync control center"
        title={`${dataSpace.display_name} syncs`}
        description="Manual, cron, webhook, retry, and initial triggers route through the shared sync engine."
        action={<RunAllDueButton dataSpaceSlug={dataSpace.slug} />}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Active sync runs</p><p className="mt-2 text-3xl font-semibold text-white">{health.activeRuns.length}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Recent runs</p><p className="mt-2 text-3xl font-semibold text-white">{health.recentRuns.length}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Warning/error sources</p><p className="mt-2 text-3xl font-semibold text-white">{health.warningSources + health.errorSources}</p></GlassPanel>
      </div>
      <GlassPanel className="p-4 sm:p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white"><RotateCw className="h-4 w-4 text-cyan-200" />Run selected source now</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runnableSources.map((source) => (
            <div key={source.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-white">{source.display_name}</p>
                <Badge tone={statusTone(source.status)}>{humanize(source.status)}</Badge>
              </div>
              <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact />
            </div>
          ))}
          {runnableSources.length === 0 ? <p className="text-sm text-slate-500">No sources in this data space currently support manual sync.</p> : null}
        </div>
      </GlassPanel>
      <div className="hidden overflow-hidden rounded-2xl border border-white/10 xl:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>{["Trigger", "Source", "Status", "Started", "Duration", "Records", "Metrics", "Error"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {health.recentRuns.map((run) => (
              <tr key={run.id}>
                <td className="px-4 py-4 text-slate-300">{humanize(run.trigger)}</td>
                <td className="px-4 py-4 text-slate-300">{humanize(run.source_type_key ?? "unknown_source")}</td>
                <td className="px-4 py-4"><Badge tone={statusTone(run.status)}>{humanize(run.status)}</Badge></td>
                <td className="px-4 py-4 text-slate-400">{formatAppDateTime(run.started_at ?? run.created_at)}</td>
                <td className="px-4 py-4 text-slate-400">{run.duration_ms ? `${run.duration_ms}ms` : "-"}</td>
                <td className="px-4 py-4 text-slate-400">{run.records_fetched}</td>
                <td className="px-4 py-4 text-slate-400">{run.metrics_upserted}</td>
                <td className="px-4 py-4 text-rose-200">{run.error_message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:hidden">
        {visibleMobileRuns.map((run) => <MobileSyncRunCard key={run.id} run={run} />)}
        {health.recentRuns.length === 0 ? <p className="text-sm text-slate-500">No recent sync runs.</p> : null}
      </div>
      {olderMobileRuns.length > 0 ? (
        <details className="group xl:hidden">
          <summary className="glass flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-200">
            <span>Show {olderMobileRuns.length} older runs</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {olderMobileRuns.map((run) => <MobileSyncRunCard key={run.id} run={run} />)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
