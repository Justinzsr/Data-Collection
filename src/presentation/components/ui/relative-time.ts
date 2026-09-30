const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function toTime(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Request-time clock for server-rendered relative labels. */
export function currentTime() {
  return Date.now();
}

function compact(amount: number, unit: "min" | "hr", diff: number) {
  return diff <= 0 ? `${amount} ${unit} ago` : `in ${amount} ${unit}`;
}

/**
 * Human relative time ("12 min ago", "in 3 days"). Server-render only: the
 * value depends on the current clock, so client components should not
 * hydrate it without a stable `now`.
 */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  options: { now?: number; fallback?: string } = {},
) {
  const time = toTime(value);
  if (time === null) return options.fallback ?? "never";
  const diff = time - (options.now ?? Date.now());
  const abs = Math.abs(diff);
  if (abs < 45_000) return diff <= 0 ? "just now" : "in under a minute";
  const minutes = Math.round(abs / MINUTE);
  if (minutes < 60) return compact(Math.max(1, minutes), "min", diff);
  const hours = Math.round(abs / HOUR);
  if (hours < 24) return compact(hours, "hr", diff);
  if (abs < 30 * DAY) return formatter.format(Math.round(diff / DAY), "day");
  if (abs < 365 * DAY) return formatter.format(Math.round(diff / (30 * DAY)), "month");
  return formatter.format(Math.round(diff / (365 * DAY)), "year");
}

/** Whole days until `value` (negative when already past); null when unknown. */
export function daysUntil(value: string | number | Date | null | undefined, now = Date.now()) {
  const time = toTime(value);
  if (time === null) return null;
  return Math.floor((time - now) / DAY);
}
