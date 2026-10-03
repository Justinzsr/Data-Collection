"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** How often an open page checks whether paid delivery needs a fresh sync. */
const CHECK_INTERVAL_MS = 60_000;

/**
 * When each source may be tried again, kept for the life of the browser tab so
 * moving between the Overview and the Ads page shares one budget instead of
 * asking again on every navigation.
 */
const nextAttemptBySource = new Map<string, number>();
const inFlightSources = new Set<string>();

type AutoSyncStatus = "idle" | "syncing" | "failed";

type SyncResponseBody = {
  fresh?: unknown;
  in_progress?: unknown;
  last_success_at?: unknown;
  retry_after_ms?: unknown;
  run?: { status?: unknown } | null;
} | null;

function sameInstant(left: unknown, right: string | null) {
  return typeof left === "string" && right !== null && Date.parse(left) === Date.parse(right);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** A sync is due when the shown delivery is older than the allowed age and the source is not waiting out a retry. */
export function shouldAutoSync(input: {
  now: number;
  lastSyncedAt: string | null;
  nextAttemptAt: number | undefined;
  maxAgeMs: number;
}) {
  const lastSync = input.lastSyncedAt ? Date.parse(input.lastSyncedAt) : Number.NaN;
  if (Number.isFinite(lastSync) && input.now - lastSync < input.maxAgeMs) return false;
  return input.nextAttemptAt === undefined || input.now >= input.nextAttemptAt;
}

/**
 * Keeps paid delivery close to live while someone is looking at it. When the
 * shown Meta Ads data is older than `maxAgeMinutes`, it asks the manual sync
 * route to sync only if the source is still that stale, so every open page,
 * tab, and person shares one sync per interval through the shared, locked
 * engine. The page is re-read when a sync ends or when another sync already
 * stored newer data; while another sync runs, it checks again a minute later.
 * Nothing runs while the tab is hidden, and a request that fails is not retried
 * for a full interval.
 */
export function AdsAutoSync({
  sourceId,
  dataSpaceSlug,
  lastSyncedAt,
  maxAgeMinutes,
}: {
  sourceId: string;
  dataSpaceSlug: string;
  lastSyncedAt: string | null;
  maxAgeMinutes: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AutoSyncStatus>("idle");
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const maxAgeMs = maxAgeMinutes * 60_000;
    let active = true;
    const check = async () => {
      if (!active || document.visibilityState !== "visible" || inFlightSources.has(sourceId)) return;
      const now = Date.now();
      if (!shouldAutoSync({ now, lastSyncedAt, nextAttemptAt: nextAttemptBySource.get(sourceId), maxAgeMs })) return;
      inFlightSources.add(sourceId);
      setStatus("syncing");
      let next: AutoSyncStatus = "failed";
      let refresh = false;
      // A failed request waits a full interval; a sync held by someone else is checked again shortly.
      let retryInMs = maxAgeMs;
      try {
        const query = new URLSearchParams({ dataSpaceSlug, minAgeMinutes: String(maxAgeMinutes) });
        const response = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/sync?${query.toString()}`, { method: "POST" });
        const body = await response.json().catch(() => null) as SyncResponseBody;
        const runStatus = body?.run?.status;
        if (response.ok && body?.fresh === true) {
          // Another page, person, or the hourly sync already refreshed it: re-read only if the data is newer
          // than what is shown, and ask again when the server says the data will be stale.
          next = "idle";
          refresh = !sameInstant(body.last_success_at, lastSyncedAt);
          retryInMs = typeof body.retry_after_ms === "number" && Number.isFinite(body.retry_after_ms)
            ? clamp(body.retry_after_ms, CHECK_INTERVAL_MS, maxAgeMs)
            : CHECK_INTERVAL_MS;
        } else if (response.ok && body?.in_progress === true) {
          // Another sync is running now; its result shows on the next check.
          next = "idle";
          retryInMs = CHECK_INTERVAL_MS;
        } else if (runStatus === "success" || runStatus === "error") {
          // A finished run changed the source either way; the page shows the new numbers or the sync error.
          next = "idle";
          refresh = true;
        } else if (runStatus === "skipped") {
          next = "idle";
          retryInMs = CHECK_INTERVAL_MS;
        }
      } catch {
        next = "failed";
      } finally {
        inFlightSources.delete(sourceId);
        nextAttemptBySource.set(sourceId, Date.now() + retryInMs);
      }
      if (!mounted.current) return;
      setStatus(next);
      if (refresh) router.refresh();
    };
    const onWake = () => void check();
    onWake();
    const timer = window.setInterval(onWake, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [dataSpaceSlug, lastSyncedAt, maxAgeMinutes, router, sourceId]);

  return (
    <span role="status" data-auto-sync={status}>
      {status === "syncing" ? " Getting the latest delivery from Meta…" : null}
      {status === "failed" ? " The live update didn't finish, so these are the last synced numbers. Use Refresh now to try again." : null}
    </span>
  );
}
