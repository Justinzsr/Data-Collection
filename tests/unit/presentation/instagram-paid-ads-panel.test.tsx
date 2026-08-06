import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));

import { buildInstagramPaidAdsSummary } from "@/aggregation/services/meta-ads-attribution-service";
import { InstagramPaidAdsPanel } from "@/presentation/dashboard/instagram-paid-ads-panel";

describe("InstagramPaidAdsPanel contrast targets", () => {
  it("renders every meaningful normal-text target with the accessible muted token", () => {
    const summary = buildInstagramPaidAdsSummary({
      metaSource: null,
      shopifySource: null,
      metaRows: [],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
      now: new Date("2026-07-30T12:00:00.000Z"),
    });
    const markup = renderToStaticMarkup(
      <InstagramPaidAdsPanel
        summary={summary}
        instagramSourceId="instagram-source"
        dataSpaceSlug="moonarq"
        returnPath="/w/moonarq/dashboard/sources/instagram-source"
      />,
    );
    const root = document.createElement("div");
    root.innerHTML = markup;
    const targets = [...root.querySelectorAll<HTMLElement>("[data-contrast-normal-text]")];
    const emptyTarget = root.querySelector<HTMLElement>(
      '[data-contrast-normal-text="paid-empty-state"]',
    );
    const reconciliationTargets = [
      ...root.querySelectorAll<HTMLElement>(
        '[data-testid="paid-attribution-reconciliation"] '
        + '[data-contrast-normal-text="paid-attribution-reconciliation"]',
      ),
    ];

    expect(targets).toHaveLength(4);
    expect(emptyTarget?.textContent).toBe(
      "The read-only connector will load delivery, spend, conversion, and creative-level UTM data.",
    );
    expect(reconciliationTargets.map((target) => target.textContent)).toEqual([
      "Includes Meta's selected click/view attribution window.",
      "Exact campaign/content tuple from the first-party Website Tracker.",
      "Exact last-visit UTM; refunds are reflected in net payment.",
    ]);
    expect(reconciliationTargets).toHaveLength(3);
    for (const target of targets) {
      expect(target.classList.contains("text-[var(--muted)]")).toBe(true);
      expect(target.classList.contains("text-slate-500")).toBe(false);
    }
  });
});
