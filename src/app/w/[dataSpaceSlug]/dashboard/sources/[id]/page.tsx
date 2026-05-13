import { ArrowLeft, Camera, Clipboard, RadioTower, ShieldAlert, Video, Webhook } from "lucide-react";
import { notFound } from "next/navigation";
import { getConnector } from "@/collection/connectors/registry";
import { getInstagramMetaAppDisplay } from "@/collection/connectors/instagram/graph-api";
import { expectedInstagramCopy } from "@/collection/connectors/instagram/source-policy";
import { getTikTokOAuthDisplay } from "@/collection/connectors/tiktok/api";
import { getTikTokAppProfileKeyForSource, isTikTokSource } from "@/collection/connectors/tiktok/source-policy";
import { generateReactHelper, generateTrackingSnippet } from "@/collection/tracking/snippet-generator";
import { getWebsiteModeLabel, isWebsiteSourceKey } from "@/collection/tracking/website-sources";
import { getPublicAppUrl, getPublicAppUrlWarning } from "@/storage/runtime/app-config";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { getSource } from "@/storage/repositories/sources-repository";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { SnippetCard } from "@/presentation/dashboard/snippet-card";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { TestConnectionButton } from "@/presentation/dashboard/test-connection-button";
import { CredentialForm } from "@/presentation/source-onboarding/credential-form";
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
  const endpoint = `${publicAppUrl ?? "http://127.0.0.1:3100"}/api/track`;
  const setup = connector.getSetupInstructions(source);
  const showInstagramOAuth = source.source_type_key === "instagram";
  const instagramConnected = source.metadata.oauth_connected === true;
  const instagramMetaApp = showInstagramOAuth ? getInstagramMetaAppDisplay(source) : null;
  const instagramOAuthHref = `/api/oauth/instagram/start?sourceId=${encodeURIComponent(source.id)}&dataSpaceSlug=${encodeURIComponent(dataSpace.slug)}&returnPath=${encodeURIComponent(`${basePath}/sources/${source.id}`)}`;
  const showTikTokOAuth = isTikTokSource(source);
  const tiktokConnected = showTikTokOAuth && source.metadata.oauth_connected === true;
  const tiktokOAuth = showTikTokOAuth ? getTikTokOAuthDisplay({ profileKey: getTikTokAppProfileKeyForSource(source) }) : null;
  const tiktokOAuthHref = `/api/oauth/tiktok/start?sourceId=${encodeURIComponent(source.id)}&dataSpaceSlug=${encodeURIComponent(dataSpace.slug)}&returnPath=${encodeURIComponent(`${basePath}/sources/${source.id}`)}`;

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
            <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} />
            <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} />
            {showInstagramOAuth ? (
              <LinkButton href={instagramOAuthHref} variant="primary">
                <Camera className="h-4 w-4" />
                Connect Instagram
              </LinkButton>
            ) : null}
            {showTikTokOAuth ? (
              <LinkButton href={tiktokOAuthHref} variant="primary">
                <Video className="h-4 w-4" />
                Connect TikTok
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-white">Connection state</h2>
            <Badge tone={statusTone(source.status)}>{source.status}</Badge>
          </div>
          <div className="grid gap-3 text-sm text-slate-300">
            <p>Data space: <span className="text-white">{dataSpace.display_name}</span></p>
            <p>Platform: <span className="text-white">{connector.displayName}</span></p>
            <p>Monitored mode: <span className="text-white">{source.source_type_key === "supabase" ? `${dataSpace.display_name} Supabase` : isWebsiteSourceKey(source.source_type_key) ? getWebsiteModeLabel(source) : connector.displayName}</span></p>
            <p>Sync mode: <span className="text-white">{source.sync_mode}</span></p>
            {showInstagramOAuth ? (
              <>
                <p>OAuth: <span className="text-white">{instagramConnected ? "connected" : "not connected"}</span></p>
                <p>Meta app profile: <span className="text-white">{instagramMetaApp?.label ?? "not selected"}</span></p>
                <p>Instagram account: <span className="text-white">{typeof source.metadata.instagram_username === "string" ? source.metadata.instagram_username : source.account_name ?? "not resolved"}</span></p>
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
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {connector.getMetricDefinitions().map((metric) => (
              <Badge key={metric.key} tone="indigo">{metric.key}</Badge>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel className="p-4 sm:p-5">
          <CredentialForm sourceId={source.id} title="Encrypted credentials" dataSpaceSlug={dataSpace.slug} />
          {credentials.length > 0 ? (
            <p className="mt-4 text-xs text-slate-500">Saved hints: {credentials.map((item) => `${item.field_key} ${item.value_hint ?? "saved"}`).join(", ")}</p>
          ) : null}
        </GlassPanel>
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
          <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
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
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href={instagramOAuthHref} variant="primary">
              <Camera className="h-4 w-4" />
              {instagramConnected ? "Reconnect Instagram" : "Connect Instagram"}
            </LinkButton>
            <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} />
            <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} />
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
          <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
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
          <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-50/85">
            TikTok data must come through official OAuth/API permissions. Do not enter TikTok passwords, do not scrape dashboards, and do not paste tokens in chat.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href={tiktokOAuthHref} variant="primary">
              <Video className="h-4 w-4" />
              {tiktokConnected ? "Reconnect TikTok" : "Connect TikTok"}
            </LinkButton>
            <TestConnectionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} />
            <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} />
          </div>
        </GlassPanel>
      ) : null}

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
            <p className="mt-2 break-all font-mono text-xs text-cyan-50">{`${publicAppUrl ?? "http://127.0.0.1:3100"}${source.webhook_url ?? `/api/webhooks/vercel/analytics-drain/${source.id}`}`}</p>
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
  );
}
