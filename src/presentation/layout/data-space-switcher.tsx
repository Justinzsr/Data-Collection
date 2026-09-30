"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { DataSpace } from "@/storage/db/schema";
import { cn } from "@/presentation/components/ui/utils";
import { WorkspaceIcon } from "@/presentation/layout/workspace-icon";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export function workspaceTarget(currentPath: string | undefined, currentSlug: string, nextSlug: string) {
  const fallback = dashboardPath(nextSlug);
  if (!currentPath) return fallback;
  const marker = `/w/${currentSlug}/dashboard`;
  if (!currentPath.startsWith(marker)) return fallback;
  return `/w/${nextSlug}/dashboard${currentPath.slice(marker.length)}`;
}

function categoryLabel(category: string) {
  return `${category.charAt(0).toUpperCase()}${category.slice(1)} workspace`;
}

export function DataSpaceSwitcher({
  current,
  spaces,
  currentPath,
  collapsed = false,
  onRequestExpand,
}: {
  current: DataSpace;
  spaces: DataSpace[];
  currentPath?: string;
  collapsed?: boolean;
  onRequestExpand?: () => void;
}) {
  const pathname = usePathname() ?? currentPath;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onRequestExpand}
        className="grid h-11 w-11 place-items-center rounded-2xl transition hover:bg-fill-hover focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
        aria-label={`Expand sidebar to switch from ${current.display_name}`}
        title={current.display_name}
      >
        <WorkspaceIcon slug={current.slug} size="sm" />
      </button>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative min-w-0 flex-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={menuId}
        className="flex w-full min-w-0 items-center gap-3 rounded-2xl p-1.5 text-left transition hover:bg-fill-hover focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
      >
        <WorkspaceIcon slug={current.slug} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-[-0.015em] text-label">{current.display_name}</span>
          <span className="block truncate text-xs text-muted">{categoryLabel(current.category)}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-label-quaternary" aria-hidden="true" />
      </button>
      {open ? (
        <nav
          id={menuId}
          aria-label="Switch workspace"
          className="glass-chrome absolute left-0 top-[calc(100%+0.5rem)] z-50 w-full min-w-60 rounded-2xl p-1.5"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted" aria-hidden="true">Workspaces</p>
          {spaces.map((space) => {
            const active = space.slug === current.slug;
            return (
              <Link
                key={space.id}
                href={workspaceTarget(pathname, current.slug, space.slug)}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-2 py-2 transition focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30",
                  active ? "bg-fill-strong" : "hover:bg-fill-hover",
                )}
              >
                <WorkspaceIcon slug={space.slug} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-label">{space.display_name}</span>
                  <span className="block truncate text-xs text-muted">{categoryLabel(space.category)}</span>
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-tint" aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
