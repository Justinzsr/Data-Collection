import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { OverviewDelta } from "@/aggregation/services/platform-overview-service";
import { formatCount } from "@/presentation/components/ui/format";
import { cn } from "@/presentation/components/ui/utils";

type Direction = "up" | "down" | "flat";

const MINUS = "−";

function direction(delta: OverviewDelta): Direction {
  if (delta.kind === "none") return "flat";
  const threshold = delta.kind === "absolute" ? 0.5 : 0.05;
  if (Math.abs(delta.value) < threshold) return "flat";
  return delta.value > 0 ? "up" : "down";
}

function signed(value: string, dir: Direction) {
  if (dir === "up") return `+${value}`;
  if (dir === "down") return `${MINUS}${value}`;
  return value;
}

/** Short visible text for a change, e.g. "+12.4%", "−38", "+0.3 pt". Null when there is nothing to show. */
export function deltaLabel(delta: OverviewDelta): string | null {
  if (delta.kind === "none") {
    if (delta.reason === "partial_day") return "So far today";
    if (delta.reason === "from_zero") return "New";
    if (delta.reason === "no_baseline") return "No earlier data";
    if (delta.reason === "incomplete") return "Incomplete";
    return null;
  }
  const dir = direction(delta);
  if (dir === "flat") return "No change";
  if (delta.kind === "percent") return signed(`${Math.abs(delta.value).toFixed(1)}%`, dir);
  if (delta.kind === "absolute") return signed(formatCount(Math.abs(delta.value), { compact: true }), dir);
  return signed(`${Math.abs(delta.value).toFixed(1)} pt`, dir);
}

/**
 * Full sentence for assistive technology and the hover title, e.g. "Up 12.4% vs
 * previous 30 days, better". It names whether the change is good for the
 * business, which the chip otherwise shows only through color.
 */
export function deltaDescription(delta: OverviewDelta, higherIsBetter: boolean | null = null): string | null {
  const label = deltaLabel(delta);
  if (!label) return null;
  if (delta.kind === "none") {
    if (delta.reason === "from_zero") return `New activity ${delta.basis ?? ""}`.trim();
    if (delta.reason === "incomplete" && delta.basis) return `${label}: ${delta.basis}`;
    return label;
  }
  const dir = direction(delta);
  if (dir === "flat") return `No change ${delta.basis}`;
  const magnitude = label.replace(/^[+−]/u, "");
  const tone = deltaTone(delta, higherIsBetter);
  const evaluation = tone === "good" ? ", better" : tone === "bad" ? ", worse" : "";
  return `${dir === "up" ? "Up" : "Down"} ${magnitude} ${delta.basis}${evaluation}`;
}

export type DeltaTone = "good" | "bad" | "neutral";

export function deltaTone(delta: OverviewDelta, higherIsBetter: boolean | null): DeltaTone {
  const dir = direction(delta);
  if (dir === "flat" || higherIsBetter === null) return "neutral";
  return (dir === "up") === higherIsBetter ? "good" : "bad";
}

const toneClasses: Record<DeltaTone, string> = {
  good: "bg-positive-fill/14 text-positive",
  bad: "bg-negative-fill/12 text-negative",
  neutral: "bg-fill-strong text-label-secondary",
};

/**
 * A change chip: an arrow for direction plus the signed value. Color adds
 * whether the change is good or bad, which the title and screen-reader text
 * also say in words.
 */
export function MetricDelta({
  delta,
  higherIsBetter,
  size = "md",
  className,
}: {
  delta: OverviewDelta;
  higherIsBetter: boolean | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const label = deltaLabel(delta);
  if (!label) return null;
  const description = deltaDescription(delta, higherIsBetter);
  if (delta.kind === "none") {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center whitespace-nowrap text-[var(--muted)]", size === "sm" ? "text-[11px]" : "text-xs", className)}
        title={delta.basis}
        data-delta="none"
      >
        {label}
        {delta.reason === "incomplete" && delta.basis ? <span className="sr-only">: {delta.basis}</span> : null}
      </span>
    );
  }
  const dir = direction(delta);
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : null;
  const tone = deltaTone(delta, higherIsBetter);
  return (
    <span
      className={cn(
        "tabular inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full font-semibold",
        size === "sm" ? "px-1.5 py-px text-[11px] leading-4" : "px-2 py-0.5 text-xs leading-4",
        toneClasses[tone],
        className,
      )}
      title={description ?? undefined}
      data-delta={dir}
      data-delta-tone={tone}
    >
      {Icon ? <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={2.4} aria-hidden="true" /> : null}
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
