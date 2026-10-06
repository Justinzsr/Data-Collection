import { describe, expect, it } from "vitest";
import { getDemoPeriod, SAMPLE_DAYS } from "@/presentation/public-preview/demo-data";

describe("public sample metrics", () => {
  it.each([7, 30] as const)("keeps the %i-day channels and funnel consistent with the headline totals", (period) => {
    const sample = getDemoPeriod(period);
    expect(sample.days).toHaveLength(period);
    expect(sample.channels.reduce((sum, channel) => sum + channel.sessions, 0)).toBe(sample.total.sessions);
    expect(sample.total.sessions).toBeGreaterThan(sample.total.carts);
    expect(sample.total.carts).toBeGreaterThan(sample.total.checkouts);
    expect(sample.total.checkouts).toBeGreaterThan(sample.total.orders);
    expect(sample.conversionRate).toBe(sample.total.orders / sample.total.sessions * 100);
    expect(sample.averageOrderValue).toBe(sample.total.revenue / sample.total.orders);
  });

  it("uses the same final seven sample days when changing the period", () => {
    const short = getDemoPeriod(7);
    const long = getDemoPeriod(30);
    expect(short.days).toEqual(long.days.slice(-7));
    expect(short.total.revenue).toBeLessThan(long.total.revenue);
    expect(Object.isFrozen(SAMPLE_DAYS)).toBe(true);
    expect(SAMPLE_DAYS.every(Object.isFrozen)).toBe(true);
  });
});
