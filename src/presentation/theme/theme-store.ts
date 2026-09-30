"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/presentation/theme/theme-constants";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();
/** The choice made in this tab; wins over storage so a blocked localStorage still works. */
let sessionPreference: ThemePreference | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function readPreference(): ThemePreference {
  if (sessionPreference) return sessionPreference;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Keep the browser chrome color (theme-color meta) in step with a forced appearance. */
function syncThemeColor(preference: ThemePreference) {
  const canvas = window.getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim();
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (meta.dataset.defaultColor === undefined) meta.dataset.defaultColor = meta.content;
    meta.content = preference === "system" || !canvas ? meta.dataset.defaultColor : canvas;
  }
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  syncThemeColor(preference);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    sessionPreference = null;
    applyPreference(readPreference());
    emit();
  };
  media.addEventListener("change", listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSystemDark() {
  return window.matchMedia(DARK_QUERY).matches;
}

export function setThemePreference(preference: ThemePreference) {
  sessionPreference = preference;
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies to this tab.
  }
  applyPreference(preference);
  emit();
}

/** Re-applies the stored appearance after hydration (the inline script covers first paint). */
export function syncStoredTheme() {
  applyPreference(readPreference());
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => "system");
}

export function useResolvedTheme(): ResolvedTheme {
  const preference = useThemePreference();
  const systemDark = useSyncExternalStore(subscribe, getSystemDark, () => false);
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}
