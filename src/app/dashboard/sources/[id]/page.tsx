import { ArrowLeft, Clipboard, RadioTower } from "lucide-react";
import { getConnector } from "@/collection/connectors/registry";
import { generateReactHelper, generateTrackingSnippet } from "@/collection/tracking/snippet-generator";
import { getSource } from "@/storage/repositories/sources-repository";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { SnippetCard } from "@/presentation/dashboard/snippet-card";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { TestConnectionButton } from "@/presentation/dashboard/test-connection-button";
import { CredentialForm } from "@/presentation/source-onboarding/credential-form";

export default async function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await getSource(id);
  if (!source) {
    return (
      <div className="mx-auto grid max-w-4xl gap-5">
        <SectionHeader title="Source not found" description="The source may have been deleted or the id is invalid." />
        <LinkButton href="/dashboard/sources" variant="secondary">
          <ArrowLeft className="h-4 w-4" />
          Back to sources
        </LinkButton>
      </div>
    );
  }
  const connector = getConnector(source.source_type_key);
  const credentials = await listCredentialHints(source.id);
  const trackingKey = String(source.metadata.public_tracking_key ?? "mq_demo_public_website");
  const endpoint = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/track`;
  const setup = connector.getSetupInstructions(source);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Source detail"
        title={source.display_name}
        description={connector.description}
        action={
          <>
            <LinkButton href="/dashboard/sources" variant="secondary">
              <ArrowLeft className="h-4 w-4" />
              Sources
            </LinkButton>
            <TestConnectionButton sourceId={source.id} />
            <SyncActionButton sourceId={source.id} />
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
            <p>Platform: <span className="text-white">{connector.displayName}</span></p>
            <p>Sync mode: <span className="text-white">{source.sync_mode}</span></p>
            <p>Last success: <span className="text-white">{source.last_success_at ?? "never"}</span></p>
            <p>Next sync: <span className="text-white">{source.next_sync_at ?? "manual only"}</span></p>
            <p>Last error: <span className="text-white">{source.last_error ?? "none"}</span></p>
            {source.webhook_url ? (
              <p className="break-all">Webhook URL: <span className="text-cyan-100">{source.webhook_url}</span></p>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {connector.getMetricDefinitions().map((metric) => (
              <Badge key={metric.key} tone="indigo">{metric.key}</Badge>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel className="p-4 sm:p-5">
          <CredentialForm sourceId={source.id} title="Encrypted credentials" />
          {credentials.length > 0 ? (
            <p className="mt-4 text-xs text-slate-500">Saved hints: {credentials.map((item) => `${item.field_key} ${item.value_hint ?? "saved"}`).join(", ")}</p>
          ) : null}
        </GlassPanel>
      </div>

      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-cyan-200" />
          <h2 className="text-base font-semibold text-white">Setup instructions</h2>
        </div>
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
          <SnippetCard
            title="Lightweight JavaScript snippet"
            description="Copy into your website to auto-send page_view and expose window.moonarqTrack."
            code={generateTrackingSnippet({ endpoint, publicTrackingKey: trackingKey })}
          />
          <SnippetCard
            title="React / Next.js helper"
            description="Use usePageViewTracking() and trackEvent(name, properties) inside a Next app."
            code={generateReactHelper({ endpoint, publicTrackingKey: trackingKey })}
          />
        </div>
      ) : (
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Clipboard className="h-4 w-4 text-cyan-200" />
            Tracking snippets are only shown for Website / Vercel Site sources.
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
