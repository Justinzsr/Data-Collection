import { describe, expect, it } from "vitest";
import {
  dateKeyInAppTimeZone,
  endExclusiveOfAppDateUtc,
  endOfAppDateUtc,
  formatAppDateTime,
  getAppDateRange,
  getComparableAppDateRangesUtc,
  getHalfOpenAppDateRangeUtc,
  normalizeDateOnlyKey,
  sameAppWallClockOnDateUtc,
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

  it("uses half-open bounds across the spring and fall DST transitions", () => {
    expect(getHalfOpenAppDateRangeUtc({
      startDate: "2026-03-08",
      endDate: "2026-03-08",
    })).toEqual({
      startInclusive: "2026-03-08T08:00:00.000Z",
      endExclusive: "2026-03-09T07:00:00.000Z",
    });
    expect(endExclusiveOfAppDateUtc("2026-11-01")).toBe("2026-11-02T08:00:00.000Z");
    expect(getHalfOpenAppDateRangeUtc({
      startDate: "2026-11-01",
      endDate: "2026-11-01",
    })).toEqual({
      startInclusive: "2026-11-01T07:00:00.000Z",
      endExclusive: "2026-11-02T08:00:00.000Z",
    });
  });

  it("maps the same Pacific wall clock and handles repeated or missing DST times explicitly", () => {
    expect(sameAppWallClockOnDateUtc(
      "2026-11-01",
      "2026-11-08T09:30:00.000Z",
    )).toBe("2026-11-01T09:30:00.000Z");
    expect(sameAppWallClockOnDateUtc(
      "2026-11-01",
      "2026-10-25T08:30:00.000Z",
    )).toBe("2026-11-01T08:30:00.000Z");
    expect(sameAppWallClockOnDateUtc(
      "2026-03-08",
      "2026-03-15T09:30:00.000Z",
    )).toBeNull();
  });

  it("uses equal elapsed durations for a partial spring-forward day", () => {
    expect(getComparableAppDateRangesUtc(
      { startDate: "2026-03-08", endDate: "2026-03-08" },
      "2026-03-08T10:30:00.000Z",
    )).toEqual({
      current: {
        startInclusive: "2026-03-08T08:00:00.000Z",
        endExclusive: "2026-03-08T10:30:00.000Z",
      },
      previous: {
        startInclusive: "2026-03-07T08:00:00.000Z",
        endExclusive: "2026-03-07T10:30:00.000Z",
      },
      previousDateRange: {
        startDate: "2026-03-07",
        endDate: "2026-03-07",
      },
      isPartialCurrentDay: true,
    });
  });

  it("uses equal elapsed durations for a partial fall-back day", () => {
    expect(getComparableAppDateRangesUtc(
      { startDate: "2026-11-01", endDate: "2026-11-01" },
      "2026-11-01T11:30:00.000Z",
    )).toEqual({
      current: {
        startInclusive: "2026-11-01T07:00:00.000Z",
        endExclusive: "2026-11-01T11:30:00.000Z",
      },
      previous: {
        startInclusive: "2026-10-31T07:00:00.000Z",
        endExclusive: "2026-10-31T11:30:00.000Z",
      },
      previousDateRange: {
        startDate: "2026-10-31",
        endDate: "2026-10-31",
      },
      isPartialCurrentDay: true,
    });
  });

  it("keeps the exact Pacific-midnight Today window empty and suppresses comparison", () => {
    expect(getComparableAppDateRangesUtc(
      { startDate: "2026-04-22", endDate: "2026-04-22" },
      "2026-04-22T07:00:00.000Z",
    )).toEqual({
      current: {
        startInclusive: "2026-04-22T07:00:00.000Z",
        endExclusive: "2026-04-22T07:00:00.000Z",
      },
      previous: null,
      previousDateRange: {
        startDate: "2026-04-21",
        endDate: "2026-04-21",
      },
      isPartialCurrentDay: true,
    });
  });

  it("suppresses a partial comparison when the 25-hour elapsed window would cross the period boundary", () => {
    const ranges = getComparableAppDateRangesUtc(
      { startDate: "2026-11-01", endDate: "2026-11-01" },
      "2026-11-02T07:30:00.000Z",
    );

    expect(ranges.current).toEqual({
      startInclusive: "2026-11-01T07:00:00.000Z",
      endExclusive: "2026-11-02T07:30:00.000Z",
    });
    expect(ranges.previous).toBeNull();
  });

  it("uses full half-open periods when the selected range is complete", () => {
    expect(getComparableAppDateRangesUtc(
      { startDate: "2026-04-20", endDate: "2026-04-26" },
      "2026-04-27T18:00:00.000Z",
    )).toEqual({
      current: {
        startInclusive: "2026-04-20T07:00:00.000Z",
        endExclusive: "2026-04-27T07:00:00.000Z",
      },
      previous: {
        startInclusive: "2026-04-13T07:00:00.000Z",
        endExclusive: "2026-04-20T07:00:00.000Z",
      },
      previousDateRange: {
        startDate: "2026-04-13",
        endDate: "2026-04-19",
      },
      isPartialCurrentDay: false,
    });
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
