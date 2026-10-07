import {
  BookOpen,
  Braces,
  Camera,
  ChartColumn,
  DatabaseZap,
  FileSpreadsheet,
  Gavel,
  Globe2,
  Megaphone,
  Orbit,
  Rocket,
  ShoppingBag,
  Store,
  ThumbsUp,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/presentation/components/ui/utils";

type PlatformStyle = { icon: LucideIcon; fill: string; glyph?: string };

/*
 * App-icon style tiles: a colored squircle with a white glyph, like the icons in
 * Apple's Settings. Colors evoke each platform without reproducing brand marks;
 * the gradients live in the --icon-* tokens in globals.css.
 */
const PLATFORM_STYLES: Record<string, PlatformStyle> = {
  website: { icon: Globe2, fill: "var(--icon-blue)" },
  vercel_web_analytics_drain: { icon: Orbit, fill: "var(--icon-graphite)" },
  vercel_project: { icon: Rocket, fill: "var(--icon-graphite)" },
  supabase: { icon: DatabaseZap, fill: "var(--icon-mint)" },
  shopify: { icon: ShoppingBag, fill: "var(--icon-lime)" },
  tiktok: { icon: Video, fill: "var(--icon-black)", glyph: "[filter:drop-shadow(1.2px_0_0_var(--icon-glyph-split-a))_drop-shadow(-1.2px_0_0_var(--icon-glyph-split-b))]" },
  instagram: { icon: Camera, fill: "var(--icon-sunset)" },
  meta_ads: { icon: Megaphone, fill: "var(--icon-azure)" },
  xiaohongshu: { icon: BookOpen, fill: "var(--icon-red)" },
  facebook_page: { icon: ThumbsUp, fill: "var(--icon-azure)" },
  etsy: { icon: Store, fill: "var(--icon-orange)" },
  whatnot: { icon: Gavel, fill: "var(--icon-gold)", glyph: "text-[var(--icon-glyph-ink)]" },
  google_analytics: { icon: ChartColumn, fill: "var(--icon-warning)" },
  custom_api: { icon: Braces, fill: "var(--icon-gray)" },
  custom_csv: { icon: FileSpreadsheet, fill: "var(--icon-green)" },
};

const FALLBACK: PlatformStyle = { icon: DatabaseZap, fill: "var(--icon-gray)" };

const sizes = {
  sm: { tile: "h-7 w-7 rounded-[8px]", glyph: "h-3.5 w-3.5" },
  md: { tile: "h-9 w-9 rounded-[10px]", glyph: "h-[18px] w-[18px]" },
  lg: { tile: "h-11 w-11 rounded-[12px]", glyph: "h-[22px] w-[22px]" },
} as const;

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
      className={cn("app-icon relative grid shrink-0 place-items-center", sizes[size].tile, className)}
      style={{ "--icon-fill": style.fill } as CSSProperties}
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
    tint: "var(--icon-blue)",
    positive: "var(--icon-positive)",
    warning: "var(--icon-warning)",
    negative: "var(--icon-negative)",
    indigo: "var(--icon-indigo)",
    pink: "var(--icon-pink)",
    teal: "var(--icon-teal)",
    neutral: "var(--icon-gray)",
  } as const;
  return (
    <span
      aria-hidden="true"
      className={cn("app-icon relative grid shrink-0 place-items-center", sizes[size].tile, className)}
      style={{ "--icon-fill": tones[tone] } as CSSProperties}
    >
      <Icon className={sizes[size].glyph} strokeWidth={2.2} />
    </span>
  );
}
