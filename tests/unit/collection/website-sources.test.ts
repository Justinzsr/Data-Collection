import { describe, expect, it } from "vitest";
import {
  resolveAuthoritativeWebsiteSource,
  resolvePrimaryWebsiteSource,
} from "@/collection/tracking/website-sources";
import type { Source } from "@/storage/db/schema";

function source(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    data_space_id: "data-space-one",
    source_type_key: "website",
    display_name: `Source ${id}`,
    input_url: null,
    normalized_url: null,
    external_account_id: null,
    account_name: null,
    status: "healthy",
    sync_mode: "webhook",
    sync_frequency_minutes: 60,
    supports_webhook: true,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    metadata: {},
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("authoritative Website source resolution", () => {
  it("returns missing when no enabled Website source exists", () => {
    const result = resolveAuthoritativeWebsiteSource([
      source("disabled", { status: "disabled" }),
      source("shopify", { source_type_key: "shopify" }),
    ]);

    expect(result).toEqual({ status: "missing", source: null, candidates: [] });
  });

  it("resolves exactly one non-disabled Website source", () => {
    const website = source("website");
    const inputs = [
      source("drain", { source_type_key: "vercel_web_analytics_drain" }),
      website,
      source("disabled", { status: "disabled" }),
    ];

    const result = resolveAuthoritativeWebsiteSource(inputs);

    expect(result).toEqual({ status: "resolved", source: website, candidates: [website] });
    expect(inputs.map((entry) => entry.id)).toEqual(["drain", "website", "disabled"]);
  });

  it("fails closed when multiple Website sources are eligible", () => {
    const healthy = source("healthy");
    const warning = source("warning", { status: "warning" });
    const result = resolveAuthoritativeWebsiteSource([warning, healthy]);

    expect(result).toEqual({
      status: "ambiguous",
      source: null,
      candidates: [warning, healthy],
    });
  });

  it("leaves the existing preference-based resolver behavior unchanged", () => {
    const warning = source("warning", { status: "warning" });
    const healthy = source("healthy");

    expect(resolvePrimaryWebsiteSource([warning, healthy])).toBe(healthy);
    expect(resolveAuthoritativeWebsiteSource([warning, healthy]).status).toBe("ambiguous");
  });
});
