import { Activity, ChevronDown, CircleAlert, Gauge, RotateCw, Timer } from "lucide-react";
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
import { GlassPanel, SectionHeader, SectionTitle } from "@/presentation/components/ui/panel";
import { IconTile, PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { currentTime, formatRelativeTime } from "@/presentation/components/ui/relative-time";
import { RunAllDueButton, SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { formatAppDateTime } from "@/storage/runtime/app-time";
import type { SourceTypeKey, SyncRun } from "@/storage/db/schema";

export const dynamic = "force-dynamic";

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function connectorLabel(key: SourceTypeKey | null) {
  if (!key) return "Unknown source";
  try {
    return getConnector(key).displayName;
  } catch {
    return humanize(key);
  }
}

function runSourceLabel(run: SyncRun, names: Map<string, string>) {
  return (run.source_id ? names.get(run.source_id) : undefined) ?? connectorLabel(run.source_type_key);
}

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function runStats(runs: SyncRun[]) {
  const finished = runs.filter((run) => run.status === "success" || run.status === "error");
  const successes = finished.filter((run) => run.status === "success").length;
  const durations = runs.map((run) => run.duration_ms).filter((value): value is number => typeof value === "number" && value > 0);
  return {
    successRate: finished.length > 0 ? Math.round((successes / finished.length) * 100) : null,
    failures: finished.length - successes,
    averageDuration: durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
  };
}

function StatCard({ label, value, detail, icon, tone }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: "tint" | "positive" | "warning" | "negative" | "indigo";
}) {
  return (
    <GlassPanel className="flex flex-col items-start gap-2.5 rounded-[22px] p-3.5 sm:flex-row sm:gap-3 sm:p-4">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-label-secondary">{label}</p>
        <p className="tabular mt-0.5 text-[26px] font-semibold leading-8 tracking-[-0.03em] text-label">{value}</p>
        <p className="mt-0.5 text-xs text-muted">{detail}</p>
      </div>
    </GlassPanel>
  );
}

function MobileSyncRunCard({ run, now, names }: { run: SyncRun; now: number; names: Map<string, string> }) {
  return (
    <GlassPanel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformIcon sourceTypeKey={run.source_type_key ?? "custom_api"} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-label">{runSourceLabel(run, names)}</p>
            <p className="mt-0.5 text-xs text-muted">{humanize(run.trigger)} · {formatRelativeTime(run.started_at ?? run.created_at, { now })}</p>
          </div>
        </div>
        <Badge tone={statusTone(run.status)} dot>{humanize(run.status)}</Badge>
      </div>
      <dl className="inset-surface mt-3 grid grid-cols-3 gap-2 p-3 text-xs">
        <div><dt className="text-muted">Duration</dt><dd className="tabular mt-0.5 font-semibold text-label">{formatDuration(run.duration_ms)}</dd></div>
        <div><dt className="text-muted">Records</dt><dd className="tabular mt-0.5 font-semibold text-label">{run.records_fetched}</dd></div>
        <div><dt className="text-muted">Metrics</dt><dd className="tabular mt-0.5 font-semibold text-label">{run.metrics_upserted}</dd></div>
      </dl>
      {run.error_message ? <p className="mt-3 break-words text-xs leading-5 text-negative">{run.error_message}</p> : null}
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
  const now = currentTime();
  const sourceNames = new Map(sources.map((source) => [source.id, source.display_name]));
  const stats = runStats(health.recentRuns);
  const visibleMobileRuns = health.recentRuns.slice(0, 5);
  const olderMobileRuns = health.recentRuns.slice(5);
  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <SectionHeader
        eyebrow="Sync control center"
        title={`${dataSpace.display_name} syncs`}
        description="Manual, cron, webhook, retry, and initial triggers route through the shared sync engine."
        action={<RunAllDueButton dataSpaceSlug={dataSpace.slug} />}
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Active sync runs"
          value={String(health.activeRuns.length)}
          detail={health.activeRuns.length > 0 ? "Running right now" : "Nothing running"}
          icon={RotateCw}
          tone="tint"
        />
        <StatCard
          label="Success rate"
          value={stats.successRate === null ? "—" : `${stats.successRate}%`}
          detail={`${health.recentRuns.length} recent runs`}
          icon={Gauge}
          tone={stats.successRate === null || stats.successRate >= 90 ? "positive" : stats.successRate >= 60 ? "warning" : "negative"}
        />
        <StatCard
          label="Average duration"
          value={formatDuration(stats.averageDuration)}
          detail="Across recent runs"
          icon={Timer}
          tone="indigo"
        />
        <StatCard
          label="Warning/error sources"
          value={String(health.warningSources + health.errorSources)}
          detail={stats.failures > 0 ? `${stats.failures} failed run${stats.failures === 1 ? "" : "s"} recently` : "No recent failures"}
          icon={CircleAlert}
          tone={health.warningSources + health.errorSources > 0 ? "warning" : "positive"}
        />
      </div>
      <GlassPanel className="p-4 sm:p-5">
        <h2 className="mb-4 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.018em] text-label"><RotateCw className="h-4 w-4 text-tint" />Run selected source now</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {runnableSources.map((source) => (
            <div key={source.id} className="inset-surface flex items-center gap-3 p-3">
              <PlatformIcon sourceTypeKey={source.source_type_key} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-label">{source.display_name}</p>
                <p className="truncate text-xs text-muted">Last success {formatRelativeTime(source.last_success_at, { now })}</p>
              </div>
              <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact />
            </div>
          ))}
          {runnableSources.length === 0 ? <p className="text-sm text-muted">No sources in this data space currently support manual sync.</p> : null}
        </div>
      </GlassPanel>

      <SectionTitle eyebrow="History" title="Recent sync runs" />
      <GlassPanel className="hidden overflow-hidden xl:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-separator text-xs text-muted">
            <tr>{["Trigger", "Source", "Status", "Started", "Duration", "Records", "Metrics", "Error"].map((heading) => <th key={heading} className="px-4 py-3 font-medium first:pl-5 last:pr-5">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-separator">
            {health.recentRuns.map((run) => (
              <tr key={run.id} className="transition-colors hover:bg-fill">
                <td className="py-3.5 pl-5 pr-4 text-label">{humanize(run.trigger)}</td>
                <td className="px-4 py-3.5">
                  <span className="flex items-center gap-2.5">
                    <PlatformIcon sourceTypeKey={run.source_type_key ?? "custom_api"} size="sm" />
                    <span className="text-label">{runSourceLabel(run, sourceNames)}</span>
                  </span>
                </td>
                <td className="px-4 py-3.5"><Badge tone={statusTone(run.status)} dot>{humanize(run.status)}</Badge></td>
                <td className="px-4 py-3.5 text-label-secondary" title={formatAppDateTime(run.started_at ?? run.created_at)}>{formatRelativeTime(run.started_at ?? run.created_at, { now })}</td>
                <td className="tabular px-4 py-3.5 text-label-secondary">{formatDuration(run.duration_ms)}</td>
                <td className="tabular px-4 py-3.5 text-label-secondary">{run.records_fetched}</td>
                <td className="tabular px-4 py-3.5 text-label-secondary">{run.metrics_upserted}</td>
                <td className="max-w-xs py-3.5 pl-4 pr-5 text-negative">{run.error_message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {health.recentRuns.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No recent sync runs.</p> : null}
      </GlassPanel>
      <div className="grid gap-3 md:grid-cols-2 xl:hidden">
        {visibleMobileRuns.map((run) => <MobileSyncRunCard key={run.id} run={run} now={now} names={sourceNames} />)}
        {health.recentRuns.length === 0 ? <p className="text-sm text-muted">No recent sync runs.</p> : null}
      </div>
      {olderMobileRuns.length > 0 ? (
        <details className="group xl:hidden">
          <summary className="glass-control flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-full px-5 text-sm font-semibold text-label">
            <span>Show {olderMobileRuns.length} older runs</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {olderMobileRuns.map((run) => <MobileSyncRunCard key={run.id} run={run} now={now} names={sourceNames} />)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
