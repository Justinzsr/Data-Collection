"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Gauge, MoonStar } from "lucide-react";
import type { DataSpace } from "@/storage/db/schema";
import { Badge } from "@/presentation/components/ui/badge";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

function targetFor(currentPath: string | undefined, currentSlug: string, nextSlug: string) {
  const fallback = dashboardPath(nextSlug);
  if (!currentPath) return fallback;
  const marker = `/w/${currentSlug}/dashboard`;
  if (!currentPath.startsWith(marker)) return fallback;
  return `/w/${nextSlug}/dashboard${currentPath.slice(marker.length)}`;
}

export function DataSpaceSwitcher({
  current,
  spaces,
  currentPath,
}: {
  current: DataSpace;
  spaces: DataSpace[];
  currentPath?: string;
}) {
  const Icon = current.slug === "auto-lab" ? Gauge : MoonStar;
  const pathname = usePathname() ?? currentPath;
  return (
    <details className="group relative">
      <summary className="mb-8 flex cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/7">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-200/20 bg-cyan-300/10">
          <Icon className="h-5 w-5 text-cyan-100" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{current.display_name}</span>
          <span className="mt-1 flex items-center gap-2">
            <Badge tone={current.category === "business" ? "cyan" : "indigo"}>{current.category}</Badge>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 right-0 top-14 z-50 rounded-lg border border-white/10 bg-[#0b111a] p-2 shadow-2xl">
        {spaces.map((space) => (
          <Link
            key={space.id}
            href={targetFor(pathname, current.slug, space.slug)}
            className={`block rounded-md px-3 py-2 text-sm transition ${
              space.slug === current.slug ? "bg-cyan-300/10 text-cyan-50" : "text-slate-300 hover:bg-white/7 hover:text-white"
            }`}
          >
            <span className="block font-medium">{space.display_name}</span>
            <span className="text-xs text-slate-500">{space.category}</span>
          </Link>
        ))}
      </div>
    </details>
  );
}
