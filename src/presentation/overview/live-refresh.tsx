"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/presentation/components/ui/button";

const DEFAULT_INTERVAL_MS = 5 * 60_000;

/**
 * Re-reads the page's stored data on an interval while the tab is visible, and
 * right away when the tab comes back after the interval has passed. It never
 * calls a platform API; syncs still run through the shared sync engine.
 */
export function LiveRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lastRefresh = useRef(0);

  useEffect(() => {
    lastRefresh.current = Date.now();
    const refresh = () => {
      lastRefresh.current = Date.now();
      startTransition(() => router.refresh());
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh.current >= intervalMs) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, router]);

  return (
    <Button
      type="button"
      variant="secondary"
      className="min-h-11 px-3.5 sm:min-h-10"
      disabled={pending}
      aria-live="polite"
      title="Refreshes automatically every few minutes while this page is open"
      onClick={() => {
        lastRefresh.current = Date.now();
        startTransition(() => router.refresh());
      }}
    >
      <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
      {pending ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
