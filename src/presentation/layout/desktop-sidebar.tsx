"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
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
import { WorkspaceIcon } from "@/presentation/layout/workspace-icon";

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
        "group relative flex h-9 items-center rounded-[11px] text-[13.5px] transition duration-150 focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30",
        collapsed ? "mx-auto w-11 justify-center" : "gap-3 px-3",
        active
          ? "bg-fill-strong font-semibold text-label shadow-[inset_0_1px_0_var(--glass-rim)]"
          : "font-medium text-label-secondary hover:bg-fill-hover hover:text-label",
      )}
    >
      <Icon
        className={cn("h-[17px] w-[17px] shrink-0 transition", active ? "text-tint" : "text-muted group-hover:text-label-secondary")}
        strokeWidth={active ? 2.3 : 2}
        aria-hidden="true"
      />
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
        "sticky top-0 z-30 hidden h-dvh shrink-0 py-3 pl-3 transition-[width] duration-300 ease-out motion-reduce:transition-none lg:block",
        collapsed ? "w-[5.25rem]" : "w-[17.25rem]",
      )}
      aria-label="Dashboard sidebar"
    >
      <div className="glass-chrome flex h-full flex-col rounded-[26px]">
        <div className={cn("relative z-40 flex shrink-0 gap-1.5 p-2.5", collapsed ? "flex-col items-center" : "items-center")}>
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
                "flex min-w-0 items-center rounded-2xl transition hover:bg-fill-hover focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30",
                collapsed ? "h-11 w-11 justify-center" : "flex-1 gap-3 p-1.5",
              )}
              aria-label={collapsed ? "MoonArq Data Command Center" : undefined}
              title={collapsed ? "MoonArq Data Command Center" : undefined}
            >
              <WorkspaceIcon slug="moonarq" size={collapsed ? "sm" : "md"} />
              {collapsed ? null : (
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold tracking-[-0.015em] text-label">MoonArq</span>
                  <span className="block truncate text-xs text-muted">Data Command Center</span>
                </span>
              )}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-fill-hover hover:text-label focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-[17px] w-[17px]" /> : <PanelLeftClose className="h-[17px] w-[17px]" />}
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2.5 pb-3" aria-label="Primary navigation">
          {collapsed ? (
            <div className="grid gap-1 pt-1">
              {primaryItems.map((item) => (
                <SidebarLink key={item.href} item={item} active={activeHref === item.href} collapsed />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 pt-1">
              {groups.map((group) => {
                const open = openGroups[group.id];
                return (
                  <section key={group.id} aria-labelledby={`sidebar-group-${group.id}`}>
                    {group.id === "command" ? (
                      <h2 id={`sidebar-group-${group.id}`} className="sr-only">{group.label}</h2>
                    ) : (
                      <button
                        id={`sidebar-group-${group.id}`}
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="group/header mb-1 flex h-7 w-full items-center justify-between rounded-lg px-3 text-[11.5px] font-semibold text-muted transition hover:text-label-secondary focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
                        aria-expanded={open}
                        aria-controls={`sidebar-group-items-${group.id}`}
                      >
                        {group.label}
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 opacity-0 transition group-hover/header:opacity-100 group-focus-visible/header:opacity-100",
                            open ? "rotate-90" : "rotate-0 opacity-100",
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                    {open ? (
                      <div id={`sidebar-group-items-${group.id}`} className="grid gap-0.5">
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

        <div className="shrink-0 border-t border-separator p-2.5">
          <SidebarLink item={settingsNavItem} active={activeHref === settingsNavItem.href} collapsed={collapsed} />
          {collapsed ? null : (
            <p className="mt-1.5 flex items-center gap-2 px-3 text-xs leading-5 text-muted">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-positive" aria-hidden="true" />
              Private, source-scoped data
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
