import { beforeEach, describe, expect, it } from "vitest";
import { calculateDelta, getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { resetDemoStore } from "@/storage/repositories/demo-store";

describe("platform modules service", () => {
  beforeEach(() => resetDemoStore());

  it("returns normalized platform modules in product order", async () => {
    const modules = await getPlatformModules("30d");
    expect(modules.map((module) => module.platformLabel)).toEqual([
      "MoonArq Website / Vercel",
      "MoonArq Supabase",
      "MoonArq TikTok",
      "MoonArq Instagram",
      "MoonArq Commerce",
      "MoonArq Custom API",
      "MoonArq Custom CSV",
    ]);
    expect(modules.find((module) => module.sourceTypeKey === "website")?.primaryMetric.key).toBe("unique_visitors");
    expect(modules.find((module) => module.sourceTypeKey === "supabase")?.primaryMetric.key).toBe("signups");
    expect(modules.find((module) => module.sourceTypeKey === "shopify")?.status).toBe("disabled");
    expect(modules.find((module) => module.sourceTypeKey === "website")?.sourceModeLabel).toBe("Demo");
  });

  it("computes delta vs previous period", () => {
    expect(calculateDelta(150, 100)).toBe(50);
    expect(calculateDelta(0, 0)).toBe(0);
    expect(calculateDelta(10, 0)).toBeNull();
  });

  it("marks setup state for missing credentials and future modules", async () => {
    const modules = await getPlatformModules("30d");
    const supabase = modules.find((module) => module.sourceTypeKey === "supabase");
    const customApi = modules.find((module) => module.sourceTypeKey === "custom_api");
    expect(supabase?.setupState.severity).toBe("warning");
    expect(customApi?.setupState.label).toBe("Future");
  });
});
