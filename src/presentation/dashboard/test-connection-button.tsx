"use client";

import { useState } from "react";
import { FlaskConical, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/presentation/components/ui/button";

export function TestConnectionButton({ sourceId, compact = false }: { sourceId: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const response = await fetch(`/api/sources/${sourceId}/test`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Connection test failed.");
      const result = body.result;
      toast[result.ok ? "success" : "error"](result.ok ? "Connection test complete" : "Connection test failed", {
        description: result.message,
      });
    } catch (error) {
      toast.error("Connection test failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button onClick={run} disabled={loading} variant="secondary" className={compact ? "px-3" : undefined}>
      {loading ? <RotateCw className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
      {compact ? "Test" : "Test Connection"}
    </Button>
  );
}
