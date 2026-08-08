import { describe, expect, it, vi } from "vitest";
import { getWebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-service";
import {
  assertWebsiteCommerceFunnelV2AggregateOnly,
  handleWebsiteCommerceFunnelV2Get,
} from "@/app/api/metrics/website-commerce-funnel-v2/route";
import type { DataSpace } from "@/storage/db/schema";

const DATA_SPACE: DataSpace = {
  id: "data-space-moonarq",
  slug: "moonarq",
  display_name: "MoonArq",
  description: null,
  category: "business",
  icon: null,
  is_default: true,
  status: "active",
  metadata: {},
  created_at: "2026-08-07T00:00:00.000Z",
  updated_at: "2026-08-07T00:00:00.000Z",
};

async function snapshot() {
  return getWebsiteCommerceFunnelV2Snapshot(
    { dataSpaceId: DATA_SPACE.id },
    { env: { NODE_ENV: "test" }, now: new Date("2026-08-07T18:00:00.000Z") },
  );
}

function request(path = "/api/metrics/website-commerce-funnel-v2?dataSpaceSlug=moonarq&range=30d&segment=all") {
  return new Request(`https://app.example.com${path}`);
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("Website commerce funnel V2 protected API", () => {
  it("rejects unauthenticated requests before resolving the data space or reading aggregates", async () => {
    const resolveDataSpace = vi.fn(async () => DATA_SPACE);
    const loadSnapshot = vi.fn(snapshot);
    const response = await handleWebsiteCommerceFunnelV2Get(request(), {
      env: { NODE_ENV: "test" },
      authenticate: vi.fn(async () => false),
      resolveDataSpace,
      loadSnapshot,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
    expect(resolveDataSpace).not.toHaveBeenCalled();
    expect(loadSnapshot).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("rejects invalid query values and cross-data-space access", async () => {
    const loadSnapshot = vi.fn(snapshot);
    const dependencies = {
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      authenticate: vi.fn(async () => true),
      resolveDataSpace: vi.fn(async () => DATA_SPACE),
      loadSnapshot,
    };
    const invalid = await handleWebsiteCommerceFunnelV2Get(
      request("/api/metrics/website-commerce-funnel-v2?range=forever"),
      dependencies,
    );
    const otherSpace = await handleWebsiteCommerceFunnelV2Get(
      request("/api/metrics/website-commerce-funnel-v2?dataSpaceSlug=auto-lab"),
      dependencies,
    );

    expect(invalid.status).toBe(400);
    expect(otherSpace.status).toBe(403);
    expect(loadSnapshot).not.toHaveBeenCalled();
    expectNoStore(invalid);
    expectNoStore(otherSpace);
  });

  it("returns only the aggregate snapshot with private no-store headers", async () => {
    const aggregate = await snapshot();
    const loadSnapshot = vi.fn(async () => aggregate);
    const response = await handleWebsiteCommerceFunnelV2Get(request(), {
      env: { NODE_ENV: "test" },
      authenticate: vi.fn(async () => true),
      resolveDataSpace: vi.fn(async () => DATA_SPACE),
      loadSnapshot,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ snapshot: aggregate });
    expect(loadSnapshot).toHaveBeenCalledWith({
      dataSpaceId: DATA_SPACE.id,
      range: "30d",
      segment: "all",
    });
    expectNoStore(response);
    expect(JSON.stringify(body)).not.toMatch(
      /event_id|order_id|source_id|session_id|anonymous_id|checkout_event_id_hash|item_instance_id_hash|email|customer_id/i,
    );
  });

  it("rejects an accidental identity-bearing field before serialization", async () => {
    const aggregate = await snapshot();
    const unsafe = {
      ...aggregate,
      diagnostics: {
        ...aggregate.diagnostics,
        rows: [{ eventId: "00000000-0000-4000-8000-000000000000" }],
      },
    };
    expect(() => assertWebsiteCommerceFunnelV2AggregateOnly(unsafe)).toThrow(/forbidden field/u);

    const response = await handleWebsiteCommerceFunnelV2Get(request(), {
      env: { NODE_ENV: "test" },
      authenticate: vi.fn(async () => true),
      resolveDataSpace: vi.fn(async () => DATA_SPACE),
      loadSnapshot: vi.fn(async () => unsafe),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "The V2 commerce funnel could not be refreshed safely." });
    expect(JSON.stringify(body)).not.toContain("00000000");
    expectNoStore(response);
  });

  it.each([
    "eventId",
    "checkoutEventIdHash",
    "itemInstanceIdHash",
    "shopifyOrderIdHash",
    "sourceId",
    "websiteSourceId",
    "shopifyCustomerId",
    "rawSessionId",
    "shopifyLineItemId",
    "warehouseShopifyLineItemIdHash",
    "anonymous-id",
    "customer.id",
    "SESSION_ID",
  ])("rejects nested identity-bearing key variant %s", (key) => {
    const unsafe = {
      summary: {
        diagnostics: [{ details: { [key]: "must-not-leak" } }],
      },
    };

    expect(() => assertWebsiteCommerceFunnelV2AggregateOnly(unsafe)).toThrow(
      new RegExp(`forbidden field at snapshot\\.summary\\.diagnostics\\[0\\]\\.details\\.${key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"),
    );
  });

  it("allows deeply nested aggregate labels that mention entities without exposing identifiers", () => {
    const aggregateOnly = {
      summary: {
        diagnostics: [{
          traffic: {
            excludedBotSessions: 5,
            eligibleShopifyOrders: 11,
            sourceIdCoverageRate: 0.91,
            customerIdMatchCount: 10,
          },
        }],
      },
    };

    expect(() => assertWebsiteCommerceFunnelV2AggregateOnly(aggregateOnly)).not.toThrow();
  });

  it("sanitizes backend failures instead of exposing database details", async () => {
    const response = await handleWebsiteCommerceFunnelV2Get(request(), {
      env: { NODE_ENV: "test" },
      authenticate: vi.fn(async () => true),
      resolveDataSpace: vi.fn(async () => DATA_SPACE),
      loadSnapshot: vi.fn(async () => {
        throw new Error("relation failed with token=do-not-leak and stack");
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "The V2 commerce funnel could not be refreshed safely." });
    expect(JSON.stringify(body)).not.toMatch(/do-not-leak|relation|stack|token/i);
    expectNoStore(response);
  });
});
