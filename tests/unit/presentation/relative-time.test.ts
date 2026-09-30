import { describe, expect, it } from "vitest";
import { daysUntil, formatRelativeTime } from "@/presentation/components/ui/relative-time";

const now = Date.parse("2026-09-29T12:00:00.000Z");
const minutes = (value: number) => new Date(now + value * 60_000).toISOString();

describe("formatRelativeTime", () => {
  it.each([
    { value: minutes(0), expected: "just now" },
    { value: minutes(-12), expected: "12 min ago" },
    { value: minutes(12), expected: "in 12 min" },
    { value: minutes(-59.8), expected: "1 hr ago" },
    { value: minutes(-3 * 60), expected: "3 hr ago" },
    { value: minutes(-24 * 60), expected: "yesterday" },
    { value: minutes(3 * 24 * 60), expected: "in 3 days" },
  ])("formats $value as $expected", ({ value, expected }) => {
    expect(formatRelativeTime(value, { now })).toBe(expected);
  });

  it("falls back for missing or invalid values", () => {
    expect(formatRelativeTime(null, { now })).toBe("never");
    expect(formatRelativeTime("not-a-date", { now, fallback: "—" })).toBe("—");
  });
});

describe("daysUntil", () => {
  it("counts whole days and goes negative once past", () => {
    expect(daysUntil(minutes(10 * 24 * 60 + 30), now)).toBe(10);
    expect(daysUntil(minutes(-30), now)).toBe(-1);
    expect(daysUntil(undefined, now)).toBeNull();
  });
});
