"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  FileUp,
  Globe2,
  KeyRound,
  LinkIcon,
  Orbit,
  Play,
  Radar,
  ShieldCheck,
  Sparkles,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { IconTile, PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { CredentialForm } from "@/presentation/source-onboarding/credential-form";

type ConnectorAvailability = "live" | "planned";
type SetupKind = "oauth" | "credentials" | "webhook" | "tracker" | "hybrid" | "upload" | "planned";
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
  "whatnot",
  "facebook_page",
  "etsy",
  "google_analytics",
  "vercel_project",
  "custom_api",
  "custom_csv",
];

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
  if (kind === "upload") return "Weekly report upload";
  return "Planned integration";
}

function syncModesFor(sourceType: SourceTypeDefinition): SyncMode[] {
  if (sourceType.key === "website") return ["webhook"];
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
  if (sourceTypeKey === "whatnot") return "https://www.whatnot.com/user/your-shop";
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
          <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.018em] text-label">Add auxiliary request-level evidence</h3>
          <p className="mt-1 text-sm leading-6 text-label-secondary">
            Vercel Drain records infrastructure and request-level events. Add the first-party Website Tracker separately for authoritative funnels, sessions, identity, and attribution.
          </p>
        </div>
        <div className="rounded-2xl bg-fill p-3">
          <p className="text-[11px] font-semibold text-muted">Drain endpoint</p>
          <p className="mt-2 break-all font-mono text-xs leading-5 text-label">{drainEndpoint}</p>
          <Button type="button" onClick={copyEndpoint} variant="secondary" className="mt-3 w-full sm:w-fit">
            <Clipboard className="h-4 w-4" />
            Copy endpoint
          </Button>
        </div>
        <ol className="grid gap-2 text-sm leading-6 text-label-secondary">
          <li>1. Open the Vercel project and create a Web Analytics Drain.</li>
          <li>2. Paste the endpoint and choose JSON or NDJSON delivery.</li>
          <li>3. Save the required signature secret below; do not use Drain totals as funnel truth.</li>
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
        <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.018em] text-label">Install the authoritative website tracker</h3>
        <p className="mt-1 text-sm leading-6 text-label-secondary">
          The source detail page contains the exact snippet and custom-event helper for this source.
        </p>
      </div>
      <ol className="grid gap-2 text-sm leading-6 text-label-secondary">
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
  const [websiteMode, setWebsiteMode] = useState<"vercel_web_analytics_drain" | "website">("website");
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
          if (!templateApplied.current && (template === "instagram" || template === "tiktok" || template === "shopify" || template === "whatnot")) {
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
    setWebsiteMode("website");
    resetDetection("");
  }

  return (
    <div
      data-testid="add-source-wizard"
      data-onboarding-ready={hydrated && !catalogLoading ? "true" : "false"}
      className="mx-auto w-full max-w-5xl"
    >
      <GlassPanel className="overflow-hidden">
        <div className="border-b border-separator px-4 py-4 sm:px-6">
          <ol aria-label="Connection progress" className="grid grid-cols-4 gap-2 text-[11px] text-muted sm:text-xs">
            {STAGES.map((item, index) => {
              const reached = index <= currentStageIndex;
              const active = item.key === stage;
              return (
                <li key={item.key} aria-current={active ? "step" : undefined} className={reached ? "font-semibold text-tint-text" : "font-medium"}>
                  <div className={`mb-2 h-1.5 rounded-full transition-colors duration-300 ${reached ? "bg-tint" : "bg-fill-strong"}`} />
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
                    <h2 className="mt-3 text-[22px] font-bold tracking-[-0.025em] text-label sm:text-[26px]">Choose a platform first</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-label-secondary">
                      Pick where the data lives. We will ask only for the setup that platform actually supports.
                    </p>
                  </div>

                  {catalogLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading platforms">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-40 animate-pulse rounded-3xl bg-fill" />
                      ))}
                    </div>
                  ) : catalogError ? (
                    <div className="rounded-[22px] bg-negative-fill/10 p-5">
                      <p className="text-sm font-semibold text-negative">Platforms could not be loaded</p>
                      <p className="mt-1 text-sm text-label-secondary">{catalogError}</p>
                      <Button type="button" variant="secondary" className="mt-4" onClick={() => setCatalogAttempt((value) => value + 1)}>
                        Try again
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {platformTypes.map((sourceType) => {
                        const available = isConnectable(sourceType);
                        const selected = sourceType.key === selectedTypeKey;
                        return (
                          <button
                            key={sourceType.key}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => choosePlatform(sourceType)}
                            className={`group min-h-40 rounded-[22px] p-4 text-left transition duration-200 focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 active:scale-[0.99] ${
                              selected
                                ? "bg-tint/10 shadow-[inset_0_0_0_2px_var(--tint)]"
                                : "bg-fill hover:bg-fill-hover"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <PlatformIcon sourceTypeKey={sourceType.key} size="lg" className={available ? undefined : "opacity-60 grayscale"} />
                              <Badge tone={available ? "green" : "amber"}>{available ? setupKindLabel(sourceType.setup_kind) : "Planned"}</Badge>
                            </div>
                            <p className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-label">{sourceType.display_name}</p>
                            <p className="mt-1 line-clamp-3 text-xs leading-5 text-label-secondary">{sourceType.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedType && !isConnectable(selectedType) ? (
                    <div className="rounded-[22px] bg-warning-fill/10 p-5" aria-live="polite">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="amber">Coming soon</Badge>
                        <p className="font-semibold text-warning">{selectedType.display_name}</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-label-secondary">
                        {selectedType.key === "xiaohongshu"
                          ? "小红书 is a roadmap placeholder. It does not collect data, request credentials, test connections, or run syncs yet. A future connector must use an official authorized integration."
                          : `${selectedType.display_name} is on the roadmap. It does not collect data or ask for credentials yet; the steps below list what it will need.`}
                      </p>
                      {selectedType.setup_instructions.length > 0 ? (
                        <details className="mt-4 rounded-2xl bg-fill px-4 py-3">
                          <summary className="cursor-pointer text-sm font-semibold text-warning">{selectedType.key === "xiaohongshu" ? "Why it is not connectable" : "What it will need"}</summary>
                          <div className="mt-3 grid gap-2 text-sm leading-6 text-label-secondary">
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
                      <h2 className="mt-3 text-[22px] font-bold tracking-[-0.025em] text-label sm:text-[26px]">Configure {selectedType.display_name}</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-label-secondary">
                        Add the public source URL now. Private access is handled securely after the source is saved.
                      </p>
                    </div>
                    <Badge tone="green">{setupKindLabel(effectiveType.setup_kind)}</Badge>
                  </div>

                  {selectedType.key === "website" ? (
                    <fieldset>
                      <legend className="text-sm font-medium text-label">Choose the website source to add</legend>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {([
                          {
                            key: "website" as const,
                            title: "First-party Website Tracker",
                            description: "Authoritative funnel, pseudonymous identity, session, attribution, and product-event source.",
                            badge: "Recommended",
                            icon: Globe2,
                          },
                          {
                            key: "vercel_web_analytics_drain" as const,
                            title: "Vercel Web Analytics Drain",
                            description: "Optional auxiliary infrastructure and request evidence; retained separately from funnel totals.",
                            badge: "Auxiliary",
                            icon: Orbit,
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
                              className={`rounded-[22px] p-4 text-left transition duration-200 focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 ${
                                checked ? "bg-tint/10 shadow-[inset_0_0_0_2px_var(--tint)]" : "bg-fill hover:bg-fill-hover"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <Icon className="h-5 w-5 text-tint" />
                                <Badge tone={checked ? "cyan" : "slate"}>{option.badge}</Badge>
                              </div>
                              <p className="mt-3 text-sm font-semibold text-label">{option.title}</p>
                              <p className="mt-1 text-xs leading-5 text-label-secondary">{option.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}

                  <div>
                    <label htmlFor="source-input" className="text-sm font-medium text-label">Public source URL</label>
                    <p className="mt-1 text-xs leading-5 text-muted">Used to identify the account or project. This does not grant private access.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        id="source-input"
                        value={inputUrl}
                        onChange={(event) => resetDetection(event.target.value)}
                        disabled={!hydrated || detectionStatus === "checking"}
                        placeholder={inputPlaceholderFor(selectedType.key)}
                        autoComplete="url"
                        className="field min-h-11 min-w-0 flex-1"
                      />
                      <Button type="button" onClick={detect} disabled={!hydrated || !inputUrl.trim() || detectionStatus === "checking"} variant="secondary">
                        <Radar className="h-4 w-4" />
                        {detectionStatus === "checking" ? "Checking..." : "Check URL"}
                      </Button>
                    </div>
                  </div>

                  {detectionStatus === "done" ? (
                    topDetection ? (
                      <div className={`rounded-[22px] p-4 ${detectionMatchesSelection ? "bg-positive-fill/10" : "bg-warning-fill/10"}`} aria-live="polite">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {detectionMatchesSelection ? <Check className="h-4 w-4 text-positive" /> : <Radar className="h-4 w-4 text-warning" />}
                            <p className="text-sm font-semibold text-label">
                              {detectionMatchesSelection ? `URL matches ${selectedType.display_name}` : `${topDetection.displayName} was detected instead`}
                            </p>
                          </div>
                          <Badge tone={topDetection.availability === "live" ? "cyan" : "amber"}>{Math.round(topDetection.confidence * 100)}% match</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-label-secondary">{topDetection.reasons.join(" ")}</p>
                        {!detectionMatchesSelection ? (
                          <Button type="button" variant="secondary" className="mt-3" onClick={() => applyDetectedPlatform(topDetection)}>
                            {topDetection.availability === "live" ? `Use ${topDetection.displayName}` : `View ${topDetection.displayName} status`}
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[22px] bg-warning-fill/10 p-4 text-sm leading-6 text-warning" aria-live="polite">
                        We could not identify this URL. Check the full public profile or project URL before continuing.
                      </div>
                    )
                  ) : null}

                  {effectiveType.setup_kind === "oauth" ? (
                    <div className="flex gap-3 rounded-[22px] bg-tint/8 p-4">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-tint" />
                      <div>
                        <p className="text-sm font-semibold text-label">No token fields in this form</p>
                        <p className="mt-1 text-sm leading-6 text-label-secondary">Save the source, then use the official {selectedType.display_name} OAuth screen.</p>
                      </div>
                    </div>
                  ) : null}

                  <details className="group rounded-[22px] bg-fill px-4 py-3">
                    <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-label">
                      <span>Advanced sync settings</span>
                      <span className="flex items-center gap-2 text-xs font-normal text-muted">
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
                          className={`rounded-2xl px-3 py-3 text-left text-[13px] font-medium leading-5 transition ${
                            syncMode === mode ? "bg-[var(--glass-selected)] text-label shadow-[inset_0_0_0_2px_var(--tint)]" : "bg-fill text-label-secondary hover:bg-fill-hover"
                          }`}
                        >
                          {syncModeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </details>

                  <div className="flex flex-col-reverse gap-2 border-t border-separator pt-5 sm:flex-row sm:justify-between">
                    <Button type="button" variant="ghost" onClick={() => setStage("platform")}>
                      <ArrowLeft className="h-4 w-4" />
                      Change platform
                    </Button>
                    <Button type="button" variant="primary" onClick={() => setStage("review")} disabled={!canReview}>
                      Review connection
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                  {!canReview ? <p className="text-right text-xs text-muted">Check a matching public URL to continue.</p> : null}
                </div>
              ) : null}

              {stage === "review" && selectedType && effectiveType ? (
                <div className="grid gap-6">
                  <div>
                    <Badge tone="cyan">Step 3 of 4</Badge>
                    <h2 className="mt-3 text-[22px] font-bold tracking-[-0.025em] text-label sm:text-[26px]">Review before saving</h2>
                    <p className="mt-2 text-sm leading-6 text-label-secondary">This creates the source only. Secure authorization or installation happens next.</p>
                  </div>

                  <dl className="divide-y divide-separator rounded-[22px] bg-fill px-4 sm:px-5">
                    {[
                      ["Platform", selectedType.key === "website" ? effectiveType.display_name : selectedType.display_name],
                      ["Public source", appliedDetection?.normalizedUrl ?? inputUrl],
                      ["Connection", setupKindLabel(effectiveType.setup_kind)],
                      ["Sync schedule", syncModeLabel(syncMode)],
                    ].map(([label, value]) => (
                      <div key={label} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                        <dt className="text-xs font-medium text-muted">{label}</dt>
                        <dd className="min-w-0 break-words text-sm font-medium text-label">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="grid gap-3 md:grid-cols-2">
                    <details className="group rounded-[22px] bg-fill px-4 py-3">
                      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-label">
                        Setup after saving
                        <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" />
                      </summary>
                      <div className="mt-3 grid gap-2 text-sm leading-6 text-label-secondary">
                        {(effectiveType.setup_instructions.length > 0
                          ? effectiveType.setup_instructions
                          : ["Open the source detail page to finish setup."]
                        ).map((instruction) => <p key={instruction}>{instruction}</p>)}
                      </div>
                    </details>
                    <details className="group rounded-[22px] bg-fill px-4 py-3">
                      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-label">
                        Available metrics
                        <span className="flex items-center gap-2 text-xs font-normal text-muted">
                          {effectiveType.supported_metrics.length}
                          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                        </span>
                      </summary>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {effectiveType.supported_metrics.length > 0
                          ? effectiveType.supported_metrics.map((metric) => <Badge key={metric} tone="indigo">{metric}</Badge>)
                          : <span className="text-sm text-muted">No production metrics are declared.</span>}
                      </div>
                    </details>
                  </div>

                  <div className="flex gap-3 rounded-[22px] bg-fill p-4">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive" />
                    <p className="text-sm leading-6 text-label-secondary">
                      Credentials are never included in this source record. OAuth and credential values are handled separately through server-side encrypted storage.
                    </p>
                  </div>

                  <div className="flex flex-col-reverse gap-2 border-t border-separator pt-5 sm:flex-row sm:justify-between">
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
                    <IconTile icon={CheckCircle2} tone="positive" size="lg" />
                    <div>
                      <Badge tone="green">Source saved</Badge>
                      <h2 className="mt-3 text-[22px] font-bold tracking-[-0.025em] text-label sm:text-[26px]">Finish connecting {savedSource.display_name}</h2>
                      <p className="mt-2 text-sm leading-6 text-label-secondary">Only the setup needed for this connection is shown below.</p>
                    </div>
                  </div>

                  {savedType.setup_kind === "oauth" ? (
                    <div className="rounded-[22px] bg-tint/8 p-5 sm:p-6">
                      <div className="flex gap-3">
                        <PlatformIcon sourceTypeKey={savedType.key} size="lg" />
                        <div>
                          <h3 className="font-semibold text-label">Continue with official {savedType.display_name} OAuth</h3>
                          <p className="mt-1 text-sm leading-6 text-label-secondary">You will authorize the account on {savedType.display_name}. There are no manual token fields in this flow.</p>
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
                  ) : savedType.setup_kind === "upload" ? (
                    <div className="rounded-[22px] bg-tint/8 p-5 sm:p-6" data-testid="upload-setup">
                      <div className="flex gap-3">
                        <PlatformIcon sourceTypeKey={savedType.key} size="lg" />
                        <div>
                          <h3 className="font-semibold text-label">Import your first {savedType.display_name} report</h3>
                          <div className="mt-1 grid gap-2 text-sm leading-6 text-label-secondary">
                            {savedType.setup_instructions.slice(1).map((instruction) => <p key={instruction}>{instruction}</p>)}
                          </div>
                        </div>
                      </div>
                      <LinkButton href={`${basePath}/platforms/${savedType.key}#import`} variant="primary" className="mt-5 w-full sm:w-fit">
                        <FileUp className="h-4 w-4" />
                        Import a report
                      </LinkButton>
                    </div>
                  ) : savedSource.source_type_key === "website" || savedSource.source_type_key === "vercel_web_analytics_drain" ? (
                    <div className="rounded-[22px] bg-fill p-4 sm:p-5">
                      <WebsiteSourceSetup source={savedSource} basePath={basePath} />
                    </div>
                  ) : (
                    <div className="rounded-[22px] bg-fill p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-label">Choose the production setup</h3>
                      <div className="mt-3 grid gap-2 text-sm leading-6 text-label-secondary">
                        {(savedType.setup_instructions.length > 0
                          ? savedType.setup_instructions
                          : ["Open the source detail page to finish this connection."]
                        ).slice(0, 3).map((instruction) => <p key={instruction}>{instruction}</p>)}
                      </div>
                    </div>
                  )}

                  {savedType.setup_kind !== "oauth" && (savedType.required_fields.length > 0 || savedType.optional_fields.length > 0) ? (
                    <details className="group rounded-[22px] bg-fill px-4 py-3">
                      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-label">
                        {savedSource.source_type_key === "vercel_web_analytics_drain" ? "Required drain security settings" : "Additional encrypted settings"}
                        <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" />
                      </summary>
                      <div className="mt-4 border-t border-separator pt-4">
                        <CredentialForm sourceId={savedSource.id} title="Encrypted server-side fields" dataSpaceSlug={dataSpaceSlug} />
                      </div>
                    </details>
                  ) : null}

                  {syncRunId ? <Badge tone="green" className="w-fit">Initial sync queued: {syncRunId}</Badge> : null}

                  <div className="flex flex-col gap-2 border-t border-separator pt-5 sm:flex-row sm:flex-wrap">
                    <LinkButton href={`${basePath}/sources/${savedSource.id}`} variant="primary">
                      <LinkIcon className="h-4 w-4" />
                      Open source detail
                    </LinkButton>
                    {savedType.setup_kind !== "oauth" && savedType.setup_kind !== "upload" && savedType.capabilities.supportsManualSync && savedType.required_fields.length === 0 ? (
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
