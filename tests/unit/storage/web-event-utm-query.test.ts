import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRowsMock } = vi.hoisted(() => ({ queryRowsMock: vi.fn() }));

vi.mock("@/storage/db/client", () => ({
  isRuntimeDatabaseConfigured: () => true,
  queryRows: queryRowsMock,
}));

import { countWebPageViewsByUtm } from "@/storage/repositories/events-repository";

const expectedUtm = {
  source: "instagram",
  medium: "paid_social",
  campaign: "bracelet_grid_jul2026",
  content: "story_v1",
};

describe("database web-event UTM query", () => {
  beforeEach(() => {
    queryRowsMock.mockReset();
    queryRowsMock.mockResolvedValue([{
      page_views: 0,
      visitors: 0,
      eligible_return_devices_1d: 0,
      returning_devices_1d: 0,
      eligible_return_devices_7d: 0,
      returning_devices_7d: 0,
    }]);
  });

  it("matches normalized v1 attribution_context before legacy evidence", async () => {
    await countWebPageViewsByUtm({
      sourceId: "11111111-1111-4111-8111-111111111111",
      startOccurredAt: "2026-07-01T07:00:00.000Z",
      endOccurredAt: "2026-07-18T06:59:59.999Z",
      utm: expectedUtm,
    });

    expect(queryRowsMock).toHaveBeenCalledTimes(1);
    const sql = String(queryRowsMock.mock.calls[0]?.[0]);
    expect(sql.match(/event_source = 'first_party_tracker'/gu)).toHaveLength(2);
    expect(sql).toContain("e.attribution_context #>> '{utm,source}'");
    expect(sql).toContain("e.attribution_context #>> '{utm,utm_source}'");
    expect(sql).toContain("e.properties #>> '{attribution,utm,source}'");
    expect(sql).toContain("substring(coalesce(e.url, '')");
    expect(sql.indexOf("e.attribution_context")).toBeLessThan(sql.indexOf("e.properties #>> '{attribution"));
  });
});
