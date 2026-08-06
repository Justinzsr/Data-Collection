import { describe, expect, it } from "vitest";
import {
  WEBSITE_FUNNEL_EQUAL_TIME_POLICY,
  WEBSITE_FUNNEL_EVENT_NAMES,
  WEBSITE_FUNNEL_STAGES,
  calculateAbsoluteDelta,
  calculateDeltaPercent,
  calculateRatePercent,
  classifyWebsiteFunnelEvent,
  isStrictWebsiteFunnelProgression,
  validateWebsiteFunnelEventProperties,
} from "@/aggregation/metric-definitions/website-funnel-definitions";

const item = {
  item_id: "sku-moon-001",
  item_name: "Moon bracelet",
  item_category: "ready-made",
  item_list_name: "Core collection",
  price: 48,
  quantity: 1,
};

describe("website funnel definitions", () => {
  it("freezes the nine-name taxonomy and four strict funnel stages", () => {
    expect(WEBSITE_FUNNEL_EVENT_NAMES).toEqual([
      "page_view",
      "view_item_list",
      "view_item",
      "add_to_cart",
      "begin_checkout",
      "build_start",
      "build_complete",
      "save_design",
      "email_signup",
    ]);
    expect(Object.isFrozen(WEBSITE_FUNNEL_EVENT_NAMES)).toBe(true);
    expect(WEBSITE_FUNNEL_STAGES.map((stage) => [stage.key, stage.eventNames])).toEqual([
      ["visit", ["page_view"]],
      ["product_intent", ["view_item", "build_start"]],
      ["add_to_cart", ["add_to_cart"]],
      ["begin_checkout", ["begin_checkout"]],
    ]);
    expect(WEBSITE_FUNNEL_STAGES).toHaveLength(4);
    expect(WEBSITE_FUNNEL_EQUAL_TIME_POLICY).toMatchObject({ key: "strictly_after" });
    expect(WEBSITE_FUNNEL_EQUAL_TIME_POLICY.description).toMatch(/Equal-time events do not advance/u);
  });

  it("validates every frozen event-property shape", () => {
    expect(validateWebsiteFunnelEventProperties("page_view", {})).toMatchObject({
      classification: "known",
      valid: true,
    });
    expect(validateWebsiteFunnelEventProperties("view_item_list", {
      item_list_name: "Core collection",
      items: [item],
    })).toMatchObject({ classification: "known", valid: true });

    for (const eventName of ["view_item", "add_to_cart", "begin_checkout"] as const) {
      expect(validateWebsiteFunnelEventProperties(eventName, {
        currency: "USD",
        value: 48,
        items: [item],
      })).toMatchObject({ classification: "known", eventName, valid: true });
    }

    expect(validateWebsiteFunnelEventProperties("build_start", {
      item_category: "build-your-own",
    })).toMatchObject({ classification: "known", valid: true });

    for (const eventName of ["build_complete", "save_design"] as const) {
      expect(validateWebsiteFunnelEventProperties(eventName, {
        currency: "USD",
        item_category: "build-your-own",
        stone_count: 7,
        value: 72,
      })).toMatchObject({ classification: "known", eventName, valid: true });
    }

    expect(validateWebsiteFunnelEventProperties("email_signup", {
      discount_code: "WELCOME10",
      method: "footer_form",
    })).toMatchObject({ classification: "known", valid: true });
  });

  it("treats the ingestion compatibility attribution copy as envelope metadata", () => {
    const validation = validateWebsiteFunnelEventProperties("view_item", {
      currency: "USD",
      value: 48,
      items: [item],
      attribution: {
        utm: { source: "instagram", medium: "paid_social", campaign: "launch" },
      },
    });

    expect(validation).toMatchObject({
      classification: "known",
      eventName: "view_item",
      valid: true,
      properties: {
        currency: "USD",
        value: 48,
        items: [item],
      },
    });
    expect(JSON.stringify(validation)).not.toContain("\"attribution\"");
  });

  it("keeps invalid known-event properties diagnosable and out of funnel stages", () => {
    const malformed = classifyWebsiteFunnelEvent("add_to_cart", {
      currency: "usd",
      value: 48,
      items: [{ ...item, quantity: 1.5 }],
      guessed_product: "must-not-be-used",
    });

    expect(malformed.stageKey).toBeNull();
    expect(malformed.validation).toMatchObject({
      classification: "known",
      eventName: "add_to_cart",
      valid: false,
      properties: null,
    });
    expect(malformed.validation.issues.map((entry) => [entry.code, entry.path])).toEqual(expect.arrayContaining([
      ["invalid_value", "properties.currency"],
      ["invalid_value", "properties.items[0].quantity"],
      ["unexpected_field", "properties.guessed_product"],
    ]));
  });

  it("rejects partial item, list, commerce, build, and email shapes", () => {
    const cases = [
      validateWebsiteFunnelEventProperties("view_item_list", { item_list_name: "Core collection", items: [] }),
      validateWebsiteFunnelEventProperties("view_item", { currency: "USD", value: 48, items: [{ item_id: "sku-only" }] }),
      validateWebsiteFunnelEventProperties("build_start", {}),
      validateWebsiteFunnelEventProperties("build_complete", {
        currency: "USD",
        item_category: "build-your-own",
        stone_count: -1,
        value: 72,
      }),
      validateWebsiteFunnelEventProperties("email_signup", { method: "footer_form" }),
    ];

    for (const result of cases) {
      expect(result.classification).toBe("known");
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("keeps unknown accepted event names separate from malformed known events", () => {
    const result = classifyWebsiteFunnelEvent("cta_click", {});
    expect(result.stageKey).toBeNull();
    expect(result.validation).toMatchObject({
      classification: "unknown",
      eventName: "cta_click",
      valid: false,
      properties: null,
      issues: [{ code: "unknown_event", path: "event_name" }],
    });
  });

  it("qualifies only valid stage events and does not turn outcomes into funnel stages", () => {
    expect(classifyWebsiteFunnelEvent("page_view", {}).stageKey).toBe("visit");
    expect(classifyWebsiteFunnelEvent("view_item", {
      currency: "USD",
      value: 48,
      items: [item],
    }).stageKey).toBe("product_intent");
    expect(classifyWebsiteFunnelEvent("build_start", {
      item_category: "build-your-own",
    }).stageKey).toBe("product_intent");
    expect(classifyWebsiteFunnelEvent("email_signup", {
      discount_code: "WELCOME10",
      method: "footer_form",
    }).stageKey).toBeNull();
  });

  it("enforces strictly-later event ordering and excludes equal timestamps", () => {
    expect(isStrictWebsiteFunnelProgression(
      "2026-07-29T12:00:00.000Z",
      "2026-07-29T12:00:00.001Z",
    )).toBe(true);
    expect(isStrictWebsiteFunnelProgression(
      "2026-07-29T12:00:00.000Z",
      "2026-07-29T12:00:00.000Z",
    )).toBe(false);
    expect(isStrictWebsiteFunnelProgression(
      "2026-07-29T12:00:00.000Z",
      "invalid",
    )).toBe(false);
  });

  it("returns null-safe rates and deltas without Infinity or NaN", () => {
    expect(calculateRatePercent(4, 8)).toBe(50);
    expect(calculateRatePercent(0, 8)).toBe(0);
    expect(calculateRatePercent(1, 0)).toBeNull();
    expect(calculateRatePercent(Number.NaN, 8)).toBeNull();

    expect(calculateDeltaPercent(12, 8)).toBe(50);
    expect(calculateDeltaPercent(0, 8)).toBe(-100);
    expect(calculateDeltaPercent(1, 0)).toBeNull();
    expect(calculateDeltaPercent(0, 0)).toBeNull();
    expect(calculateAbsoluteDelta(8, 12)).toBe(-4);
    expect(calculateAbsoluteDelta(null, 12)).toBeNull();
  });
});
