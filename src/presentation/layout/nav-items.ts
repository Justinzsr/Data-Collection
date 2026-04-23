import {
  Activity,
  BarChart3,
  DatabaseZap,
  Gauge,
  HeartPulse,
  RadioTower,
  Settings,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

export const navItems = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/sources", label: "Sources", icon: DatabaseZap },
  { href: "/dashboard/sources/new", label: "Add Source", icon: Sparkles },
  { href: "/dashboard/sync", label: "Sync Center", icon: RadioTower },
  { href: "/dashboard/events", label: "Events", icon: Activity },
  { href: "/dashboard/content", label: "Content", icon: BarChart3 },
  { href: "/dashboard/commerce", label: "Commerce", icon: ShoppingBag },
  { href: "/dashboard/health", label: "Health", icon: HeartPulse },
  { href: "/settings", label: "Settings", icon: Settings },
];
