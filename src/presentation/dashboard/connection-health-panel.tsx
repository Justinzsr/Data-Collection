import Link from "next/link";
import { ChevronRight, KeyRound, PlugZap } from "lucide-react";
import { isAuthorizationError } from "@/aggregation/services/platform-overview-service";
import type { Source } from "@/storage/db/schema";
import { Badge, statusTone, type BadgeTone } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { currentTime, daysUntil, formatRelativeTime } from "@/presentation/components/ui/relative-time";
import { cn } from "@/presentation/components/ui/utils";
import { formatAppDate } from "@/storage/runtime/app-time";

const RENEWAL_WARNING_DAYS = 14;

export type AuthorizationState = {
  tone: BadgeTone;
  label: string;
  /** Someone should look at this connection (never authorized, expiring, or expired). */
  attention: boolean;
  /** An existing authorization is expiring soon or has expired and must be renewed. */
  renewal: boolean;
};

function metadataText(source: Source, key: string) {
  const value = source.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * When will this connection need a human to re-authorize it?
 * TikTok and Etsy access tokens refresh server-side, so only the refresh-token
 * expiry matters there. Instagram and Meta long-lived tokens expire outright.
 * Read-only: this never touches credentials.
 */
export function authorizationState(source: Source, now = currentTime()): AuthorizationState | null {
  const refreshesItself = source.source_type_key === "tiktok" || source.source_type_key === "etsy";
  const oauthPlatform = refreshesItself || source.source_type_key === "instagram" || source.source_type_key === "meta_ads";
  if (!oauthPlatform) return null;
  if (source.status === "demo" || source.metadata.demo === true) {
    return { tone: "slate", label: "Demo only", attention: false, renewal: false };
  }
  if (source.metadata.oauth_connected !== true) {
    return { tone: "amber", label: "Not authorized", attention: true, renewal: false };
  }
  // A refused authorization outranks any expiry date still on record.
  if (source.status === "error" && isAuthorizationError(source.last_error)) {
    return { tone: "rose", label: "Reconnect needed", attention: true, renewal: true };
  }
  const deadline = refreshesItself
    ? metadataText(source, "refresh_expires_at")
    : metadataText(source, "token_expires_at");
  const days = daysUntil(deadline, now);
  if (days === null) {
    return refreshesItself
      ? { tone: "green", label: "Auto-refreshing", attention: false, renewal: false }
      : { tone: "slate", label: "Expiry unknown", attention: false, renewal: false };
  }
  if (days < 0) return { tone: "rose", label: "Authorization expired", attention: true, renewal: true };
  if (days <= RENEWAL_WARNING_DAYS) {
    return {
      tone: "amber",
      label: days === 0 ? "Renew today" : `Renew within ${days} day${days === 1 ? "" : "s"}`,
      attention: true,
      renewal: true,
    };
  }
  return { tone: "green", label: `Valid until ${formatAppDate(deadline)}`, attention: false, renewal: false };
}

function statusLabel(status: Source["status"]) {
  if (status === "needs_credentials") return "Needs setup";
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

function needsAttention(source: Source, authorization: AuthorizationState | null) {
  return ["error", "warning", "needs_credentials"].includes(source.status) || Boolean(authorization?.attention);
}

export function ConnectionHealthPanel({
  sources,
  basePath,
  now: nowProp,
  className,
}: {
  sources: Source[];
  basePath: string;
  now?: number;
  className?: string;
}) {
  if (sources.length === 0) return null;
  const now = nowProp ?? currentTime();
  const rows = sources
    .map((source) => ({ source, authorization: authorizationState(source, now) }))
    .sort((left, right) => Number(needsAttention(right.source, right.authorization)) - Number(needsAttention(left.source, left.authorization)));
  const attentionCount = rows.filter((row) => needsAttention(row.source, row.authorization)).length;
  const connectedCount = rows.filter((row) => ["healthy", "demo"].includes(row.source.status)).length;

  return (
    <GlassPanel className={cn("p-4 sm:p-5", className)} data-testid="connection-health" aria-labelledby="connection-health-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-tint/12 text-tint">
            <PlugZap className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">Connections</p>
            <h2 id="connection-health-title" className="mt-0.5 text-[17px] font-semibold tracking-[-0.018em] text-label">
              Platform connections
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-label-secondary">
              Live status and authorization renewal dates, so nothing expires unnoticed.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge tone="green" dot>{connectedCount} connected</Badge>
          <Badge tone={attentionCount > 0 ? "amber" : "slate"} dot={attentionCount > 0}>
            {attentionCount === 0 ? "Nothing needs attention" : `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`}
          </Badge>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-1" aria-label="Connected sources">
        {rows.map(({ source, authorization }) => {
          const account = source.account_name
            ?? metadataText(source, "instagram_username")
            ?? metadataText(source, "tiktok_username")
            ?? source.normalized_url
            ?? source.input_url;
          // The first-party tracker receives events continuously; it has no sync schedule.
          const synced = source.source_type_key === "website"
            ? "live first-party tracker"
            : source.last_success_at
              ? `synced ${formatRelativeTime(source.last_success_at, { now })}`
              : "never synced";
          return (
            <li key={source.id}>
              <Link
                href={`${basePath}/sources/${source.id}`}
                className="group flex min-h-14 items-center gap-3 rounded-2xl px-2.5 py-2 transition hover:bg-fill-hover focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
              >
                <PlatformIcon sourceTypeKey={source.source_type_key} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-label">{source.display_name}</span>
                  <span className="block truncate text-xs text-muted">
                    {account ? `${account} · ` : ""}{synced}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">
                    <Badge tone={statusTone(source.status)} dot>{statusLabel(source.status)}</Badge>
                    {authorization ? (
                      <Badge tone={authorization.tone}>
                        <KeyRound className="h-3 w-3" aria-hidden="true" />
                        {authorization.label}
                      </Badge>
                    ) : null}
                  </span>
                </span>
                {authorization ? (
                  <span className="hidden shrink-0 sm:inline-flex">
                    <Badge tone={authorization.tone}>
                      <KeyRound className="h-3 w-3" aria-hidden="true" />
                      {authorization.label}
                    </Badge>
                  </span>
                ) : null}
                <span className="hidden shrink-0 sm:inline-flex">
                  <Badge tone={statusTone(source.status)} dot>{statusLabel(source.status)}</Badge>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-label-quaternary transition group-hover:translate-x-0.5 group-hover:text-muted" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </GlassPanel>
  );
}
