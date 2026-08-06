import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const expandMigration = readFileSync(
  "src/storage/db/migrations/0009_website_event_contract_v1.sql",
  "utf8",
);
const rebuildMigration = readFileSync(
  "src/storage/db/migrations/0010_rebuild_authoritative_website_metrics.sql",
  "utf8",
);

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim().toLowerCase();
}

const compactExpandMigration = compactSql(expandMigration);
const compactRebuildMigration = compactSql(rebuildMigration);

describe("Website Event Contract migrations", () => {
  it("uses bounded local timeouts inside the migration runner transaction", () => {
    expect(compactExpandMigration).toContain("set local lock_timeout = '10s'");
    expect(compactExpandMigration).toContain("set local statement_timeout = '15min'");
    expect(compactRebuildMigration).toContain("set local lock_timeout = '10s'");
    expect(compactRebuildMigration).toContain("set local statement_timeout = '15min'");

    const migrationRunner = compactSql(readFileSync("scripts/db-migrate.ts", "utf8"));
    expect(migrationRunner).toContain("await withdatabasetransaction(async (client) =>");
  });

  it("adds the v1 storage columns and source/event idempotency constraint", () => {
    for (const columnDefinition of [
      "event_id uuid",
      "schema_version text",
      "event_source text",
      "attribution_context jsonb",
      "consent_status jsonb",
      "client_context jsonb",
      "received_at timestamptz",
    ]) {
      expect(compactExpandMigration).toContain(
        `alter table web_events add column if not exists ${columnDefinition}`,
      );
    }

    expect(compactExpandMigration).toMatch(
      /create unique index if not exists idx_web_events_source_event_id on web_events \(source_id, event_id\)/,
    );
    expect(compactExpandMigration).not.toContain("nulls not distinct");
  });

  it("adds all four contract lookup-index families", () => {
    for (const indexDefinition of [
      "idx_web_events_event_time on web_events (event_name, occurred_at desc)",
      "idx_web_events_session_time on web_events (source_id, session_id, occurred_at desc)",
      "idx_web_events_anonymous_time on web_events (source_id, anonymous_id, occurred_at desc)",
      "idx_web_events_source_received_time on web_events (source_id, received_at desc)",
    ]) {
      expect(compactExpandMigration).toContain(
        `create index if not exists ${indexDefinition}`,
      );
    }
  });

  it("constrains schema versions and event sources", () => {
    expect(compactExpandMigration).toContain("constraint web_events_schema_version_check");
    expect(compactExpandMigration).toContain(
      "check (schema_version in ('legacy', '1.0', 'vercel.analytics.v2'))",
    );
    expect(compactExpandMigration).toContain("constraint web_events_event_source_check");
    expect(compactExpandMigration).toContain(
      "check (event_source in ('first_party_tracker', 'vercel_drain'))",
    );
  });

  it("keeps raw events browser-inaccessible with least-privilege service access", () => {
    for (const reportingView of [
      "reporting.platform_website_daily",
      "reporting.moonarq_website_daily",
    ]) {
      expect(compactExpandMigration).toContain(
        `alter view ${reportingView} set (security_invoker = true)`,
      );
      expect(compactExpandMigration).toContain(
        `revoke all privileges on table ${reportingView} from public`,
      );
      expect(compactExpandMigration).toContain(
        `revoke all privileges on table ${reportingView} from anon`,
      );
      expect(compactExpandMigration).toContain(
        `revoke all privileges on table ${reportingView} from authenticated`,
      );
      expect(compactExpandMigration).toContain(
        `revoke all privileges on table ${reportingView} from service_role`,
      );
      expect(compactExpandMigration).toContain(
        `grant select on table ${reportingView} to service_role`,
      );
    }

    for (const browserRole of ["public", "anon", "authenticated"]) {
      expect(compactExpandMigration).toContain(
        `revoke all privileges on table public.web_events from ${browserRole}`,
      );
    }

    expect(compactExpandMigration).toContain(
      "grant select, insert on table public.web_events to service_role",
    );
    expect(compactExpandMigration).toContain(
      "revoke all privileges on table public.web_events from service_role",
    );
    expect(compactExpandMigration).toContain(
      "create policy web_events_service_role_select on public.web_events for select to service_role using (true)",
    );
    expect(compactExpandMigration).toContain(
      "create policy web_events_service_role_insert on public.web_events for insert to service_role with check (true)",
    );
    expect(compactExpandMigration).not.toMatch(
      /grant [^;']*(?:update|delete|truncate|references|trigger)[^;']* on table public\.web_events to service_role/,
    );
    expect(compactExpandMigration).not.toMatch(
      /create policy [^;']+ on public\.web_events for all to service_role/,
    );

    expect(compactExpandMigration).toContain("grant usage on schema public to service_role");
    for (const dependency of ["public.sources", "public.data_spaces", "public.metrics_daily"]) {
      expect(compactExpandMigration).toContain(
        `revoke all privileges on table ${dependency} from service_role`,
      );
      expect(compactExpandMigration).toContain(
        `grant select on table ${dependency} to service_role`,
      );
    }
    expect(compactExpandMigration).not.toMatch(
      /grant [^;']*(?:insert|update|delete|truncate|references|trigger|maintain)[^;']* on table public\.(?:sources|data_spaces|metrics_daily) to service_role/,
    );
    expect(compactExpandMigration).not.toMatch(
      /(?:grant|revoke) [^;']* on table public\.(?:source_credentials|raw_ingestions) (?:to|from) service_role/,
    );
  });

  it("rebuilds all six website metrics from first-party tracker events only", () => {
    expect(compactRebuildMigration).toContain("s.source_type_key = 'website'");
    expect(compactRebuildMigration.match(/e\.event_source = 'first_party_tracker'/gu)).toHaveLength(1);
    expect(compactRebuildMigration).not.toContain("vercel_drain");

    for (const dailyMetric of ["page_views", "custom_events", "unique_visitors", "sessions"]) {
      expect(compactRebuildMigration).toContain(
        `('${dailyMetric}'::text, daily.${dailyMetric})`,
      );
    }
    expect(compactRebuildMigration).toContain("'events_by_path'::text");
    expect(compactRebuildMigration).toContain("'events_by_referrer'::text");
  });
});
