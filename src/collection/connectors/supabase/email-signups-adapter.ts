import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Source } from "@/storage/db/schema";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { listSources } from "@/storage/repositories/sources-repository";

export const EMAIL_SIGNUPS_TABLE = "email_signups";
export const EMAIL_SIGNUPS_PAGE_SIZE = 1_000;
export const MOONARQ_WEB_SUPABASE_PROJECT_REF = "efryepaxzelvmwjkrzke";
const MAX_EMAIL_SIGNUP_PAGES = 100;
const EMAIL_SIGNUP_COLUMNS = [
  "id",
  "email",
  "email_normalized",
  "source",
  "discount_code",
  "consent_email_marketing",
  "page_url",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "promo_email_sent",
  "zapier_sent_at",
  "shopify_customer_id",
  "created_at",
  "updated_at",
].join(",");

export type EmailSignup = {
  id: string;
  email: string;
  email_normalized: string;
  source: string | null;
  discount_code: string | null;
  consent_email_marketing: boolean;
  page_url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  promo_email_sent: boolean;
  zapier_sent_at: string | null;
  shopify_customer_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EmailSignupSourceDescriptor = {
  sourceId: string;
  sourceName: string;
  projectRef: string;
  table: typeof EMAIL_SIGNUPS_TABLE;
};

export class EmailSignupSourceError extends Error {
  constructor(
    public readonly code:
      | "source_not_configured"
      | "source_ambiguous"
      | "source_mismatch"
      | "credential_missing"
      | "query_failed"
      | "response_invalid"
      | "result_too_large",
    message: string,
  ) {
    super(message);
    this.name = "EmailSignupSourceError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function bool(value: unknown) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  return false;
}

function utcTimestamp(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseEmailSignupRows(value: unknown): EmailSignup[] {
  if (!Array.isArray(value)) {
    throw new EmailSignupSourceError("response_invalid", "The email signup source returned an invalid response.");
  }

  return value.flatMap((item) => {
    const row = record(item);
    if (!row) return [];
    const id = text(row.id);
    const email = text(row.email);
    if (!id || !email) return [];

    return [
      {
        id,
        email,
        email_normalized: text(row.email_normalized) ?? email.toLowerCase(),
        source: text(row.source),
        discount_code: text(row.discount_code),
        consent_email_marketing: bool(row.consent_email_marketing),
        page_url: text(row.page_url),
        referrer: text(row.referrer),
        utm_source: text(row.utm_source),
        utm_medium: text(row.utm_medium),
        utm_campaign: text(row.utm_campaign),
        promo_email_sent: bool(row.promo_email_sent),
        zapier_sent_at: utcTimestamp(row.zapier_sent_at),
        shopify_customer_id: text(row.shopify_customer_id),
        created_at: utcTimestamp(row.created_at),
        updated_at: utcTimestamp(row.updated_at),
      },
    ];
  });
}

function normalizedSupabaseUrl(source: Source) {
  const raw = source.normalized_url ?? source.input_url;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/iu.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sourceProjectRef(source: Source) {
  const url = normalizedSupabaseUrl(source);
  if (!url) return null;
  return new URL(url).hostname.split(".")[0];
}

export function selectMoonArqWebsiteSupabaseSource(sources: Source[]) {
  const candidates = sources.filter(
    (source) =>
      source.source_type_key === "supabase" &&
      source.status !== "disabled" &&
      Boolean(normalizedSupabaseUrl(source)),
  );
  const websiteCandidates = candidates.filter(
    (source) => sourceProjectRef(source) === MOONARQ_WEB_SUPABASE_PROJECT_REF,
  );

  if (websiteCandidates.length === 1) return websiteCandidates[0];
  if (websiteCandidates.length > 1) {
    throw new EmailSignupSourceError(
      "source_ambiguous",
      "More than one MoonArq website Supabase source is configured. Mark one source as the monitored website project.",
    );
  }
  if (candidates.length > 0) {
    throw new EmailSignupSourceError(
      "source_mismatch",
      "The configured Supabase source is not the monitored moonarq-web project. Email signups were not queried.",
    );
  }
  throw new EmailSignupSourceError(
    "source_not_configured",
    "The MoonArq website Supabase source is not configured for this data space.",
  );
}

export async function getMoonArqEmailSignupConnection(dataSpaceId: string) {
  const source = selectMoonArqWebsiteSupabaseSource(await listSources({ dataSpaceId }));
  const projectUrl = normalizedSupabaseUrl(source);
  if (!projectUrl || sourceProjectRef(source) !== MOONARQ_WEB_SUPABASE_PROJECT_REF) {
    throw new EmailSignupSourceError(
      "source_mismatch",
      "The selected source is not the monitored MoonArq website Supabase project.",
    );
  }
  const credentials = await getDecryptedCredentialMap(source.id);
  const serviceRoleKey = credentials.service_role_key?.trim();
  if (!serviceRoleKey) {
    throw new EmailSignupSourceError(
      "credential_missing",
      "The MoonArq website Supabase source is missing its encrypted server-side service role credential.",
    );
  }
  return { source, projectUrl, serviceRoleKey };
}

export async function readMoonArqEmailSignups(dataSpaceId: string): Promise<{
  rows: EmailSignup[];
  source: EmailSignupSourceDescriptor;
}> {
  const { source, projectUrl, serviceRoleKey } = await getMoonArqEmailSignupConnection(dataSpaceId);
  const client = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  const rawRows: unknown[] = [];

  for (let page = 0; page < MAX_EMAIL_SIGNUP_PAGES; page += 1) {
    const from = page * EMAIL_SIGNUPS_PAGE_SIZE;
    const { data, error } = await client
      .from(EMAIL_SIGNUPS_TABLE)
      .select(EMAIL_SIGNUP_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + EMAIL_SIGNUPS_PAGE_SIZE - 1);

    if (error) {
      throw new EmailSignupSourceError(
        "query_failed",
        "The MoonArq website email signup source could not be read. Existing dashboard data was not changed.",
      );
    }
    if (!Array.isArray(data)) {
      throw new EmailSignupSourceError("response_invalid", "The email signup source returned an invalid response.");
    }
    rawRows.push(...data);
    if (data.length < EMAIL_SIGNUPS_PAGE_SIZE) break;
    if (page === MAX_EMAIL_SIGNUP_PAGES - 1) {
      throw new EmailSignupSourceError(
        "result_too_large",
        "The email signup source exceeded the safe read limit. Narrowed server pagination is required.",
      );
    }
  }

  return {
    rows: parseEmailSignupRows(rawRows),
    source: {
      sourceId: source.id,
      sourceName: source.display_name,
      projectRef: MOONARQ_WEB_SUPABASE_PROJECT_REF,
      table: EMAIL_SIGNUPS_TABLE,
    },
  };
}
