"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/presentation/components/ui/button";
import type { DataSpace } from "@/storage/db/schema";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

type MobileNavItem = {
  href: string;
  label: string;
};

export function MobileNav({
  navItems = [],
  currentDataSpace,
  dataSpaces = [],
}: {
  navItems?: MobileNavItem[];
  currentDataSpace?: DataSpace;
  dataSpaces?: DataSpace[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <Button aria-label="Open navigation" variant="ghost" className="px-3" onClick={() => setOpen(true)}>
        <Menu className="h-5 w-5" />
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
          <div className="ml-auto h-full w-[min(88vw,22rem)] border-l border-white/10 bg-[#0b111a] p-5 shadow-2xl">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{currentDataSpace?.display_name ?? "MoonArq"}</p>
                <p className="text-xs text-slate-500">Data command center</p>
              </div>
              <Button aria-label="Close navigation" variant="ghost" className="px-3" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="grid gap-2">
              {currentDataSpace ? (
                <div className="mb-2 grid gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
                  {dataSpaces.map((space) => (
                    <Link
                      key={space.id}
                      href={dashboardPath(space.slug)}
                      onClick={() => setOpen(false)}
                      className={`rounded-md px-3 py-2 text-sm ${space.slug === currentDataSpace.slug ? "bg-cyan-300/10 text-cyan-50" : "text-slate-300"}`}
                    >
                      {space.display_name}
                    </Link>
                  ))}
                </div>
              ) : null}
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-white/10 px-3 py-3 text-sm text-slate-200 transition hover:bg-white/7"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
