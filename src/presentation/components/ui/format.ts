/**
 * Shared number formatting for dashboard metrics. A metric unit is "count",
 * "percent", "ratio", or a three-letter currency code (for example "usd").
 */

const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function isCurrencyUnit(unit: string) {
  return /^[a-z]{3}$/iu.test(unit);
}

export function formatCount(value: number, options: { compact?: boolean } = {}) {
  if (options.compact && Math.abs(value) >= 10_000) return compactFormatter.format(value);
  return countFormatter.format(value);
}

export function formatCurrency(value: number, currency: string, options: { compact?: boolean } = {}) {
  const code = currency.toUpperCase();
  try {
    if (options.compact && Math.abs(value) >= 10_000) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

export function formatRatio(value: number) {
  return `${value.toFixed(2)}×`;
}

/** Short labels for chart axes: whole currency amounts and compact thousands ("$1.2K", "4.5K"). */
export function formatAxisValue(value: number, unit: string) {
  if (!Number.isFinite(value)) return "";
  if (unit === "percent") return `${Number(value.toFixed(1))}%`;
  if (unit === "ratio") return `${Number(value.toFixed(1))}×`;
  const options: Intl.NumberFormatOptions = {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) >= 10 || value === 0 ? (Math.abs(value) >= 1_000 ? 1 : 0) : 2,
  };
  if (isCurrencyUnit(unit)) {
    try {
      return new Intl.NumberFormat("en-US", { ...options, style: "currency", currency: unit.toUpperCase() }).format(value);
    } catch {
      return new Intl.NumberFormat("en-US", options).format(value);
    }
  }
  return new Intl.NumberFormat("en-US", options).format(value);
}

/** Formats a metric value by unit; null renders as an em dash (unavailable, never zero). */
export function formatMetricValue(value: number | null, unit: string, options: { compact?: boolean } = {}) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "percent") return formatPercent(value);
  if (unit === "ratio") return formatRatio(value);
  if (isCurrencyUnit(unit)) return formatCurrency(value, unit, options);
  return formatCount(value, options);
}
