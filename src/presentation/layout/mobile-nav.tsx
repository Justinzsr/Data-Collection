"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Gauge, Menu, MoonStar, ShieldCheck, X } from "lucide-react";
import { cn } from "@/presentation/components/ui/utils";
import {
  findActiveNavHref,
  getNavGroups,
  getSettingsNavItem,
  type DashboardNavGroup,
  type DashboardNavItem,
} from "@/presentation/layout/nav-items";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import type { DataSpace } from "@/storage/db/schema";

const defaultOpenGroups: Record<DashboardNavGroup["id"], boolean> = {
  command: true,
  manage: true,
  operations: true,
  insights: true,
};

function workspaceTarget(pathname: string, currentSlug: string, nextSlug: string) {
  const marker = `/w/${currentSlug}/dashboard`;
  if (!pathname.startsWith(marker)) return dashboardPath(nextSlug);
  return `/w/${nextSlug}/dashboard${pathname.slice(marker.length)}`;
}

function MobileNavLink({
  item,
  active,
  onNavigate,
}: {
  item: DashboardNavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40",
        active
          ? "border-cyan-200/20 bg-cyan-300/12 text-cyan-50"
          : "border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.05] hover:text-white",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-2 left-0 w-0.5 rounded-full bg-cyan-300", active ? "opacity-100" : "opacity-0")}
      />
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-cyan-200" : "text-slate-500")} />
      {item.label}
    </Link>
  );
}

export function MobileNav({
  currentDataSpace,
  dataSpaces = [],
}: {
  currentDataSpace?: DataSpace;
  dataSpaces?: DataSpace[];
}) {
  const [open, setOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(defaultOpenGroups);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const groups = getNavGroups(currentDataSpace?.slug ?? "moonarq");
  const primaryItems = groups.flatMap((group) => group.items);
  const settingsNavItem = getSettingsNavItem(currentDataSpace?.slug ?? "moonarq");
  const activeHref = findActiveNavHref(pathname, [...primaryItems, settingsNavItem]);
  const WorkspaceIcon = currentDataSpace?.slug === "auto-lab" ? Gauge : MoonStar;

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    function closeAtDesktopBreakpoint(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }
    desktopQuery.addEventListener("change", closeAtDesktopBreakpoint);
    return () => desktopQuery.removeEventListener("change", closeAtDesktopBreakpoint);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        drawerRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      });
    };
  }, [open]);

  function closeNavigation() {
    setOpen(false);
  }

  function toggleGroup(groupId: DashboardNavGroup["id"]) {
    setOpenGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  return (
    <div className="lg:hidden">
      <button
        type="button"
        ref={triggerRef}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-dashboard-navigation"
        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Dismiss navigation"
            className="absolute inset-0 bg-black/72 backdrop-blur-sm"
            onClick={closeNavigation}
          />
          <div
            id="mobile-dashboard-navigation"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
            tabIndex={-1}
            className="relative ml-auto flex h-dvh w-[min(88vw,22rem)] max-w-full flex-col overflow-y-auto overscroll-contain border-l border-white/10 bg-[#090e16] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#090e16]/95 px-5 py-4 backdrop-blur-xl">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-200/20 bg-cyan-300/10">
                  <WorkspaceIcon className="h-5 w-5 text-cyan-100" />
                </span>
                <div className="min-w-0">
                  <p id="mobile-navigation-title" className="truncate text-sm font-semibold text-white">
                    {currentDataSpace?.display_name ?? "MoonArq"}
                  </p>
                  <p className="truncate text-xs text-slate-500">Data command center</p>
                </div>
              </div>
              <button
                type="button"
                ref={closeButtonRef}
                aria-label="Close navigation"
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-transparent px-3 py-2 text-slate-300 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
                onClick={closeNavigation}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 px-4 py-4">
              {currentDataSpace && dataSpaces.length > 0 ? (
                <section className="mb-4 rounded-lg border border-white/10 bg-white/[0.025] p-2" aria-labelledby="mobile-workspace-switcher-label">
                  <button
                    id="mobile-workspace-switcher-label"
                    type="button"
                    onClick={() => setWorkspaceOpen((current) => !current)}
                    aria-expanded={workspaceOpen}
                    aria-controls="mobile-workspace-options"
                    className="flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/35"
                  >
                    Switch workspace
                    <ChevronDown className={cn("h-4 w-4 transition-transform", workspaceOpen ? "rotate-0" : "-rotate-90")} />
                  </button>
                  {workspaceOpen ? (
                    <div id="mobile-workspace-options" className="mt-1 grid gap-1">
                      {dataSpaces.map((space) => (
                        <Link
                          key={space.id}
                          href={workspaceTarget(pathname, currentDataSpace.slug, space.slug)}
                          onClick={closeNavigation}
                          aria-current={space.slug === currentDataSpace.slug ? "page" : undefined}
                          className={cn(
                            "rounded-md px-3 py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-cyan-300/35",
                            space.slug === currentDataSpace.slug ? "bg-cyan-300/10 text-cyan-50" : "text-slate-300 hover:bg-white/[0.05]",
                          )}
                        >
                          {space.display_name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              <nav className="grid gap-3" aria-label="Mobile primary navigation">
                {groups.map((group) => {
                  const groupOpen = openGroups[group.id];
                  const containsActiveItem = group.items.some((item) => item.href === activeHref);
                  return (
                    <section key={group.id} aria-labelledby={`mobile-nav-group-${group.id}`}>
                      <button
                        id={`mobile-nav-group-${group.id}`}
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={groupOpen}
                        aria-controls={`mobile-nav-items-${group.id}`}
                        className={cn(
                          "flex min-h-9 w-full items-center justify-between rounded-md px-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] focus:outline-none focus:ring-2 focus:ring-cyan-300/35",
                          containsActiveItem ? "text-cyan-200/85" : "text-slate-600",
                        )}
                      >
                        {group.label}
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", groupOpen ? "rotate-0" : "-rotate-90")} />
                      </button>
                      {groupOpen ? (
                        <div id={`mobile-nav-items-${group.id}`} className="mt-1 grid gap-1">
                          {group.items.map((item) => (
                            <MobileNavLink key={item.href} item={item} active={activeHref === item.href} onNavigate={closeNavigation} />
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </nav>
            </div>

            <div className="shrink-0 border-t border-white/10 px-4 py-4">
              <MobileNavLink item={settingsNavItem} active={activeHref === settingsNavItem.href} onNavigate={closeNavigation} />
              <p className="mt-3 flex items-center gap-2 px-3 text-xs text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300/70" />
                Private, source-scoped data
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
