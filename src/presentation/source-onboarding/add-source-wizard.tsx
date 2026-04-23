"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Clipboard, DatabaseZap, KeyRound, LinkIcon, Play, Radar, ShieldAlert } from "lucide-react";
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
  "https://xxxxx.supabase.co",
  "https://example.com",
  "https://vercel.com/team/project",
  "https://your-store.myshopify.com",
  "https://www.tiktok.com/@account",
  "https://www.instagram.com/account",
];

export function AddSourceWizard() {
  const [inputUrl, setInputUrl] = useState("");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selected, setSelected] = useState<Detection | null>(null);
  const [syncMode, setSyncMode] = useState("hybrid");
  const [saving, setSaving] = useState(false);
  const [savedSource, setSavedSource] = useState<{ id: string; display_name: string } | null>(null);
  const [syncRunId, setSyncRunId] = useState<string | null>(null);

  const step = savedSource ? 4 : selected ? 3 : detections.length > 0 ? 2 : 1;

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
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_type_key: selected.sourceTypeKey,
          display_name: selected.accountName ? `${selected.displayName}: ${selected.accountName}` : selected.displayName,
          input_url: inputUrl,
          normalized_url: selected.normalizedUrl,
          account_name: selected.accountName,
          sync_mode: syncMode,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Save failed");
      setSavedSource(body.source);
      toast.success("Source saved", { description: "Demo mode is active until credentials/setup are added." });
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
                <label htmlFor="source-input" className="text-sm font-medium text-slate-200">Paste a source link or identifier</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="source-input"
                    value={inputUrl}
                    onChange={(event) => setInputUrl(event.target.value)}
                    placeholder="https://xxxxx.supabase.co"
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
                  Unknown platform? You can save it later as a custom API or custom CSV connector when mapping support is added.
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
                      Links identify the source. Private metrics usually require an API key, OAuth token, webhook secret, service role key, or tracking snippet.
                    </p>
                  </div>
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
              <CredentialForm sourceId={savedSource.id} title="Encrypted credential fields" />
            ) : (
              (selected?.requiredSetup ?? [
              "Paste a source link to see setup requirements.",
              "Credentials will be encrypted server-side when real database persistence is configured.",
              ]).map((item) => (
                <p key={item} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  {item.length > 500 ? "SQL setup snippet available in Supabase connector docs and source setup instructions." : item}
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
            <div className="mt-4">
              <LinkButton href="/dashboard/events" variant="primary">
                <Clipboard className="h-4 w-4" />
                Get tracking snippet
              </LinkButton>
            </div>
          ) : null}
        </GlassPanel>
      </div>
    </div>
  );
}
