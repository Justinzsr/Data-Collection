import {
  Activity,
  BarChart3,
  DatabaseZap,
  FileText,
  Gauge,
  HeartPulse,
  RadioTower,
  Settings,
  ShoppingBag,
  Sparkles,
  TableProperties,
  type LucideIcon,
} from "lucide-react";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export type DashboardNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type DashboardNavGroup = {
  id: "command" | "manage" | "operations" | "insights";
  label: string;
  items: DashboardNavItem[];
};

export function getNavGroups(dataSpaceSlug = "moonarq"): DashboardNavGroup[] {
  return [
    {
      id: "command",
      label: "Command",
      items: [{ href: dashboardPath(dataSpaceSlug), label: "Overview", icon: Gauge }],
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
        { href: dashboardPath(dataSpaceSlug, "/commerce"), label: "Commerce", icon: ShoppingBag },
        { href: dashboardPath(dataSpaceSlug, "/health"), label: "Health", icon: HeartPulse },
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
