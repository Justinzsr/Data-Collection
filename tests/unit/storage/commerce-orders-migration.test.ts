import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "src/storage/db/migrations/0011_shopify_commerce_bridge_facts.sql",
  "utf8",
).replace(/\s+/gu, " ").trim().toLowerCase();

describe("Shopify commerce bridge migration", () => {
  it("creates private order and line facts with constrained hash/state pairs", () => {
    expect(migration).toContain("create table if not exists public.commerce_orders");
    expect(migration).toContain("create table if not exists public.commerce_order_lines");
    expect(migration).toContain("checkout_bridge_state in ('missing', 'matched', 'invalid', 'ambiguous')");
    expect(migration).toContain("item_bridge_state in ('missing', 'matched', 'invalid', 'ambiguous')");
    expect(migration).toContain("checkout_bridge_state = 'matched' and checkout_event_id_hash is not null");
    expect(migration).toContain("checkout_bridge_state <> 'matched' and checkout_event_id_hash is null");
    expect(migration).toContain("item_bridge_state = 'matched' and item_instance_id_hash is not null");
    expect(migration).toContain("item_bridge_state <> 'matched' and item_instance_id_hash is null");
    expect(migration).toContain("shopify_order_id_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("shopify_line_item_id_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("cancelled_at is null or cancelled_at >= occurred_at");
    expect(migration).toContain("quantity >= 1");
  });

  it("keeps both fact tables off browser and service-role APIs", () => {
    for (const table of ["commerce_orders", "commerce_order_lines"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      for (const role of ["public", "anon", "authenticated", "service_role"]) {
        expect(migration).toContain(`revoke all privileges on table public.${table} from ${role}`);
      }
    }
    expect(migration).not.toMatch(/grant [^;']+ on table public\.commerce_/u);
    expect(migration).not.toContain("customattributes");
    expect(migration).not.toContain("_mq_checkout_event_id");
    expect(migration).not.toContain("_mq_item_instance_id");
  });
});
