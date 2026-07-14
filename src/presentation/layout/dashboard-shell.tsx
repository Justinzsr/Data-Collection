import type { DataSpace } from "@/storage/db/schema";
import { DesktopSidebar } from "@/presentation/layout/desktop-sidebar";
import { MobileNav } from "@/presentation/layout/mobile-nav";

export function DashboardShell({
  children,
  dataSpace,
  dataSpaces = [],
}: {
  children: React.ReactNode;
  dataSpace?: DataSpace;
  dataSpaces?: DataSpace[];
}) {
  return (
    <div className="relative min-h-screen">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1800px]">
        <DesktopSidebar dataSpace={dataSpace} dataSpaces={dataSpaces} />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-4 border-b border-white/10 bg-[#070a0f]/88 px-4 py-2 backdrop-blur-xl sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-baseline gap-3">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/75">
                {dataSpace?.display_name ?? "MoonArq"} workspace
              </p>
              <p className="hidden truncate text-xs text-slate-500 xl:block">
                Source monitoring, sync health, and official ingestion paths
              </p>
            </div>
            <MobileNav currentDataSpace={dataSpace} dataSpaces={dataSpaces} />
          </header>
          <main className="px-4 py-4 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
