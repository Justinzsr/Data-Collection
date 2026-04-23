"use client";

import { useState } from "react";
import { Play, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/presentation/components/ui/button";

export function SyncActionButton({ sourceId, compact = false }: { sourceId: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const response = await fetch(`/api/sources/${sourceId}/sync`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Sync failed");
      toast.success(`Sync ${body.run.status}`, { description: `sync_run_id: ${body.run.id}` });
    } catch (error) {
      toast.error("Sync failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button onClick={run} disabled={loading} variant="primary" className={compact ? "px-3" : undefined}>
      {loading ? <RotateCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {compact ? "Sync" : "Run Sync Now"}
    </Button>
  );
}

export function RunAllDueButton() {
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const response = await fetch("/api/sync/all", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Run all failed");
      toast.success("Due syncs completed", { description: `${body.runs.length} sync run(s) created.` });
    } catch (error) {
      toast.error("Run all failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button onClick={run} disabled={loading} variant="secondary">
      {loading ? <RotateCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      Run All Due Sources
    </Button>
  );
}
