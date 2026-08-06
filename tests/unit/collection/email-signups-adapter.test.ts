import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EmailSignupSourceError,
  MOONARQ_WEB_SUPABASE_PROJECT_REF,
  parseEmailSignupRows,
  selectMoonArqWebsiteSupabaseSource,
} from "@/collection/connectors/supabase/email-signups-adapter";
import type { Source } from "@/storage/db/schema";

const NOW = "2026-07-18T18:00:00.000Z";

function makeSupabaseSource(
  input: Partial<Source> & Pick<Source, "id" | "display_name">,
): Source {
  return {
    id: input.id,
    data_space_id: input.data_space_id ?? "data-space-moonarq",
    source_type_key: input.source_type_key ?? "supabase",
    display_name: input.display_name,
    input_url: input.input_url ?? `https://${input.id}.supabase.co`,
    normalized_url: input.normalized_url ?? `https://${input.id}.supabase.co`,
    external_account_id: input.external_account_id ?? input.id,
    account_name: input.account_name ?? input.display_name,
    status: input.status ?? "healthy",
    sync_mode: input.sync_mode ?? "manual",
    sync_frequency_minutes: input.sync_frequency_minutes ?? 60,
    supports_webhook: input.supports_webhook ?? false,
    webhook_url: input.webhook_url ?? null,
    webhook_secret_hint: input.webhook_secret_hint ?? null,
    last_manual_sync_at: input.last_manual_sync_at ?? null,
    last_cron_sync_at: input.last_cron_sync_at ?? null,
    last_webhook_sync_at: input.last_webhook_sync_at ?? null,
    last_success_at: input.last_success_at ?? null,
    last_error_at: input.last_error_at ?? null,
    last_error: input.last_error ?? null,
    next_sync_at: input.next_sync_at ?? null,
    metadata: input.metadata ?? {},
    created_at: input.created_at ?? NOW,
    updated_at: input.updated_at ?? NOW,
  };
}

describe("MoonArq email signup Supabase adapter", () => {
  it("selects the website project and never falls back to the Data Hub runtime project", () => {
    const website = makeSupabaseSource({
      id: "website-source",
      display_name: "MoonArq Website Supabase",
      normalized_url: `https://${MOONARQ_WEB_SUPABASE_PROJECT_REF}.supabase.co`,
      external_account_id: MOONARQ_WEB_SUPABASE_PROJECT_REF,
    });
    const dataHub = makeSupabaseSource({
      id: "data-hub-project-ref",
      display_name: "MoonArq Website Supabase",
      normalized_url: "https://wrong-data-hub-ref.supabase.co",
      metadata: { monitored_project: "moonarq-web" },
    });

    expect(selectMoonArqWebsiteSupabaseSource([dataHub, website])).toBe(website);
    expect(() => selectMoonArqWebsiteSupabaseSource([dataHub])).toThrowError(
      expect.objectContaining<Partial<EmailSignupSourceError>>({
        code: "source_mismatch",
        message:
          "The configured Supabase source is not the monitored moonarq-web project. Email signups were not queried.",
      }),
    );
  });

  it("matches the exact URL project ref rather than names, metadata, or external account labels", () => {
    const misleadingSource = makeSupabaseSource({
      id: "misleading-source",
      display_name: "moonarq-web production",
      normalized_url: "https://not-the-website-project.supabase.co",
      external_account_id: MOONARQ_WEB_SUPABASE_PROJECT_REF,
      metadata: { project: "moonarq-web", website: true },
    });

    expect(() => selectMoonArqWebsiteSupabaseSource([misleadingSource])).toThrowError(
      expect.objectContaining<Partial<EmailSignupSourceError>>({
        code: "source_mismatch",
      }),
    );
  });

  it("fails closed when more than one source has the exact website project URL", () => {
    const sources = [
      makeSupabaseSource({
        id: "website-one",
        display_name: "MoonArq Website One",
        normalized_url: `https://${MOONARQ_WEB_SUPABASE_PROJECT_REF}.supabase.co`,
      }),
      makeSupabaseSource({
        id: "website-two",
        display_name: "MoonArq Website Two",
        normalized_url: `https://${MOONARQ_WEB_SUPABASE_PROJECT_REF}.supabase.co`,
      }),
    ];

    expect(() => selectMoonArqWebsiteSupabaseSource(sources)).toThrowError(
      expect.objectContaining<Partial<EmailSignupSourceError>>({
        code: "source_ambiguous",
      }),
    );
  });

  it("normalizes valid timestamps and tolerates malformed, null, and optional UTM values", () => {
    const rows = parseEmailSignupRows([
      {
        id: " signup-one ",
        email: " Person@Example.COM ",
        email_normalized: " ",
        source: " website-popup ",
        consent_email_marketing: "true",
        promo_email_sent: 1,
        page_url: " https://www.moonarqstudio.com/newsletter ",
        referrer: " https://www.google.com/ ",
        utm_source: " instagram ",
        utm_medium: null,
        utm_campaign: " ",
        zapier_sent_at: "not-a-timestamp",
        created_at: "2026-07-18T10:15:30-07:00",
        updated_at: null,
      },
      {
        id: 2,
        email: "second@example.com",
        consent_email_marketing: false,
        promo_email_sent: false,
        zapier_sent_at: "2026-07-18T17:20:00.000Z",
        created_at: "definitely invalid",
        updated_at: "2026-07-18T17:30:00Z",
      },
      null,
      { id: "missing-email" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "signup-one",
      email: "Person@Example.COM",
      email_normalized: "person@example.com",
      source: "website-popup",
      page_url: "https://www.moonarqstudio.com/newsletter",
      referrer: "https://www.google.com/",
      consent_email_marketing: true,
      promo_email_sent: true,
      utm_source: "instagram",
      utm_medium: null,
      utm_campaign: null,
      zapier_sent_at: null,
      created_at: "2026-07-18T17:15:30.000Z",
      updated_at: null,
    });
    expect(rows[1]).toMatchObject({
      id: "2",
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      zapier_sent_at: "2026-07-18T17:20:00.000Z",
      created_at: null,
      updated_at: "2026-07-18T17:30:00.000Z",
    });
  });

  it("rejects a non-array source response with a typed, sanitized error", () => {
    expect(() => parseEmailSignupRows({ rows: [] })).toThrowError(
      expect.objectContaining<Partial<EmailSignupSourceError>>({
        code: "response_invalid",
        message: "The email signup source returned an invalid response.",
      }),
    );
  });

  it("keeps the production adapter SELECT-only with ordered ranged reads", () => {
    const source = readFileSync(
      join(process.cwd(), "src/collection/connectors/supabase/email-signups-adapter.ts"),
      "utf8",
    );

    expect(source).toMatch(/\.from\(EMAIL_SIGNUPS_TABLE\)[\s\S]*?\.select\(EMAIL_SIGNUP_COLUMNS\)/u);
    expect(source.match(/\.order\(/gu)).toHaveLength(2);
    expect(source).toMatch(/\.range\(from, from \+ EMAIL_SIGNUPS_PAGE_SIZE - 1\)/u);
    expect(source).not.toMatch(/\.(?:insert|update|upsert|delete|rpc)\s*\(/iu);
    expect(source).not.toMatch(/fetch\([^)]*zapier|\/api\/.*zapier/iu);
  });
});
