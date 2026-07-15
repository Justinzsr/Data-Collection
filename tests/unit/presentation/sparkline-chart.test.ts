import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSparklinePath, SparklineChart } from "@/presentation/charts/sparkline-chart";

function yCoordinates(path: string) {
  return [...path.matchAll(/[ML]\s+[\d.]+\s+([\d.]+)/g)].map((match) => Number(match[1]));
}

describe("sparkline chart path", () => {
  it("uses the local value range so small real changes stay visible", () => {
    const path = buildSparklinePath([{ value: 358 }, { value: 364 }]);
    const [firstY, lastY] = yCoordinates(path);

    expect(Math.abs(firstY - lastY)).toBeGreaterThan(8);
    expect(Math.abs(firstY - lastY)).toBeLessThan(20);
    expect(lastY).toBeLessThan(firstY);
  });

  it("renders a visible horizontal line for one snapshot", () => {
    const path = buildSparklinePath([{ value: 364 }]);

    expect(path).toBe("M 0.00 50.00 L 100.00 50.00");
  });

  it("centers a constant positive series without producing invalid coordinates", () => {
    const path = buildSparklinePath([{ value: 20 }, { value: 20 }, { value: 20 }]);
    const coordinates = yCoordinates(path);

    expect(path).not.toContain("NaN");
    expect(new Set(coordinates).size).toBe(1);
    expect(coordinates[0]).toBe(50);
  });

  it("returns an empty path when there is no data", () => {
    expect(buildSparklinePath([])).toBe("");
  });

  it("labels the rendered chart with its metric, dates, direction, and range", () => {
    const markup = renderToStaticMarkup(createElement(SparklineChart, {
      data: [
        { date: "2026-07-13", value: 21 },
        { date: "2026-07-14", value: 20 },
      ],
      label: "MoonArq Instagram Followers, Last 30 days",
      compact: true,
    }));

    expect(markup).toContain(
      'aria-label="MoonArq Instagram Followers, Last 30 days sparkline, dates 2026-07-13 to 2026-07-14, started at 21, ended at 20, range 20 to 21"',
    );
  });
});
