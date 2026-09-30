import { CheckCircle2, CircleAlert, DatabaseZap, KeyRound, Plus } from "lucide-react";
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
import { IconTile, PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { currentTime, formatRelativeTime } from "@/presentation/components/ui/relative-time";
import { authorizationState } from "@/presentation/dashboard/connection-health-panel";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { TestConnectionButton } from "@/presentation/dashboard/test-connection-button";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function SummaryTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof DatabaseZap;
  tone: "tint" | "positive" | "warning" | "negative";
}) {
  return (
    <GlassPanel className="flex flex-col items-start gap-2.5 rounded-[22px] p-3.5 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-label-secondary">{label}</p>
        <p className="tabular text-[26px] font-semibold leading-8 tracking-[-0.03em] text-label">{value}</p>
      </div>
    </GlassPanel>
  );
}

export default async function SourcesPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const sources = await listSources({ dataSpaceId: dataSpace.id });
  const now = currentTime();
  const withCredentials = await Promise.all(
    sources.map(async (source) => {
      const connector = getConnector(source.source_type_key);
      const credentialKeys = new Set([...connector.requiredFields, ...connector.optionalFields].map((field) => field.key));
      const credentials = (await listCredentialHints(source.id)).filter((credential) => credentialKeys.has(credential.field_key));
      return {
        source,
        connector,
        authorization: authorizationState(source, now),
        blockReason: getSourceOperationBlockReason(source) ?? getCredentialSetupBlockReason(connector, credentials.map((credential) => credential.field_key)),
        credentials,
      };
    }),
  );
  const healthy = sources.filter((source) => ["healthy", "demo"].includes(source.status)).length;
  const attention = sources.filter((source) => ["warning", "needs_credentials", "error"].includes(source.status)).length;
  const renewals = withCredentials.filter(({ authorization }) => authorization?.renewal).length;

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
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
        <GlassPanel className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <IconTile icon={DatabaseZap} tone="tint" size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">{dataSpace.display_name} has no sources yet</h2>
            <p className="mt-1 text-sm leading-6 text-label-secondary">
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
          </div>
        </GlassPanel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <SummaryTile label="Sources" value={sources.length} icon={DatabaseZap} tone="tint" />
            <SummaryTile label="Healthy" value={healthy} icon={CheckCircle2} tone="positive" />
            <SummaryTile label="Need attention" value={attention} icon={CircleAlert} tone={attention > 0 ? "warning" : "positive"} />
            <SummaryTile label="Renewals due" value={renewals} icon={KeyRound} tone={renewals > 0 ? "warning" : "positive"} />
          </div>

          <GlassPanel className="hidden overflow-hidden xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-separator text-xs text-muted">
                <tr>
                  {["Source", "Status", "Authorization", "Last success", "Schedule", "Actions"].map((heading) => (
                    <th key={heading} className="px-4 py-3 font-medium first:pl-5 last:pr-5">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {withCredentials.map(({ source, connector, credentials, blockReason, authorization }) => (
                  <tr key={source.id} data-testid={`source-row-${source.id}`} className="align-top transition-colors hover:bg-fill">
                    <td className="py-4 pl-5 pr-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <PlatformIcon sourceTypeKey={source.source_type_key} />
                        <div className="min-w-0">
                          <p className="font-semibold text-label">{source.display_name}</p>
                          <p className="max-w-xs truncate text-xs text-muted">{source.normalized_url ?? source.input_url ?? source.source_type_key}</p>
                          {credentials.length ? <p className="mt-1 max-w-xs truncate font-mono text-[11px] text-muted">{credentials.map((c) => c.value_hint).join(", ")}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4"><Badge tone={statusTone(source.status)} dot>{humanize(source.status)}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {authorization ? <Badge tone={authorization.tone}>{authorization.label}</Badge> : <span className="text-xs text-muted">Not required</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {source.source_type_key === "website"
                        ? <p className="text-label">Live tracker</p>
                        : <p className="text-label" title={formatAppDateTime(source.last_success_at)}>{formatRelativeTime(source.last_success_at, { now })}</p>}
                    </td>
                    <td className="px-4 py-4">
                      <p className="whitespace-nowrap text-label-secondary">{humanize(source.sync_mode)} · every {source.sync_frequency_minutes}m</p>
                      <p className="mt-0.5 text-xs text-muted">{source.next_sync_at ? `Next ${formatAppDateTime(source.next_sync_at)}` : "Manual only"}</p>
                    </td>
                    <td className="py-4 pl-4 pr-5">
                      <div className="flex flex-wrap gap-2">
                        {!blockReason && connector.capabilities.supportsManualSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                        {!blockReason && connector.capabilities.canTestConnection ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                        <LinkButton href={`${basePath}/sources/${source.id}`} variant="secondary" className="px-3.5">Manage</LinkButton>
                      </div>
                      {blockReason ? <p className="mt-2 max-w-xs text-xs leading-5 text-muted">{blockReason}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassPanel>
          <div className="grid gap-3 md:grid-cols-2 xl:hidden">
            {withCredentials.map(({ source, connector, blockReason, authorization }) => (
              <GlassPanel key={source.id} data-testid={`source-card-${source.id}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <PlatformIcon sourceTypeKey={source.source_type_key} />
                    <div className="min-w-0">
                      <p className="font-semibold text-label">{source.display_name}</p>
                      <p className="truncate text-xs text-muted">{source.normalized_url ?? source.input_url}</p>
                    </div>
                  </div>
                  <Badge tone={statusTone(source.status)} dot className="shrink-0">{humanize(source.status)}</Badge>
                </div>
                <dl className="inset-surface mt-4 grid gap-2 p-3 text-[13px]">
                  <div className="flex justify-between gap-3"><dt className="text-muted">Sync mode</dt><dd className="text-right text-label">{humanize(source.sync_mode)} · {source.sync_frequency_minutes}m</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Last success</dt><dd className="text-right text-label">{source.source_type_key === "website" ? "Live tracker" : formatRelativeTime(source.last_success_at, { now })}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Next</dt><dd className="text-right text-label">{formatAppDateTime(source.next_sync_at, "manual only")}</dd></div>
                  {authorization ? (
                    <div className="flex items-center justify-between gap-3"><dt className="text-muted">Authorization</dt><dd><Badge tone={authorization.tone}>{authorization.label}</Badge></dd></div>
                  ) : null}
                  <div className="flex justify-between gap-3"><dt className="text-muted">Last error</dt><dd className="min-w-0 break-words text-right text-label">{source.last_error ?? "none"}</dd></div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!blockReason && connector.capabilities.supportsManualSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                  {!blockReason && connector.capabilities.canTestConnection ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact /> : null}
                  <LinkButton href={`${basePath}/sources/${source.id}`} variant="secondary">Manage</LinkButton>
                </div>
                {blockReason ? <p className="mt-3 text-xs leading-5 text-muted">{blockReason}</p> : null}
              </GlassPanel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
