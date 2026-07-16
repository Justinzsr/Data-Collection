import { ArrowLeft, Camera, ChevronDown, Clipboard, Megaphone, RadioTower, ShieldAlert, Video, Webhook } from "lucide-react";
import { notFound } from "next/navigation";
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
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
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

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-white">Connection state</h2>
            <Badge tone={statusTone(source.status)}>{source.status.replaceAll("_", " ")}</Badge>
          </div>
          <div className="grid gap-3 text-sm text-slate-300">
            <p>Data space: <span className="text-white">{dataSpace.display_name}</span></p>
            <p>Platform: <span className="text-white">{connector.displayName}</span></p>
            <p>Monitored mode: <span className="text-white">{source.source_type_key === "supabase" ? `${dataSpace.display_name} Supabase` : isWebsiteSourceKey(source.source_type_key) ? getWebsiteModeLabel(source) : connector.displayName}</span></p>
            <p>Sync mode: <span className="text-white">{source.sync_mode.replaceAll("_", " ")}</span></p>
            {showInstagramOAuth ? (
              <>
                <p>OAuth: <span className="text-white">{instagramConnected ? "connected" : "not connected"}</span></p>
                <p>Meta app profile: <span className="text-white">{instagramMetaApp?.label ?? "not selected"}</span></p>
                <p>Instagram account: <span className="text-white">{typeof source.metadata.instagram_username === "string" ? source.metadata.instagram_username : source.account_name ?? "not resolved"}</span></p>
                <p>Token expiry: <span className="text-white">{tokenStatus(source)}</span></p>
              </>
            ) : null}
            {showMetaAdsOAuth ? (
              <>
                <p>OAuth: <span className="text-white">{metaAdsAuthorized ? "authorized" : "not connected"}</span></p>
                <p>Permission: <span className="text-white">ads_read (read only)</span></p>
                <p>Ad account: <span className="text-white">{metaAdsReady ? metaAdsSource?.account_name ?? selectedMetaAdsAccountId : "not selected"}</span></p>
                <p>Token expiry: <span className="text-white">{tokenStatus(source)}</span></p>
              </>
            ) : null}
            {showTikTokOAuth ? (
              <>
                <p>OAuth: <span className="text-white">{tiktokConnected ? "connected" : "not connected"}</span></p>
                <p>TikTok app profile: <span className="text-white">{tiktokOAuth?.label ?? "Default / Auto Lab TikTok app"}</span></p>
                <p>TikTok account: <span className="text-white">{typeof source.metadata.tiktok_username === "string" ? source.metadata.tiktok_username : typeof source.metadata.tiktok_display_name === "string" ? source.metadata.tiktok_display_name : source.account_name ?? "not resolved"}</span></p>
                <p>Open ID: <span className="text-white">{typeof source.metadata.tiktok_open_id === "string" ? source.metadata.tiktok_open_id : source.external_account_id ?? "not resolved"}</span></p>
                <p>Token expiry: <span className="text-white">{tokenStatus(source)}</span></p>
              </>
            ) : null}
            <p>Last success: <span className="text-white">{formatAppDateTime(source.last_success_at)}</span></p>
            <p>Next sync: <span className="text-white">{formatAppDateTime(source.next_sync_at, "manual only")}</span></p>
            <p>Last error: <span className="text-white">{source.last_error ?? "none"}</span></p>
            {source.webhook_url ? <p className="break-all">Webhook URL: <span className="text-cyan-100">{source.webhook_url}</span></p> : null}
            {actionBlockReason ? <p className="text-amber-100">{actionBlockReason}</p> : null}
          </div>
          <details className="group mt-4 rounded-xl border border-white/10 bg-black/15">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-slate-300">
              <span>Supported metrics <span className="text-slate-500">({metricDefinitions.length})</span></span>
              <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="flex flex-wrap gap-2 border-t border-white/10 p-3">
              {metricDefinitions.map((metric) => (
                <Badge key={metric.key} tone="indigo">{metric.key}</Badge>
              ))}
            </div>
          </details>
          {operationBlockReason ? <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.07] p-3 text-sm leading-6 text-amber-100">{operationBlockReason}</p> : null}
        </GlassPanel>

        {!isOAuthSource && connector.availability === "live" ? (
          <details className="group glass rounded-2xl">
            <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 transition hover:bg-white/[0.025] sm:p-5">
              <div>
                <h2 className="text-base font-semibold text-white">Credentials and connection settings</h2>
                <p className="mt-1 text-sm text-slate-500">Encrypted server-side. Expand only when changing this connection.</p>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="border-t border-white/10 p-4 sm:p-5">
              <CredentialForm sourceId={source.id} title="Encrypted credentials" dataSpaceSlug={dataSpace.slug} />
              {credentials.length > 0 ? (
                <p className="mt-4 text-xs text-slate-500">Saved hints: {credentials.map((item) => `${item.field_key} ${item.value_hint ?? "saved"}`).join(", ")}</p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      {showInstagramOAuth ? (
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2 text-base font-semibold text-white">
                <Camera className="h-4 w-4 text-cyan-200" />
                Instagram OAuth
              </div>
              <p className="text-sm leading-6 text-slate-300">
                Connects this {dataSpace.display_name} Instagram source through the official Meta Graph API. Tokens stay encrypted server-side and are stored only for this source.
              </p>
            </div>
            <Badge tone={instagramConnected ? "green" : "amber"}>{instagramConnected ? "OAuth connected" : "Needs OAuth"}</Badge>
          </div>
          <details className="group mt-4 rounded-xl border border-white/10 bg-black/15">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-slate-300">
              OAuth account and app details
              <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
          <div className="grid gap-3 border-t border-white/10 p-3 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Expected account</p>
              <p className="mt-2 text-white">{expectedInstagramCopy(source)}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Meta app profile</p>
              <p className="mt-2 text-white">{instagramMetaApp?.label ?? "Default Meta app"}</p>
              <p className="mt-1 text-xs text-slate-500">{instagramMetaApp ? `${instagramMetaApp.appIdEnvKey} ${instagramMetaApp.appIdConfigured ? "configured" : "not configured"}` : "Server-side only"}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Graph API</p>
              <p className="mt-2 text-white">{typeof source.metadata.graph_api_version === "string" ? source.metadata.graph_api_version : instagramMetaApp?.graphApiVersion ?? "v25.0"}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Token</p>
              <p className="mt-2 text-white">{tokenStatus(source)}</p>
            </div>
          </div>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            {!operationBlockReason ? (
              <LinkButton href={instagramOAuthHref} variant="primary">
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
              <div className="mb-2 flex items-center gap-2 text-base font-semibold text-white">
                <Megaphone className="h-4 w-4 text-cyan-200" aria-hidden="true" />
                Meta Ads + first Story attribution
              </div>
              <p className="max-w-4xl text-sm leading-6 text-slate-300">
                Read-only Marketing API delivery data is joined to first-party website UTMs and Shopify order attribution. OAuth tokens stay encrypted server-side.
              </p>
            </div>
            <Badge tone={metaAdsHealthy ? "green" : "amber"}>
              {metaAdsHealthy ? "Ready to sync" : metaAdsReady ? "Connected · needs attention" : metaAdsAuthorized ? "Select ad account" : "Needs OAuth"}
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Permission</p>
              <p className="mt-2 text-sm font-medium text-white">ads_read + existing read scopes</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Reuses Instagram/Page read-only scopes; no ad editing or publishing permission.</p>
            </div>
            <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Ad account</p>
              <p className="mt-2 truncate text-sm font-medium text-white">
                {metaAdsReady ? metaAdsSource?.account_name ?? selectedMetaAdsAccountId : metaAdsAuthorized ? "Selection required" : "Not connected"}
              </p>
              {metaAdsReady && selectedMetaAdsAccountId ? <p className="mt-1 break-all font-mono text-xs text-slate-500">{selectedMetaAdsAccountId}</p> : null}
            </div>
            <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Tracked campaign</p>
              <p className="mt-2 break-words text-sm font-medium text-white">{MOONARQ_FIRST_STORY_UTM_TAGS.utm_campaign}</p>
              <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                {MOONARQ_FIRST_STORY_UTM_TAGS.utm_source} · {MOONARQ_FIRST_STORY_UTM_TAGS.utm_medium} · {MOONARQ_FIRST_STORY_UTM_TAGS.utm_content}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Connection</p>
              <p className="mt-2 text-sm font-medium text-white">
                {metaAdsAuthorized ? "OAuth authorized" : "Waiting for authorization"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
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
            <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.07] p-3 text-sm leading-6 text-amber-100">
              This Meta Ads source is not linked to an Instagram source in this data space. Open the Instagram source and start Meta Ads OAuth there.
            </p>
          ) : null}
          {metaAdsActionBlockReason && metaAdsSource && !metaAdsReady ? (
            <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.07] p-3 text-sm leading-6 text-amber-100">
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
              <div className="mb-2 flex items-center gap-2 text-base font-semibold text-white">
                <Video className="h-4 w-4 text-cyan-200" />
                TikTok OAuth
              </div>
              <p className="text-sm leading-6 text-slate-300">
                Connects this {dataSpace.display_name} source through TikTok Login Kit and official TikTok APIs. Tokens stay encrypted server-side and are stored only for this source.
              </p>
            </div>
            <Badge tone={tiktokConnected ? "green" : "amber"}>{tiktokConnected ? "OAuth connected" : "Needs OAuth"}</Badge>
          </div>
          <details className="group mt-4 rounded-xl border border-white/10 bg-black/15">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-slate-300">
              OAuth account and app details
              <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
          <div className="grid gap-3 border-t border-white/10 p-3 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Scope</p>
              <p className="mt-2 text-white">{dataSpace.display_name}</p>
              <p className="mt-1 text-xs text-slate-500">Data stays scoped to this source and workspace.</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">TikTok app</p>
              <p className="mt-2 text-white">{tiktokOAuth?.label ?? "Default / Auto Lab TikTok app"}</p>
              <p className="mt-1 text-xs text-slate-500">{tiktokOAuth ? `${tiktokOAuth.clientKeyEnvKey} ${tiktokOAuth.clientKeyConfigured ? "configured" : "not configured"}` : "Server-side only"}</p>
              {tiktokOAuth?.usesDefaultFallback ? <p className="mt-1 text-xs text-amber-100">MoonArq-specific TikTok env vars are not configured; using default profile.</p> : null}
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Granted scopes</p>
              <p className="mt-2 break-words text-white">{typeof source.metadata.tiktok_scopes === "string" ? source.metadata.tiktok_scopes : "Waiting for OAuth"}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Token</p>
              <p className="mt-2 text-white">{tokenStatus(source)}</p>
            </div>
          </div>
          </details>
          <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-50/85">
            TikTok data must come through official OAuth/API permissions. Do not enter TikTok passwords, do not scrape dashboards, and do not paste tokens in chat.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!operationBlockReason ? (
              <LinkButton href={tiktokOAuthHref} variant="primary">
                <Video className="h-4 w-4" />
                {tiktokConnected ? "Reconnect TikTok" : "Connect TikTok"}
              </LinkButton>
            ) : null}
            {canTest ? <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
            {canSync ? <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} /> : null}
          </div>
        </GlassPanel>
      ) : null}

      <details className="group glass rounded-2xl">
        <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 transition hover:bg-white/[0.025] sm:p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/70">Technical setup</p>
            <h2 className="mt-1 text-base font-semibold text-white">Instructions, endpoints, and code snippets</h2>
            <p className="mt-1 text-sm text-slate-500">Expand when installing or troubleshooting this source.</p>
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-5 border-t border-white/10 p-4 sm:p-5">
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-cyan-200" />
          <h2 className="text-base font-semibold text-white">Setup instructions</h2>
        </div>
        {publicAppUrlWarning ? (
          <div className="mb-4 rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-sm text-amber-100">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <ShieldAlert className="h-4 w-4" />
              Public app URL warning
            </div>
            {publicAppUrlWarning}
          </div>
        ) : null}
        <div className="grid gap-3">
          {setup.map((item, index) => (
            <div key={`${index}-${item.slice(0, 24)}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-slate-300">
              {item.length > 700 ? <pre className="code-scroll text-xs leading-5 text-cyan-50">{item}</pre> : item}
            </div>
          ))}
        </div>
      </GlassPanel>

      {source.source_type_key === "website" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <SnippetCard title="Lightweight JavaScript snippet" description="Copy into your website to auto-send page_view and expose window.moonarqTrack." code={generateTrackingSnippet({ endpoint, publicTrackingKey: trackingKey })} />
          <SnippetCard title="React / Next.js helper" description="Use usePageViewTracking() and trackEvent(name, properties) inside a Next app." code={generateReactHelper({ endpoint, publicTrackingKey: trackingKey })} />
        </div>
      ) : source.source_type_key === "vercel_web_analytics_drain" ? (
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
            <Webhook className="h-4 w-4 text-cyan-200" />
            Vercel Drain endpoint
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Vercel drain URL</p>
            <p className="mt-2 break-all font-mono text-xs text-cyan-50">{`${publicAppUrl ?? "http://localhost:4000"}${source.webhook_url ?? `/api/webhooks/vercel/analytics-drain/${source.id}`}`}</p>
          </div>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Clipboard className="h-4 w-4 text-cyan-200" />
            Tracking snippets are only shown for Website Tracker sources. Official API setup lives in the instructions above.
          </div>
        </GlassPanel>
      )}
        </div>
      </details>
    </div>
  );
}
