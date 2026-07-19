import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseline = readFileSync(
  "scripts/sql/capture-0009-website-event-baseline.sql",
  "utf8",
).toLowerCase();
const verification = readFileSync(
  "scripts/sql/verify-0009-website-event-contract-v1.sql",
  "utf8",
).toLowerCase();
const legacyProbe = readFileSync("scripts/sql/probe-0009-legacy-writes.sql", "utf8").toLowerCase();
const migrationRunner = readFileSync("scripts/db-migrate.ts", "utf8");
const migrationPreflight = readFileSync("scripts/preflight-0009-migration.ts", "utf8");
const databaseClient = readFileSync("src/storage/db/client.ts", "utf8");

describe("Website Event Contract production verification artifacts", () => {
  it("captures deterministic, fixed-cutoff event and metric fingerprints without returning rows", () => {
    expect(baseline).toContain("begin read only");
    expect(baseline).toContain(":'baseline_cutoff'::timestamptz");
    expect(baseline).toContain("settled_web_event_fingerprint");
    expect(baseline).toContain("settled_website_metric_fingerprint");
    expect(baseline).toContain("digest(");
    expect(baseline).not.toMatch(/select\s+events\.\*/u);
  });

  it("checks every required post-0009 catalog and access invariant", () => {
    for (const checkName of [
      "migration_phase_state",
      "column_types_defaults_nullability",
      "validated_check_constraints",
      "compatibility_function_definition",
      "compatibility_trigger_definition",
      "required_column_backfill",
      "settled_backfill_invariants",
      "event_source_classification",
      "source_scoped_event_id_uniqueness",
      "required_index_definitions",
      "row_level_security_enabled",
      "row_level_security_policies",
      "table_acl",
      "column_acl",
      "reporting_view_security_and_acl",
      "runtime_role_rls_and_acl_compatibility",
      "runtime_role_reporting_view_execution",
    ]) {
      expect(verification).toContain(checkName);
    }
    expect(verification).toContain("create temporary table verification_0009_checks");
    expect(verification).toContain(":'baseline_cutoff'::timestamptz");
    expect(verification).toContain("pg_get_indexdef");
    expect(verification).toContain("on commit drop");
    expect(verification).toContain("rollback;");
    expect(verification).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+)?public\./u);
    expect(verification).toContain("limit 0");
    expect(verification).toContain("effective_privilege_mismatch");
    expect(verification).toContain("'truncate'");
    expect(verification).toContain("'trigger'");
    expect(verification).toContain("'maintain'");
    expect(verification).toContain("raise exception 'post-0009 verification failed");
  });

  it("keeps both legacy insert probes rollback-only and omits every new column", () => {
    expect(legacyProbe).toContain("source_type_key = 'website'");
    expect(legacyProbe).toContain("source_type_key = 'vercel_web_analytics_drain'");
    expect(legacyProbe).toContain("rollback;");
    expect(legacyProbe).not.toMatch(/\bcommit\s*;/u);

    const insertColumnLists = [...legacyProbe.matchAll(/insert into public\.web_events\s*\(([^)]+)\)/gu)];
    expect(insertColumnLists).toHaveLength(2);
    for (const [, columns] of insertColumnLists) {
      expect(columns).not.toMatch(
        /event_id|schema_version|event_source|attribution_context|consent_status|client_context|received_at/u,
      );
    }
  });

  it("uses one shared planner, a bounded read-only preflight, and success logs after commit", () => {
    expect(migrationRunner).toContain("selectPendingMigrations");
    expect(migrationPreflight).toContain('client.query("set transaction read only")');
    expect(migrationPreflight).toContain("set local statement_timeout = '30s'");
    expect(migrationPreflight).toContain("[TARGET_MIGRATION]");
    expect(migrationRunner.indexOf("console.log(`Applied migration")).toBeGreaterThan(
      migrationRunner.indexOf("await withDatabaseTransaction"),
    );
  });

  it("keeps existing runtime TLS behavior while migration tooling requires an explicit Supabase CA", () => {
    expect(databaseClient).toContain("isSupabaseHost(hostname)");
    expect(migrationRunner).toContain("sslCa: process.env.DATABASE_SSL_CA");
    expect(migrationPreflight).toContain("sslCa: process.env.DATABASE_SSL_CA");
  });
});
