"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Menu, ShieldCheck, X } from "lucide-react";
import { cn } from "@/presentation/components/ui/utils";
import { workspaceTarget } from "@/presentation/layout/data-space-switcher";
import {
  findActiveNavHref,
  getNavGroups,
  getSettingsNavItem,
  type DashboardNavGroup,
  type DashboardNavItem,
} from "@/presentation/layout/nav-items";
import { WorkspaceIcon } from "@/presentation/layout/workspace-icon";
import { ThemeToggle } from "@/presentation/theme/theme-toggle";
import type { DataSpace } from "@/storage/db/schema";

const defaultOpenGroups: Record<DashboardNavGroup["id"], boolean> = {
  command: true,
  manage: true,
  operations: true,
  insights: true,
};

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
        "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[15px] transition focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30",
        active ? "bg-fill-strong font-semibold text-label" : "font-medium text-label-secondary hover:bg-fill-hover hover:text-label",
      )}
    >
      <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-tint" : "text-muted")} aria-hidden="true" />
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

  const drawer = open ? (
    <div className="fixed inset-0 z-[70] lg:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Dismiss navigation"
        className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]"
        onClick={closeNavigation}
      />
      <div
        id="mobile-dashboard-navigation"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-navigation-title"
        tabIndex={-1}
        className="glass-chrome absolute inset-y-2 right-2 flex w-[min(88vw,22rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-[28px]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-separator px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <WorkspaceIcon slug={currentDataSpace?.slug ?? "moonarq"} />
            <div className="min-w-0">
              <p id="mobile-navigation-title" className="truncate text-[15px] font-semibold tracking-[-0.015em] text-label">
                {currentDataSpace?.display_name ?? "MoonArq"}
              </p>
              <p className="truncate text-xs text-muted">Data command center</p>
            </div>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            aria-label="Close navigation"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fill-strong text-label-secondary transition hover:text-label focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
            onClick={closeNavigation}
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {currentDataSpace && dataSpaces.length > 0 ? (
            <section className="mb-3 rounded-2xl bg-fill p-1.5" aria-labelledby="mobile-workspace-switcher-label">
              <button
                id="mobile-workspace-switcher-label"
                type="button"
                onClick={() => setWorkspaceOpen((current) => !current)}
                aria-expanded={workspaceOpen}
                aria-controls="mobile-workspace-options"
                className="flex min-h-10 w-full items-center justify-between rounded-xl px-2.5 text-left text-[13px] font-semibold text-label-secondary focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
              >
                Switch workspace
                <ChevronDown className={cn("h-4 w-4 transition-transform", workspaceOpen ? "rotate-0" : "-rotate-90")} />
              </button>
              {workspaceOpen ? (
                <div id="mobile-workspace-options" className="mt-1 grid gap-1">
                  {dataSpaces.map((space) => {
                    const active = space.slug === currentDataSpace.slug;
                    return (
                      <Link
                        key={space.id}
                        href={workspaceTarget(pathname, currentDataSpace.slug, space.slug)}
                        onClick={closeNavigation}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-xl px-2 text-[14px] transition focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30",
                          active ? "bg-glass-selected font-semibold text-label shadow-sm" : "text-label-secondary hover:bg-fill-hover",
                        )}
                      >
                        <WorkspaceIcon slug={space.slug} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{space.display_name}</span>
                        {active ? <Check className="h-4 w-4 shrink-0 text-tint" aria-hidden="true" /> : null}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}

          <nav className="grid gap-3" aria-label="Mobile primary navigation">
            {groups.map((group) => {
              const groupOpen = openGroups[group.id];
              return (
                <section key={group.id} aria-labelledby={`mobile-nav-group-${group.id}`}>
                  <button
                    id={`mobile-nav-group-${group.id}`}
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={groupOpen}
                    aria-controls={`mobile-nav-items-${group.id}`}
                    className="flex min-h-9 w-full items-center justify-between rounded-xl px-3 text-[12px] font-semibold text-muted focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
                  >
                    {group.label}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", groupOpen ? "rotate-0" : "-rotate-90")} />
                  </button>
                  {groupOpen ? (
                    <div id={`mobile-nav-items-${group.id}`} className="mt-0.5 grid gap-0.5">
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

        <div className="shrink-0 border-t border-separator px-3 py-3">
          <MobileNavLink item={settingsNavItem} active={activeHref === settingsNavItem.href} onNavigate={closeNavigation} />
          <div className="mt-2 px-1">
            <ThemeToggle showLabels className="flex w-full" />
          </div>
          <p className="mt-3 flex items-center gap-2 px-3 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-positive" />
            Private, source-scoped data
          </p>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="lg:hidden">
      <button
        type="button"
        ref={triggerRef}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-dashboard-navigation"
        className="grid h-10 w-10 place-items-center rounded-full text-label-secondary transition hover:bg-fill-hover hover:text-label focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>
      {drawer ? createPortal(drawer, document.body) : null}
    </div>
  );
}
