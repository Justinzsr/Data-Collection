import { describe, expect, it } from "vitest";
import { buildIndexedTrendData } from "@/presentation/charts/platform-trend-chart";

describe("platform trend chart data", () => {
  it("aligns sparse series by date and leaves unmeasured dates empty instead of inserting zeroes", () => {
    const result = buildIndexedTrendData([
      {
        key: "website",
        label: "Website",
        color: "#38bdf8",
        data: [
          { date: "2026-07-10", value: 10 },
          { date: "2026-07-11", value: 12 },
          { date: "2026-07-12", value: 15 },
        ],
      },
      {
        key: "tiktok",
        label: "TikTok",
        color: "#fb7185",
        data: [
          { date: "2026-07-11", value: 200 },
          { date: "2026-07-12", value: 220 },
        ],
      },
    ]);

    expect(result.chartData.slice(0, 2)).toEqual([
      { date: "07-10", website: 100, tiktok: null },
      { date: "07-11", website: 120, tiktok: 100 },
    ]);
    expect(result.chartData[2]).toMatchObject({ date: "07-12", website: 150 });
    expect(result.chartData[2].tiktok).toBeCloseTo(110);
  });
});
