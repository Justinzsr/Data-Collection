"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, FileText, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import type { DataSpace, SourceStatus, SourceTypeKey } from "@/storage/db/schema";
import { cn } from "@/presentation/components/ui/utils";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { workspaceTarget } from "@/presentation/layout/data-space-switcher";
import { getNavItems } from "@/presentation/layout/nav-items";
import { WorkspaceIcon } from "@/presentation/layout/workspace-icon";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { setThemePreference } from "@/presentation/theme/theme-store";

export const OPEN_COMMAND_PALETTE_EVENT = "moonarq:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

type CommandGroup = "Pages" | "Sources" | "Actions" | "Workspaces";

type CommandItem = {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  href?: string;
  run?: () => void;
};

type SourceSummary = {
  id: string;
  display_name: string;
  source_type_key: SourceTypeKey;
  status: SourceStatus;
};

const GROUP_ORDER: CommandGroup[] = ["Pages", "Sources", "Actions", "Workspaces"];

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function matches(item: CommandItem, query: string) {
  if (!query) return true;
  const haystack = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""} ${item.group}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function isSourceSummary(value: unknown): value is SourceSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.display_name === "string"
    && typeof record.source_type_key === "string"
    && typeof record.status === "string";
}

export function CommandPalette({
  dataSpace,
  dataSpaces = [],
}: {
  dataSpace?: DataSpace;
  dataSpaces?: DataSpace[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const slug = dataSpace?.slug ?? "moonarq";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [sources, setSources] = useState<SourceSummary[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const show = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const apple = /Mac|iPhone|iPad|iPod/u.test(window.navigator.platform || window.navigator.userAgent);
    function onKeyDown(event: KeyboardEvent) {
      const modifier = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (modifier && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setActiveIndex(0);
        setOpen((current) => !current);
      }
    }
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, show);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, show);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [show]);

  useEffect(() => {
    if (!open || sources !== null) return;
    let cancelled = false;
    fetch(`/api/sources?dataSpaceSlug=${encodeURIComponent(slug)}`, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { sources?: unknown } | null) => {
        if (cancelled) return;
        const list = Array.isArray(body?.sources) ? body.sources.filter(isSourceSummary) : [];
        setSources(list.map(({ id, display_name, source_type_key, status }) => ({ id, display_name, source_type_key, status })));
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug, sources]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const pages: CommandItem[] = getNavItems(slug).map((item) => {
      const Icon = item.icon;
      return {
        id: `page:${item.href}`,
        group: "Pages",
        label: item.label,
        keywords: "page go to open",
        href: item.href,
        icon: <Icon className="h-4 w-4 text-muted" aria-hidden="true" />,
      };
    });
    const sourceItems: CommandItem[] = (sources ?? []).map((source) => ({
      id: `source:${source.id}`,
      group: "Sources",
      label: source.display_name,
      hint: humanize(source.status),
      keywords: `${humanize(source.source_type_key)} source connection`,
      href: dashboardPath(slug, `/sources/${source.id}`),
      icon: <PlatformIcon sourceTypeKey={source.source_type_key} size="sm" />,
    }));
    const actions: CommandItem[] = [
      {
        id: "action:add-source",
        group: "Actions",
        label: "Add a source",
        keywords: "new connect platform instagram tiktok shopify supabase website",
        href: dashboardPath(slug, "/sources/new"),
        icon: <Plus className="h-4 w-4 text-muted" aria-hidden="true" />,
      },
      {
        id: "action:daily-report",
        group: "Actions",
        label: "Open daily report",
        keywords: "morning report excel generate",
        href: dashboardPath(slug, "/reports/daily"),
        icon: <FileText className="h-4 w-4 text-muted" aria-hidden="true" />,
      },
      {
        id: "action:theme-light",
        group: "Actions",
        label: "Use light appearance",
        keywords: "theme mode light bright",
        run: () => setThemePreference("light"),
        icon: <Sun className="h-4 w-4 text-muted" aria-hidden="true" />,
      },
      {
        id: "action:theme-dark",
        group: "Actions",
        label: "Use dark appearance",
        keywords: "theme mode dark night",
        run: () => setThemePreference("dark"),
        icon: <Moon className="h-4 w-4 text-muted" aria-hidden="true" />,
      },
      {
        id: "action:theme-system",
        group: "Actions",
        label: "Match system appearance",
        keywords: "theme mode auto automatic system",
        run: () => setThemePreference("system"),
        icon: <Monitor className="h-4 w-4 text-muted" aria-hidden="true" />,
      },
    ];
    const workspaces: CommandItem[] = dataSpaces
      .filter((space) => space.slug !== slug)
      .map((space) => ({
        id: `workspace:${space.slug}`,
        group: "Workspaces",
        label: `Switch to ${space.display_name}`,
        keywords: `workspace data space ${space.category}`,
        href: workspaceTarget(pathname, slug, space.slug),
        icon: <WorkspaceIcon slug={space.slug} size="sm" className="h-7 w-7 rounded-[8px]" />,
      }));
    return [...pages, ...sourceItems, ...actions, ...workspaces];
  }, [dataSpaces, pathname, slug, sources]);

  const filtered = useMemo(() => {
    const visible = items.filter((item) => matches(item, query.trim()));
    return GROUP_ORDER.flatMap((group) => visible.filter((item) => item.group === group));
  }, [items, query]);

  const boundedIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);
  const activeItem = boundedIndex >= 0 ? filtered[boundedIndex] : null;
  const sections = GROUP_ORDER.map((group) => ({
    group,
    entries: filtered.flatMap((item, index) => (item.group === group ? [{ item, index }] : [])),
  })).filter((section) => section.entries.length > 0);

  useEffect(() => {
    if (!open || !activeItem) return;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-command-id="${CSS.escape(activeItem.id)}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [activeItem, open]);

  function close() {
    setOpen(false);
  }

  function runItem(item: CommandItem) {
    close();
    if (item.run) item.run();
    if (item.href) router.push(item.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length > 0) setActiveIndex((boundedIndex + 1) % filtered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length > 0) setActiveIndex((boundedIndex - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeItem) runItem(activeItem);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  }

  if (!open) return null;

  const palette = (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[10vh] sm:pt-[14vh]">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close search"
        className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Search ${dataSpace?.display_name ?? "Data Hub"}`}
        className="glass-chrome relative flex max-h-[min(34rem,80vh)] w-full max-w-[40rem] flex-col overflow-hidden rounded-[28px]"
      >
        <div className="flex items-center gap-3 border-b border-separator px-4">
          <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages, sources, and actions"
            aria-label="Search pages, sources, and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls={filtered.length > 0 ? listId : undefined}
            aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-label outline-hidden placeholder:text-label-quaternary"
          />
          <kbd className="hidden rounded-md bg-fill-strong px-1.5 py-0.5 font-sans text-[11px] font-medium text-label-secondary sm:inline">esc</kbd>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {filtered.length > 0 ? (
            <div id={listId} role="listbox" aria-label="Results">
              {sections.map(({ group, entries }) => (
                <div key={group} role="group" aria-labelledby={`${listId}-group-${group}`}>
                  <p id={`${listId}-group-${group}`} aria-hidden="true" className="px-3 pb-1 pt-3 text-[11.5px] font-semibold text-muted">
                    {group}
                  </p>
                  {entries.map(({ item, index }) => {
                    const active = index === boundedIndex;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-${item.id}`}
                        data-command-id={item.id}
                        role="option"
                        aria-selected={active}
                        onMouseMove={() => {
                          if (!active) setActiveIndex(index);
                        }}
                        onClick={() => runItem(item)}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 py-1.5 text-[14px] transition-colors",
                          active ? "bg-tint text-on-tint" : "text-label",
                        )}
                      >
                        <span className={cn("grid h-7 w-7 shrink-0 place-items-center", active && !item.id.startsWith("source:") && !item.id.startsWith("workspace:") ? "[&_svg]:text-on-tint" : undefined)}>
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                        {item.hint ? (
                          <span className={cn("shrink-0 text-xs capitalize", active ? "text-on-tint/85" : "text-muted")}>{item.hint}</span>
                        ) : null}
                        {active ? <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-3 py-10 text-center text-sm text-muted" role="status">No matches for “{query.trim()}”.</p>
          )}
          {sources === null ? <p className="px-3 py-2 text-xs text-muted" role="status">Loading sources…</p> : null}
        </div>
        <div className="hidden items-center gap-4 border-t border-separator px-4 py-2.5 text-xs text-muted sm:flex">
          <span><kbd className="font-sans font-semibold text-label-secondary">↑↓</kbd> move</span>
          <span><kbd className="font-sans font-semibold text-label-secondary">↵</kbd> open</span>
          <span><kbd className="font-sans font-semibold text-label-secondary">⌘K</kbd> or <kbd className="font-sans font-semibold text-label-secondary">Ctrl K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );

  return createPortal(palette, document.body);
}
