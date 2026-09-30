import {
  BookOpen,
  Braces,
  Camera,
  DatabaseZap,
  FileSpreadsheet,
  Globe2,
  Megaphone,
  Orbit,
  Rocket,
  ShoppingBag,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/presentation/components/ui/utils";

type PlatformStyle = { icon: LucideIcon; background: string; glyph?: string };

/*
 * App-icon style tiles: a colored squircle with a white glyph, like the icons in
 * Apple's Settings. Colors evoke each platform without reproducing brand marks.
 */
const PLATFORM_STYLES: Record<string, PlatformStyle> = {
  website: { icon: Globe2, background: "bg-[linear-gradient(180deg,#48a6ff_0%,#0a6cf0_100%)]" },
  vercel_web_analytics_drain: { icon: Orbit, background: "bg-[linear-gradient(180deg,#4a4a50_0%,#141417_100%)]" },
  vercel_project: { icon: Rocket, background: "bg-[linear-gradient(180deg,#4a4a50_0%,#141417_100%)]" },
  supabase: { icon: DatabaseZap, background: "bg-[linear-gradient(180deg,#4fdc9d_0%,#1c9a60_100%)]" },
  shopify: { icon: ShoppingBag, background: "bg-[linear-gradient(180deg,#a6cf55_0%,#5b8c2f_100%)]" },
  tiktok: { icon: Video, background: "bg-[linear-gradient(180deg,#3a3a40_0%,#0c0c0e_100%)]", glyph: "[filter:drop-shadow(1.2px_0_0_#fe2c55)_drop-shadow(-1.2px_0_0_#25f4ee)]" },
  instagram: { icon: Camera, background: "bg-[linear-gradient(40deg,#f9b233_0%,#ee2a7b_48%,#6a2fd6_100%)]" },
  meta_ads: { icon: Megaphone, background: "bg-[linear-gradient(180deg,#4d9dff_0%,#1662d8_100%)]" },
  xiaohongshu: { icon: BookOpen, background: "bg-[linear-gradient(180deg,#ff5a6a_0%,#e0243a_100%)]" },
  custom_api: { icon: Braces, background: "bg-[linear-gradient(180deg,#9e9ea6_0%,#5f5f66_100%)]" },
  custom_csv: { icon: FileSpreadsheet, background: "bg-[linear-gradient(180deg,#47d16c_0%,#1f8a3d_100%)]" },
};

const FALLBACK: PlatformStyle = { icon: DatabaseZap, background: "bg-[linear-gradient(180deg,#9e9ea6_0%,#5f5f66_100%)]" };

const sizes = {
  sm: { tile: "h-7 w-7 rounded-[8px]", glyph: "h-3.5 w-3.5" },
  md: { tile: "h-9 w-9 rounded-[10px]", glyph: "h-[18px] w-[18px]" },
  lg: { tile: "h-11 w-11 rounded-[12px]", glyph: "h-[22px] w-[22px]" },
} as const;

export function platformIconFor(sourceTypeKey: string) {
  return (PLATFORM_STYLES[sourceTypeKey] ?? FALLBACK).icon;
}

export function PlatformIcon({
  sourceTypeKey,
  size = "md",
  className,
}: {
  sourceTypeKey: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const style = PLATFORM_STYLES[sourceTypeKey] ?? FALLBACK;
  const Icon = style.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.12),0_2px_6px_-2px_rgba(15,23,42,0.35)]",
        sizes[size].tile,
        style.background,
        className,
      )}
    >
      <Icon className={cn(sizes[size].glyph, style.glyph)} strokeWidth={2.2} />
    </span>
  );
}

/** Generic tinted icon tile for non-platform concepts (reports, health, etc.). */
export function IconTile({
  icon: Icon,
  tone = "tint",
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone?: "tint" | "positive" | "warning" | "negative" | "indigo" | "pink" | "teal" | "neutral";
  size?: keyof typeof sizes;
  className?: string;
}) {
  const tones = {
    tint: "bg-[linear-gradient(180deg,#48a6ff_0%,#0a6cf0_100%)]",
    positive: "bg-[linear-gradient(180deg,#4cd964_0%,#248a3d_100%)]",
    warning: "bg-[linear-gradient(180deg,#ffb340_0%,#e07b00_100%)]",
    negative: "bg-[linear-gradient(180deg,#ff6a61_0%,#d70015_100%)]",
    indigo: "bg-[linear-gradient(180deg,#7d7aff_0%,#3634a3_100%)]",
    pink: "bg-[linear-gradient(180deg,#ff6482_0%,#d30f45_100%)]",
    teal: "bg-[linear-gradient(180deg,#5de6ff_0%,#0071a4_100%)]",
    neutral: "bg-[linear-gradient(180deg,#9e9ea6_0%,#5f5f66_100%)]",
  } as const;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.12),0_2px_6px_-2px_rgba(15,23,42,0.35)]",
        sizes[size].tile,
        tones[tone],
        className,
      )}
    >
      <Icon className={sizes[size].glyph} strokeWidth={2.2} />
    </span>
  );
}
