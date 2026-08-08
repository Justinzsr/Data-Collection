import { describe, expect, it } from "vitest";
import { selectPendingMigrations } from "../../../scripts/db-migration-plan";

const migrations = [
  "0011_shopify_commerce_bridge_facts.sql",
  "0010_rebuild_authoritative_website_metrics.sql",
  "0008_meta_ads_attribution.sql",
  "0009_website_event_contract_v1.sql",
  "README.md",
];

describe("database migration planning", () => {
  it("confirms that an exact 0001-0008 state plans only 0009", () => {
    expect(
      selectPendingMigrations({
        filenames: migrations,
        appliedFilenames: new Set(["0008_meta_ads_attribution.sql"]),
        target: "0009_website_event_contract_v1.sql",
      }),
    ).toEqual(["0009_website_event_contract_v1.sql"]);
  });

  it("includes any missing earlier migration instead of treating a target as an only flag", () => {
    expect(
      selectPendingMigrations({
        filenames: migrations,
        appliedFilenames: new Set(),
        target: "0009_website_event_contract_v1.sql",
      }),
    ).toEqual(["0008_meta_ads_attribution.sql", "0009_website_event_contract_v1.sql"]);
  });

  it("never includes migrations after the target", () => {
    expect(
      selectPendingMigrations({
        filenames: migrations,
        appliedFilenames: new Set(["0008_meta_ads_attribution.sql"]),
        target: "0009_website_event_contract_v1.sql",
      }),
    ).not.toContain("0010_rebuild_authoritative_website_metrics.sql");
  });

  it("plans the commerce bridge migration after the v1 rebuild", () => {
    expect(
      selectPendingMigrations({
        filenames: migrations,
        appliedFilenames: new Set([
          "0008_meta_ads_attribution.sql",
          "0009_website_event_contract_v1.sql",
          "0010_rebuild_authoritative_website_metrics.sql",
        ]),
        target: "0011_shopify_commerce_bridge_facts.sql",
      }),
    ).toEqual(["0011_shopify_commerce_bridge_facts.sql"]);
  });

  it("rejects an unknown target", () => {
    expect(() =>
      selectPendingMigrations({
        filenames: migrations,
        appliedFilenames: new Set(),
        target: "0099_missing.sql",
      }),
    ).toThrow("Unknown migration target");
  });
});
