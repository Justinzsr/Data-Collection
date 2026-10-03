import Link from "next/link";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { LiveRefresh } from "@/presentation/overview/live-refresh";

const RANGE_OPTIONS: Array<{ key: DateRangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export function OverviewHeader({
  title,
  subtitle,
  range,
  rangeHref,
}: {
  title: string;
  subtitle: string;
  range: DateRangeKey;
  rangeHref: (range: DateRangeKey) => string;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-4 px-1 lg:flex-row lg:items-end lg:justify-between" data-testid="overview-header">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.028em] text-label sm:text-[34px]">{title}</h1>
        <p className="mt-1.5 text-[14px] leading-6 text-label-secondary">{subtitle}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <nav className="segmented" aria-label="Date range">
          {RANGE_OPTIONS.map((option) => (
            <Link
              key={option.key}
              href={rangeHref(option.key)}
              className="segmented-item min-h-11 sm:min-h-10"
              aria-current={range === option.key ? "page" : undefined}
            >
              {option.label}
            </Link>
          ))}
        </nav>
        <LiveRefresh />
      </div>
    </header>
  );
}
