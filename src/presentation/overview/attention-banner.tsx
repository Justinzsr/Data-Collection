import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import type { Source } from "@/storage/db/schema";
import { cn } from "@/presentation/components/ui/utils";
import { platformHealth } from "@/presentation/overview/platform-health";

/** One quiet line that names only the connections someone needs to act on. Renders nothing when all is well. */
export function AttentionBanner({ sources, basePath, now }: { sources: Source[]; basePath: string; now: number }) {
  const items = sources
    .filter((source) => source.status !== "disabled")
    .map((source) => ({ source, health: platformHealth(source, now) }))
    .filter((item) => item.health.needsAttention)
    .sort((left, right) => Number(right.health.tone === "rose") - Number(left.health.tone === "rose"));
  if (items.length === 0) return null;

  return (
    <section
      className="glass flex min-w-0 flex-col gap-2 rounded-[22px] p-2.5 sm:flex-row sm:items-center sm:gap-3 sm:pl-4"
      aria-label="Connections that need attention"
      data-testid="overview-attention"
    >
      <p className="flex shrink-0 items-center gap-2 px-1.5 text-[13px] font-semibold text-label sm:px-0">
        <TriangleAlert className="h-4 w-4 text-warning" aria-hidden="true" />
        {items.length === 1 ? "1 connection needs attention" : `${items.length} connections need attention`}
      </p>
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {items.map(({ source, health }) => (
          <li key={source.id} className="min-w-0 max-w-full">
            <Link
              href={`${basePath}/sources/${source.id}`}
              className={cn(
                "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 sm:min-h-9",
                health.tone === "rose" ? "bg-negative-fill/12 text-negative hover:bg-negative-fill/18" : "bg-warning-fill/14 text-warning hover:bg-warning-fill/20",
              )}
            >
              <span className="truncate">{source.display_name}</span>
              <span className="shrink-0 pl-0.5 font-semibold">{health.label}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
