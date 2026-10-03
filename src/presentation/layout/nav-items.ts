import {
  Activity,
  BarChart3,
  Camera,
  DatabaseZap,
  FileText,
  Gauge,
  Globe2,
  HeartPulse,
  Megaphone,
  RadioTower,
  Settings,
  ShoppingBag,
  Sparkles,
  TableProperties,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export type DashboardNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type DashboardNavGroup = {
  id: "command" | "platforms" | "manage" | "operations" | "insights";
  label: string;
  items: DashboardNavItem[];
};

/** Platform detail pages. MoonArq has the full set; other spaces hold social accounts only. */
export function getPlatformNavItems(dataSpaceSlug = "moonarq"): DashboardNavItem[] {
  const social: DashboardNavItem[] = [
    { href: dashboardPath(dataSpaceSlug, "/platforms/instagram"), label: "Instagram", icon: Camera },
    { href: dashboardPath(dataSpaceSlug, "/platforms/tiktok"), label: "TikTok", icon: Video },
  ];
  if (dataSpaceSlug !== "moonarq") return social;
  return [
    { href: dashboardPath(dataSpaceSlug, "/platforms/ads"), label: "Meta Ads", icon: Megaphone },
    { href: dashboardPath(dataSpaceSlug, "/platforms/website"), label: "Website", icon: Globe2 },
    { href: dashboardPath(dataSpaceSlug, "/platforms/shopify"), label: "Shopify", icon: ShoppingBag },
    ...social,
    { href: dashboardPath(dataSpaceSlug, "/platforms/supabase"), label: "Supabase", icon: Users },
  ];
}

export function getNavGroups(dataSpaceSlug = "moonarq"): DashboardNavGroup[] {
  return [
    {
      id: "command",
      label: "Command",
      items: [{ href: dashboardPath(dataSpaceSlug), label: "Overview", icon: Gauge }],
    },
    {
      id: "platforms",
      label: "Platforms",
      items: getPlatformNavItems(dataSpaceSlug),
    },
    {
      id: "manage",
      label: "Manage",
      items: [
        { href: dashboardPath(dataSpaceSlug, "/sources"), label: "Sources", icon: DatabaseZap },
        { href: dashboardPath(dataSpaceSlug, "/sources/new"), label: "Add Source", icon: Sparkles },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [
        { href: dashboardPath(dataSpaceSlug, "/sync"), label: "Sync Center", icon: RadioTower },
        { href: dashboardPath(dataSpaceSlug, "/health"), label: "Health", icon: HeartPulse },
        { href: dashboardPath(dataSpaceSlug, "/data"), label: "Data Explorer", icon: TableProperties },
        { href: dashboardPath(dataSpaceSlug, "/reports/daily"), label: "Reports", icon: FileText },
      ],
    },
    {
      id: "insights",
      label: "Insights",
      items: [
        { href: dashboardPath(dataSpaceSlug, "/events"), label: "Events", icon: Activity },
        { href: dashboardPath(dataSpaceSlug, "/content"), label: "Content", icon: BarChart3 },
      ],
    },
  ];
}

export function getSettingsNavItem(dataSpaceSlug = "moonarq"): DashboardNavItem {
  return {
    href: dashboardPath(dataSpaceSlug, "/settings"),
    label: "Settings",
    icon: Settings,
  };
}

export const settingsNavItem = getSettingsNavItem("moonarq");

export function getNavItems(dataSpaceSlug = "moonarq") {
  return [...getNavGroups(dataSpaceSlug).flatMap((group) => group.items), getSettingsNavItem(dataSpaceSlug)];
}

export function findActiveNavHref(pathname: string, items: DashboardNavItem[]) {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

export const navItems = getNavItems("moonarq");

const pageLabelOverrides: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\/sources\/new(?:\/|$)/u, label: "Add Source" },
  { pattern: /\/sources\/[^/]+$/u, label: "Source detail" },
  { pattern: /\/supabase\/email-marketing(?:\/|$)/u, label: "Email Marketing" },
];

/** Human label for the current dashboard page, used by the toolbar breadcrumb. */
export function getPageLabel(pathname: string, dataSpaceSlug = "moonarq") {
  for (const override of pageLabelOverrides) {
    if (override.pattern.test(pathname)) return override.label;
  }
  const items = getNavItems(dataSpaceSlug);
  const activeHref = findActiveNavHref(pathname, items);
  return items.find((item) => item.href === activeHref)?.label ?? "Overview";
}

/** Primary destinations for the floating mobile tab bar. */
export function getMobileTabItems(dataSpaceSlug = "moonarq"): DashboardNavItem[] {
  return [
    { href: dashboardPath(dataSpaceSlug), label: "Overview", icon: Gauge },
    { href: dashboardPath(dataSpaceSlug, "/sources"), label: "Sources", icon: DatabaseZap },
    { href: dashboardPath(dataSpaceSlug, "/sync"), label: "Sync", icon: RadioTower },
    { href: dashboardPath(dataSpaceSlug, "/data"), label: "Data", icon: TableProperties },
  ];
}
