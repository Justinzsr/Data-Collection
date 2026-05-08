import Link from "next/link";
import type { DataSpace } from "@/storage/db/schema";
import { getNavItems, navItems as defaultNavItems } from "@/presentation/layout/nav-items";
import { DataSpaceSwitcher } from "@/presentation/layout/data-space-switcher";
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
  const navItems = dataSpace ? getNavItems(dataSpace.slug) : defaultNavItems;
  const mobileNavItems = navItems.map((item) => ({ href: item.href, label: item.label }));
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1800px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/10 bg-black/15 px-4 py-5 backdrop-blur-xl lg:block">
          {dataSpace ? (
            <DataSpaceSwitcher current={dataSpace} spaces={dataSpaces} />
          ) : (
            <Link href="/w/moonarq/dashboard" className="mb-8 flex items-center gap-3 rounded-lg px-2 py-2">
              <span>
                <span className="block text-sm font-semibold text-white">MoonArq</span>
                <span className="block text-xs text-slate-500">Data Command Center</span>
              </span>
            </Link>
          )}
          <nav className="grid gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/7 hover:text-white"
              >
                <item.icon className="h-4 w-4 text-slate-500 transition group-hover:text-cyan-200" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="absolute bottom-5 left-4 right-4 rounded-lg border border-cyan-200/15 bg-cyan-300/8 p-3 text-xs leading-5 text-slate-300">
            Modules in this app are scoped source systems. The app&apos;s own runtime/storage stays separate, and real private metrics still require official credentials, webhooks, drains, or tracking setup.
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-[#070a0f]/78 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">{dataSpace?.display_name ?? "MoonArq"} source monitoring</p>
              <p className="text-sm text-slate-400">Server-scoped data space, sync health, official ingestion paths.</p>
            </div>
            <MobileNav navItems={mobileNavItems} currentDataSpace={dataSpace} dataSpaces={dataSpaces} />
          </header>
          <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
