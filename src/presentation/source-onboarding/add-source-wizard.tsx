"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Clipboard, DatabaseZap, KeyRound, LinkIcon, Play, Radar, ShieldAlert, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { CredentialForm } from "@/presentation/source-onboarding/credential-form";

interface Detection {
  sourceTypeKey: string;
  displayName: string;
  confidence: number;
  normalizedUrl: string | null;
  accountName?: string | null;
  requiredSetup: string[];
  possibleMetrics: string[];
  reasons: string[];
}

const examples = [
  "https://moonarqstudio.com",
  "https://xxxxx.supabase.co",
  "https://vercel.com/team/project",
  "https://your-store.myshopify.com",
];

type SavedSource = {
  id: string;
  display_name: string;
  source_type_key: string;
  webhook_url?: string | null;
};

function WebsiteSourceSetup({ source }: { source: SavedSource }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3100";
  const drainEndpoint = `${origin}${source.webhook_url ?? `/api/webhooks/vercel/analytics-drain/${source.id}`}`;

  if (source.source_type_key === "vercel_web_analytics_drain") {
    return (
      <div className="grid gap-3 rounded-lg border border-cyan-300/20 bg-cyan-300/8 p-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Vercel Web Analytics Drain setup</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            MoonArq Website / Vercel is configured for the official Vercel Drain path. Add this endpoint in the existing MoonArq Vercel project and optionally save the drain signature secret here.
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Drain endpoint</p>
          <p className="mt-2 break-all font-mono text-xs text-cyan-50">{drainEndpoint}</p>
        </div>
        <div className="grid gap-2 text-sm text-slate-300">
          <p>1. In Vercel, add a Web Analytics Drain with JSON or NDJSON delivery.</p>
          <p>2. Paste the endpoint above.</p>
          <p>3. Optional but recommended: set a Signature Verification Secret in Vercel and save the same value below.</p>
          <p>4. Keep the Website Tracker fallback disabled if the drain is the live primary mode.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <LinkButton href={`/dashboard/sources/${source.id}`} variant="primary">
            <Webhook className="h-4 w-4" />
            Open Source Detail
          </LinkButton>
          <LinkButton href="/dashboard/events" variant="secondary">
            Tracker fallback page
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-cyan-300/20 bg-cyan-300/8 p-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Website Tracker fallback / helper</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          This path keeps MoonArq website tracking available when Vercel Drains are unavailable or when you want the lighter first-party helper path.
        </p>
      </div>
      <div className="grid gap-2 text-sm text-slate-300">
        <p>1. Open the source detail page to copy the exact tracker snippet.</p>
        <p>2. Install it on moonarqstudio.com.</p>
        <p>3. Use window.moonarqTrack(...) for custom events if you need product or marketing signals beyond page views.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <LinkButton href={`/dashboard/sources/${source.id}`} variant="primary">
          <Clipboard className="h-4 w-4" />
          Open Source Snippet
        </LinkButton>
        <LinkButton href="/dashboard/events" variant="secondary">
          Event Dashboard
        </LinkButton>
      </div>
    </div>
  );
}

export function AddSourceWizard() {
  const [inputUrl, setInputUrl] = useState("");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selected, setSelected] = useState<Detection | null>(null);
  const [syncMode, setSyncMode] = useState("hybrid");
  const [websiteMode, setWebsiteMode] = useState<"vercel_web_analytics_drain" | "website">("vercel_web_analytics_drain");
  const [saving, setSaving] = useState(false);
  const [savedSource, setSavedSource] = useState<SavedSource | null>(null);
  const [syncRunId, setSyncRunId] = useState<string | null>(null);

  const step = savedSource ? 4 : selected ? 3 : detections.length > 0 ? 2 : 1;
  const effectiveSourceTypeKey = selected?.sourceTypeKey === "website" ? websiteMode : selected?.sourceTypeKey ?? null;

  async function detect() {
    const response = await fetch("/api/sources/detect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: inputUrl }),
    });
    const body = await response.json();
    setDetections(body.detections ?? []);
    setSelected(body.detections?.[0] ?? null);
  }

  async function save() {
    if (!selected || !effectiveSourceTypeKey) return;
    setSaving(true);
    try {
      const isMoonArqWebsite = selected.sourceTypeKey === "website";
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_type_key: effectiveSourceTypeKey,
          display_name: isMoonArqWebsite
            ? "MoonArq Website / Vercel"
            : selected.accountName
              ? `${selected.displayName}: ${selected.accountName}`
              : selected.displayName,
          input_url: inputUrl,
          normalized_url: selected.normalizedUrl,
          account_name: selected.accountName,
          sync_mode: syncMode,
          metadata: isMoonArqWebsite ? { monitored_source: "moonarq_website", website_mode: effectiveSourceTypeKey } : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Save failed");
      setSavedSource(body.source);
      toast.success("Source saved", {
        description:
          effectiveSourceTypeKey === "vercel_web_analytics_drain"
            ? "MoonArq Website / Vercel is ready for the official drain endpoint setup."
            : "MoonArq source saved. Finish credentials or tracking setup next.",
      });
    } catch (error) {
      toast.error("Could not save source", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSaving(false);
    }
  }

  async function runInitialSync() {
    if (!savedSource) return;
    const response = await fetch(`/api/sources/${savedSource.id}/sync`, { method: "POST" });
    const body = await response.json();
    setSyncRunId(body.run?.id ?? null);
    toast.success("Initial sync created", { description: body.run?.id });
  }

  const metrics = useMemo(() => selected?.possibleMetrics ?? [], [selected]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
      <GlassPanel className="p-4 sm:p-6">
        <div className="mb-6 grid grid-cols-4 gap-2 text-xs text-slate-400">
          {["Input", "Detect", "Setup", "Saved"].map((label, index) => (
            <div key={label} className={index + 1 <= step ? "text-cyan-100" : ""}>
              <div className={`mb-2 h-1 rounded-full ${index + 1 <= step ? "bg-cyan-300" : "bg-white/10"}`} />
              {label}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            <div className="space-y-5">
              <div>
                <label htmlFor="source-input" className="text-sm font-medium text-slate-200">Paste a MoonArq source link or identifier</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="source-input"
                    value={inputUrl}
                    onChange={(event) => setInputUrl(event.target.value)}
                    placeholder="https://moonarqstudio.com"
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none ring-cyan-300/30 transition placeholder:text-slate-600 focus:ring-2"
                  />
                  <Button onClick={detect} variant="primary">
                    <Radar className="h-4 w-4" />
                    Detect
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {examples.map((example) => (
                    <button
                      key={example}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-cyan-200/30 hover:text-cyan-100"
                      onClick={() => setInputUrl(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              {detections.length > 0 ? (
                <div className="grid gap-3">
                  {detections.map((detection) => (
                    <button
                      key={`${detection.sourceTypeKey}-${detection.confidence}`}
                      onClick={() => setSelected(detection)}
                      className={`rounded-lg border p-4 text-left transition ${
                        selected?.sourceTypeKey === detection.sourceTypeKey
                          ? "border-cyan-200/50 bg-cyan-300/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <DatabaseZap className="h-4 w-4 text-cyan-200" />
                          {detection.displayName}
                        </div>
                        <Badge tone="cyan">{Math.round(detection.confidence * 100)}% match</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-400">{detection.reasons.join(" ")}</p>
                    </button>
                  ))}
                </div>
              ) : inputUrl ? (
                <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                  Unknown platform? Save it later as a future custom MoonArq source when that connector is ready.
                </div>
              ) : null}

              {selected ? (
                <div className="grid gap-4">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <ShieldAlert className="h-4 w-4 text-amber-200" />
                      Reality check
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Links identify the monitored source. Private metrics still require the right official ingestion path, such as a Vercel Drain, a website tracker, or a server-side Supabase credential.
                    </p>
                  </div>

                  {selected.sourceTypeKey === "website" ? (
                    <div>
                      <p className="mb-2 text-sm font-medium text-slate-200">MoonArq website data mode</p>
                      <div className="grid gap-2 lg:grid-cols-2">
                        <button
                          onClick={() => setWebsiteMode("vercel_web_analytics_drain")}
                          className={`rounded-lg border px-3 py-3 text-left transition ${
                            websiteMode === "vercel_web_analytics_drain"
                              ? "border-cyan-200/50 bg-cyan-300/10 text-cyan-50"
                              : "border-white/10 bg-white/[0.03] text-slate-300"
                          }`}
                        >
                          <div className="font-medium">Vercel Web Analytics Drain</div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">Use the official Vercel Analytics Drain now that the MoonArq Vercel team is on Pro.</div>
                        </button>
                        <button
                          onClick={() => setWebsiteMode("website")}
                          className={`rounded-lg border px-3 py-3 text-left transition ${
                            websiteMode === "website"
                              ? "border-cyan-200/50 bg-cyan-300/10 text-cyan-50"
                              : "border-white/10 bg-white/[0.03] text-slate-300"
                          }`}
                        >
                          <div className="font-medium">Website Tracker fallback</div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">Keep the first-party snippet/helper path available for fallback and custom event support.</div>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-200">Sync mode</p>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {["hybrid", "hourly", "webhook", "manual"].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setSyncMode(mode)}
                          className={`rounded-lg border px-3 py-3 text-sm capitalize transition ${
                            syncMode === mode ? "border-cyan-200/50 bg-cyan-300/10 text-cyan-50" : "border-white/10 bg-white/[0.03] text-slate-300"
                          }`}
                        >
                          {mode === "hourly" ? "Every hour" : mode}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button onClick={save} disabled={saving || !!savedSource} variant="primary">
                      <CheckCircle2 className="h-4 w-4" />
                      {savedSource ? "Saved" : "Save Source"}
                    </Button>
                    {savedSource ? (
                      <Button onClick={runInitialSync} variant="secondary">
                        <Play className="h-4 w-4" />
                        Run Initial Sync
                      </Button>
                    ) : null}
                  </div>
                  {syncRunId ? <Badge tone="green">sync_run_id: {syncRunId}</Badge> : null}
                </div>
              ) : null}
            </div>
          </motion.div>
        </AnimatePresence>
      </GlassPanel>

      <div className="grid gap-5">
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <KeyRound className="h-4 w-4 text-cyan-200" />
            Credentials and setup
          </h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            {savedSource ? (
              savedSource.source_type_key === "website" || savedSource.source_type_key === "vercel_web_analytics_drain" ? (
                <WebsiteSourceSetup source={savedSource} />
              ) : (
                <CredentialForm sourceId={savedSource.id} title="Encrypted credential fields" />
              )
            ) : (
              (selected?.requiredSetup ?? [
                "Paste a source link to see setup requirements.",
                "The monitored MoonArq source stays separate from the Data Hub app's own runtime/storage.",
              ]).map((item) => (
                <p key={item} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  {item.length > 500 ? "Extended setup instructions are available in the source detail view after saving." : item}
                </p>
              ))
            )}
          </div>
        </GlassPanel>
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <LinkIcon className="h-4 w-4 text-teal-200" />
            Metrics this can collect
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {metrics.length > 0 ? metrics.map((metric) => <Badge key={metric} tone="indigo">{metric}</Badge>) : <Badge>No source selected</Badge>}
          </div>
          {selected?.sourceTypeKey === "website" ? (
            <div className="mt-4 flex flex-col gap-2">
              <Badge tone="cyan">{websiteMode === "vercel_web_analytics_drain" ? "Official Vercel Drain mode" : "Tracker fallback mode"}</Badge>
              <LinkButton href="/dashboard/events" variant="primary">
                <Clipboard className="h-4 w-4" />
                Open website setup
              </LinkButton>
            </div>
          ) : null}
        </GlassPanel>
      </div>
    </div>
  );
}
