import type { WebsiteFunnelComparisonMode } from "@/aggregation/services/website-funnel-types";

export type ComparisonDisplayState =
  | { kind: "unmeasured"; label: "Not measured"; tone: "neutral"; showPrevious: false }
  | { kind: "off"; label: "Comparison off"; tone: "neutral"; showPrevious: false }
  | { kind: "unavailable"; label: "Comparison unavailable"; tone: "neutral"; showPrevious: false }
  | { kind: "no_baseline"; label: "No baseline"; tone: "neutral"; showPrevious: false }
  | { kind: "available"; label: "Previous period"; tone: "neutral"; showPrevious: true }
  | { kind: "positive"; label: string; tone: "positive"; showPrevious: true }
  | { kind: "negative"; label: string; tone: "negative"; showPrevious: true }
  | { kind: "zero"; label: "0.0% vs previous"; tone: "neutral"; showPrevious: true };

type ComparisonDisplayInput = {
  mode: WebsiteFunnelComparisonMode;
  globallyAvailable: boolean;
  measured?: boolean;
  hasBaseline?: boolean;
  deltaPercent?: number | null;
  includeDelta?: boolean;
};

export function resolveComparisonDisplay({
  mode,
  globallyAvailable,
  measured = true,
  hasBaseline = true,
  deltaPercent = null,
  includeDelta = false,
}: ComparisonDisplayInput): ComparisonDisplayState {
  if (!measured) {
    return { kind: "unmeasured", label: "Not measured", tone: "neutral", showPrevious: false };
  }
  if (mode === "off") {
    return { kind: "off", label: "Comparison off", tone: "neutral", showPrevious: false };
  }
  if (!globallyAvailable) {
    return {
      kind: "unavailable",
      label: "Comparison unavailable",
      tone: "neutral",
      showPrevious: false,
    };
  }
  if (!hasBaseline || (includeDelta && (deltaPercent === null || !Number.isFinite(deltaPercent)))) {
    return { kind: "no_baseline", label: "No baseline", tone: "neutral", showPrevious: false };
  }
  if (!includeDelta) {
    return { kind: "available", label: "Previous period", tone: "neutral", showPrevious: true };
  }
  if (deltaPercent === 0) {
    return { kind: "zero", label: "0.0% vs previous", tone: "neutral", showPrevious: true };
  }
  if (deltaPercent !== null && deltaPercent > 0) {
    return {
      kind: "positive",
      label: `+${deltaPercent.toFixed(1)}% vs previous`,
      tone: "positive",
      showPrevious: true,
    };
  }
  return {
    kind: "negative",
    label: `${deltaPercent?.toFixed(1)}% vs previous`,
    tone: "negative",
    showPrevious: true,
  };
}

export function comparisonToneClass(tone: ComparisonDisplayState["tone"]) {
  if (tone === "positive") return "text-positive";
  if (tone === "negative") return "text-negative";
  return "text-[var(--muted)]";
}

/** Capsule treatment for a comparison label (text tone + tinted fill). */
export function comparisonChipClass(tone: ComparisonDisplayState["tone"]) {
  if (tone === "positive") return "bg-positive-fill/15 text-positive";
  if (tone === "negative") return "bg-negative-fill/12 text-negative";
  return "bg-fill-strong text-[var(--muted)]";
}
