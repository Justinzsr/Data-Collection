"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/presentation/components/ui/button";

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

function errorMessage(body: Record<string, unknown>, fallback: string) {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

export function SyncActionButton({ sourceId, compact = false }: { sourceId: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [resultLabel, setResultLabel] = useState<string | null>(null);
  const router = useRouter();
  async function run() {
    setLoading(true);
    setResultLabel(null);
    try {
      const response = await fetch(`/api/sources/${sourceId}/sync`, { method: "POST" });
      const body = await readJson(response);
      const run = body.run && typeof body.run === "object" ? body.run as { id?: unknown; status?: unknown; records_fetched?: unknown } : null;
      if (!response.ok || !run || run.status !== "success") {
        throw new Error(errorMessage(body, run?.status === "skipped" ? "Source is already syncing." : "Sync failed."));
      }
      setResultLabel("Sync success");
      toast.success("Sync success", {
        description: `sync_run_id: ${String(run.id)} · records_fetched: ${String(run.records_fetched ?? 0)}`,
      });
      window.setTimeout(() => router.refresh(), 900);
    } catch (error) {
      setResultLabel("Sync failed");
      toast.error("Sync failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" onClick={run} disabled={loading} variant="primary" className={compact ? "px-3" : undefined}>
        {loading ? <RotateCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {compact ? "Sync" : "Run Sync Now"}
      </Button>
      {resultLabel ? <span className="text-xs text-slate-400">{resultLabel}</span> : null}
    </span>
  );
}

export function RunAllDueButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  async function run() {
    setLoading(true);
    try {
      const response = await fetch("/api/sync/all", { method: "POST" });
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(body, "Run all failed"));
      const runs = Array.isArray(body.runs) ? body.runs : [];
      toast.success("Due syncs completed", { description: `${runs.length} sync run(s) created.` });
      router.refresh();
    } catch (error) {
      toast.error("Run all failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button type="button" onClick={run} disabled={loading} variant="secondary">
      {loading ? <RotateCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      Run All Due Sources
    </Button>
  );
}
