import { metaSyncIsStale } from "@/aggregation/services/meta-ads-attribution-service";
import { isAuthorizationError } from "@/aggregation/services/platform-overview-service";
import type { Source } from "@/storage/db/schema";
import type { BadgeTone } from "@/presentation/components/ui/badge";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { authorizationState } from "@/presentation/dashboard/connection-health-panel";

export type PlatformHealth = {
  tone: BadgeTone;
  label: string;
  /** Someone should act: reconnect, renew, finish setup, or fix a failing sync. */
  needsAttention: boolean;
};

/**
 * One status for a platform card, combining the source status, sync freshness,
 * and OAuth renewal dates. Read-only: it never touches credentials.
 */
export function platformHealth(source: Source | null, now = currentTime()): PlatformHealth {
  if (!source) return { tone: "slate", label: "Not connected", needsAttention: false };
  if (source.status === "demo" || source.metadata.demo === true) {
    return { tone: "cyan", label: "Demo data", needsAttention: false };
  }
  const authorization = authorizationState(source, now);
  if (authorization?.renewal && authorization.tone === "rose") {
    return { tone: "rose", label: "Reconnect needed", needsAttention: true };
  }
  if (source.status === "error") {
    // An OAuth platform whose authorization was revoked fails every sync until it is reconnected.
    return authorization && isAuthorizationError(source.last_error)
      ? { tone: "rose", label: "Reconnect needed", needsAttention: true }
      : { tone: "rose", label: "Sync error", needsAttention: true };
  }
  if (source.status === "needs_credentials") return { tone: "amber", label: "Setup needed", needsAttention: true };
  if (authorization?.attention) {
    return { tone: "amber", label: authorization.renewal ? authorization.label : "Not authorized", needsAttention: true };
  }
  if (source.status === "warning") return { tone: "amber", label: "Check source", needsAttention: true };
  // The first-party tracker receives events continuously and has no sync schedule.
  if (source.source_type_key === "website") return { tone: "green", label: "Live", needsAttention: false };
  // Webhook and manual sources have no schedule to fall behind, so they are never overdue.
  const scheduled = source.sync_mode !== "webhook" && source.sync_mode !== "manual";
  if (scheduled && metaSyncIsStale(source, new Date(now))) {
    return { tone: "amber", label: "Sync overdue", needsAttention: true };
  }
  if (!source.last_success_at) {
    return scheduled
      ? { tone: "amber", label: "Awaiting first sync", needsAttention: true }
      : { tone: "slate", label: "No data yet", needsAttention: false };
  }
  return { tone: "green", label: "Live", needsAttention: false };
}
