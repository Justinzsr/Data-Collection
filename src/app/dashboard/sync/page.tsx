import { RotateCw } from "lucide-react";
import { getSystemHealth } from "@/aggregation/services/health-service";
import { listSources } from "@/storage/repositories/sources-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { RunAllDueButton, SyncActionButton } from "@/presentation/dashboard/sync-action-button";

export default async function SyncPage() {
  const [health, sources] = await Promise.all([getSystemHealth(), listSources()]);
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Sync control center"
        title="Manual, cron, and webhook syncs"
        description="All triggers route through enqueueSyncRun and the same connector sync engine."
        action={<RunAllDueButton />}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Active sync runs</p><p className="mt-2 text-3xl font-semibold text-white">{health.activeRuns.length}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Recent runs</p><p className="mt-2 text-3xl font-semibold text-white">{health.recentRuns.length}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Warning/error sources</p><p className="mt-2 text-3xl font-semibold text-white">{health.warningSources + health.errorSources}</p></GlassPanel>
      </div>
      <GlassPanel className="p-4 sm:p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white"><RotateCw className="h-4 w-4 text-cyan-200" />Run selected source now</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sources.filter((source) => source.status !== "disabled").map((source) => (
            <div key={source.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-white">{source.display_name}</p>
                <Badge tone={statusTone(source.status)}>{source.status}</Badge>
              </div>
              <SyncActionButton sourceId={source.id} compact />
            </div>
          ))}
        </div>
      </GlassPanel>
      <div className="hidden overflow-hidden rounded-lg border border-white/10 lg:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>{["Trigger", "Source", "Status", "Started", "Duration", "Records", "Metrics", "Error"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {health.recentRuns.map((run) => (
              <tr key={run.id}>
                <td className="px-4 py-4 text-slate-300">{run.trigger}</td>
                <td className="px-4 py-4 text-slate-300">{run.source_type_key}</td>
                <td className="px-4 py-4"><Badge tone={statusTone(run.status)}>{run.status}</Badge></td>
                <td className="px-4 py-4 text-slate-400">{run.started_at ?? run.created_at}</td>
                <td className="px-4 py-4 text-slate-400">{run.duration_ms ? `${run.duration_ms}ms` : "-"}</td>
                <td className="px-4 py-4 text-slate-400">{run.records_fetched}</td>
                <td className="px-4 py-4 text-slate-400">{run.metrics_upserted}</td>
                <td className="px-4 py-4 text-rose-200">{run.error_message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 lg:hidden">
        {health.recentRuns.map((run) => (
          <GlassPanel key={run.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-white">{run.source_type_key} · {run.trigger}</p>
              <Badge tone={statusTone(run.status)}>{run.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-400">Duration: {run.duration_ms ? `${run.duration_ms}ms` : "-"}</p>
            <p className="text-sm text-slate-400">Records: {run.records_fetched} · Metrics: {run.metrics_upserted}</p>
            {run.error_message ? <p className="mt-2 text-sm text-rose-200">{run.error_message}</p> : null}
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
