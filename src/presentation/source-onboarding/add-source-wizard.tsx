"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  DatabaseZap,
  FileSpreadsheet,
  Globe2,
  KeyRound,
  LinkIcon,
  Orbit,
  Play,
  Radar,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Video,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { CredentialForm } from "@/presentation/source-onboarding/credential-form";

type ConnectorAvailability = "live" | "planned";
type SetupKind = "oauth" | "credentials" | "webhook" | "tracker" | "hybrid" | "planned";
type SyncMode = "webhook" | "hourly" | "manual" | "hybrid";
type WizardStage = "platform" | "configure" | "review" | "complete";

interface ConnectorCapabilities {
  supportsWebhook: boolean;
  supportsPolling: boolean;
  supportsManualSync: boolean;
  recommendedSyncFrequencyMinutes: number;
  canBackfill: boolean;
  canTestConnection: boolean;
}

interface SourceTypeDefinition {
  key: string;
  display_name: string;
  description: string;
  category: string;
  icon: string | null;
  availability: ConnectorAvailability;
  setup_kind: SetupKind;
  default_sync_mode: SyncMode;
  capabilities: ConnectorCapabilities;
  setup_instructions: string[];
  supported_metrics: string[];
  required_fields: Array<{ key: string }>;
  optional_fields: Array<{ key: string }>;
  enabled: boolean;
}

interface Detection {
  sourceTypeKey: string;
  displayName: string;
  availability: ConnectorAvailability;
  setupKind: SetupKind;
  confidence: number;
  normalizedUrl: string | null;
  externalAccountId?: string | null;
  accountName?: string | null;
  requiredSetup: string[];
  possibleMetrics: string[];
  reasons: string[];
}

type SavedSource = {
  id: string;
  display_name: string;
  source_type_key: string;
  webhook_url?: string | null;
};

const PLATFORM_PRIORITY = [
  "website",
  "instagram",
  "tiktok",
  "supabase",
  "xiaohongshu",
  "shopify",
  "vercel_project",
  "custom_api",
  "custom_csv",
];

const PLATFORM_ICONS: Record<string, LucideIcon> = {
  website: Globe2,
  vercel_web_analytics_drain: Orbit,
  instagram: Camera,
  tiktok: Video,
  supabase: DatabaseZap,
  xiaohongshu: BookOpen,
  shopify: ShoppingBag,
  vercel_project: Rocket,
  custom_api: Braces,
  custom_csv: FileSpreadsheet,
};

const STAGES: Array<{ key: WizardStage; label: string }> = [
  { key: "platform", label: "Platform" },
  { key: "configure", label: "Configure" },
  { key: "review", label: "Review" },
  { key: "complete", label: "Finish" },
];

function subscribeToHydration() {
  return () => {};
}

function getClientHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

function isConnectable(sourceType: SourceTypeDefinition | null | undefined) {
  return Boolean(sourceType?.enabled && sourceType.availability === "live" && sourceType.setup_kind !== "planned");
}

function syncModeLabel(mode: SyncMode) {
  if (mode === "hourly") return "Every hour";
  if (mode === "hybrid") return "Webhook + hourly fallback";
  if (mode === "webhook") return "Event-driven webhook";
  return "Manual only";
}

function setupKindLabel(kind: SetupKind) {
  if (kind === "oauth") return "Secure OAuth";
  if (kind === "hybrid") return "Webhook or server credential";
  if (kind === "webhook") return "Webhook endpoint";
  if (kind === "tracker") return "First-party tracker";
  if (kind === "credentials") return "Encrypted server credentials";
  return "Planned integration";
}

function syncModesFor(sourceType: SourceTypeDefinition): SyncMode[] {
  const modes: SyncMode[] = [];
  if (sourceType.capabilities.supportsWebhook && sourceType.capabilities.supportsPolling) modes.push("hybrid");
  if (sourceType.capabilities.supportsPolling) modes.push("hourly");
  if (sourceType.capabilities.supportsWebhook) modes.push("webhook");
  if (sourceType.capabilities.supportsManualSync) modes.push("manual");
  if (!modes.includes(sourceType.default_sync_mode)) modes.unshift(sourceType.default_sync_mode);
  return [...new Set(modes)];
}

function defaultInputFor(sourceTypeKey: string, dataSpaceSlug: string) {
  if (sourceTypeKey === "instagram") {
    return dataSpaceSlug === "auto-lab"
      ? "https://www.instagram.com/auto_lab_cars"
      : "https://www.instagram.com/moonarqstudio";
  }
  if (sourceTypeKey === "tiktok") {
    return dataSpaceSlug === "auto-lab"
      ? "https://www.tiktok.com/@auto_lab_cars"
      : "https://www.tiktok.com/@moonarq";
  }
  if (sourceTypeKey === "website") return dataSpaceSlug === "moonarq" ? "https://moonarqstudio.com" : "";
  return "";
}

function inputPlaceholderFor(sourceTypeKey: string) {
  if (sourceTypeKey === "instagram") return "https://www.instagram.com/your-account";
  if (sourceTypeKey === "tiktok") return "https://www.tiktok.com/@your-account";
  if (sourceTypeKey === "shopify") return "https://your-store.myshopify.com";
  if (sourceTypeKey === "supabase") return "https://your-project.supabase.co";
  if (sourceTypeKey === "website") return "https://your-site.com";
  return "Paste the official account, project, or source URL";
}

function WebsiteSourceSetup({ source, basePath }: { source: SavedSource; basePath: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:4000";
  const drainEndpoint = `${origin}${source.webhook_url ?? `/api/webhooks/vercel/analytics-drain/${source.id}`}`;

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(drainEndpoint);
      toast.success("Drain endpoint copied");
    } catch {
      toast.error("Could not copy the endpoint");
    }
  }

  if (source.source_type_key === "vercel_web_analytics_drain") {
    return (
      <div className="grid gap-4">
        <div>
          <Badge tone="cyan">Official Vercel Drain</Badge>
          <h3 className="mt-3 text-base font-semibold text-white">Send Web Analytics to this source</h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Add one Web Analytics Drain in Vercel, paste the endpoint below, then send JSON or NDJSON events.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Drain endpoint</p>
          <p className="mt-2 break-all font-mono text-xs leading-5 text-cyan-50">{drainEndpoint}</p>
          <Button type="button" onClick={copyEndpoint} variant="secondary" className="mt-3 w-full sm:w-fit">
            <Clipboard className="h-4 w-4" />
            Copy endpoint
          </Button>
        </div>
        <ol className="grid gap-2 text-sm leading-6 text-slate-300">
          <li>1. Open the Vercel project and create a Web Analytics Drain.</li>
          <li>2. Paste the endpoint and choose JSON or NDJSON delivery.</li>
          <li>3. Save the same required signature secret under security settings below.</li>
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <LinkButton href={`${basePath}/sources/${source.id}`} variant="primary">
            <Webhook className="h-4 w-4" />
            Open source detail
          </LinkButton>
          <LinkButton href={`${basePath}/events`} variant="secondary">View incoming events</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <Badge tone="cyan">First-party tracker</Badge>
        <h3 className="mt-3 text-base font-semibold text-white">Install the lightweight website tracker</h3>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          The source detail page contains the exact snippet and custom-event helper for this source.
        </p>
      </div>
      <ol className="grid gap-2 text-sm leading-6 text-slate-300">
        <li>1. Copy the generated snippet from the source detail page.</li>
        <li>2. Install it once in the website layout.</li>
        <li>3. Use the custom-event helper only for the product or marketing events you need.</li>
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row">
        <LinkButton href={`${basePath}/sources/${source.id}`} variant="primary">
          <Clipboard className="h-4 w-4" />
          Open tracker snippet
        </LinkButton>
        <LinkButton href={`${basePath}/events`} variant="secondary">View website events</LinkButton>
      </div>
    </div>
  );
}

export function AddSourceWizard({
  dataSpaceSlug = "moonarq",
  dataSpaceName = "MoonArq",
  basePath = "/w/moonarq/dashboard",
}: {
  dataSpaceSlug?: string;
  dataSpaceName?: string;
  basePath?: string;
}) {
  const searchParams = useSearchParams();
  const template = searchParams.get("template");
  const templateApplied = useRef(false);
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);

  const [stage, setStage] = useState<WizardStage>("platform");
  const [sourceTypes, setSourceTypes] = useState<SourceTypeDefinition[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectedTypeKey, setSelectedTypeKey] = useState<string | null>(null);
  const [websiteMode, setWebsiteMode] = useState<"vercel_web_analytics_drain" | "website">("vercel_web_analytics_drain");
  const [inputUrl, setInputUrl] = useState("");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [appliedDetection, setAppliedDetection] = useState<Detection | null>(null);
  const [detectionStatus, setDetectionStatus] = useState<"idle" | "checking" | "done">("idle");
  const [syncMode, setSyncMode] = useState<SyncMode>("hybrid");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savedSource, setSavedSource] = useState<SavedSource | null>(null);
  const [syncRunId, setSyncRunId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSourceTypes() {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const response = await fetch("/api/source-types");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load platforms.");
        if (!cancelled) {
          const loadedSourceTypes: SourceTypeDefinition[] = body.sourceTypes ?? [];
          setSourceTypes(loadedSourceTypes);
          if (!templateApplied.current && (template === "instagram" || template === "tiktok" || template === "shopify")) {
            const templateType = loadedSourceTypes.find((item) => item.key === template);
            if (isConnectable(templateType)) {
              templateApplied.current = true;
              setSelectedTypeKey(templateType!.key);
              setSyncMode(templateType!.default_sync_mode);
              setInputUrl(defaultInputFor(templateType!.key, dataSpaceSlug));
              setStage("configure");
            }
          }
        }
      } catch (error) {
        if (!cancelled) setCatalogError(error instanceof Error ? error.message : "Could not load platforms.");
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }

    void loadSourceTypes();
    return () => {
      cancelled = true;
    };
  }, [catalogAttempt, dataSpaceSlug, template]);

  const platformTypes = useMemo(
    () => sourceTypes
      .filter((item) => item.key !== "vercel_web_analytics_drain" && item.key !== "meta_ads")
      .sort((a, b) => {
        const aIndex = PLATFORM_PRIORITY.indexOf(a.key);
        const bIndex = PLATFORM_PRIORITY.indexOf(b.key);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      }),
    [sourceTypes],
  );
  const selectedType = sourceTypes.find((item) => item.key === selectedTypeKey) ?? null;
  const effectiveTypeKey = selectedTypeKey === "website" ? websiteMode : selectedTypeKey;
  const effectiveType = sourceTypes.find((item) => item.key === effectiveTypeKey) ?? selectedType;
  const savedType = sourceTypes.find((item) => item.key === savedSource?.source_type_key) ?? effectiveType;
  const topDetection = detections[0] ?? null;
  const detectionMatchesSelection = Boolean(
    topDetection
      && (topDetection.sourceTypeKey === selectedTypeKey
        || (selectedTypeKey === "website" && topDetection.sourceTypeKey === "website")),
  );
  const canReview = Boolean(
    isConnectable(effectiveType)
      && inputUrl.trim()
      && detectionStatus === "done"
      && detectionMatchesSelection,
  );
  const currentStageIndex = STAGES.findIndex((item) => item.key === stage);

  function resetDetection(nextInput = inputUrl) {
    setInputUrl(nextInput);
    setDetections([]);
    setAppliedDetection(null);
    setDetectionStatus("idle");
  }

  function choosePlatform(sourceType: SourceTypeDefinition) {
    setSelectedTypeKey(sourceType.key);
    setSavedSource(null);
    setSyncRunId(null);
    resetDetection(defaultInputFor(sourceType.key, dataSpaceSlug));
    setSyncMode(sourceType.default_sync_mode);

    if (isConnectable(sourceType)) {
      setStage("configure");
    } else {
      setStage("platform");
    }
  }

  function chooseWebsiteMode(mode: "vercel_web_analytics_drain" | "website") {
    setWebsiteMode(mode);
    const modeType = sourceTypes.find((item) => item.key === mode);
    if (modeType) setSyncMode(modeType.default_sync_mode);
  }

  async function detect() {
    if (!inputUrl.trim()) return;
    setDetectionStatus("checking");
    setAppliedDetection(null);
    try {
      const response = await fetch("/api/sources/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: inputUrl }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not check this URL.");
      const results: Detection[] = body.detections ?? [];
      setDetections(results);
      const topResult = results[0] ?? null;
      const matches = Boolean(
        topResult
          && (topResult.sourceTypeKey === selectedTypeKey
            || (selectedTypeKey === "website" && topResult.sourceTypeKey === "website")),
      );
      setAppliedDetection(matches ? topResult : null);
    } catch (error) {
      setDetections([]);
      toast.error("URL check failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setDetectionStatus("done");
    }
  }

  function applyDetectedPlatform(detection: Detection) {
    const detectedType = sourceTypes.find((item) => item.key === detection.sourceTypeKey);
    if (!detectedType) return;
    setSelectedTypeKey(detectedType.key);
    setSyncMode(detectedType.default_sync_mode);
    setAppliedDetection(detection);
    if (!isConnectable(detectedType)) {
      setStage("platform");
      return;
    }
    setStage("configure");
  }

  async function save() {
    if (!selectedType || !effectiveType || !isConnectable(effectiveType) || !canReview) return;
    setSaving(true);
    try {
      const isWebsite = selectedType.key === "website";
      const accountName = appliedDetection?.accountName ?? null;
      const sourceLabel = isWebsite
        ? `${dataSpaceName} Website`
        : selectedType.key === "instagram" || selectedType.key === "tiktok"
          ? `${dataSpaceName} ${selectedType.display_name}`
          : accountName
            ? `${selectedType.display_name}: ${accountName}`
            : `${dataSpaceName} ${selectedType.display_name}`;
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_type_key: effectiveType.key,
          data_space_slug: dataSpaceSlug,
          display_name: sourceLabel,
          input_url: inputUrl.trim(),
          normalized_url: appliedDetection?.normalizedUrl ?? inputUrl.trim(),
          external_account_id: appliedDetection?.externalAccountId ?? null,
          account_name: accountName,
          sync_mode: syncMode,
          metadata: isWebsite
            ? { monitored_source: `${dataSpaceSlug}_website`, website_mode: effectiveType.key }
            : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Save failed");
      setSavedSource(body.source);
      setStage("complete");
      toast.success("Source saved", { description: "Finish the secure setup shown on this page." });
    } catch (error) {
      toast.error("Could not save source", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSaving(false);
    }
  }

  async function runInitialSync() {
    if (!savedSource || !savedType || !isConnectable(savedType) || !savedType.capabilities.supportsManualSync) return;
    setSyncing(true);
    try {
      const response = await fetch(
        `/api/sources/${savedSource.id}/sync?dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the initial sync.");
      setSyncRunId(body.run?.id ?? null);
      toast.success("Initial sync queued", { description: body.run?.id });
    } catch (error) {
      toast.error("Initial sync was not started", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSyncing(false);
    }
  }

  function startAnotherSource() {
    setStage("platform");
    setSelectedTypeKey(null);
    setSavedSource(null);
    setSyncRunId(null);
    setWebsiteMode("vercel_web_analytics_drain");
    resetDetection("");
  }

  return (
    <div
      data-testid="add-source-wizard"
      data-onboarding-ready={hydrated && !catalogLoading ? "true" : "false"}
      className="mx-auto w-full max-w-5xl"
    >
      <GlassPanel className="overflow-hidden">
        <div className="border-b border-white/8 px-4 py-4 sm:px-6">
          <ol aria-label="Connection progress" className="grid grid-cols-4 gap-2 text-[11px] text-slate-500 sm:text-xs">
            {STAGES.map((item, index) => {
              const reached = index <= currentStageIndex;
              const active = item.key === stage;
              return (
                <li key={item.key} aria-current={active ? "step" : undefined} className={reached ? "text-cyan-100" : undefined}>
                  <div className={`mb-2 h-1 rounded-full transition ${reached ? "bg-cyan-300" : "bg-white/10"}`} />
                  {item.label}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
            >
              {stage === "platform" ? (
                <div className="grid gap-6">
                  <div>
                    <Badge tone="cyan">Step 1 of 4</Badge>
                    <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">Choose a platform first</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                      Pick where the data lives. We will ask only for the setup that platform actually supports.
                    </p>
                  </div>

                  {catalogLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading platforms">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-40 animate-pulse rounded-2xl border border-white/8 bg-white/[0.025]" />
                      ))}
                    </div>
                  ) : catalogError ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/8 p-5">
                      <p className="text-sm font-medium text-rose-100">Platforms could not be loaded</p>
                      <p className="mt-1 text-sm text-rose-100/70">{catalogError}</p>
                      <Button type="button" variant="secondary" className="mt-4" onClick={() => setCatalogAttempt((value) => value + 1)}>
                        Try again
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {platformTypes.map((sourceType) => {
                        const Icon = PLATFORM_ICONS[sourceType.key] ?? DatabaseZap;
                        const available = isConnectable(sourceType);
                        const selected = sourceType.key === selectedTypeKey;
                        return (
                          <button
                            key={sourceType.key}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => choosePlatform(sourceType)}
                            className={`group min-h-40 rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40 ${
                              selected
                                ? "border-cyan-200/45 bg-cyan-300/9"
                                : "border-white/9 bg-white/[0.025] hover:border-white/18 hover:bg-white/[0.045]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/20 text-cyan-100">
                                <Icon className="h-5 w-5" />
                              </span>
                              <Badge tone={available ? "green" : "amber"}>{available ? setupKindLabel(sourceType.setup_kind) : "Planned"}</Badge>
                            </div>
                            <p className="mt-4 font-semibold text-white">{sourceType.display_name}</p>
                            <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-400">{sourceType.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedType && !isConnectable(selectedType) ? (
                    <div className="rounded-2xl border border-amber-300/20 bg-amber-400/8 p-5" aria-live="polite">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="amber">Coming soon</Badge>
                        <p className="font-semibold text-amber-50">{selectedType.display_name}</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-amber-50/80">
                        {selectedType.key === "xiaohongshu"
                          ? "小红书 is a roadmap placeholder. It does not collect data, request credentials, test connections, or run syncs yet. A future connector must use an official authorized integration."
                          : "This connector is visible on the roadmap but cannot be saved or connected yet."}
                      </p>
                      {selectedType.setup_instructions.length > 0 ? (
                        <details className="mt-4 rounded-xl border border-amber-200/15 bg-black/15 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-medium text-amber-50">Why it is not connectable</summary>
                          <div className="mt-3 grid gap-2 text-sm leading-6 text-amber-50/70">
                            {selectedType.setup_instructions.map((instruction) => <p key={instruction}>{instruction}</p>)}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {stage === "configure" && selectedType && effectiveType ? (
                <div className="grid gap-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <Badge tone="cyan">Step 2 of 4</Badge>
                      <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">Configure {selectedType.display_name}</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                        Add the public source URL now. Private access is handled securely after the source is saved.
                      </p>
                    </div>
                    <Badge tone="green">{setupKindLabel(effectiveType.setup_kind)}</Badge>
                  </div>

                  {selectedType.key === "website" ? (
                    <fieldset>
                      <legend className="text-sm font-medium text-slate-200">Choose one website data path</legend>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {([
                          {
                            key: "vercel_web_analytics_drain" as const,
                            title: "Vercel Web Analytics Drain",
                            description: "Best when the site is on Vercel Pro. Events arrive through one official drain endpoint.",
                            badge: "Recommended",
                            icon: Orbit,
                          },
                          {
                            key: "website" as const,
                            title: "First-party Website Tracker",
                            description: "Use the lightweight snippet for any site or for custom product and marketing events.",
                            badge: "Flexible fallback",
                            icon: Globe2,
                          },
                        ]).map((option) => {
                          const Icon = option.icon;
                          const checked = websiteMode === option.key;
                          return (
                            <button
                              key={option.key}
                              type="button"
                              aria-pressed={checked}
                              onClick={() => chooseWebsiteMode(option.key)}
                              className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40 ${
                                checked ? "border-cyan-200/45 bg-cyan-300/9" : "border-white/9 bg-white/[0.025] hover:border-white/18"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <Icon className="h-5 w-5 text-cyan-100" />
                                <Badge tone={checked ? "cyan" : "slate"}>{option.badge}</Badge>
                              </div>
                              <p className="mt-3 text-sm font-semibold text-white">{option.title}</p>
                              <p className="mt-1 text-xs leading-5 text-slate-400">{option.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}

                  <div>
                    <label htmlFor="source-input" className="text-sm font-medium text-slate-200">Public source URL</label>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Used to identify the account or project. This does not grant private access.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        id="source-input"
                        value={inputUrl}
                        onChange={(event) => resetDetection(event.target.value)}
                        disabled={!hydrated || detectionStatus === "checking"}
                        placeholder={inputPlaceholderFor(selectedType.key)}
                        autoComplete="url"
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none ring-cyan-300/30 transition placeholder:text-slate-600 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-55"
                      />
                      <Button type="button" onClick={detect} disabled={!hydrated || !inputUrl.trim() || detectionStatus === "checking"} variant="secondary">
                        <Radar className="h-4 w-4" />
                        {detectionStatus === "checking" ? "Checking..." : "Check URL"}
                      </Button>
                    </div>
                  </div>

                  {detectionStatus === "done" ? (
                    topDetection ? (
                      <div className={`rounded-2xl border p-4 ${detectionMatchesSelection ? "border-emerald-300/20 bg-emerald-400/8" : "border-amber-300/20 bg-amber-400/8"}`} aria-live="polite">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {detectionMatchesSelection ? <Check className="h-4 w-4 text-emerald-200" /> : <Radar className="h-4 w-4 text-amber-200" />}
                            <p className="text-sm font-semibold text-white">
                              {detectionMatchesSelection ? `URL matches ${selectedType.display_name}` : `${topDetection.displayName} was detected instead`}
                            </p>
                          </div>
                          <Badge tone={topDetection.availability === "live" ? "cyan" : "amber"}>{Math.round(topDetection.confidence * 100)}% match</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{topDetection.reasons.join(" ")}</p>
                        {!detectionMatchesSelection ? (
                          <Button type="button" variant="secondary" className="mt-3" onClick={() => applyDetectedPlatform(topDetection)}>
                            {topDetection.availability === "live" ? `Use ${topDetection.displayName}` : `View ${topDetection.displayName} status`}
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-amber-300/20 bg-amber-400/8 p-4 text-sm leading-6 text-amber-50" aria-live="polite">
                        We could not identify this URL. Check the full public profile or project URL before continuing.
                      </div>
                    )
                  ) : null}

                  {effectiveType.setup_kind === "oauth" ? (
                    <div className="flex gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/7 p-4">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />
                      <div>
                        <p className="text-sm font-medium text-cyan-50">No token fields in this form</p>
                        <p className="mt-1 text-sm leading-6 text-slate-300">Save the source, then use the official {selectedType.display_name} OAuth screen.</p>
                      </div>
                    </div>
                  ) : null}

                  <details className="group rounded-2xl border border-white/9 bg-white/[0.02] px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-200">
                      <span>Advanced sync settings</span>
                      <span className="flex items-center gap-2 text-xs font-normal text-slate-500">
                        {syncModeLabel(syncMode)}
                        <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                      </span>
                    </summary>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {syncModesFor(effectiveType).map((mode) => (
                        <button
                          type="button"
                          key={mode}
                          aria-pressed={syncMode === mode}
                          onClick={() => setSyncMode(mode)}
                          className={`rounded-xl border px-3 py-3 text-left text-xs leading-5 transition ${
                            syncMode === mode ? "border-cyan-200/40 bg-cyan-300/9 text-cyan-50" : "border-white/9 bg-black/15 text-slate-400"
                          }`}
                        >
                          {syncModeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </details>

                  <div className="flex flex-col-reverse gap-2 border-t border-white/8 pt-5 sm:flex-row sm:justify-between">
                    <Button type="button" variant="ghost" onClick={() => setStage("platform")}>
                      <ArrowLeft className="h-4 w-4" />
                      Change platform
                    </Button>
                    <Button type="button" variant="primary" onClick={() => setStage("review")} disabled={!canReview}>
                      Review connection
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                  {!canReview ? <p className="text-right text-xs text-slate-500">Check a matching public URL to continue.</p> : null}
                </div>
              ) : null}

              {stage === "review" && selectedType && effectiveType ? (
                <div className="grid gap-6">
                  <div>
                    <Badge tone="cyan">Step 3 of 4</Badge>
                    <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">Review before saving</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">This creates the source only. Secure authorization or installation happens next.</p>
                  </div>

                  <dl className="divide-y divide-white/8 rounded-2xl border border-white/9 bg-white/[0.02] px-4 sm:px-5">
                    {[
                      ["Platform", selectedType.key === "website" ? effectiveType.display_name : selectedType.display_name],
                      ["Public source", appliedDetection?.normalizedUrl ?? inputUrl],
                      ["Connection", setupKindLabel(effectiveType.setup_kind)],
                      ["Sync schedule", syncModeLabel(syncMode)],
                    ].map(([label, value]) => (
                      <div key={label} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                        <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</dt>
                        <dd className="min-w-0 break-words text-sm text-slate-200">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="grid gap-3 md:grid-cols-2">
                    <details className="group rounded-2xl border border-white/9 bg-white/[0.02] px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-200">
                        Setup after saving
                        <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
                      </summary>
                      <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-400">
                        {(effectiveType.setup_instructions.length > 0
                          ? effectiveType.setup_instructions
                          : ["Open the source detail page to finish setup."]
                        ).map((instruction) => <p key={instruction}>{instruction}</p>)}
                      </div>
                    </details>
                    <details className="group rounded-2xl border border-white/9 bg-white/[0.02] px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-200">
                        Available metrics
                        <span className="flex items-center gap-2 text-xs font-normal text-slate-500">
                          {effectiveType.supported_metrics.length}
                          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                        </span>
                      </summary>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {effectiveType.supported_metrics.length > 0
                          ? effectiveType.supported_metrics.map((metric) => <Badge key={metric} tone="indigo">{metric}</Badge>)
                          : <span className="text-sm text-slate-500">No production metrics are declared.</span>}
                      </div>
                    </details>
                  </div>

                  <div className="flex gap-3 rounded-2xl border border-white/9 bg-black/15 p-4">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />
                    <p className="text-sm leading-6 text-slate-300">
                      Credentials are never included in this source record. OAuth and credential values are handled separately through server-side encrypted storage.
                    </p>
                  </div>

                  <div className="flex flex-col-reverse gap-2 border-t border-white/8 pt-5 sm:flex-row sm:justify-between">
                    <Button type="button" variant="ghost" onClick={() => setStage("configure")} disabled={saving}>
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </Button>
                    <Button type="button" variant="primary" onClick={save} disabled={!canReview || saving || !isConnectable(effectiveType)}>
                      <CheckCircle2 className="h-4 w-4" />
                      {saving ? "Saving..." : "Save source"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {stage === "complete" && savedSource && savedType ? (
                <div className="grid gap-6">
                  <div className="flex gap-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
                      <CheckCircle2 className="h-6 w-6" />
                    </span>
                    <div>
                      <Badge tone="green">Source saved</Badge>
                      <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">Finish connecting {savedSource.display_name}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-400">Only the setup needed for this connection is shown below.</p>
                    </div>
                  </div>

                  {savedType.setup_kind === "oauth" ? (
                    <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/7 p-5 sm:p-6">
                      <div className="flex gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />
                        <div>
                          <h3 className="font-semibold text-white">Continue with official {savedType.display_name} OAuth</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-300">You will authorize the account on {savedType.display_name}. There are no manual token fields in this flow.</p>
                        </div>
                      </div>
                      <LinkButton
                        href={`/api/oauth/${savedType.key}/start?sourceId=${encodeURIComponent(savedSource.id)}&dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}&returnPath=${encodeURIComponent(`${basePath}/sources/${savedSource.id}`)}`}
                        variant="primary"
                        className="mt-5 w-full sm:w-fit"
                      >
                        <KeyRound className="h-4 w-4" />
                        Connect {savedType.display_name}
                      </LinkButton>
                    </div>
                  ) : savedSource.source_type_key === "website" || savedSource.source_type_key === "vercel_web_analytics_drain" ? (
                    <div className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5">
                      <WebsiteSourceSetup source={savedSource} basePath={basePath} />
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-white">Choose the production setup</h3>
                      <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-400">
                        {(savedType.setup_instructions.length > 0
                          ? savedType.setup_instructions
                          : ["Open the source detail page to finish this connection."]
                        ).slice(0, 3).map((instruction) => <p key={instruction}>{instruction}</p>)}
                      </div>
                    </div>
                  )}

                  {savedType.setup_kind !== "oauth" && (savedType.required_fields.length > 0 || savedType.optional_fields.length > 0) ? (
                    <details className="group rounded-2xl border border-white/9 bg-white/[0.02] px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-200">
                        {savedSource.source_type_key === "vercel_web_analytics_drain" ? "Required drain security settings" : "Additional encrypted settings"}
                        <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
                      </summary>
                      <div className="mt-4 border-t border-white/8 pt-4">
                        <CredentialForm sourceId={savedSource.id} title="Encrypted server-side fields" dataSpaceSlug={dataSpaceSlug} />
                      </div>
                    </details>
                  ) : null}

                  {syncRunId ? <Badge tone="green" className="w-fit">Initial sync queued: {syncRunId}</Badge> : null}

                  <div className="flex flex-col gap-2 border-t border-white/8 pt-5 sm:flex-row sm:flex-wrap">
                    <LinkButton href={`${basePath}/sources/${savedSource.id}`} variant="primary">
                      <LinkIcon className="h-4 w-4" />
                      Open source detail
                    </LinkButton>
                    {savedType.setup_kind !== "oauth" && savedType.capabilities.supportsManualSync && savedType.required_fields.length === 0 ? (
                      <Button type="button" onClick={runInitialSync} disabled={syncing} variant="secondary">
                        <Play className="h-4 w-4" />
                        {syncing ? "Queuing..." : "Run initial sync"}
                      </Button>
                    ) : null}
                    <Button type="button" onClick={startAnotherSource} variant="ghost">
                      <Sparkles className="h-4 w-4" />
                      Add another source
                    </Button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </GlassPanel>
    </div>
  );
}
