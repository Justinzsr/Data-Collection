import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import {
  getConnector,
  getCredentialSetupBlockReason,
  getSourceOperationBlockReason,
} from "@/collection/connectors/registry";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { TestConnectionButton } from "@/presentation/dashboard/test-connection-button";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default async function SourcesPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const sources = await listSources({ dataSpaceId: dataSpace.id });
  const withCredentials = await Promise.all(
    sources.map(async (source) => {
      const connector = getConnector(source.source_type_key);
      const credentialKeys = new Set([...connector.requiredFields, ...connector.optionalFields].map((field) => field.key));
      const credentials = (await listCredentialHints(source.id)).filter((credential) => credentialKeys.has(credential.field_key));
      return {
        source,
        connector,
        blockReason: getSourceOperationBlockReason(source) ?? getCredentialSetupBlockReason(connector, credentials.map((credential) => credential.field_key)),
        credentials,
      };
    }),
  );
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Collection layer"
        title={`${dataSpace.display_name} Source management`}
        description="Connect platforms over time, choose sync modes, test setup, and run manual syncs through the shared engine."
        action={
          <LinkButton href={`${basePath}/sources/new`} variant="primary">
            <Plus className="h-4 w-4" />
            Add Source
          </LinkButton>
        }
      />
      {sources.length === 0 ? (
        <GlassPanel className="p-5">
          <h2 className="text-lg font-semibold text-white">{dataSpace.display_name} has no sources yet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {dataSpace.slug === "auto-lab"
              ? "Use this space to test personal car/content TikTok and Instagram accounts."
              : "Add an official API, webhook, drain, tracker, or manual source to start collecting data."}
          </p>
          {dataSpace.slug === "auto-lab" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href={`${basePath}/sources/new?template=tiktok`} variant="primary">Add Auto Lab TikTok</LinkButton>
              <LinkButton href={`${basePath}/sources/new?template=instagram`} variant="secondary">Add Auto Lab Instagram</LinkButton>
            </div>
          ) : null}
        </GlassPanel>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-white/10 xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  {["Source", "Status", "Schedule", "Last success", "Next", "Actions"].map((heading) => (
                    <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {withCredentials.map(({ source, connector, credentials, blockReason }) => (
                  <tr key={source.id} data-testid={`source-row-${source.id}`} className="bg-black/10">
                    <td className="px-4 py-4">
                      <p className="font-medium text-white">{source.display_name}</p>
                      <p className="max-w-xs truncate text-xs text-slate-500">{source.normalized_url ?? source.input_url ?? source.source_type_key}</p>
                      {credentials.length ? <p className="mt-1 text-xs text-slate-500">Credentials: {credentials.map((c) => c.value_hint).join(", ")}</p> : null}
                    </td>
                    <td className="px-4 py-4"><Badge tone={statusTone(source.status)}>{humanize(source.status)}</Badge></td>
                    <td className="px-4 py-4 text-slate-300">{humanize(source.sync_mode)} · {source.sync_frequency_minutes}m</td>
                    <td className="px-4 py-4 text-slate-400">{formatAppDateTime(source.last_success_at)}</td>
                    <td className="px-4 py-4 text-slate-400">{formatAppDateTime(source.next_sync_at, "manual")}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        {!blockReason && connector.capabilities.supportsManualSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                        {!blockReason && connector.capabilities.canTestConnection ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                        <LinkButton href={`${basePath}/sources/${source.id}`} variant="secondary" className="px-3">Manage</LinkButton>
                      </div>
                      {blockReason ? <p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">{blockReason}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:hidden">
            {withCredentials.map(({ source, connector, blockReason }) => (
              <GlassPanel key={source.id} data-testid={`source-card-${source.id}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{source.display_name}</p>
                    <p className="truncate text-xs text-slate-500">{source.normalized_url ?? source.input_url}</p>
                  </div>
                  <Badge tone={statusTone(source.status)}>{humanize(source.status)}</Badge>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-400">
                  <p>Sync mode: {humanize(source.sync_mode)} · {source.sync_frequency_minutes}m</p>
                  <p>Last success: {formatAppDateTime(source.last_success_at)}</p>
                  <p>Last error: {source.last_error ?? "none"}</p>
                  <p>Next: {formatAppDateTime(source.next_sync_at, "manual only")}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!blockReason && connector.capabilities.supportsManualSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                  {!blockReason && connector.capabilities.canTestConnection ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                  <LinkButton href={`${basePath}/sources/${source.id}`} variant="secondary">Manage</LinkButton>
                </div>
                {blockReason ? <p className="mt-3 text-xs leading-5 text-slate-500">{blockReason}</p> : null}
              </GlassPanel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
