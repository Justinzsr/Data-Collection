import type { DataSpace } from "@/storage/db/schema";
import { AppToolbar } from "@/presentation/layout/app-toolbar";
import { CommandPalette } from "@/presentation/layout/command-palette";
import { DesktopSidebar } from "@/presentation/layout/desktop-sidebar";
import { MobileTabBar } from "@/presentation/layout/mobile-tab-bar";

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
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1800px]">
        <DesktopSidebar dataSpace={dataSpace} dataSpaces={dataSpaces} />
        <div className="min-w-0 flex-1">
          <AppToolbar dataSpace={dataSpace} dataSpaces={dataSpaces} />
          <main className="px-3 pb-32 pt-4 sm:px-5 lg:px-6 lg:pb-12">{children}</main>
        </div>
      </div>
      <MobileTabBar dataSpaceSlug={dataSpace?.slug ?? "moonarq"} />
      <CommandPalette key={dataSpace?.slug ?? "moonarq"} dataSpace={dataSpace} dataSpaces={dataSpaces} />
    </div>
  );
}
