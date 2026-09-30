"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/presentation/components/ui/utils";
import {
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from "@/presentation/theme/theme-store";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
];

export function ThemeToggle({ showLabels = false, className }: { showLabels?: boolean; className?: string }) {
  const preference = useThemePreference();

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = OPTIONS.findIndex((option) => option.value === preference);
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    setThemePreference(next.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-option="${next.value}"]`)?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("segmented", className)} onKeyDown={onKeyDown}>
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={showLabels ? undefined : `${option.label} appearance`}
            title={`${option.label} appearance`}
            data-selected={selected}
            data-theme-option={option.value}
            tabIndex={selected ? 0 : -1}
            onClick={() => setThemePreference(option.value)}
            className={cn("segmented-item h-9", showLabels ? "flex-1 px-3" : "w-9 px-0")}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {showLabels ? option.label : null}
          </button>
        );
      })}
    </div>
  );
}
