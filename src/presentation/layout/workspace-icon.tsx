import { Gauge, Layers, MoonStar } from "lucide-react";
import { cn } from "@/presentation/components/ui/utils";

const WORKSPACES = {
  moonarq: { icon: MoonStar, background: "bg-[linear-gradient(180deg,#7d7aff_0%,#3634a3_100%)]" },
  "auto-lab": { icon: Gauge, background: "bg-[linear-gradient(180deg,#ff9f45_0%,#e0412c_100%)]" },
} as const;

const FALLBACK = { icon: Layers, background: "bg-[linear-gradient(180deg,#48a6ff_0%,#0a6cf0_100%)]" };

export function WorkspaceIcon({ slug, size = "md", className }: { slug?: string; size?: "sm" | "md"; className?: string }) {
  const workspace = (slug && slug in WORKSPACES ? WORKSPACES[slug as keyof typeof WORKSPACES] : null) ?? FALLBACK;
  const Icon = workspace.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.15),0_3px_8px_-3px_rgba(15,23,42,0.45)]",
        size === "sm" ? "h-8 w-8 rounded-[9px]" : "h-10 w-10 rounded-[12px]",
        workspace.background,
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} strokeWidth={2.2} />
    </span>
  );
}
