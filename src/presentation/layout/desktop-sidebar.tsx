"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, MoonStar, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import type { DataSpace } from "@/storage/db/schema";
import { cn } from "@/presentation/components/ui/utils";
import { DataSpaceSwitcher } from "@/presentation/layout/data-space-switcher";
import {
  findActiveNavHref,
  getNavGroups,
  getSettingsNavItem,
  type DashboardNavGroup,
  type DashboardNavItem,
} from "@/presentation/layout/nav-items";

const defaultOpenGroups: Record<DashboardNavGroup["id"], boolean> = {
  command: true,
  manage: true,
  operations: true,
  insights: true,
};

function SidebarLink({
  item,
  active,
  collapsed,
}: {
  item: DashboardNavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex min-h-10 items-center rounded-lg text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40",
        collapsed ? "justify-center px-2" : "gap-3 px-3",
        active
          ? "bg-cyan-300/12 text-cyan-50 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.12)]"
          : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-2 left-0 w-0.5 rounded-full bg-cyan-300 transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon className={cn("h-4 w-4 shrink-0 transition", active ? "text-cyan-200" : "text-slate-500 group-hover:text-slate-300")} />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function DesktopSidebar({
  dataSpace,
  dataSpaces = [],
}: {
  dataSpace?: DataSpace;
  dataSpaces?: DataSpace[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState(defaultOpenGroups);
  const groups = getNavGroups(dataSpace?.slug ?? "moonarq");
  const primaryItems = groups.flatMap((group) => group.items);
  const settingsNavItem = getSettingsNavItem(dataSpace?.slug ?? "moonarq");
  const activeHref = findActiveNavHref(pathname, [...primaryItems, settingsNavItem]);

  function toggleGroup(groupId: DashboardNavGroup["id"]) {
    setOpenGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  return (
    <aside
      className={cn(
        "sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-white/10 bg-[#080c13]/95 transition-[width] duration-200 motion-reduce:transition-none lg:flex",
        collapsed ? "w-[4.5rem]" : "w-[16.5rem]",
      )}
      aria-label="Dashboard sidebar"
    >
      <div className={cn("relative z-40 flex shrink-0 gap-2 border-b border-white/[0.08] p-3", collapsed ? "flex-col items-center" : "items-center")}>
        {dataSpace ? (
          <DataSpaceSwitcher
            current={dataSpace}
            spaces={dataSpaces}
            collapsed={collapsed}
            onRequestExpand={() => setCollapsed(false)}
          />
        ) : (
          <Link
            href="/w/moonarq/dashboard"
            className={cn(
              "flex min-w-0 items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-300/40",
              collapsed ? "h-10 w-10 justify-center border border-cyan-200/20 bg-cyan-300/10" : "flex-1 gap-3 px-2 py-2",
            )}
            aria-label={collapsed ? "MoonArq Data Command Center" : undefined}
            title={collapsed ? "MoonArq Data Command Center" : undefined}
          >
            <MoonStar className="h-5 w-5 shrink-0 text-cyan-100" />
            {collapsed ? null : (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">MoonArq</span>
                <span className="block truncate text-xs text-slate-500">Data Command Center</span>
              </span>
            )}
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3" aria-label="Primary navigation">
        {collapsed ? (
          <div className="grid gap-1">
            {primaryItems.map((item) => (
              <SidebarLink key={item.href} item={item} active={activeHref === item.href} collapsed />
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {groups.map((group) => {
              const open = openGroups[group.id];
              const containsActiveItem = group.items.some((item) => item.href === activeHref);
              return (
                <section key={group.id} aria-labelledby={`sidebar-group-${group.id}`}>
                  <button
                    id={`sidebar-group-${group.id}`}
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] transition focus:outline-none focus:ring-2 focus:ring-cyan-300/35",
                      containsActiveItem ? "text-cyan-200/85" : "text-slate-600 hover:text-slate-400",
                    )}
                    aria-expanded={open}
                    aria-controls={`sidebar-group-items-${group.id}`}
                  >
                    {group.label}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open ? "rotate-0" : "-rotate-90")} />
                  </button>
                  {open ? (
                    <div id={`sidebar-group-items-${group.id}`} className="mt-1 grid gap-1">
                      {group.items.map((item) => (
                        <SidebarLink key={item.href} item={item} active={activeHref === item.href} collapsed={false} />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-white/[0.08] p-3">
        {collapsed ? null : (
          <div className="mb-2 flex items-center gap-2 px-3 text-xs leading-5 text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300/70" />
            Private, source-scoped data
          </div>
        )}
        <SidebarLink item={settingsNavItem} active={activeHref === settingsNavItem.href} collapsed={collapsed} />
      </div>
    </aside>
  );
}
