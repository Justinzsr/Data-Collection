import { Plus } from "lucide-react";
import { listSources } from "@/storage/repositories/sources-repository";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";

export default async function SourcesPage() {
  const sources = await listSources();
  const withCredentials = await Promise.all(
    sources.map(async (source) => ({ source, credentials: await listCredentialHints(source.id) })),
  );
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Collection layer"
        title="Source management"
        description="Connect platforms over time, choose sync modes, test setup, and run manual syncs through the shared engine."
        action={
          <LinkButton href="/dashboard/sources/new" variant="primary">
            <Plus className="h-4 w-4" />
            Add Source
          </LinkButton>
        }
      />
      <div className="hidden overflow-hidden rounded-lg border border-white/10 lg:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>
              {["Source", "Status", "Sync", "Last manual", "Last cron", "Last webhook", "Next", "Actions"].map((heading) => (
                <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {withCredentials.map(({ source, credentials }) => (
              <tr key={source.id} className="bg-black/10">
                <td className="px-4 py-4">
                  <p className="font-medium text-white">{source.display_name}</p>
                  <p className="max-w-xs truncate text-xs text-slate-500">{source.normalized_url ?? source.input_url ?? source.source_type_key}</p>
                  {credentials.length ? <p className="mt-1 text-xs text-slate-500">Credentials: {credentials.map((c) => c.value_hint).join(", ")}</p> : null}
                </td>
                <td className="px-4 py-4"><Badge tone={statusTone(source.status)}>{source.status}</Badge></td>
                <td className="px-4 py-4 text-slate-300">{source.sync_mode} · {source.sync_frequency_minutes}m</td>
                <td className="px-4 py-4 text-slate-400">{source.last_manual_sync_at ?? "never"}</td>
                <td className="px-4 py-4 text-slate-400">{source.last_cron_sync_at ?? "never"}</td>
                <td className="px-4 py-4 text-slate-400">{source.last_webhook_sync_at ?? "never"}</td>
                <td className="px-4 py-4 text-slate-400">{source.next_sync_at ?? "manual"}</td>
                <td className="px-4 py-4"><SyncActionButton sourceId={source.id} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:hidden">
        {withCredentials.map(({ source }) => (
          <GlassPanel key={source.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-white">{source.display_name}</p>
                <p className="truncate text-xs text-slate-500">{source.normalized_url ?? source.input_url}</p>
              </div>
              <Badge tone={statusTone(source.status)}>{source.status}</Badge>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-slate-400">
              <p>Sync mode: {source.sync_mode} · {source.sync_frequency_minutes}m</p>
              <p>Last success: {source.last_success_at ?? "never"}</p>
              <p>Last error: {source.last_error ?? "none"}</p>
              <p>Next: {source.next_sync_at ?? "manual only"}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <SyncActionButton sourceId={source.id} compact />
              <LinkButton href="/dashboard/events" variant="secondary">Setup Webhook</LinkButton>
            </div>
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
