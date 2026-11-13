import { beforeEach, expect, it, vi } from "vitest";
import WebsitePlatformPage from "@/app/w/[dataSpaceSlug]/dashboard/platforms/website/page";
import { getChatgptAdsFunnelSnapshot } from "@/aggregation/services/chatgpt-ads-funnel-service";
import { getWebsiteFunnelOverview } from "@/aggregation/services/website-funnel-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

vi.mock("@/aggregation/services/chatgpt-ads-funnel-service", () => ({ getChatgptAdsFunnelSnapshot: vi.fn() }));
vi.mock("@/aggregation/services/website-funnel-service", () => ({ getWebsiteFunnelOverview: vi.fn() }));
vi.mock("@/storage/repositories/data-spaces-repository", () => ({ getDataSpaceBySlug: vi.fn() }));
vi.mock("@/storage/repositories/sources-repository", () => ({ listSources: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  const store = getDemoStore();
  vi.mocked(getDataSpaceBySlug).mockResolvedValue(store.dataSpaces.find((space) => space.slug === "moonarq")!);
  vi.mocked(listSources).mockResolvedValue([{ ...store.sources[0], source_type_key: "chatgpt_ads", status: "healthy" }]);
  vi.mocked(getWebsiteFunnelOverview).mockResolvedValue(createWebsiteFunnelOverview());
});

it("returns the storefront page without waiting for the optional Ads report", async () => {
  vi.mocked(getChatgptAdsFunnelSnapshot).mockReturnValue(new Promise(() => {}));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = await Promise.race([
      WebsitePlatformPage({ params: Promise.resolve({ dataSpaceSlug: "moonarq" }) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Storefront rendering waited for the Ads report.")), 1_000); }),
    ]);
    expect(page).toBeDefined();
    expect(getWebsiteFunnelOverview).toHaveBeenCalledTimes(1);
    expect(getChatgptAdsFunnelSnapshot).not.toHaveBeenCalled();
  } finally {
    clearTimeout(timer);
  }
});
