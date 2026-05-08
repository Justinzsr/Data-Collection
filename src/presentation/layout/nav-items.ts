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
} from "lucide-react";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export function getNavItems(dataSpaceSlug = "moonarq") {
  return [
    { href: dashboardPath(dataSpaceSlug), label: "Overview", icon: Gauge },
    { href: dashboardPath(dataSpaceSlug, "/sources"), label: "Sources", icon: DatabaseZap },
    { href: dashboardPath(dataSpaceSlug, "/sources/new"), label: "Add Source", icon: Sparkles },
    { href: dashboardPath(dataSpaceSlug, "/sync"), label: "Sync Center", icon: RadioTower },
    { href: dashboardPath(dataSpaceSlug, "/data"), label: "Data Explorer", icon: TableProperties },
    { href: dashboardPath(dataSpaceSlug, "/reports/daily"), label: "Reports", icon: FileText },
    { href: dashboardPath(dataSpaceSlug, "/events"), label: "Events", icon: Activity },
    { href: dashboardPath(dataSpaceSlug, "/content"), label: "Content", icon: BarChart3 },
    { href: dashboardPath(dataSpaceSlug, "/commerce"), label: "Commerce", icon: ShoppingBag },
    { href: dashboardPath(dataSpaceSlug, "/health"), label: "Health", icon: HeartPulse },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
}

export const navItems = [
  { href: "/w/moonarq/dashboard", label: "Overview", icon: Gauge },
  { href: "/w/moonarq/dashboard/sources", label: "Sources", icon: DatabaseZap },
  { href: "/w/moonarq/dashboard/sources/new", label: "Add Source", icon: Sparkles },
  { href: "/w/moonarq/dashboard/sync", label: "Sync Center", icon: RadioTower },
  { href: "/w/moonarq/dashboard/data", label: "Data Explorer", icon: TableProperties },
  { href: "/w/moonarq/dashboard/reports/daily", label: "Reports", icon: FileText },
  { href: "/w/moonarq/dashboard/events", label: "Events", icon: Activity },
  { href: "/w/moonarq/dashboard/content", label: "Content", icon: BarChart3 },
  { href: "/w/moonarq/dashboard/commerce", label: "Commerce", icon: ShoppingBag },
  { href: "/w/moonarq/dashboard/health", label: "Health", icon: HeartPulse },
  { href: "/settings", label: "Settings", icon: Settings },
];
