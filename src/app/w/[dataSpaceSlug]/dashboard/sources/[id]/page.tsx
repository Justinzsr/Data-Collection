import { ArrowLeft, Camera, ChevronDown, Clipboard, Megaphone, RadioTower, ShieldAlert, Video, Webhook } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  getConnector,
  getCredentialSetupBlockReason,
  getSourceOperationBlockReason,
} from "@/collection/connectors/registry";
import { getInstagramMetaAppDisplay } from "@/collection/connectors/instagram/graph-api";
import { expectedInstagramCopy } from "@/collection/connectors/instagram/source-policy";
import { MOONARQ_FIRST_STORY_UTM_TAGS } from "@/collection/connectors/meta-ads/constants";
import { getTikTokOAuthDisplay } from "@/collection/connectors/tiktok/api";
import { getTikTokAppProfileKeyForSource, isTikTokSource } from "@/collection/connectors/tiktok/source-policy";
import { generateReactHelper, generateTrackingSnippet } from "@/collection/tracking/snippet-generator";
import { getWebsiteModeLabel, isWebsiteSourceKey } from "@/collection/tracking/website-sources";
import { getPublicAppUrl, getPublicAppUrlWarning } from "@/storage/runtime/app-config";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { getSource, listSources } from "@/storage/repositories/sources-repository";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import type { JsonRecord } from "@/storage/db/schema";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { Callout, GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { formatRelativeTime } from "@/presentation/components/ui/relative-time";
import { authorizationState } from "@/presentation/dashboard/connection-health-panel";
import { SnippetCard } from "@/presentation/dashboard/snippet-card";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { TestConnectionButton } from "@/presentation/dashboard/test-connection-button";
import { CredentialForm } from "@/presentation/source-onboarding/credential-form";
import {
  MetaAdsAccountSelector,
  type MetaAdsAccountCandidate,
} from "@/presentation/source-onboarding/meta-ads-account-selector";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

function StateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[13px] font-medium text-label">{children}</dd>
    </div>
  );
}

function tokenStatus(source: { metadata: Record<string, unknown> }) {
  const expiresAt = typeof source.metadata.token_expires_at === "string" ? source.metadata.token_expires_at : null;
  if (!expiresAt) return "Not available";
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return "Unknown";
  if (time <= Date.now()) return `Expired ${formatAppDateTime(expiresAt)}`;
  return `Expires ${formatAppDateTime(expiresAt)}`;
}

function metadataString(metadata: JsonRecord, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaAdsAccountCandidates(metadata: JsonRecord): MetaAdsAccountCandidate[] {
  const candidates = metadata.candidate_ad_accounts;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const record = candidate as JsonRecord;
    const id = metadataString(record, "id");
    if (!id) return [];
    const status = record.account_status;
    return [{
      id,
      name: metadataString(record, "name"),
      accountStatus: typeof status === "number" && Number.isFinite(status) ? status : null,
      currency: metadataString(record, "currency"),
      timezone: metadataString(record, "timezone_name"),
    }];
  });
}

export default async function SourceDetailPage({ params }: { params: Promise<{ dataSpaceSlug: string; id: string }> }) {
  const { dataSpaceSlug, id } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const source = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!source) {
    return (
      <div className="mx-auto grid max-w-4xl gap-5">
        <SectionHeader title="Source not found" description="The source may belong to another data space, may have been deleted, or the id is invalid." />
        <LinkButton href={`${basePath}/sources`} variant="secondary">
          <ArrowLeft className="h-4 w-4" />
          Back to sources
        </LinkButton>
      </div>
    );
  }
  const connector = getConnector(source.source_type_key);
  const credentialKeys = new Set([...connector.requiredFields, ...connector.optionalFields].map((field) => field.key));
  const credentials = (await listCredentialHints(source.id)).filter((credential) => credentialKeys.has(credential.field_key));
  const trackingKey = String(source.metadata.public_tracking_key ?? "mq_demo_public_website");
  const publicAppUrl = getPublicAppUrl();
  const publicAppUrlWarning = getPublicAppUrlWarning();
  const endpoint = `${publicAppUrl ?? "http://localhost:4000"}/api/track`;
  const setup = connector.getSetupInstructions(source);
  const metricDefinitions = connector.getMetricDefinitions();
  const showInstagramOAuth = source.source_type_key === "instagram";
  const showMetaAdsOAuth = source.source_type_key === "meta_ads";
  const showFirstStoryMetaAds = dataSpace.slug === "moonarq" && (showInstagramOAuth || showMetaAdsOAuth);
  const instagramConnected = source.metadata.oauth_connected === true;
  const instagramMetaApp = showInstagramOAuth ? getInstagramMetaAppDisplay(source) : null;
  const instagramOAuthHref = `/api/oauth/instagram/start?sourceId=${encodeURIComponent(source.id)}&dataSpaceSlug=${encodeURIComponent(dataSpace.slug)}&returnPath=${encodeURIComponent(`${basePath}/sources/${source.id}`)}`;
  const oauthSources = showInstagramOAuth || showMetaAdsOAuth ? await listSources({ dataSpaceId: dataSpace.id }) : [];
  const metaAdsSource = showMetaAdsOAuth
    ? source
    : oauthSources.find(
      (candidate) => candidate.source_type_key === "meta_ads" && candidate.metadata.linked_instagram_source_id === source.id,
    ) ?? null;
  const linkedInstagramSourceId = showInstagramOAuth
    ? source.id
    : metaAdsSource ? metadataString(metaAdsSource.metadata, "linked_instagram_source_id") : null;
  const linkedInstagramSource = linkedInstagramSourceId
    ? oauthSources.find((candidate) => candidate.id === linkedInstagramSourceId && candidate.source_type_key === "instagram") ?? null
    : null;
  const metaAdsAuthorized = metaAdsSource?.metadata.oauth_connected === true;
  const selectedMetaAdsAccountId = metaAdsSource
    ? metadataString(metaAdsSource.metadata, "selected_ad_account_id") ?? metaAdsSource.external_account_id
    : null;
  const metaAdsCandidates = metaAdsSource ? metaAdsAccountCandidates(metaAdsSource.metadata) : [];
  const metaAdsReady = Boolean(metaAdsAuthorized && selectedMetaAdsAccountId);
  const metaAdsHealthy = Boolean(metaAdsReady && metaAdsSource?.status === "healthy");
  const metaAdsConnector = metaAdsSource ? getConnector("meta_ads") : null;
  const metaAdsCredentialHints = metaAdsSource
    ? metaAdsSource.id === source.id ? credentials : await listCredentialHints(metaAdsSource.id)
    : [];
  const metaAdsActionBlockReason = metaAdsSource && metaAdsConnector
    ? getSourceOperationBlockReason(metaAdsSource) ?? getCredentialSetupBlockReason(
      metaAdsConnector,
      metaAdsCredentialHints.map((credential) => credential.field_key),
    )
    : null;
  const canTestMetaAds = Boolean(
    metaAdsSource && metaAdsConnector?.capabilities.canTestConnection && metaAdsReady && !metaAdsActionBlockReason,
  );
  const canSyncMetaAds = Boolean(
    metaAdsSource && metaAdsConnector?.capabilities.supportsManualSync && metaAdsReady && !metaAdsActionBlockReason,
  );
  const metaAdsOAuthHref = showFirstStoryMetaAds && linkedInstagramSource
    ? `/api/oauth/meta-ads/start?instagramSourceId=${encodeURIComponent(linkedInstagramSource.id)}&dataSpaceSlug=${encodeURIComponent(dataSpace.slug)}&returnPath=${encodeURIComponent(`${basePath}/sources/${source.id}`)}`
    : null;
  const showTikTokOAuth = isTikTokSource(source);
  const tiktokConnected = showTikTokOAuth && source.metadata.oauth_connected === true;
  const tiktokOAuth = showTikTokOAuth ? getTikTokOAuthDisplay({ profileKey: getTikTokAppProfileKeyForSource(source) }) : null;
  const tiktokOAuthHref = `/api/oauth/tiktok/start?sourceId=${encodeURIComponent(source.id)}&dataSpaceSlug=${encodeURIComponent(dataSpace.slug)}&returnPath=${encodeURIComponent(`${basePath}/sources/${source.id}`)}`;
  const operationBlockReason = getSourceOperationBlockReason(source);
  const credentialBlockReason = getCredentialSetupBlockReason(
    connector,
    credentials.map((credential) => credential.field_key),
  );
  const actionBlockReason = operationBlockReason ?? credentialBlockReason;
  const isOAuthSource = connector.setupKind === "oauth";
  const canTest = !actionBlockReason && connector.capabilities.canTestConnection;
  const canSync = !actionBlockReason && connector.capabilities.supportsManualSync;
  const authorization = authorizationState(source);

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <SectionHeader
        eyebrow={`${dataSpace.display_name} source detail`}
        title={source.display_name}
        description={connector.description}
        action={
          <>
            <LinkButton href={`${basePath}/sources`} variant="secondary">
              <ArrowLeft className="h-4 w-4" />
              Sources
            </LinkButton>
            {!isOAuthSource && canTest ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
            {!isOAuthSource && canSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
          </>
        }
      />

      <div className={`grid gap-5 ${isOAuthSource ? "" : "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"}`}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <PlatformIcon sourceTypeKey={source.source_type_key} size="lg" />
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">Connection state</h2>
                <p className="truncate text-xs text-muted">{connector.displayName}</p>
              </div>
            </div>
            <Badge tone={statusTone(source.status)} dot>{source.status.replaceAll("_", " ")}</Badge>
          </div>
          <dl className="divide-y divide-separator">
            <StateRow label="Data space">{dataSpace.display_name}</StateRow>
            <StateRow label="Platform">{connector.displayName}</StateRow>
            <StateRow label="Monitored mode">{source.source_type_key === "supabase" ? `${dataSpace.display_name} Supabase` : isWebsiteSourceKey(source.source_type_key) ? getWebsiteModeLabel(source) : connector.displayName}</StateRow>
            <StateRow label="Sync mode"><span className="capitalize">{source.sync_mode.replaceAll("_", " ")}</span></StateRow>
            {showInstagramOAuth ? (
              <>
                <StateRow label="OAuth">{instagramConnected ? "connected" : "not connected"}</StateRow>
                <StateRow label="Meta app profile">{instagramMetaApp?.label ?? "not selected"}</StateRow>
                <StateRow label="Instagram account">{typeof source.metadata.instagram_username === "string" ? source.metadata.instagram_username : source.account_name ?? "not resolved"}</StateRow>
                <StateRow label="Token expiry">{tokenStatus(source)}</StateRow>
              </>
            ) : null}
            {showMetaAdsOAuth ? (
              <>
                <StateRow label="OAuth">{metaAdsAuthorized ? "authorized" : "not connected"}</StateRow>
                <StateRow label="Permission">ads_read (read only)</StateRow>
                <StateRow label="Ad account">{metaAdsReady ? metaAdsSource?.account_name ?? selectedMetaAdsAccountId : "not selected"}</StateRow>
                <StateRow label="Token expiry">{tokenStatus(source)}</StateRow>
              </>
            ) : null}
            {showTikTokOAuth ? (
              <>
                <StateRow label="OAuth">{tiktokConnected ? "connected" : "not connected"}</StateRow>
                <StateRow label="TikTok app profile">{tiktokOAuth?.label ?? "Default / Auto Lab TikTok app"}</StateRow>
                <StateRow label="TikTok account">{typeof source.metadata.tiktok_username === "string" ? source.metadata.tiktok_username : typeof source.metadata.tiktok_display_name === "string" ? source.metadata.tiktok_display_name : source.account_name ?? "not resolved"}</StateRow>
                <StateRow label="Open ID"><span className="font-mono text-xs">{typeof source.metadata.tiktok_open_id === "string" ? source.metadata.tiktok_open_id : source.external_account_id ?? "not resolved"}</span></StateRow>
                <StateRow label="Token expiry">{tokenStatus(source)}</StateRow>
              </>
            ) : null}
            {authorization ? (
              <StateRow label="Authorization">
                <Badge tone={authorization.tone}>{authorization.label}</Badge>
              </StateRow>
            ) : null}
            <StateRow label="Last success">
              {formatAppDateTime(source.last_success_at)}
              {source.last_success_at ? <span className="block text-xs font-normal text-muted">{formatRelativeTime(source.last_success_at)}</span> : null}
            </StateRow>
            <StateRow label="Next sync">{formatAppDateTime(source.next_sync_at, "manual only")}</StateRow>
            <StateRow label="Last error"><span className={source.last_error ? "text-negative" : undefined}>{source.last_error ?? "none"}</span></StateRow>
            {source.webhook_url ? <StateRow label="Webhook URL"><span className="break-all font-mono text-xs text-tint-text">{source.webhook_url}</span></StateRow> : null}
          </dl>
          {actionBlockReason ? <Callout tone="warning" className="mt-3">{actionBlockReason}</Callout> : null}
          <details className="group inset-surface mt-4 rounded-[16px]">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3.5 text-sm font-semibold text-label transition hover:bg-fill-hover">
              <span>Supported metrics <span className="font-normal text-muted">({metricDefinitions.length})</span></span>
              <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="flex flex-wrap gap-2 border-t border-separator p-3">
              {metricDefinitions.map((metric) => (
                <Badge key={metric.key} tone="indigo" className="font-mono font-medium">{metric.key}</Badge>
              ))}
            </div>
          </details>
          {operationBlockReason ? <Callout tone="warning" className="mt-4">{operationBlockReason}</Callout> : null}
        </GlassPanel>

        {!isOAuthSource && connector.availability === "live" ? (
          <details className="group glass self-start rounded-3xl">
            <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-3xl p-4 transition hover:bg-fill sm:p-5">
              <div>
                <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">Credentials and connection settings</h2>
                <p className="mt-1 text-sm text-muted">Encrypted server-side. Expand only when changing this connection.</p>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-muted transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="border-t border-separator p-4 sm:p-5">
              <CredentialForm sourceId={source.id} title="Credentials and settings" dataSpaceSlug={dataSpace.slug} />
              {credentials.length > 0 ? (
                <p className="mt-4 text-xs text-muted">Saved hints: {credentials.map((item) => `${item.field_key} ${item.value_hint ?? "saved"}`).join(", ")}</p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      {showInstagramOAuth ? (
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.018em] text-label">
                <PlatformIcon sourceTypeKey="instagram" size="sm" />
                Instagram OAuth
              </div>
              <p className="text-sm leading-6 text-label-secondary">
                Connects this {dataSpace.display_name} Instagram source through the official Meta Graph API. Tokens stay encrypted server-side and are stored only for this source.
              </p>
            </div>
            <Badge tone={instagramConnected ? "green" : "amber"} dot>{instagramConnected ? "OAuth connected" : "Needs OAuth"}</Badge>
          </div>
          <details className="group mt-4 rounded-[16px] border border-separator">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3.5 text-sm font-semibold text-label transition hover:bg-fill">
              OAuth account and app details
              <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
            </summary>
          <div className="grid gap-3 border-t border-separator p-3 text-sm text-label-secondary md:grid-cols-2 xl:grid-cols-4">
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">Expected account</p>
              <p className="mt-2 text-label">{expectedInstagramCopy(source)}</p>
            </div>
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">Meta app profile</p>
              <p className="mt-2 text-label">{instagramMetaApp?.label ?? "Default Meta app"}</p>
              <p className="mt-1 text-xs text-muted">{instagramMetaApp ? `${instagramMetaApp.appIdEnvKey} ${instagramMetaApp.appIdConfigured ? "configured" : "not configured"}` : "Server-side only"}</p>
            </div>
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">Graph API</p>
              <p className="mt-2 text-label">{typeof source.metadata.graph_api_version === "string" ? source.metadata.graph_api_version : instagramMetaApp?.graphApiVersion ?? "v25.0"}</p>
            </div>
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">Token</p>
              <p className="mt-2 text-label">{tokenStatus(source)}</p>
            </div>
          </div>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            {!operationBlockReason ? (
              <LinkButton href={instagramOAuthHref} variant={instagramConnected ? "secondary" : "primary"}>
                <Camera className="h-4 w-4" />
                {instagramConnected ? "Reconnect Instagram" : "Connect Instagram"}
              </LinkButton>
            ) : null}
            {canTest ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
            {canSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
          </div>
        </GlassPanel>
      ) : null}

      {showFirstStoryMetaAds ? (
        <GlassPanel className="overflow-hidden p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.018em] text-label">
                <PlatformIcon sourceTypeKey="meta_ads" size="sm" />
                Meta Ads + first Story attribution
              </div>
              <p className="max-w-4xl text-sm leading-6 text-label-secondary">
                Read-only Marketing API delivery data is joined to first-party website UTMs and Shopify order attribution. OAuth tokens stay encrypted server-side.
              </p>
            </div>
            <Badge tone={metaAdsHealthy ? "green" : "amber"} dot>
              {metaAdsHealthy ? "Ready to sync" : metaAdsReady ? "Connected · needs attention" : metaAdsAuthorized ? "Select ad account" : "Needs OAuth"}
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="inset-surface min-w-0 p-3">
              <p className="text-xs text-muted">Permission</p>
              <p className="mt-2 text-sm font-medium text-label">ads_read + existing read scopes</p>
              <p className="mt-1 text-xs leading-5 text-muted">Reuses Instagram/Page read-only scopes; no ad editing or publishing permission.</p>
            </div>
            <div className="inset-surface min-w-0 p-3">
              <p className="text-xs text-muted">Ad account</p>
              <p className="mt-2 truncate text-sm font-medium text-label">
                {metaAdsReady ? metaAdsSource?.account_name ?? selectedMetaAdsAccountId : metaAdsAuthorized ? "Selection required" : "Not connected"}
              </p>
              {metaAdsReady && selectedMetaAdsAccountId ? <p className="mt-1 break-all font-mono text-xs text-muted">{selectedMetaAdsAccountId}</p> : null}
            </div>
            <div className="inset-surface min-w-0 p-3">
              <p className="text-xs text-muted">Tracked campaign</p>
              <p className="mt-2 break-words text-sm font-medium text-label">{MOONARQ_FIRST_STORY_UTM_TAGS.utm_campaign}</p>
              <p className="mt-1 break-words text-xs leading-5 text-muted">
                {MOONARQ_FIRST_STORY_UTM_TAGS.utm_source} · {MOONARQ_FIRST_STORY_UTM_TAGS.utm_medium} · {MOONARQ_FIRST_STORY_UTM_TAGS.utm_content}
              </p>
            </div>
            <div className="inset-surface min-w-0 p-3">
              <p className="text-xs text-muted">Connection</p>
              <p className="mt-2 text-sm font-medium text-label">
                {metaAdsAuthorized ? "OAuth authorized" : "Waiting for authorization"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {metaAdsCandidates.length > 0 ? `${metaAdsCandidates.length} available ad account${metaAdsCandidates.length === 1 ? "" : "s"}` : "No account list saved yet"}
              </p>
            </div>
          </div>

          {metaAdsSource && metaAdsAuthorized && metaAdsCandidates.length > 0 ? (
            <MetaAdsAccountSelector
              sourceId={metaAdsSource.id}
              dataSpaceSlug={dataSpace.slug}
              candidates={metaAdsCandidates}
              selectedAccountId={selectedMetaAdsAccountId}
            />
          ) : null}

          {!linkedInstagramSource ? (
            <p className="mt-4 rounded-2xl bg-warning-fill/10 p-3.5 text-sm leading-6 text-warning">
              This Meta Ads source is not linked to an Instagram source in this data space. Open the Instagram source and start Meta Ads OAuth there.
            </p>
          ) : null}
          {metaAdsActionBlockReason && metaAdsSource && !metaAdsReady ? (
            <p className="mt-4 rounded-2xl bg-warning-fill/10 p-3.5 text-sm leading-6 text-warning">
              {metaAdsActionBlockReason}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {metaAdsOAuthHref ? (
              <LinkButton href={metaAdsOAuthHref} variant={metaAdsReady ? "secondary" : "primary"}>
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                {metaAdsAuthorized ? "Reconnect Meta Ads" : "Connect Meta Ads"}
              </LinkButton>
            ) : null}
            {metaAdsSource && canTestMetaAds ? (
              <TestConnectionButton sourceId={metaAdsSource.id} dataSpaceSlug={dataSpace.slug} />
            ) : null}
            {metaAdsSource && canSyncMetaAds ? (
              <SyncActionButton sourceId={metaAdsSource.id} dataSpaceSlug={dataSpace.slug} />
            ) : null}
            {showInstagramOAuth && metaAdsSource ? (
              <LinkButton href={`${basePath}/sources/${metaAdsSource.id}`} variant="ghost">Open Meta Ads source</LinkButton>
            ) : null}
            {showMetaAdsOAuth && linkedInstagramSource ? (
              <LinkButton href={`${basePath}/sources/${linkedInstagramSource.id}`} variant="ghost">Open linked Instagram</LinkButton>
            ) : null}
          </div>
        </GlassPanel>
      ) : null}

      {showTikTokOAuth ? (
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.018em] text-label">
                <PlatformIcon sourceTypeKey="tiktok" size="sm" />
                TikTok OAuth
              </div>
              <p className="text-sm leading-6 text-label-secondary">
                Connects this {dataSpace.display_name} source through TikTok Login Kit and official TikTok APIs. Tokens stay encrypted server-side and are stored only for this source.
              </p>
            </div>
            <Badge tone={tiktokConnected ? "green" : "amber"} dot>{tiktokConnected ? "OAuth connected" : "Needs OAuth"}</Badge>
          </div>
          <details className="group mt-4 rounded-[16px] border border-separator">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3.5 text-sm font-semibold text-label transition hover:bg-fill">
              OAuth account and app details
              <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
            </summary>
          <div className="grid gap-3 border-t border-separator p-3 text-sm text-label-secondary md:grid-cols-2 xl:grid-cols-4">
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">Scope</p>
              <p className="mt-2 text-label">{dataSpace.display_name}</p>
              <p className="mt-1 text-xs text-muted">Data stays scoped to this source and workspace.</p>
            </div>
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">TikTok app</p>
              <p className="mt-2 text-label">{tiktokOAuth?.label ?? "Default / Auto Lab TikTok app"}</p>
              <p className="mt-1 text-xs text-muted">{tiktokOAuth ? `${tiktokOAuth.clientKeyEnvKey} ${tiktokOAuth.clientKeyConfigured ? "configured" : "not configured"}` : "Server-side only"}</p>
              {tiktokOAuth?.usesDefaultFallback ? <p className="mt-1 text-xs text-warning">MoonArq-specific TikTok env vars are not configured; using default profile.</p> : null}
            </div>
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">Granted scopes</p>
              <p className="mt-2 break-words text-label">{typeof source.metadata.tiktok_scopes === "string" ? source.metadata.tiktok_scopes : "Waiting for OAuth"}</p>
            </div>
            <div className="inset-surface p-3">
              <p className="text-xs text-muted">Token</p>
              <p className="mt-2 text-label">{tokenStatus(source)}</p>
            </div>
          </div>
          </details>
          <Callout tone="warning" className="mt-4" icon={<ShieldAlert className="h-4 w-4" />}>
            TikTok data must come through official OAuth/API permissions. Do not enter TikTok passwords, do not scrape dashboards, and do not paste tokens in chat.
          </Callout>
          <div className="mt-4 flex flex-wrap gap-2">
            {!operationBlockReason ? (
              <LinkButton href={tiktokOAuthHref} variant={tiktokConnected ? "secondary" : "primary"}>
                <Video className="h-4 w-4" />
                {tiktokConnected ? "Reconnect TikTok" : "Connect TikTok"}
              </LinkButton>
            ) : null}
            {canTest ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
            {canSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
          </div>
        </GlassPanel>
      ) : null}

      <details className="group glass rounded-3xl">
        <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-3xl p-4 transition hover:bg-fill sm:p-5">
          <div>
            <p className="eyebrow">Technical setup</p>
            <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Instructions, endpoints, and code snippets</h2>
            <p className="mt-1 text-sm text-muted">Expand when installing or troubleshooting this source.</p>
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-5 border-t border-separator p-4 sm:p-5">
      <div className="inset-surface rounded-[18px] p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-tint-text" />
          <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">Setup instructions</h2>
        </div>
        {publicAppUrlWarning ? (
          <Callout tone="warning" className="mb-4" title="Public app URL warning" icon={<ShieldAlert className="h-4 w-4" />}>
            {publicAppUrlWarning}
          </Callout>
        ) : null}
        <div className="grid grid-cols-1 gap-3">
          {setup.map((item, index) => (
            <div key={`${index}-${item.slice(0, 24)}`} className="rounded-[14px] bg-fill-strong p-3.5 text-sm leading-6 text-label-secondary">
              {item.length > 700 ? <pre className="code-scroll text-xs leading-5 text-label">{item}</pre> : item}
            </div>
          ))}
        </div>
      </div>

      {source.source_type_key === "website" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <SnippetCard title="Lightweight JavaScript snippet" description="Copy into your website to auto-send versioned page_view events and expose window.moonarqTrack." code={generateTrackingSnippet({ endpoint, publicTrackingKey: trackingKey, sourceId: source.id })} />
          <SnippetCard title="React / Next.js helper" description="Use usePageViewTracking() and trackEvent(name, properties) with the v1 event contract inside a Next app." code={generateReactHelper({ endpoint, publicTrackingKey: trackingKey, sourceId: source.id })} />
        </div>
      ) : source.source_type_key === "vercel_web_analytics_drain" ? (
        <div className="inset-surface rounded-[18px] p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.018em] text-label">
            <Webhook className="h-4 w-4 text-tint-text" />
            Vercel Drain endpoint
          </div>
          <div className="rounded-[14px] bg-fill-strong p-3">
            <p className="text-xs font-medium text-muted">Vercel drain URL</p>
            <p className="mt-2 break-all font-mono text-xs text-label">{`${publicAppUrl ?? "http://localhost:4000"}${source.webhook_url ?? `/api/webhooks/vercel/analytics-drain/${source.id}`}`}</p>
          </div>
        </div>
      ) : (
        <div className="inset-surface rounded-[18px] p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm text-label-secondary">
            <Clipboard className="h-4 w-4 text-tint-text" />
            Tracking snippets are only shown for Website Tracker sources. Official API setup lives in the instructions above.
          </div>
        </div>
      )}
        </div>
      </details>
    </div>
  );
}
