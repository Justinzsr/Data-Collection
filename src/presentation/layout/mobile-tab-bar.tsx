"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/presentation/components/ui/utils";
import { openCommandPalette } from "@/presentation/layout/command-palette";
import { getMobileTabItems } from "@/presentation/layout/nav-items";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

/** iOS-style floating tab bar for the primary destinations on small screens. */
export function MobileTabBar({ dataSpaceSlug = "moonarq" }: { dataSpaceSlug?: string }) {
  const pathname = usePathname();
  const overviewHref = dashboardPath(dataSpaceSlug);
  const items = getMobileTabItems(dataSpaceSlug);

  function isActive(href: string) {
    if (href === overviewHref) return pathname === overviewHref;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end justify-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <nav aria-label="Quick navigation" className="glass-chrome pointer-events-auto flex h-[3.75rem] items-center rounded-full px-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 w-[clamp(3.25rem,16.5vw,4.5rem)] flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-tint/30",
                active ? "bg-fill-strong text-tint-text" : "text-label-secondary",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.3 : 2} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Search"
        className="glass-chrome pointer-events-auto grid h-[3.75rem] w-[3.75rem] shrink-0 place-items-center rounded-full text-label-secondary transition hover:text-label focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-tint/30"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
