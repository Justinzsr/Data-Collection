import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdsCampaignHistorySnapshot } from "@/aggregation/services/ads-campaign-history-types";
import { AdsCampaignHistory } from "@/presentation/platforms/ads-campaign-history";

function snapshot(overrides: Partial<AdsCampaignHistorySnapshot> = {}): AdsCampaignHistorySnapshot {
  return {
    platform: "meta_ads", state: "partial", sourceId: "private-source-key", accountName: "Sample ad account",
    currency: "USD", timeZone: "America/Los_Angeles", clickLabel: "All clicks",
    coverage: { basis: "official_available_history", startDate: "2025-05-01", endDate: "2026-11-18", note: "Only the official report's available history is included." },
    totals: { spend: 340.15, impressions: 7625, clicks: 365 },
    campaigns: [{ key: "private-campaign-key", name: "Sample campaign", startDate: "2025-05-01", endDate: "2026-11-18", spend: 340.15, impressions: 7625, clicks: 365 }],
    updatedAt: "2026-11-18T20:15:00.000Z", note: "Independent of the selected date range.",
    ...overrides,
  };
}

function render(value: AdsCampaignHistorySnapshot) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<AdsCampaignHistory snapshot={value} />);
  return root;
}

describe("Campaign history presentation", () => {
  it("shows available coverage, cumulative totals and account-local freshness without claiming lifetime completeness", () => {
    const root = render(snapshot());
    expect(root.querySelector("h2")?.textContent).toBe("Campaign history");
    expect(root.querySelector('[data-testid="ads-history-coverage"]')?.textContent).toBe("Official available history · 2025-05-01 – 2026-11-18");
    expect(root.querySelector('[data-testid="ads-history-spend"] dd')?.textContent).toBe("$340.15");
    expect(root.querySelector('[data-testid="ads-history-impressions"] dd')?.textContent).toBe("7,625");
    expect(root.querySelector('[data-testid="ads-history-clicks"]')?.textContent).toBe("All clicks365");
    expect(root.textContent).toContain("America/Los_Angeles");
    expect(root.querySelector("time")?.textContent).toBe("Nov 18, 2026, 12:15 PM");
    expect(root.textContent).toContain("Partial history");
    expect(root.textContent).not.toMatch(/all time|lifetime/i);
    expect(root.querySelector("caption")?.textContent).toContain("independent of the selected date range");
  });

  it("keeps explicitly reported zero campaigns visible and distinguishes missing values", () => {
    const root = render(snapshot({
      platform: "chatgpt_ads", clickLabel: "Ad clicks", state: "ready",
      totals: { spend: 0, impressions: 0, clicks: null },
      campaigns: [{ key: "zero-key", name: "Sample zero campaign", startDate: "2026-11-18", endDate: "2026-11-18", spend: 0, impressions: 0, clicks: 0 }],
    }));
    expect(root.querySelector('[data-testid="ads-history-spend"] dd')?.textContent).toBe("$0.00");
    expect(root.querySelector('[data-testid="ads-history-impressions"] dd')?.textContent).toBe("0");
    expect(root.querySelector('[data-testid="ads-history-clicks"] dd')?.textContent).toBe("—");
    expect(root.querySelector('[data-testid="ads-history-clicks"] dt')?.textContent).toBe("Ad clicks");
    expect(Array.from(root.querySelectorAll("tbody td"), (cell) => cell.textContent)).toEqual(["$0.00", "0", "0"]);
    expect(root.textContent).toContain("Sample zero campaign");
  });

  it("labels retained records as collected history and keeps unavailable totals unknown", () => {
    const root = render(snapshot({
      state: "unavailable", currency: null, timeZone: null, updatedAt: null,
      coverage: { basis: "collected_history", startDate: null, endDate: null, note: "No official historical snapshot has been collected." },
      totals: { spend: null, impressions: null, clicks: null }, campaigns: [],
    }));
    expect(root.querySelector('[data-testid="ads-history-coverage"]')?.textContent).toBe("Collected history · Dates not yet reported");
    expect(Array.from(root.querySelectorAll("dd"), (cell) => cell.textContent)).toEqual(["—", "—", "—"]);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Campaign history is not available yet.");
    expect(root.querySelector("time")).toBeNull();
    expect(root.textContent).toContain("Account time zone not yet verified");
  });

  it("never substitutes an assumed currency for an unverified spend amount", () => {
    const unknownCurrency = render(snapshot({ currency: null }));
    expect(unknownCurrency.querySelector('[data-testid="ads-history-spend"] dd')?.textContent).toBe("—");
    expect(unknownCurrency.querySelector("tbody td")?.textContent).toBe("—");
    const euro = render(snapshot({ currency: "EUR" }));
    expect(euro.querySelector('[data-testid="ads-history-spend"] dd')?.textContent).toBe("€340.15");
    expect(euro.textContent).not.toContain("$340.15");
  });

  it("uses a name fallback without rendering source or campaign identifiers", () => {
    const value = snapshot();
    value.campaigns[0].name = value.campaigns[0].key;
    const root = render(value);
    expect(root.textContent).toContain("Unnamed campaign");
    expect(root.innerHTML).not.toContain("private-campaign-key");
    expect(root.innerHTML).not.toContain("private-source-key");
    expect(root.querySelector('[role="region"]')?.getAttribute("tabindex")).toBe("0");
    expect(root.querySelector("table")?.className).toContain("min-w-[40rem]");
    expect(root.querySelector('[role="region"]')?.className).toContain("overflow-x-auto");
  });

  it("does not imply that an empty campaign list means no delivery", () => {
    const root = render(snapshot({ campaigns: [] }));
    expect(root.querySelector('[role="status"]')?.textContent).toBe("No campaign-level history has been reported yet.");
    expect(root.querySelector('[data-testid="ads-history-spend"] dd')?.textContent).toBe("$340.15");
    expect(root.textContent).not.toContain("No campaign delivered");
  });

  it("describes a retained historical snapshot without claiming the regular sync is overdue", () => {
    const root = render(snapshot({ state: "stale", note: "The latest history request was unavailable; showing the previous report." }));
    expect(root.textContent).toContain("Previous report");
    expect(root.textContent).toContain("The latest history request was unavailable; showing the previous report.");
    expect(root.textContent).not.toContain("Sync overdue");
    expect(root.querySelector('[data-testid="ads-history-spend"] dd')?.textContent).toBe("$340.15");
  });
});
