import { Gauge, Layers, MoonStar } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/presentation/components/ui/utils";

const WORKSPACES = {
  moonarq: { icon: MoonStar, fill: "var(--icon-indigo)" },
  "auto-lab": { icon: Gauge, fill: "var(--icon-orange)" },
} as const;

const FALLBACK = { icon: Layers, fill: "var(--icon-blue)" };

export function WorkspaceIcon({ slug, size = "md", className }: { slug?: string; size?: "sm" | "md"; className?: string }) {
  const workspace = (slug && slug in WORKSPACES ? WORKSPACES[slug as keyof typeof WORKSPACES] : null) ?? FALLBACK;
  const Icon = workspace.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "app-icon grid shrink-0 place-items-center",
        size === "sm" ? "h-8 w-8 rounded-[9px]" : "h-10 w-10 rounded-[12px]",
        className,
      )}
      style={{ "--icon-fill": workspace.fill } as CSSProperties}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} strokeWidth={2.2} />
    </span>
  );
}
