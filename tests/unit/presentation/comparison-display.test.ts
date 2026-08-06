import { describe, expect, it } from "vitest";
import {
  comparisonToneClass,
  resolveComparisonDisplay,
} from "@/presentation/dashboard/comparison-display";

describe("resolveComparisonDisplay", () => {
  it.each([
    {
      name: "unmeasured values before considering comparison mode",
      input: { mode: "off" as const, globallyAvailable: false, measured: false },
      expected: {
        kind: "unmeasured",
        label: "Not measured",
        tone: "neutral",
        showPrevious: false,
      },
    },
    {
      name: "comparison disabled by the viewer",
      input: { mode: "off" as const, globallyAvailable: true },
      expected: {
        kind: "off",
        label: "Comparison off",
        tone: "neutral",
        showPrevious: false,
      },
    },
    {
      name: "globally unavailable history",
      input: { mode: "previous" as const, globallyAvailable: false },
      expected: {
        kind: "unavailable",
        label: "Comparison unavailable",
        tone: "neutral",
        showPrevious: false,
      },
    },
    {
      name: "missing baseline",
      input: {
        mode: "previous" as const,
        globallyAvailable: true,
        hasBaseline: false,
        deltaPercent: 25,
        includeDelta: true,
      },
      expected: {
        kind: "no_baseline",
        label: "No baseline",
        tone: "neutral",
        showPrevious: false,
      },
    },
    {
      name: "available comparison without a delta",
      input: {
        mode: "previous" as const,
        globallyAvailable: true,
        hasBaseline: true,
      },
      expected: {
        kind: "available",
        label: "Previous period",
        tone: "neutral",
        showPrevious: true,
      },
    },
    {
      name: "zero delta",
      input: {
        mode: "previous" as const,
        globallyAvailable: true,
        deltaPercent: 0,
        includeDelta: true,
      },
      expected: {
        kind: "zero",
        label: "0.0% vs previous",
        tone: "neutral",
        showPrevious: true,
      },
    },
    {
      name: "positive delta",
      input: {
        mode: "previous" as const,
        globallyAvailable: true,
        deltaPercent: 12.34,
        includeDelta: true,
      },
      expected: {
        kind: "positive",
        label: "+12.3% vs previous",
        tone: "positive",
        showPrevious: true,
      },
    },
    {
      name: "negative delta",
      input: {
        mode: "previous" as const,
        globallyAvailable: true,
        deltaPercent: -12.34,
        includeDelta: true,
      },
      expected: {
        kind: "negative",
        label: "-12.3% vs previous",
        tone: "negative",
        showPrevious: true,
      },
    },
  ])("resolves $name", ({ input, expected }) => {
    expect(resolveComparisonDisplay(input)).toEqual(expected);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "treats a non-finite delta (%s) as no baseline",
    (deltaPercent) => {
      expect(resolveComparisonDisplay({
        mode: "previous",
        globallyAvailable: true,
        deltaPercent,
        includeDelta: true,
      })).toEqual({
        kind: "no_baseline",
        label: "No baseline",
        tone: "neutral",
        showPrevious: false,
      });
    },
  );

  it("maps comparison tones to semantic text classes", () => {
    expect(comparisonToneClass("positive")).toBe("text-emerald-200");
    expect(comparisonToneClass("negative")).toBe("text-rose-200");
    expect(comparisonToneClass("neutral")).toBe("text-[var(--muted)]");
  });
});
