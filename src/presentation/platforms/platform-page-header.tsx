import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { Badge, type BadgeTone } from "@/presentation/components/ui/badge";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";

const RANGE_OPTIONS: Array<{ key: DateRangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

/** Header for a platform detail page: the way back, the platform, its status, and its actions. */
export function PlatformPageHeader({
  overviewHref,
  iconKey,
  title,
  subtitle,
  status,
  actions,
  range,
  rangeHref,
  testId,
}: {
  overviewHref: string;
  iconKey: string;
  title: string;
  subtitle?: ReactNode;
  status?: { tone: BadgeTone; label: string };
  actions?: ReactNode;
  range?: DateRangeKey;
  rangeHref?: (range: DateRangeKey) => string;
  testId?: string;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-4 px-1" data-testid={testId}>
      <Link
        href={overviewHref}
        className="-ml-1 inline-flex min-h-11 w-fit items-center gap-0.5 rounded-full pl-1 pr-3 text-[14px] font-medium text-tint-text transition hover:bg-fill-hover sm:min-h-9"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Overview
      </Link>
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <PlatformIcon sourceTypeKey={iconKey} size="lg" />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.028em] text-label sm:text-[34px]">{title}</h1>
              {status ? <Badge tone={status.tone} dot>{status.label}</Badge> : null}
            </div>
            {subtitle ? <p className="mt-1 break-words text-[14px] leading-6 text-label-secondary">{subtitle}</p> : null}
          </div>
        </div>
        {actions || (range && rangeHref) ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {range && rangeHref ? (
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
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
