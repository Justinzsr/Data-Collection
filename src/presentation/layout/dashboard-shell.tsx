import Link from "next/link";
import { MoonStar } from "lucide-react";
import { navItems } from "@/presentation/layout/nav-items";
import { MobileNav } from "@/presentation/layout/mobile-nav";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1800px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/10 bg-black/15 px-4 py-5 backdrop-blur-xl lg:block">
          <Link href="/dashboard" className="mb-8 flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-200/20 bg-cyan-300/10">
              <MoonStar className="h-5 w-5 text-cyan-100" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">MoonArq</span>
              <span className="block text-xs text-slate-500">Data Collection Base</span>
            </span>
          </Link>
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
            Demo mode is live. Real private metrics require official API credentials, OAuth, webhooks, or tracking snippets.
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-[#070a0f]/78 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Internal command center</p>
              <p className="text-sm text-slate-400">Official APIs, webhooks, cron, manual sync, first-party tracking.</p>
            </div>
            <MobileNav />
          </header>
          <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
