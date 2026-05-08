import type { DataSpace } from "@/storage/db/schema";

export const DATA_SPACE_IDS = {
  moonarq: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  autoLab: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;

export const DEFAULT_DATA_SPACE_SLUG = "moonarq";
export const AUTO_LAB_DATA_SPACE_SLUG = "auto-lab";

export function staticDataSpaces(): DataSpace[] {
  const now = new Date().toISOString();
  return [
    {
      id: DATA_SPACE_IDS.moonarq,
      slug: DEFAULT_DATA_SPACE_SLUG,
      display_name: "MoonArq",
      description: "Existing MoonArq company data space.",
      category: "business",
      icon: "MoonStar",
      is_default: true,
      status: "active",
      metadata: { seeded: true },
      created_at: now,
      updated_at: now,
    },
    {
      id: DATA_SPACE_IDS.autoLab,
      slug: AUTO_LAB_DATA_SPACE_SLUG,
      display_name: "Auto Lab",
      description: "Personal car/content account testing space",
      category: "personal",
      icon: "Gauge",
      is_default: false,
      status: "active",
      metadata: { seeded: true },
      created_at: now,
      updated_at: now,
    },
  ];
}
