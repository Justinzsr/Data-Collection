import { describe, expect, it } from "vitest";
import {
  dateKeyInAppTimeZone,
  endOfAppDateUtc,
  formatAppDateTime,
  getAppDateRange,
  normalizeDateOnlyKey,
  startOfAppDateUtc,
} from "@/storage/runtime/app-time";

describe("app time helpers", () => {
  it("uses the America/Los_Angeles calendar day for date keys", () => {
    expect(dateKeyInAppTimeZone("2026-04-27T06:30:00.000Z")).toBe("2026-04-26");
    expect(dateKeyInAppTimeZone("2026-04-27T08:30:00.000Z")).toBe("2026-04-27");
  });

  it("builds dashboard date ranges from the Pacific calendar day", () => {
    expect(getAppDateRange("today", "2026-04-27T06:30:00.000Z")).toEqual({
      startDate: "2026-04-26",
      endDate: "2026-04-26",
    });
    expect(getAppDateRange("7d", "2026-04-27T06:30:00.000Z")).toEqual({
      startDate: "2026-04-20",
      endDate: "2026-04-26",
    });
  });

  it("converts Pacific business date boundaries back to UTC instants", () => {
    expect(startOfAppDateUtc("2026-04-26")).toBe("2026-04-26T07:00:00.000Z");
    expect(endOfAppDateUtc("2026-04-26")).toBe("2026-04-27T06:59:59.999Z");
  });

  it("formats user-facing timestamps with a Pacific time-zone label", () => {
    expect(formatAppDateTime("2026-04-27T06:37:00.000Z")).toMatch(/Apr 26.*11:37.*P[SD]T/);
  });

  it("normalizes database date-only values without producing browser-hostile dates", () => {
    expect(normalizeDateOnlyKey("2026-04-28T00:00:00.000Z", "2026-04-27")).toBe("2026-04-28");
    expect(normalizeDateOnlyKey(new Date("2026-04-28T00:00:00.000Z"), "2026-04-27")).toBe("2026-04-28");
    expect(normalizeDateOnlyKey("Tue Apr 28", "2026-04-27")).toBe("2026-04-27");
  });
});
