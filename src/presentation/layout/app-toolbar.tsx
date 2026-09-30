"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import type { DataSpace } from "@/storage/db/schema";
import { openCommandPalette } from "@/presentation/layout/command-palette";
import { MobileNav } from "@/presentation/layout/mobile-nav";
import { getPageLabel } from "@/presentation/layout/nav-items";
import { WorkspaceIcon } from "@/presentation/layout/workspace-icon";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { ThemeToggle } from "@/presentation/theme/theme-toggle";

export function AppToolbar({
  dataSpace,
  dataSpaces = [],
}: {
  dataSpace?: DataSpace;
  dataSpaces?: DataSpace[];
}) {
  const pathname = usePathname();
  const slug = dataSpace?.slug ?? "moonarq";
  const workspaceName = dataSpace?.display_name ?? "MoonArq";
  const pageLabel = getPageLabel(pathname, slug);

  return (
    <header className="pointer-events-none sticky top-0 z-40 px-3 pt-3 sm:px-5 lg:px-6">
      <div className="glass-chrome pointer-events-auto flex h-[3.25rem] min-w-0 items-center justify-between gap-2 rounded-full pl-1.5 pr-1.5 sm:pl-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href={dashboardPath(slug)} className="shrink-0 rounded-[9px] lg:hidden" aria-label={`${workspaceName} overview`}>
            <WorkspaceIcon slug={slug} size="sm" />
          </Link>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <Link
              href={dashboardPath(slug)}
              className="hidden shrink-0 font-medium text-muted transition hover:text-label sm:inline"
            >
              {workspaceName}
            </Link>
            <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-label-quaternary sm:block" aria-hidden="true" />
            <span className="truncate font-semibold text-label" aria-current="page">{pageLabel}</span>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={openCommandPalette}
            className="glass-control hidden h-10 min-w-10 items-center justify-center gap-2 rounded-full px-2.5 lg:inline-flex text-[13px] text-muted transition hover:text-label focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 lg:pl-3 lg:pr-2"
            aria-label="Search pages, sources, and actions"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span>Search</span>
            <kbd className="rounded-md bg-fill-strong px-1.5 py-0.5 font-sans text-[11px] font-medium text-label-secondary">⌘K</kbd>
          </button>
          <ThemeToggle className="hidden md:inline-flex" />
          <MobileNav currentDataSpace={dataSpace} dataSpaces={dataSpaces} />
        </div>
      </div>
    </header>
  );
}
