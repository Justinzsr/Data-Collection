import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateWebsiteFunnelEventProperties } from "@/aggregation/metric-definitions/website-funnel-definitions";
import {
  isWebsitePaymentSeparator,
  sanitizeWebsiteDisplayDimension,
} from "@/collection/tracking/website-display-privacy";
import { closeDatabasePool, query } from "@/storage/db/client";
import {
  getWebsiteFunnelAggregate,
  WEBSITE_FUNNEL_AGGREGATE_SQL,
} from "@/storage/repositories/website-funnel-repository";

const enabled = process.env.RUN_WEBSITE_FUNNEL_POSTGRES_TEST === "true";
const databaseUrl = process.env.DATABASE_URL;
const dataSpaceId = randomUUID();
const websiteSourceId = randomUUID();
const otherSourceId = randomUUID();
let insertedWebsiteSourceType = false;
const ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD = (
  (BigInt(1) << BigInt(1024)) - (BigInt(1) << BigInt(970))
).toString();

function requireDisposableLocalDatabase() {
  if (!enabled) return;
  if (!databaseUrl) throw new Error("The opt-in Website funnel PostgreSQL test requires DATABASE_URL.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("The opt-in Website funnel PostgreSQL test only runs against a local disposable database.");
  }
}

function percentEncodeAscii(value: string) {
  return [...Buffer.from(value, "utf8")]
    .map((byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`)
    .join("");
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStringValues);
  }
  return [];
}

function paymentSeparatorSqlPattern() {
  const marker = 'input.scan_text collate "pg_c_utf8",';
  const markerIndex = WEBSITE_FUNNEL_AGGREGATE_SQL.indexOf(marker);
  const patternMatch = markerIndex < 0
    ? null
    : WEBSITE_FUNNEL_AGGREGATE_SQL.slice(markerIndex + marker.length).match(/^\s*'([^']+)'/u);
  if (!patternMatch) throw new Error("The payment separator SQL pattern is unavailable.");
  return patternMatch[1];
}

async function insertEvent(input: {
  sourceId: string;
  eventName: string;
  occurredAt: string;
  properties?: unknown;
  rawPropertiesJson?: string;
  eventSource?: "first_party_tracker" | "vercel_drain";
  schemaVersion?: "1.0" | "legacy";
  anonymousId?: string;
  sessionId?: string;
  path?: string;
  url?: string;
  referrer?: string | null;
  attributionContext?: unknown;
}) {
  if (Object.hasOwn(input, "properties") && Object.hasOwn(input, "rawPropertiesJson")) {
    throw new Error("Use either properties or rawPropertiesJson, not both.");
  }
  const path = input.path ?? "/products/fixture";
  const properties = Object.hasOwn(input, "properties") ? input.properties : {};
  const serializedProperties = Object.hasOwn(input, "rawPropertiesJson")
    ? input.rawPropertiesJson
    : JSON.stringify(properties);
  const attributionContext = Object.hasOwn(input, "attributionContext")
    ? input.attributionContext
    : {
        utm: {
          source: "fixture",
          medium: "test",
          campaign: "contract-v1",
        },
        landing_page: path,
      };
  await query(
    `
      insert into web_events (
        id,
        event_id,
        schema_version,
        event_source,
        source_id,
        anonymous_id,
        session_id,
        event_name,
        path,
        url,
        referrer,
        properties,
        attribution_context,
        consent_status,
        client_context,
        occurred_at,
        received_at,
        created_at
      ) values (
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::text,
        $5::uuid,
        $6::text,
        $7::text,
        $8::text,
        $9::text,
        $10::text,
        $11::text,
        $12::jsonb,
        $13::jsonb,
        '{"analytics":"granted","marketing":"denied"}'::jsonb,
        '{"device_category":"desktop"}'::jsonb,
        $14::timestamptz,
        $14::timestamptz + interval '1 second',
        $14::timestamptz + interval '1 second'
      )
    `,
    [
      randomUUID(),
      randomUUID(),
      input.schemaVersion ?? "1.0",
      input.eventSource ?? "first_party_tracker",
      input.sourceId,
      input.anonymousId ?? "fixture-visitor",
      input.sessionId ?? "fixture-session",
      input.eventName,
      path,
      input.url ?? `https://fixture.invalid${path}`,
      input.referrer ?? null,
      serializedProperties,
      JSON.stringify(attributionContext),
      input.occurredAt,
    ],
  );
}

describe.skipIf(!enabled)("Website funnel PostgreSQL aggregate", () => {
  beforeAll(async () => {
    requireDisposableLocalDatabase();
    const sourceType = await query(
      `
        insert into source_types (
          key,
          display_name,
          description,
          category,
          auth_type
        ) values (
          'website',
          'Website',
          'Disposable Website funnel integration source.',
          'website',
          'public_key'
        )
        on conflict (key) do nothing
        returning key
      `,
    );
    insertedWebsiteSourceType = sourceType.rowCount === 1;
    await query(
      `
        insert into data_spaces (
          id, slug, display_name, category, status
        ) values (
          $1::uuid, $2::text, 'Funnel integration fixture', 'test', 'active'
        )
      `,
      [dataSpaceId, `funnel-fixture-${dataSpaceId}`],
    );
    await query(
      `
        insert into sources (
          id,
          data_space_id,
          source_type_key,
          display_name,
          status,
          sync_mode
        ) values
          ($1::uuid, $3::uuid, 'website', 'Fixture Website', 'healthy', 'webhook'),
          ($2::uuid, $3::uuid, 'website', 'Other data-space Website', 'healthy', 'webhook')
      `,
      [websiteSourceId, otherSourceId, dataSpaceId],
    );
    await query(
      "update sources set status = 'disabled' where id = $1::uuid",
      [otherSourceId],
    );

    const item = {
      item_id: "FIXTURE-SKU",
      item_name: "Fixture product",
      item_category: "Ready-made",
      quantity: 1,
    };
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "page_view",
      occurredAt: "2026-07-02T16:00:00.000Z",
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "view_item",
      occurredAt: "2026-07-02T16:01:00.000Z",
      properties: {
        currency: " USD ",
        value: 80,
        items: [item],
        attribution: { utm: { source: "fixture", medium: "test" } },
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "add_to_cart",
      occurredAt: "2026-07-02T16:02:00.000Z",
      properties: { currency: "USD", value: 80, items: [item] },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "begin_checkout",
      occurredAt: "2026-07-02T16:03:00.000Z",
      properties: {
        currency: "USD",
        value: 80,
        items: [{ ...item, item_id: "fixture-product-slug" }],
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "view_item",
      occurredAt: "2026-07-02T16:04:00.000Z",
      properties: null,
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "fixture_unknown",
      occurredAt: "2026-07-02T16:05:00.000Z",
      properties: { diagnostic: true },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "page_view",
      occurredAt: "2026-07-02T16:06:00.000Z",
      eventSource: "vercel_drain",
    });
  });

  afterAll(async () => {
    if (enabled) {
      await query(
        "delete from web_events where source_id = any($1::uuid[])",
        [[websiteSourceId, otherSourceId]],
      );
      await query(
        "delete from sources where id = any($1::uuid[])",
        [[websiteSourceId, otherSourceId]],
      );
      await query("delete from data_spaces where id = $1::uuid", [dataSpaceId]);
      if (insertedWebsiteSourceType) {
        await query("delete from source_types where key = 'website'");
      }
      await closeDatabasePool();
    }
  });

  it("keeps PostgreSQL payment-span separators exhaustive with the frozen Unicode 17 contract", async () => {
    const expectedCodepoints: number[] = [];
    const separatorManifest: string[] = [];
    for (let codepoint = 1; codepoint <= 0x10ffff; codepoint += 1) {
      if (codepoint >= 0xd800 && codepoint <= 0xdfff) continue;
      const character = String.fromCodePoint(codepoint);
      if (isWebsitePaymentSeparator(character)) {
        separatorManifest.push(codepoint.toString(16).toUpperCase());
      }
      if ((codepoint >= 0x30 && codepoint <= 0x39) || isWebsitePaymentSeparator(character)) {
        expectedCodepoints.push(codepoint);
      }
    }
    expect({
      separatorCount: separatorManifest.length,
      separatorSha256: createHash("sha256").update(separatorManifest.join(",")).digest("hex"),
    }).toEqual({
      separatorCount: 9498,
      separatorSha256: "3ad6ea47d91684e6bf68beccc66b06fe925d5473b8a1175f4370fde1a9850b2e",
    });

    const parity = await query<{
      expected_count: number;
      postgres_count: number;
      missing_count: number;
      unexpected_count: number;
    }>(
      `
        with expected(codepoint) as materialized (
          select unnest($1::integer[])
        ),
        postgres_matches(codepoint) as materialized (
          select candidate.codepoint
          from generate_series(1, 1114111) candidate(codepoint)
          where case
            when candidate.codepoint between 55296 and 57343 then false
            else chr(candidate.codepoint) collate "pg_c_utf8" ~ $2::text
          end
        )
        select
          (select count(*)::integer from expected) as expected_count,
          (select count(*)::integer from postgres_matches) as postgres_count,
          (
            select count(*)::integer
            from expected
            left join postgres_matches using (codepoint)
            where postgres_matches.codepoint is null
          ) as missing_count,
          (
            select count(*)::integer
            from postgres_matches
            left join expected using (codepoint)
            where expected.codepoint is null
          ) as unexpected_count
      `,
      [expectedCodepoints, paymentSeparatorSqlPattern()],
    );

    expect(parity.rows[0]).toEqual({
      expected_count: expectedCodepoints.length,
      postgres_count: expectedCodepoints.length,
      missing_count: 0,
      unexpected_count: 0,
    });
  });

  it("executes the fixed query and preserves strict first-party semantics", async () => {
    const result = await getWebsiteFunnelAggregate({
      dataSpaceId,
      segment: "all",
      current: {
        startAt: "2026-07-01T07:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
      comparison: {
        startAt: "2026-06-24T07:00:00.000Z",
        endExclusive: "2026-07-01T07:00:00.000Z",
      },
    });

    expect(result.candidate_count).toBe(1);
    expect(
      result.stages
        .filter((row) => row.period_key === "current")
        .map((row) => [row.stage_key, Number(row.sessions)]),
    ).toEqual([
      ["visit", 1],
      ["product_intent", 1],
      ["add_to_cart", 1],
      ["begin_checkout", 1],
    ]);
    expect(result.invalid_properties).toContainEqual({
      period_key: "current",
      event_name: "view_item",
      events: 1,
    });
    expect(result.unknown_events[0]).toMatchObject({
      period_key: "current",
      event_name: "fixture_unknown",
      events: 1,
    });
    expect(result.event_counts).toContainEqual({
      period_key: "current",
      accepted_events: 6,
      unfiltered_events: 6,
    });
    expect(result.products.find((row) => row.item_id === "FIXTURE-SKU")).toMatchObject({
      stable_identity: true,
      product_view_sessions: 1,
      add_to_cart_sessions: 1,
      matched_view_to_cart_sessions: 1,
    });
    expect(result.products.find((row) => row.item_id === "Unknown / unmapped")).toMatchObject({
      stable_identity: false,
      product_view_events: 1,
    });
    expect(result.filter_options).toMatchObject({
      devices: ["desktop"],
      utm_sources: ["fixture"],
      utm_mediums: ["test"],
    });

    const exactMidnight = await getWebsiteFunnelAggregate({
      dataSpaceId,
      segment: "all",
      current: {
        startAt: "2026-07-08T07:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
      comparison: {
        startAt: "2026-07-01T07:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
    });

    expect(exactMidnight.candidate_count).toBe(1);
    expect(exactMidnight.source).toMatchObject({
      display_name: "Fixture Website",
      status: "healthy",
    });
    expect(exactMidnight.event_counts).toContainEqual({
      period_key: "current",
      accepted_events: 0,
      unfiltered_events: 0,
    });
  });

  it("normalizes unsafe historical display dimensions before aggregate output", async () => {
    const rawEmail = "private-person@example.invalid";
    const encodedEmail = "private-person%40example.invalid";
    const doubleEncodedEmail = "private-person%2540example.invalid";
    const unsafeCredentialUrl = `https://${rawEmail}/`;
    const syntheticIpv4 = ["198", "51", "100", "42"].join(".");
    const syntheticIpv6 = ["2001", "db8", "", "42"].join(":");
    const syntheticPhone = ["+1", " 202", "-555", "-0100"].join("");
    const invalidFirstIpv4 = `999.999.999.999x${syntheticIpv4}`;
    const invalidFirstPhone = `0000000x${syntheticPhone}`;
    const alternativeIpv4Host = "0xc633642a";
    const alternativeIpv4Url = `https://${alternativeIpv4Host}/`;
    const encodedAlternativeIpv4Url = percentEncodeAscii(alternativeIpv4Url);
    const trailingDotAlternativeIpv4Url = `https://${alternativeIpv4Host}./`;
    const backslashAlternativeIpv4Url = `https://${alternativeIpv4Host}\\path`;
    const elidedAlternativeIpv4Url = `https:${alternativeIpv4Host}`;
    const extraSlashAlternativeIpv4Url = `https:///${alternativeIpv4Host}`;
    const ftpAlternativeIpv4Url = `ftp:${alternativeIpv4Host}`;
    const fileAuthorityAlternativeIpv4Url = `file://${alternativeIpv4Host}/`;
    const safeNonSpecialNumericHostUrl = `fixture://${alternativeIpv4Host}/`;
    const safeFileNumericPathUrl = `file:///${alternativeIpv4Host}`;
    const syntheticCard = ["4242", "4242", "4242", "4242"].join(" ");
    const syntheticPan13 = ["700", "000", "000", "000", "3"].join("");
    const syntheticPan16 = ["7000", "0000", "0000", "0005"].join("");
    const syntheticPan19 = ["700", "0000", "0000", "0000", "000", "3"].join("");
    const dottedPan16 = syntheticPan16.match(/.{1,4}/gu)!.join(".");
    const invalidDottedPan16 = ["7000", "0000", "0000", "0100"].join(".");
    const slashPan16 = syntheticPan16.match(/.{1,4}/gu)!.join("/");
    const uninterruptedTwentyDigitIdentifier = `${syntheticPan19}5`;
    const expandingCompatibilityReferrer = `https://editorial.example.invalid/${"\u2152".repeat(800)}７０００．００００．００００．０００５`;
    const delimiterStressReferrers = [
      `https://editorial.example.invalid/${":".repeat(1150)}email=x`,
      `https://editorial.example.invalid/${":".repeat(1150)}phone=x`,
      `https://editorial.example.invalid/${":".repeat(1146)}source_id=x`,
    ];
    const syntheticSecret = ["to", "ken", "=", "synthetic_value_12345678"].join("");
    const syntheticAddress = ["123", " Main", " Street"].join("");
    const controlValue = `archive${String.fromCharCode(7)}control`;
    const alternativeIpv4DecimalHost = "2130706433";
    const spacedEncodedAlternativeUrl = `%20${percentEncodeAscii(
      `https://${alternativeIpv4DecimalHost}/`,
    )}%20`;
    const plusSeparatedPhone = ["+1", "+202", "+555", "+0100"].join("");
    const syntheticGitHubCredential = `ghp_${"A".repeat(30)}`;
    const syntheticGitHubFineGrainedCredential = [
      "github",
      "pat",
      "A".repeat(20),
    ].join("_");
    const syntheticShopifyCredential = `shpat_${"A".repeat(20)}`;
    const safeUtf16Boundary = "😀".repeat(128);
    const unsafeUtf16Boundary = "😀".repeat(129);
    const sourceParityFixtures = [
      { label: "leading-nbsp-url", value: `\u00a0https://${alternativeIpv4DecimalHost}/`, expected: "" },
      { label: "leading-bom-url", value: `\ufeffhttps://${alternativeIpv4DecimalHost}/`, expected: "" },
      { label: "trailing-nbsp-url", value: `https://${alternativeIpv4DecimalHost}/\u00a0`, expected: "" },
      { label: "ideographic-dot-url", value: "https://127\u30020\u30020\u30021/", expected: "" },
      { label: "fullwidth-dot-url", value: "https://127\uff0e0\uff0e0\uff0e1/", expected: "" },
      { label: "halfwidth-dot-url", value: "https://127\uff610\uff610\uff611/", expected: "" },
      { label: "mixed-dot-url", value: "https://0x7f\u30020.0\uff611/", expected: "" },
      { label: "fullwidth-decimal-url", value: "https://１２７.０.０.１/", expected: "" },
      { label: "fullwidth-hex-url", value: "https://０ｘ７ｆ.０.０.１/", expected: "" },
      { label: "superscript-decimal-url", value: "https://¹²⁷.⁰.⁰.¹/", expected: "" },
      { label: "soft-hyphen-url", value: "https://12\u00ad7.0.0.1/", expected: "" },
      { label: "zero-width-url", value: "https://12\u200b7.0.0.1/", expected: "" },
      { label: "combining-mark-ipv4", value: "198\u0301.51\u0301.100\u0301.42", expected: "" },
      { label: "combining-mark-numeric-host", value: "https://0x7f\u0301.0\u0301.0\u0301.1/", expected: "" },
      { label: "scheme-relative-url", value: `//${alternativeIpv4DecimalHost}/`, expected: "" },
      { label: "assigned-scheme-relative-url", value: `redirect=//${alternativeIpv4DecimalHost}/path`, expected: "" },
      { label: "wrapped-scheme-relative-url", value: `prefix (//${alternativeIpv4DecimalHost}/path)`, expected: "" },
      { label: "pipe-scheme-relative-url", value: `prefix|//${alternativeIpv4DecimalHost}/path`, expected: "" },
      { label: "extra-slash-relative-url", value: `///${alternativeIpv4DecimalHost}/`, expected: "" },
      { label: "backslash-relative-url", value: `/\\${alternativeIpv4DecimalHost}/`, expected: "" },
      { label: "ftp-multiple-userinfo-url", value: `ftp://a@b@${alternativeIpv4DecimalHost}/`, expected: "" },
      { label: "encoded-space-url", value: spacedEncodedAlternativeUrl, expected: "" },
      {
        label: "double-encoded-space-url",
        value: spacedEncodedAlternativeUrl.replaceAll("%", "%25"),
        expected: "",
      },
      { label: "unicode-fold-email", value: "user@e\u212aample.example.invalid", expected: "" },
      { label: "long-s-tld-email", value: "user@example.\u017f\u017f", expected: "" },
      { label: "eai-trailing-mark", value: "用户@例子.中国\u0301", expected: "" },
      { label: "decomposed-email", value: "jose\u0301@example.invalid", expected: "" },
      {
        label: "fullwidth-email",
        value: "ｐｒｉｖａｃｙ＠ｆｉｘｔｕｒｅ．ｉｎｖａｌｉｄ",
        expected: "",
      },
      {
        label: "encoded-fullwidth-email",
        value: encodeURIComponent("ｐｒｉｖａｃｙ＠ｆｉｘｔｕｒｅ．ｉｎｖａｌｉｄ"),
        expected: "",
      },
      { label: "fullwidth-percent-email", value: "private-person％40example.invalid", expected: "" },
      { label: "fullwidth-percent-digits-email", value: "private-person％４０example.invalid", expected: "" },
      { label: "fullwidth-percent-credential", value: "credential％3Asynthetic", expected: "" },
      { label: "unicode17-compat-email", value: "\u{1ccd6}@fixture.invalid", expected: "" },
      { label: "email-trailing-dot", value: "privacy@fixture.invalid.", expected: "" },
      { label: "email-trailing-hyphen", value: "privacy@fixture.invalid-", expected: "" },
      { label: "email-short-extra-label", value: "privacy@fixture.invalid.x", expected: "" },
      {
        label: "encoded-email-trailing-dot",
        value: percentEncodeAscii("privacy@fixture.invalid."),
        expected: "",
      },
      {
        label: "email-underscore-boundary-control",
        value: "privacy@fixture.invalid_",
        expected: "privacy@fixture.invalid_",
      },
      { label: "unicode-fold-address", value: "123 Main \u017ftreet", expected: "" },
      { label: "arabic-indic-address", value: "١٢٣ Main Street", expected: "" },
      { label: "devanagari-address", value: "१२३ Main Street", expected: "" },
      { label: "unicode-fold-po-box", value: "P O BOX \u212a123", expected: "" },
      { label: "unicode-fold-bearer", value: "Bearer abcdefg\u212a", expected: "" },
      { label: "unicode-fold-live-key", value: "sk_live_abcdefg\u212a", expected: "" },
      { label: "embedded-bom-address", value: "123\ufeffMain\ufeffStreet", expected: "" },
      { label: "embedded-bom-bearer", value: "Bearer\ufeffabcdefgh", expected: "" },
      { label: "zero-width-address", value: "123\u200bMain\u200bStreet", expected: "" },
      { label: "zero-width-bearer", value: "Bearer\u200babcdefgh", expected: "" },
      { label: "zero-width-basic", value: "Basic\u200bdXNlcjpwYXNz", expected: "" },
      { label: "zwnj-address", value: "123\u200cMain\u200cStreet", expected: "" },
      { label: "zwj-bearer", value: "Bearer\u200dabcdefgh", expected: "" },
      { label: "lrm-phone", value: "202\u200e555\u200e0100", expected: "" },
      { label: "rlo-pan", value: "7000\u202e0000\u202e0000\u202e0005", expected: "" },
      { label: "arabic-mark-basic", value: "Basic\u061cdXNlcjpwYXNz", expected: "" },
      { label: "braille-blank-address", value: "123\u2800Main\u2800Street", expected: "" },
      { label: "braille-blank-bearer", value: "Bearer\u2800abcdefgh", expected: "" },
      { label: "braille-blank-phone", value: "202\u2800555\u28000100", expected: "" },
      { label: "fullwidth-address", value: "１２３ Ｍａｉｎ Ｓｔｒｅｅｔ", expected: "" },
      { label: "fullwidth-bearer", value: "Ｂｅａｒｅｒ ａｂｃｄｅｆｇｈ", expected: "" },
      { label: "short-bearer", value: "Bearer abc123", expected: "" },
      { label: "one-character-bearer", value: "Bearer x", expected: "" },
      { label: "short-basic-unpadded", value: "Basic dTpw", expected: "" },
      { label: "six-character-basic-unpadded", value: "Basic YTpiYQ", expected: "" },
      { label: "two-character-basic-unpadded", value: "Basic Og", expected: "" },
      { label: "short-basic-padded", value: "Basic Og==", expected: "" },
      {
        label: "encoded-short-basic",
        value: encodeURIComponent("Basic dTpw"),
        expected: "",
      },
      { label: "embedded-token", value: "launch token=synthetic_value_12345678", expected: "" },
      {
        label: "parenthesized-password",
        value: "launch(password=synthetic_value_12345678)",
        expected: "",
      },
      { label: "spaced-api-key", value: "launch api key:synthetic_value_12345678", expected: "" },
      {
        label: "token-delimiter-space",
        value: "launch token = synthetic_value_12345678",
        expected: "",
      },
      { label: "json-token-key", value: '{"token":"synthetic_value_12345678"}', expected: "" },
      { label: "access-token-key", value: "accessToken=synthetic_value_12345678", expected: "" },
      { label: "refresh-token-key", value: "refresh_token=synthetic_value_12345678", expected: "" },
      { label: "client-secret-key", value: "client_secret=synthetic_value_12345678", expected: "" },
      {
        label: "encoded-access-key",
        value: encodeURIComponent("launch access key=synthetic_value_12345678"),
        expected: "",
      },
      { label: "http-userinfo", value: "https://alice:syntheticpass@localhost/path", expected: "" },
      { label: "ftp-userinfo", value: "ftp://alice:syntheticpass@localhost/path", expected: "" },
      {
        label: "custom-scheme-userinfo",
        value: "fixture://alice:syntheticpass@localhost/path",
        expected: "",
      },
      {
        label: "embedded-userinfo",
        value: "prefix https://alice:syntheticpass@localhost/path",
        expected: "",
      },
      { label: "relative-userinfo", value: "//alice:syntheticpass@localhost/path", expected: "" },
      { label: "backslash-userinfo", value: "\\\\alice:syntheticpass@localhost\\path", expected: "" },
      {
        label: "wrapped-relative-userinfo",
        value: "prefix (//alice:syntheticpass@localhost/path)",
        expected: "",
      },
      {
        label: "assigned-relative-userinfo",
        value: "redirect=//alice:syntheticpass@localhost/path",
        expected: "",
      },
      {
        label: "comma-delimited-relative-userinfo",
        value: "prefix,//alice:syntheticpass@localhost/path",
        expected: "",
      },
      {
        label: "json-relative-userinfo",
        value: '{"redirect":"//alice:syntheticpass@localhost/path"}',
        expected: "",
      },
      {
        label: "angle-wrapped-relative-userinfo",
        value: "prefix<//alice:syntheticpass@localhost/path>",
        expected: "",
      },
      {
        label: "pipe-delimited-relative-userinfo",
        value: "prefix|//alice:syntheticpass@localhost/path",
        expected: "",
      },
      {
        label: "ampersand-delimited-relative-userinfo",
        value: "prefix&//alice:syntheticpass@localhost/path",
        expected: "",
      },
      { label: "greater-than-relative-userinfo", value: "prefix>//alice:syntheticpass@localhost/path", expected: "" },
      { label: "plus-relative-userinfo", value: "prefix+//alice:syntheticpass@localhost/path", expected: "" },
      { label: "closing-brace-relative-userinfo", value: "prefix}//alice:syntheticpass@localhost/path", expected: "" },
      { label: "unicode-punctuation-relative-userinfo", value: "prefix—//alice:syntheticpass@localhost/path", expected: "" },
      { label: "first-name-field", value: "first_name=Alice", expected: "" },
      { label: "last-name-field", value: "lastName=Smith", expected: "" },
      { label: "full-name-field", value: "full name:Alice Smith", expected: "" },
      { label: "customer-name-field", value: "customer_name=Alice", expected: "" },
      { label: "alphanumeric-address", value: "42A Fixture Road", expected: "" },
      { label: "place-address", value: "1 Fixture Place", expected: "" },
      { label: "terrace-address", value: "10 Fixture Terrace", expected: "" },
      { label: "non-ascii-street-name", value: "123 Máin Street", expected: "" },
      { label: "combining-mark-address", value: "42A Fixtu\u0301re Road", expected: "" },
      { label: "comma-address", value: "123, Main Street", expected: "" },
      { label: "period-address", value: "123. Main Street", expected: "" },
      { label: "semicolon-address", value: "123; Main Street", expected: "" },
      { label: "colon-address", value: "123: Main Street", expected: "" },
      { label: "slash-address", value: "123/Main Street", expected: "" },
      { label: "slash-unit-address", value: "123/B Main Street", expected: "" },
      { label: "punctuation-slash-address", value: "123/Main/Street", expected: "" },
      { label: "punctuation-backslash-address", value: "123\\Main\\Street", expected: "" },
      { label: "punctuation-colon-address", value: "123:Main:Street", expected: "" },
      { label: "punctuation-period-address", value: "123.Main.Street", expected: "" },
      { label: "punctuation-comma-address", value: "123,Main,Street", expected: "" },
      { label: "punctuation-semicolon-address", value: "123;Main;Street", expected: "" },
      { label: "dotted-slash-po-box", value: "P.O.Box/123", expected: "" },
      { label: "slash-po-box", value: "P/O/Box/123", expected: "" },
      { label: "colon-po-box", value: "P:O:Box:123", expected: "" },
      { label: "comma-po-box", value: "P,O,Box,123", expected: "" },
      { label: "long-form-punctuation-po-box", value: "Post.Office.Box/123", expected: "" },
      { label: "synthetic-github-credential", value: syntheticGitHubCredential, expected: "" },
      {
        label: "synthetic-github-fine-grained-credential",
        value: syntheticGitHubFineGrainedCredential,
        expected: "",
      },
      { label: "synthetic-shopify-credential", value: syntheticShopifyCredential, expected: "" },
      { label: "canonical-email-key", value: "email=synthetic", expected: "" },
      { label: "canonical-phone-key", value: "mobile_number=synthetic", expected: "" },
      { label: "canonical-address-key", value: "shipping_address=synthetic", expected: "" },
      { label: "canonical-card-key", value: "card_number=synthetic", expected: "" },
      { label: "canonical-source-key", value: "source_id=synthetic", expected: "" },
      { label: "canonical-user-agent-key", value: "user_agent=synthetic", expected: "" },
      { label: "split-email-key", value: "e+m+a+i+l_hash=synthetic", expected: "" },
      { label: "quoted-slash-email-key", value: "\"e/m/a/i/l\"=synthetic", expected: "" },
      { label: "split-source-key", value: "s+o+u+r+c+e+i+d_value=synthetic", expected: "" },
      { label: "split-user-agent-key", value: "u+s+e+r+a+g+e+n+t_string=synthetic", expected: "" },
      { label: "concatenated-email-key", value: "customeremailhash=synthetic", expected: "" },
      { label: "concatenated-phone-key", value: "phonenumber=synthetic", expected: "" },
      { label: "concatenated-address-key", value: "shippingaddressline1=synthetic", expected: "" },
      { label: "concatenated-card-key", value: "cardnumberlast4=synthetic", expected: "" },
      { label: "concatenated-password-key", value: "passwordhash=synthetic", expected: "" },
      { label: "concatenated-name-key", value: "customernamenormalized=synthetic", expected: "" },
      { label: "concatenated-source-key", value: "sourceidvalue=synthetic", expected: "" },
      { label: "concatenated-tracking-key", value: "trackingkeyvalue=synthetic", expected: "" },
      { label: "concatenated-user-agent-key", value: "useragentstring=synthetic", expected: "" },
      { label: "numeric-email-key", value: "email1=synthetic", expected: "" },
      {
        label: "supplementary-padded-sensitive-key",
        value: `email${"😀".repeat(60)}label=synthetic`,
        expected: "",
      },
      { label: "later-pipe-email-key", value: "safe=x|email=synthetic", expected: "" },
      { label: "later-bang-phone-key", value: "safe=x!phone=synthetic", expected: "" },
      { label: "later-brace-source-key", value: "safe=x}source_id=synthetic", expected: "" },
      { label: "later-angle-user-agent-key", value: "safe=x>user_agent=synthetic", expected: "" },
      { label: "later-plus-tracking-key", value: "safe=x+tracking_key=synthetic", expected: "" },
      { label: "padded-email-key", value: `email${"x".repeat(121)}=synthetic`, expected: "" },
      { label: "encoded-fragment-delimiter", value: "archive%23control", expected: "" },
      { label: "encoded-query-delimiter", value: "archive%3Fcontrol", expected: "" },
      { label: "encoded-at-sign-delimiter", value: "archive%40control", expected: "" },
      { label: "email-before-safe-access-token", value: "emailAccessTokenizer=archive", expected: "" },
      { label: "token-before-safe-access-token", value: "tokenAccessTokenizer=archive", expected: "" },
      { label: "repeated-access-token", value: "accessTokenAccessTokenizer=archive", expected: "" },
      { label: "token-before-safe-source-id", value: "accessTokenizerSourceIdentifier=archive", expected: "" },
      { label: "access-token-non-safe-suffix", value: "accessTokenizerHash=archive", expected: "" },
      { label: "source-id-non-safe-suffix", value: "sourceIdentifierValue=archive", expected: "" },
      { label: "api-key-non-safe-suffix", value: "apiKeyNotebook=archive", expected: "" },
      { label: "split-access-token-terminal", value: "access-token-izer=archive", expected: "" },
      { label: "split-api-key-terminal", value: "api-key-note=archive", expected: "" },
      { label: "split-source-id-terminal", value: "source-id-entifier=archive", expected: "" },
      { label: "split-event-id-terminal", value: "event-id-ea=archive", expected: "" },
      { label: "split-user-agent-terminal", value: "user-agent-ive=archive", expected: "" },
      { label: "elided-https-userinfo", value: "https:alice:syntheticpass@localhost", expected: "" },
      { label: "single-slash-http-userinfo", value: "http:/alice:syntheticpass@localhost", expected: "" },
      { label: "single-backslash-https-userinfo", value: "https:\\alice:syntheticpass@localhost", expected: "" },
      { label: "elided-ftp-userinfo", value: "ftp:alice:syntheticpass@localhost", expected: "" },
      { label: "elided-ws-userinfo", value: "ws:alice:syntheticpass@localhost", expected: "" },
      { label: "malformed-numeric-scheme-userinfo", value: "1://alice:syntheticpass@localhost/path", expected: "" },
      { label: "malformed-punctuation-scheme-userinfo", value: "-://alice:syntheticpass@localhost/path", expected: "" },
      { label: "malformed-numeric-scheme-host", value: "1://0xc633642a/path", expected: "" },
      { label: "fullwidth-pan", value: "７０００．００００．００００．０００５", expected: "" },
      { label: "arabic-indic-pan", value: "٧٠٠٠.٠٠٠٠.٠٠٠٠.٠٠٠٥", expected: "" },
      { label: "devanagari-pan", value: "७०००.००००.००००.०००५", expected: "" },
      { label: "combining-mark-pan", value: "7000\u0301.0000\u0301.0000\u0301.0005", expected: "" },
      { label: "ignored-pan", value: "7000\u200b.0000.0000.0005", expected: "" },
      { label: "fullwidth-ipv4", value: "１９８．５１．１００．４２", expected: "" },
      { label: "arabic-indic-phone", value: "٢٠٢ ٥٥٥ ٠١٠٠", expected: "" },
      { label: "slash-phone-uk", value: "44/20/7946/0958", expected: "" },
      { label: "slash-phone-de", value: "49/30/1234/5678", expected: "" },
      { label: "slash-phone-national", value: "030/123/45678", expected: "" },
      { label: "contiguous-phone-kz", value: "74951234567", expected: "" },
      { label: "contiguous-phone-ma", value: "212612345678", expected: "" },
      { label: "contiguous-phone-ke", value: "254712345678", expected: "" },
      { label: "contiguous-phone-il", value: "972501234567", expected: "" },
      { label: "dotted-phone-uk", value: "44.20.7946.0958", expected: "" },
      { label: "dotted-phone-national", value: "020.7946.0958", expected: "" },
      { label: "two-run-phone-national-slash", value: "020/79460958", expected: "" },
      { label: "two-run-phone-national-hyphen", value: "020-79460958", expected: "" },
      { label: "two-run-phone-national-encoded", value: "020%2F79460958", expected: "" },
      { label: "two-run-phone-national-double-encoded", value: "020%252F79460958", expected: "" },
      { label: "unicode-dash-phone", value: "202–555–0100", expected: "" },
      { label: "symbol-phone", value: "202•555•0100", expected: "" },
      { label: "underscore-phone", value: "202_555_0100", expected: "" },
      { label: "combining-mark-phone", value: "202\u0301 555\u0301 0100", expected: "" },
      { label: "combining-mark-phone-uk", value: "44\u0301/20\u0301/7946\u0301/0958", expected: "" },
      { label: "compressed-nanp-local", value: "202-5550100", expected: "" },
      { label: "compressed-nanp-prefix", value: "202555-0100", expected: "" },
      { label: "compressed-nanp-spaced", value: "202 5550100", expected: "" },
      { label: "compressed-nanp-parenthesized", value: "(202)5550100", expected: "" },
      { label: "compressed-nanp-country", value: "1-202-5550100", expected: "" },
      {
        label: "formatted-phone-prefix-with-padding",
        value: "202ⓐ555ⓐ0100ⓐ000100",
        expected: "",
      },
      { label: "c1-control", value: `archive${String.fromCharCode(0x85)}control`, expected: "" },
      { label: "plus-separated-phone", value: plusSeparatedPhone, expected: "" },
      {
        label: "encoded-plus-separated-phone",
        value: percentEncodeAscii(plusSeparatedPhone),
        expected: "",
      },
      { label: "utf16-over-limit", value: unsafeUtf16Boundary, expected: "" },
      { label: "relative-path-control", value: `/${alternativeIpv4DecimalHost}`, expected: `/${alternativeIpv4DecimalHost}` },
      { label: "pseudo-scheme-colon-control", value: "://example.invalid/path", expected: "://example.invalid/path" },
      { label: "pseudo-scheme-numeric-control", value: "0://example.invalid/path", expected: "0://example.invalid/path" },
      { label: "pseudo-scheme-plus-control", value: "+://example.invalid/path", expected: "+://example.invalid/path" },
      { label: "pseudo-scheme-underscore-control", value: "_://example.invalid/path", expected: "_://example.invalid/path" },
      { label: "pseudo-scheme-dot-hyphen-control", value: ".-://example.invalid/path", expected: ".-://example.invalid/path" },
      {
        label: "unicode-domain-control",
        value: "https://12é7.example.invalid/",
        expected: "https://12é7.example.invalid/",
      },
      { label: "utf16-boundary-control", value: safeUtf16Boundary, expected: safeUtf16Boundary },
      { label: "trimmed-control", value: "\u00a0spring-sale\ufeff", expected: "spring-sale" },
      { label: "localized-year-control", value: "summer-٢٠٢٦", expected: "summer-٢٠٢٦" },
      { label: "year-release-control", value: "2026-1234567", expected: "2026-1234567" },
      { label: "two-run-release-control", value: "2026/12345678", expected: "2026/12345678" },
      { label: "invalid-nanp-area-control", value: "102-5550100", expected: "102-5550100" },
      { label: "invalid-nanp-exchange-control", value: "202-1550100", expected: "202-1550100" },
      { label: "numeric-campaign-control", value: "campaign-123.4-release", expected: "campaign-123.4-release" },
      { label: "numeric-path-label-control", value: "archive/123/version", expected: "archive/123/version" },
      { label: "post-office-campaign-control", value: "post-office-launch", expected: "post-office-launch" },
      { label: "postal-campaign-control", value: "postal-campaign", expected: "postal-campaign" },
      { label: "fullwidth-percent-control", value: "save％off", expected: "save％off" },
      { label: "fullwidth-label-control", value: "ＳＰＲＩＮＧ", expected: "ＳＰＲＩＮＧ" },
      { label: "token-prefix-control", value: "tokenizer=archive", expected: "tokenizer=archive" },
      { label: "basic-plan-control", value: "Basic plan", expected: "Basic plan" },
      { label: "basic-tier-control", value: "Basic tier", expected: "Basic tier" },
      { label: "bearer-word-control", value: "bearer-bond", expected: "bearer-bond" },
      { label: "basic-word-control", value: "basic-plan", expected: "basic-plan" },
      {
        label: "first-name-campaign-control",
        value: "first-name-campaign",
        expected: "first-name-campaign",
      },
      {
        label: "customer-name-campaign-control",
        value: "customer-name-story",
        expected: "customer-name-story",
      },
      { label: "api-key-word-prefix-control", value: "api-keynote=archive", expected: "api-keynote=archive" },
      {
        label: "access-token-word-prefix-control",
        value: "accessTokenizer=archive",
        expected: "accessTokenizer=archive",
      },
      { label: "source-identifier-control", value: "source-identifier=archive", expected: "source-identifier=archive" },
      { label: "event-idea-control", value: "event-idea=archive", expected: "event-idea=archive" },
      { label: "session-idea-control", value: "session-idea=archive", expected: "session-idea=archive" },
      { label: "anonymous-idea-control", value: "anonymous-idea=archive", expected: "anonymous-idea=archive" },
      { label: "user-idea-control", value: "user-idea=archive", expected: "user-idea=archive" },
      { label: "tracking-keynote-control", value: "tracking-keynote=archive", expected: "tracking-keynote=archive" },
      { label: "user-agentive-control", value: "user-agentive=archive", expected: "user-agentive=archive" },
      {
        label: "ignored-character-label-control",
        value: "launch\u200barchive",
        expected: "launch\u200barchive",
      },
      { label: "emoji-zwj-control", value: "launch-👩‍💻-archive", expected: "launch-👩‍💻-archive" },
      { label: "rtl-format-control", value: "campaign\u202earchive", expected: "campaign\u202earchive" },
      { label: "braille-blank-control", value: "campaign\u2800archive", expected: "campaign\u2800archive" },
      { label: "social-handle-control", value: "social@handle", expected: "social@handle" },
      {
        label: "url-path-at-control",
        value: "https://fixture.invalid/archive/social@handle",
        expected: "https://fixture.invalid/archive/social@handle",
      },
      {
        label: "url-path-repeated-slash-at-control",
        value: "https://fixture.invalid/archive//social@handle",
        expected: "https://fixture.invalid/archive//social@handle",
      },
      {
        label: "relative-path-repeated-slash-at-control",
        value: "/collections/archive//social@handle",
        expected: "/collections/archive//social@handle",
      },
      { label: "opaque-scheme-control", value: "fixture:alice@localhost", expected: "fixture:alice@localhost" },
      {
        label: "repeated-slash-control",
        value: "/collections/2026//123/",
        expected: "/collections/2026//123/",
      },
      { label: "unicode-multi-lower-control", value: "\u0130", expected: "\u0130" },
      { label: "greek-final-sigma-control", value: "\u039f\u03a3", expected: "\u039f\u03a3" },
      { label: "unknown-control", value: "uNkNoWn", expected: "Unknown" },
    ] as const;
    const sourceParityUnsafeCampaign = "parity-unsafe-cases";
    const sourceParityCampaign = (index: number) => (
      sourceParityFixtures[index]?.expected === ""
        ? sourceParityUnsafeCampaign
        : `parity-fixture-${index}-case`
    );
    for (const fixture of sourceParityFixtures) {
      expect(sanitizeWebsiteDisplayDimension(fixture.value, "utm", 256)).toBe(fixture.expected);
    }
    expect(expandingCompatibilityReferrer.length).toBeLessThanOrEqual(1200);
    expect(sanitizeWebsiteDisplayDimension(
      expandingCompatibilityReferrer,
      "utm",
      1200,
    )).toBe("");
    for (const delimiterStressReferrer of delimiterStressReferrers) {
      expect(delimiterStressReferrer.length).toBeLessThanOrEqual(1200);
      expect(sanitizeWebsiteDisplayDimension(delimiterStressReferrer, "utm", 1200)).toBe("");
    }
    const paymentPrivacyFixtures = [
      { label: "dotted", value: dottedPan16, unsafe: true },
      { label: "embedded", value: `launch-${dottedPan16}-archive`, unsafe: true },
      { label: "mixed-separators", value: "7000,0000_0000/0005", unsafe: true },
      { label: "punctuation-separators", value: "7000;0000!0000=0005", unsafe: true },
      { label: "unicode-separators", value: "7000\u00a00000\u20140000\u20090005", unsafe: true },
      {
        label: "alphabetic-symbol-separators",
        value: "7000\u24d00000\u24d00000\u24d00005",
        unsafe: true,
      },
      {
        label: "supplementary-symbol-separators",
        value: "7000\u{1f130}0000\u{1f130}0000\u{1f130}0005",
        unsafe: true,
      },
      {
        label: "unicode-table-gap-bmp-separators",
        value: "7000\u24270000\u24270000\u24270005",
        unsafe: true,
      },
      {
        label: "unicode-table-gap-supplementary-separators",
        value: "7000\u{1f8d0}0000\u{1f8d0}0000\u{1f8d0}0005",
        unsafe: true,
      },
      {
        label: "combining-mark-separators-with-padding",
        value: "7000\u03010000\u03010000\u03010005\u03011234",
        unsafe: true,
      },
      {
        label: "zero-width-separators-with-padding",
        value: "7000\u200b0000\u200b0000\u200b0005\u200b1234",
        unsafe: true,
      },
      { label: "contiguous", value: syntheticPan16, unsafe: true },
      { label: "thirteen-digit", value: syntheticPan13, unsafe: true },
      { label: "nineteen-digit", value: syntheticPan19, unsafe: true },
      { label: "encoded", value: percentEncodeAscii(slashPan16), unsafe: true },
      {
        label: "double-encoded",
        value: percentEncodeAscii(slashPan16).replaceAll("%", "%25"),
        unsafe: true,
      },
      {
        label: "triple-encoded",
        value: percentEncodeAscii(slashPan16)
          .replaceAll("%", "%25")
          .replaceAll("%", "%25"),
        unsafe: true,
      },
      {
        label: "encoding-beyond-bound",
        value: slashPan16.replaceAll("/", "%2525252F"),
        unsafe: true,
      },
      {
        label: "encoded-unicode-separators",
        value: [
          "7000", "%C2%A0", "0000", "%E2%80%94", "0000", "%E2%80%89", "0005",
        ].join(""),
        unsafe: true,
      },
      {
        label: "malformed-separators",
        value: ["7000", "0000", "0000", "0005"].join("%ZZ"),
        unsafe: true,
      },
      { label: "malformed-control", value: "spring%ZZsale", unsafe: true },
      { label: "invalid-utf8-control", value: "campaign%E2%28%A1", unsafe: true },
      { label: "surrogate-control", value: "campaign%ED%A0%80", unsafe: true },
      {
        label: "residual-fourth-pass-control",
        value: "spring%25252520sale",
        unsafe: true,
      },
      {
        label: "later-candidate",
        value: `first-${invalidDottedPan16}-then-${dottedPan16}`,
        unsafe: true,
      },
      { label: "multiple-candidates", value: `${dottedPan16}|${syntheticPan13}`, unsafe: true },
      { label: "malformed-before-card", value: `%ZZ-${dottedPan16}`, unsafe: true },
      {
        label: "long-run-then-card",
        value: `${uninterruptedTwentyDigitIdentifier}-${dottedPan16}`,
        unsafe: true,
      },
      { label: "surrounded-card", value: `9-${dottedPan16}-8`, unsafe: true },
      { label: "invalid-check-digit", value: invalidDottedPan16, unsafe: false },
      { label: "twelve-digit", value: "7000.0000.0003", unsafe: false },
      { label: "twenty-digit", value: uninterruptedTwentyDigitIdentifier, unsafe: false },
      {
        label: "twenty-digit-then-short",
        value: `${uninterruptedTwentyDigitIdentifier}-12`,
        unsafe: false,
      },
      { label: "letter-boundaries", value: "700000A000000B005", unsafe: false },
      { label: "encoded-unicode-control", value: "caf%C3%A9", unsafe: false },
      { label: "bounded-triple-encoded-control", value: "spring%252520sale", unsafe: false },
    ] as const;
    const paymentUnsafeCampaign = "payment-unsafe-cases";
    const paymentCampaign = (fixture: (typeof paymentPrivacyFixtures)[number]) => (
      fixture.unsafe ? paymentUnsafeCampaign : `payment-${fixture.label}-case`
    );
    const paymentDimensionFixtures = [
      {
        label: "unsafe-landing",
        kind: "landing_path" as const,
        value: `/campaign/${dottedPan16}`,
        unsafe: true,
      },
      {
        label: "safe-landing",
        kind: "landing_path" as const,
        value: `/campaign/${invalidDottedPan16}`,
        unsafe: false,
      },
      {
        label: "unsafe-referrer",
        kind: "referrer_host" as const,
        value: `${dottedPan16}.invalid`,
        unsafe: true,
      },
      {
        label: "safe-referrer",
        kind: "referrer_host" as const,
        value: `${invalidDottedPan16}.invalid`,
        unsafe: false,
      },
    ] as const;
    for (const fixture of paymentPrivacyFixtures) {
      expect(sanitizeWebsiteDisplayDimension(fixture.value, "utm", 256)).toBe(
        fixture.unsafe ? "" : fixture.value,
      );
    }
    for (const fixture of paymentDimensionFixtures) {
      expect(sanitizeWebsiteDisplayDimension(fixture.value, fixture.kind, 500)).toBe(
        fixture.unsafe ? "" : fixture.value,
      );
    }
    for (const fixture of [
      { value: invalidFirstIpv4, kind: "utm" as const, maximumLength: 256 },
      { value: invalidFirstPhone, kind: "utm" as const, maximumLength: 256 },
      { value: alternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: encodedAlternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: trailingDotAlternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: backslashAlternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: elidedAlternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: extraSlashAlternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: ftpAlternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: fileAuthorityAlternativeIpv4Url, kind: "utm" as const, maximumLength: 256 },
      { value: alternativeIpv4Host, kind: "referrer_host" as const, maximumLength: 253 },
    ]) {
      expect(sanitizeWebsiteDisplayDimension(
        fixture.value,
        fixture.kind,
        fixture.maximumLength,
      )).toBe("");
    }
    for (const value of [safeNonSpecialNumericHostUrl, safeFileNumericPathUrl]) {
      expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe(value);
    }
    const encodedPrivacyFixtures = [
      { label: "phone", value: syntheticPhone },
      { label: "address", value: syntheticAddress },
      { label: "secret", value: syntheticSecret },
      { label: "ip", value: syntheticIpv4 },
    ].flatMap((fixture, index) => {
      const encoded = percentEncodeAscii(fixture.value);
      return [
        {
          sessionId: `privacy-encoded-${fixture.label}`,
          minute: 40 + index * 2,
          attributionContext: {
            utm: {
              source: encoded,
              medium: "test",
              campaign: `encoded-${fixture.label}-case`,
            },
            landing_page: "/collections/archive",
          },
        },
        {
          sessionId: `privacy-double-encoded-${fixture.label}`,
          minute: 41 + index * 2,
          attributionContext: {
            utm: {
              source: encoded.replaceAll("%", "%25"),
              medium: "test",
              campaign: `double-encoded-${fixture.label}-case`,
            },
            landing_page: "/collections/archive",
          },
        },
      ];
    });
    const safeItem = {
      item_id: "ARCHIVE-SAFE-SKU",
      item_name: "Archive safe product",
      item_category: "Ready-made",
      quantity: 1,
    };
    const privacyFixtures = [
      {
        sessionId: "privacy-raw-email",
        minute: 0,
        attributionContext: {
          utm: { source: rawEmail, medium: "email", campaign: "raw-email-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-encoded-email",
        minute: 2,
        attributionContext: {
          utm: { source: encodedEmail, medium: "email", campaign: "encoded-email-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-double-encoded-email",
        minute: 4,
        attributionContext: {
          utm: { source: doubleEncodedEmail, medium: "email", campaign: "double-encoded-email-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-ipv4",
        minute: 5,
        attributionContext: {
          utm: { source: syntheticIpv4, medium: "test", campaign: "ipv4-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-ipv6",
        minute: 6,
        attributionContext: {
          utm: { source: syntheticIpv6, medium: "test", campaign: "ipv6-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-phone",
        minute: 7,
        attributionContext: {
          utm: { source: syntheticPhone, medium: "test", campaign: "phone-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-invalid-first-ipv4",
        minute: 48,
        attributionContext: {
          utm: { source: invalidFirstIpv4, medium: "test", campaign: "invalid-first-ipv4-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-invalid-first-phone",
        minute: 49,
        attributionContext: {
          utm: { source: invalidFirstPhone, medium: "test", campaign: "invalid-first-phone-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-alternative-ipv4-url",
        minute: 50,
        attributionContext: {
          utm: { source: alternativeIpv4Url, medium: "test", campaign: "alternative-ipv4-url-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-encoded-alternative-ipv4-url",
        minute: 51,
        attributionContext: {
          utm: {
            source: encodedAlternativeIpv4Url,
            medium: "test",
            campaign: "encoded-alternative-ipv4-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-alternative-ipv4-referrer",
        minute: 52,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "alternative-ipv4-referrer-case" },
          landing_page: "/collections/archive",
          first_referrer: alternativeIpv4Url,
        },
      },
      {
        sessionId: "privacy-expanded-payment-referrer",
        minute: 52,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "expanded-payment-referrer-case" },
          landing_page: "/collections/archive",
          first_referrer: expandingCompatibilityReferrer,
        },
      },
      ...delimiterStressReferrers.map((firstReferrer, index) => ({
        sessionId: `privacy-delimiter-stress-referrer-${index}`,
        minute: 52 + index,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "expanded-payment-referrer-case" },
          landing_page: "/collections/archive",
          first_referrer: firstReferrer,
        },
      })),
      {
        sessionId: "privacy-trailing-dot-alternative-ipv4-url",
        minute: 53,
        attributionContext: {
          utm: {
            source: trailingDotAlternativeIpv4Url,
            medium: "test",
            campaign: "trailing-dot-alternative-ipv4-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-backslash-alternative-ipv4-url",
        minute: 54,
        attributionContext: {
          utm: {
            source: backslashAlternativeIpv4Url,
            medium: "test",
            campaign: "backslash-alternative-ipv4-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-elided-alternative-ipv4-url",
        minute: 55,
        attributionContext: {
          utm: {
            source: elidedAlternativeIpv4Url,
            medium: "test",
            campaign: "elided-alternative-ipv4-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-extra-slash-alternative-ipv4-url",
        minute: 56,
        attributionContext: {
          utm: {
            source: extraSlashAlternativeIpv4Url,
            medium: "test",
            campaign: "extra-slash-alternative-ipv4-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-ftp-alternative-ipv4-url",
        minute: 57,
        attributionContext: {
          utm: {
            source: ftpAlternativeIpv4Url,
            medium: "test",
            campaign: "ftp-alternative-ipv4-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-file-authority-alternative-ipv4-url",
        minute: 57,
        attributionContext: {
          utm: {
            source: fileAuthorityAlternativeIpv4Url,
            medium: "test",
            campaign: "file-authority-alternative-ipv4-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-safe-non-special-numeric-host-url",
        minute: 58,
        attributionContext: {
          utm: {
            source: safeNonSpecialNumericHostUrl,
            medium: "test",
            campaign: "safe-non-special-numeric-host-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-safe-file-numeric-path-url",
        minute: 59,
        attributionContext: {
          utm: {
            source: safeFileNumericPathUrl,
            medium: "test",
            campaign: "safe-file-numeric-path-url-case",
          },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-card",
        minute: 8,
        attributionContext: {
          utm: { source: syntheticCard, medium: "test", campaign: "card-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-secret",
        minute: 9,
        attributionContext: {
          utm: { source: syntheticSecret, medium: "test", campaign: "secret-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-control",
        minute: 10,
        attributionContext: {
          utm: { source: controlValue, medium: "test", campaign: "control-case" },
          landing_page: "/collections/archive",
        },
      },
      {
        sessionId: "privacy-unsafe-primary",
        minute: 12,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "unsafe-primary-case" },
          landing_page: "/collections/archive",
          first_referrer: unsafeCredentialUrl,
        },
        referrer: "https://safe-fallback.example.invalid/",
      },
      {
        sessionId: "privacy-safe-fallback",
        minute: 14,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "safe-fallback-case" },
          landing_page: "/collections/archive",
        },
        referrer: "https://safe-fallback.example.invalid/",
      },
      {
        sessionId: "privacy-unsafe-fallback",
        minute: 16,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "unsafe-fallback-case" },
          landing_page: "/collections/archive",
        },
        referrer: unsafeCredentialUrl,
      },
      {
        sessionId: "privacy-unsafe-landing",
        minute: 18,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "unsafe-landing-case" },
          landing_page: `/collections/${doubleEncodedEmail}`,
        },
      },
      {
        sessionId: "privacy-safe-control",
        minute: 20,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "safe-control" },
          landing_page: "/collections/archive",
          first_referrer: "https://editorial.example.invalid/",
        },
      },
      {
        sessionId: "privacy-referrer-query",
        minute: 22,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "referrer-query-case" },
          landing_page: "/collections/archive",
          first_referrer: `https://editorial.example.invalid/path?${syntheticSecret}`,
        },
      },
      {
        sessionId: "privacy-referrer-fragment",
        minute: 24,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "referrer-fragment-case" },
          landing_page: "/collections/archive",
          first_referrer: "https://editorial.example.invalid/path#fragment",
        },
      },
      {
        sessionId: "privacy-referrer-port",
        minute: 26,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "referrer-port-case" },
          landing_page: "/collections/archive",
          first_referrer: "https://editorial.example.invalid:70000/",
        },
      },
      {
        sessionId: "privacy-referrer-ip",
        minute: 28,
        attributionContext: {
          utm: { source: "archive", medium: "referral", campaign: "referrer-ip-case" },
          landing_page: "/collections/archive",
          first_referrer: `https://${syntheticIpv4}/`,
        },
      },
      ...sourceParityFixtures.map((fixture, index) => ({
        sessionId: `privacy-parity-${fixture.label}`,
        minute: index % 60,
        attributionContext: {
          utm: {
            source: fixture.value,
            medium: "test",
            campaign: sourceParityCampaign(index),
          },
          landing_page: "/collections/archive",
        },
      })),
      ...encodedPrivacyFixtures,
    ] as const;

    await Promise.all(privacyFixtures.map((fixture) => insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: fixture.sessionId,
        anonymousId: `${fixture.sessionId}-visitor`,
        eventName: "page_view",
        occurredAt: `2026-08-10T16:${String(fixture.minute).padStart(2, "0")}:00.000Z`,
        path: "/collections/archive",
        attributionContext: fixture.attributionContext,
        referrer: "referrer" in fixture ? fixture.referrer : null,
      })));

    await Promise.all(paymentPrivacyFixtures.map((fixture, index) => insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: `privacy-payment-${fixture.label}`,
        anonymousId: `privacy-payment-${fixture.label}-visitor`,
        eventName: "page_view",
        occurredAt: `2026-08-10T17:${String(index).padStart(2, "0")}:00.000Z`,
        path: "/collections/archive",
        attributionContext: {
          utm: {
            source: fixture.value,
            medium: "test",
            campaign: paymentCampaign(fixture),
          },
          landing_page: "/collections/archive",
        },
      })));

    await Promise.all(paymentDimensionFixtures.map((fixture, index) => {
      const isLanding = fixture.kind === "landing_path";
      return insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: `privacy-payment-${fixture.label}`,
        anonymousId: `privacy-payment-${fixture.label}-visitor`,
        eventName: "page_view",
        occurredAt: `2026-08-10T17:${String(30 + index).padStart(2, "0")}:00.000Z`,
        path: "/collections/archive",
        attributionContext: {
          utm: {
            source: "payment-dimension",
            medium: "test",
            campaign: `payment-${fixture.label}-case`,
          },
          landing_page: isLanding ? fixture.value : "/collections/archive",
          ...(!isLanding
            ? { first_referrer: `https://${fixture.value}/` }
            : {}),
        },
      });
    }));

    const unsafeItemFixtures = [
      {
        sessionId: "privacy-item-id",
        minute: 20,
        properties: {
          currency: "USD",
          value: 80,
          items: [{ ...safeItem, item_id: rawEmail }],
        },
      },
      {
        sessionId: "privacy-item-name",
        minute: 23,
        properties: {
          currency: "USD",
          value: 80,
          items: [{ ...safeItem, item_name: encodedEmail }],
        },
      },
      {
        sessionId: "privacy-item-category",
        minute: 26,
        properties: {
          currency: "USD",
          value: 80,
          items: [{ ...safeItem, item_category: doubleEncodedEmail }],
        },
      },
      {
        sessionId: "privacy-item-payment",
        minute: 29,
        properties: {
          currency: "USD",
          value: 80,
          items: [{ ...safeItem, item_id: dottedPan16 }],
        },
      },
      {
        sessionId: "privacy-item-alternative-ipv4-url",
        minute: 32,
        properties: {
          currency: "USD",
          value: 80,
          items: [{ ...safeItem, item_id: alternativeIpv4Url }],
        },
      },
    ] as const;

    await Promise.all(unsafeItemFixtures.flatMap((fixture) => [
      insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: fixture.sessionId,
        anonymousId: `${fixture.sessionId}-visitor`,
        eventName: "page_view",
        occurredAt: `2026-08-10T16:${String(fixture.minute).padStart(2, "0")}:00.000Z`,
        path: "/products/archive-safe",
        attributionContext: {
          utm: { source: "product-safety", medium: "test", campaign: fixture.sessionId },
          landing_page: "/products/archive-safe",
        },
      }),
      insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: fixture.sessionId,
        anonymousId: `${fixture.sessionId}-visitor`,
        eventName: "view_item",
        occurredAt: `2026-08-10T16:${String(fixture.minute + 1).padStart(2, "0")}:00.000Z`,
        path: "/products/archive-safe",
        attributionContext: {},
        properties: fixture.properties,
      }),
    ]));

    await insertEvent({
      sourceId: websiteSourceId,
      schemaVersion: "legacy",
      sessionId: "privacy-item-list",
      anonymousId: "privacy-item-list-visitor",
      eventName: "page_view",
      occurredAt: "2026-08-10T16:30:00.000Z",
      path: "/collections/archive",
      attributionContext: {
        utm: { source: "product-safety", medium: "test", campaign: "unsafe-item-list" },
        landing_page: "/collections/archive",
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      schemaVersion: "legacy",
      sessionId: "privacy-item-list",
      anonymousId: "privacy-item-list-visitor",
      eventName: "view_item_list",
      occurredAt: "2026-08-10T16:31:00.000Z",
      path: "/collections/archive",
      attributionContext: {},
      properties: {
        item_list_name: rawEmail,
        items: [{ ...safeItem, item_list_name: dottedPan16 }],
      },
    });

    await insertEvent({
      sourceId: websiteSourceId,
      schemaVersion: "legacy",
      sessionId: "privacy-safe-item",
      anonymousId: "privacy-safe-item-visitor",
      eventName: "page_view",
      occurredAt: "2026-08-10T16:34:00.000Z",
      path: "/products/archive-safe",
      attributionContext: {
        utm: { source: "product-safety", medium: "test", campaign: "safe-item-control" },
        landing_page: "/products/archive-safe",
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      schemaVersion: "legacy",
      sessionId: "privacy-safe-item",
      anonymousId: "privacy-safe-item-visitor",
      eventName: "view_item",
      occurredAt: "2026-08-10T16:35:00.000Z",
      path: "/products/archive-safe",
      attributionContext: {},
      properties: {
        currency: "USD",
        value: 80,
        items: [safeItem],
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      schemaVersion: "legacy",
      sessionId: "privacy-safe-item",
      anonymousId: "privacy-safe-item-visitor",
      eventName: "add_to_cart",
      occurredAt: "2026-08-10T16:36:00.000Z",
      path: "/products/archive-safe",
      attributionContext: {},
      properties: {
        currency: "USD",
        value: 80,
        items: [safeItem],
      },
    });

    const safeUnknownEventName = "privacy_safe_custom";
    const unsafeUnknownEventNames = [
      ["202", "555", "0100"].join(""),
      ["to", "ken", ":", "synthetic_value_12345678"].join(""),
    ];
    await insertEvent({
      sourceId: websiteSourceId,
      schemaVersion: "legacy",
      sessionId: "privacy-safe-unknown-event",
      anonymousId: "privacy-safe-unknown-event-visitor",
      eventName: safeUnknownEventName,
      occurredAt: "2026-08-10T16:50:00.000Z",
      attributionContext: {},
    });
    for (const [index, eventName] of unsafeUnknownEventNames.entries()) {
      await insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: `privacy-unsafe-unknown-event-${index}`,
        anonymousId: `privacy-unsafe-unknown-event-${index}-visitor`,
        eventName,
        occurredAt: `2026-08-10T16:${51 + index}:00.000Z`,
        attributionContext: {},
      });
    }

    const acquisitionPageLimit = 100;
    const aggregateInput = {
      dataSpaceId,
      segment: "all" as const,
      current: {
        startAt: "2026-08-10T07:00:00.000Z",
        endExclusive: "2026-08-11T07:00:00.000Z",
      },
      comparison: {
        startAt: "2026-08-09T07:00:00.000Z",
        endExclusive: "2026-08-10T07:00:00.000Z",
      },
      pagination: {
        groupLimit: acquisitionPageLimit,
      },
    };
    const result = await getWebsiteFunnelAggregate(aggregateInput);
    const acquisitionTotal = Number(result.group_totals.acquisition);
    const acquisitionOffsets = Array.from(
      { length: Math.max(0, Math.ceil(acquisitionTotal / acquisitionPageLimit) - 1) },
      (_, index) => (index + 1) * acquisitionPageLimit,
    );
    const acquisitionPages = await Promise.all(acquisitionOffsets.map((acquisitionOffset) => (
      getWebsiteFunnelAggregate({
        ...aggregateInput,
        pagination: {
          ...aggregateInput.pagination,
          acquisitionOffset,
        },
      })
    )));
    for (const acquisitionPage of acquisitionPages) {
      result.acquisition.push(...acquisitionPage.acquisition);
    }
    const unsafeCanaries = [
      rawEmail,
      encodedEmail,
      doubleEncodedEmail,
      unsafeCredentialUrl,
      syntheticIpv4,
      syntheticIpv6,
      syntheticPhone,
      invalidFirstIpv4,
      invalidFirstPhone,
      alternativeIpv4Host,
      alternativeIpv4Url,
      encodedAlternativeIpv4Url,
      trailingDotAlternativeIpv4Url,
      backslashAlternativeIpv4Url,
      elidedAlternativeIpv4Url,
      extraSlashAlternativeIpv4Url,
      ftpAlternativeIpv4Url,
      fileAuthorityAlternativeIpv4Url,
      expandingCompatibilityReferrer,
      ...delimiterStressReferrers,
      syntheticCard,
      syntheticSecret,
      syntheticAddress,
      controlValue,
      ...encodedPrivacyFixtures.map((fixture) => fixture.attributionContext.utm.source),
      ...paymentPrivacyFixtures.filter((fixture) => fixture.unsafe).map((fixture) => fixture.value),
      ...paymentDimensionFixtures.filter((fixture) => fixture.unsafe).map((fixture) => fixture.value),
      ...sourceParityFixtures
        .filter((fixture) => fixture.expected === "" || fixture.expected !== fixture.value)
        .map((fixture) => fixture.value),
      ...unsafeUnknownEventNames,
    ];

    const returnedStrings = collectStringValues(result);
    const approvedSafeReturnedStrings = new Set([
      ...paymentPrivacyFixtures
        .filter((fixture) => !fixture.unsafe)
        .flatMap((fixture) => [fixture.value, fixture.value.toLowerCase()]),
      ...paymentDimensionFixtures
        .filter((fixture) => !fixture.unsafe)
        .flatMap((fixture) => [fixture.value, fixture.value.toLowerCase()]),
      safeNonSpecialNumericHostUrl,
      safeFileNumericPathUrl,
      ...sourceParityFixtures
        .filter((fixture) => fixture.expected !== "")
        .flatMap((fixture) => [fixture.expected, fixture.expected.toLowerCase()]),
    ]);
    expect(unsafeCanaries.findIndex((canary) =>
      returnedStrings.some((value) =>
        value.includes(canary) && !approvedSafeReturnedStrings.has(value))),
    ).toBe(-1);
    expect(result.filter_options.utm_sources).not.toContain(rawEmail);
    expect(result.filter_options.utm_sources).not.toContain(encodedEmail);
    expect(result.filter_options.utm_sources).not.toContain(doubleEncodedEmail);
    expect(result.filter_options.utm_sources).toContain("Unknown");
    expect(result.filter_options.utm_sources).toContain("archive");
    expect(result.filter_options.utm_sources).toContain(safeNonSpecialNumericHostUrl);
    expect(result.filter_options.utm_sources).toContain(safeFileNumericPathUrl);
    expect(result.filter_options.landing_pages).toContain("Unknown");
    expect(result.filter_options.referrer_hosts).toContain("Unknown");
    expect(result.filter_options.referrer_hosts).toContain("editorial.example.invalid");

    for (const campaign of [
      "raw-email-case",
      "encoded-email-case",
      "double-encoded-email-case",
      "ipv4-case",
      "ipv6-case",
      "phone-case",
      "invalid-first-ipv4-case",
      "invalid-first-phone-case",
      "alternative-ipv4-url-case",
      "encoded-alternative-ipv4-url-case",
      "trailing-dot-alternative-ipv4-url-case",
      "backslash-alternative-ipv4-url-case",
      "elided-alternative-ipv4-url-case",
      "extra-slash-alternative-ipv4-url-case",
      "ftp-alternative-ipv4-url-case",
      "file-authority-alternative-ipv4-url-case",
      "card-case",
      "secret-case",
      "control-case",
      "encoded-phone-case",
      "double-encoded-phone-case",
      "encoded-address-case",
      "double-encoded-address-case",
      "encoded-secret-case",
      "double-encoded-secret-case",
      "encoded-ip-case",
      "double-encoded-ip-case",
      paymentUnsafeCampaign,
      ...sourceParityFixtures.flatMap((fixture, index) =>
        fixture.expected === "" ? [sourceParityCampaign(index)] : []),
    ]) {
      expect(
        result.acquisition.find((row) => row.utm_campaign === campaign),
        `missing sanitized acquisition fixture ${campaign}`,
      ).toMatchObject({
        utm_source: "Unknown",
      });
    }
    expect(result.acquisition.find(
      (row) => row.utm_campaign === sourceParityUnsafeCampaign,
    )).toMatchObject({
      utm_source: "Unknown",
      sessions: sourceParityFixtures.filter((fixture) => fixture.expected === "").length,
    });
    expect(result.acquisition.find((row) => row.utm_campaign === "unsafe-primary-case")).toMatchObject({
      referrer_host: "Unknown",
    });
    expect(result.acquisition.find((row) => row.utm_campaign === "safe-fallback-case")).toMatchObject({
      referrer_host: "safe-fallback.example.invalid",
    });
    expect(result.acquisition.find((row) => row.utm_campaign === "unsafe-fallback-case")).toMatchObject({
      referrer_host: "Unknown",
    });
    expect(result.acquisition.find((row) => row.utm_campaign === "unsafe-landing-case")).toMatchObject({
      landing_page: "Unknown",
    });
    for (const campaign of [
      "referrer-query-case",
      "referrer-fragment-case",
      "referrer-port-case",
      "referrer-ip-case",
      "alternative-ipv4-referrer-case",
      "expanded-payment-referrer-case",
    ]) {
      expect(result.acquisition.find((row) => row.utm_campaign === campaign)).toMatchObject({
        referrer_host: "Unknown",
      });
    }
    expect(result.acquisition.find(
      (row) => row.utm_campaign === "expanded-payment-referrer-case",
    )).toMatchObject({
      referrer_host: "Unknown",
      sessions: 1 + delimiterStressReferrers.length,
    });
    expect(result.acquisition.find((row) => row.utm_campaign === "safe-control")).toMatchObject({
      utm_source: "archive",
      utm_medium: "referral",
      landing_page: "/collections/archive",
      referrer_host: "editorial.example.invalid",
    });
    expect(result.acquisition.find(
      (row) => row.utm_campaign === "safe-non-special-numeric-host-url-case",
    )).toMatchObject({ utm_source: safeNonSpecialNumericHostUrl, sessions: 1 });
    expect(result.acquisition.find(
      (row) => row.utm_campaign === "safe-file-numeric-path-url-case",
    )).toMatchObject({ utm_source: safeFileNumericPathUrl, sessions: 1 });
    for (const [index, fixture] of sourceParityFixtures.entries()) {
      if (fixture.expected === "") continue;
      expect(result.acquisition.find(
        (row) => row.utm_campaign === sourceParityCampaign(index),
      )).toMatchObject({
        utm_source: fixture.expected === "Unknown"
          ? "Unknown"
          : fixture.expected.toLowerCase(),
        sessions: 1,
      });
      expect(result.filter_options.utm_sources).toContain(
        fixture.expected === "Unknown" ? "Unknown" : fixture.expected.toLowerCase(),
      );
    }
    await Promise.all([
      "unicode-multi-lower-control",
      "greek-final-sigma-control",
      "pseudo-scheme-colon-control",
    ].map(async (label) => {
      const fixtureIndex = sourceParityFixtures.findIndex((candidate) => candidate.label === label);
      const fixture = sourceParityFixtures[fixtureIndex];
      const normalizedOption = fixture.expected.toLowerCase();
      const filteredResult = await getWebsiteFunnelAggregate({
        ...aggregateInput,
        filters: { utmSource: normalizedOption },
      });
      expect(filteredResult.acquisition.find(
        (row) => row.utm_campaign === sourceParityCampaign(fixtureIndex),
      )).toMatchObject({
        utm_source: normalizedOption,
        sessions: 1,
      });
    }));
    for (const fixture of paymentPrivacyFixtures.filter((candidate) => !candidate.unsafe)) {
      expect(result.acquisition.find(
        (row) => row.utm_campaign === `payment-${fixture.label}-case`,
      )).toMatchObject({
        utm_source: fixture.value.toLowerCase(),
        sessions: 1,
      });
    }
    expect(result.acquisition.find(
      (row) => row.utm_campaign === paymentUnsafeCampaign,
    )).toMatchObject({
      utm_source: "Unknown",
      sessions: paymentPrivacyFixtures.filter((fixture) => fixture.unsafe).length,
    });
    expect(result.acquisition.find(
      (row) => row.utm_campaign === "payment-unsafe-landing-case",
    )).toMatchObject({ landing_page: "Unknown", sessions: 1 });
    expect(result.acquisition.find(
      (row) => row.utm_campaign === "payment-safe-landing-case",
    )).toMatchObject({ landing_page: `/campaign/${invalidDottedPan16}`, sessions: 1 });
    expect(result.acquisition.find(
      (row) => row.utm_campaign === "payment-unsafe-referrer-case",
    )).toMatchObject({ referrer_host: "Unknown", sessions: 1 });
    expect(result.acquisition.find(
      (row) => row.utm_campaign === "payment-safe-referrer-case",
    )).toMatchObject({ referrer_host: `${invalidDottedPan16}.invalid`, sessions: 1 });

    expect(result.products.find((row) => row.item_id === "Unknown / unmapped")).toMatchObject({
      stable_identity: false,
      product_view_events: 5,
    });
    expect(result.products.find((row) => row.item_id === "ARCHIVE-SAFE-SKU")).toMatchObject({
      stable_identity: true,
      item_name: "Archive safe product",
      item_category: "Ready-made",
    });
    expect(result.collections.find((row) => row.item_list_name === "Unknown / unmapped")).toMatchObject({
      collection_view_events: 1,
    });
    expect(result.unknown_events.find(
      (row) => row.event_name === safeUnknownEventName,
    )).toMatchObject({
      events: 1,
    });
    expect(result.unknown_events.find(
      (row) => row.event_name === "Unknown",
    )).toMatchObject({
      events: unsafeUnknownEventNames.length,
    });

    const unknownFilter = await getWebsiteFunnelAggregate({
      ...aggregateInput,
      filters: { utmSource: "Unknown" },
    });
    expect(unknownFilter.stages.find(
      (row) => row.period_key === "current" && row.stage_key === "visit",
    )?.sessions).toBe(
      privacyFixtures.filter((fixture) => {
        const value = sanitizeWebsiteDisplayDimension(
          fixture.attributionContext.utm.source,
          "utm",
          256,
        );
        return value === "" || value === "Unknown";
      }).length
      + paymentPrivacyFixtures.filter((fixture) => fixture.unsafe).length
    );

    const unsafeFilter = await getWebsiteFunnelAggregate({
      ...aggregateInput,
      filters: { utmSource: rawEmail },
    });
    expect(unsafeFilter.event_counts).toEqual(result.event_counts);
    expect(JSON.stringify(unsafeFilter).includes(rawEmail)).toBe(false);
  });

  it("rejects missing, null, whitespace, and mixed item arrays without SQL NULL escapes", async () => {
    const validItem = {
      item_id: "CONTROL-SKU",
      item_name: "Control product",
      item_category: "Ready-made",
      quantity: 1,
    };
    const invalidItems = [
      { item_name: "Missing ID label", item_category: "Ready-made", quantity: 1 },
      { item_id: "MISSING-NAME", item_category: "Ready-made", quantity: 1 },
      { item_id: "MISSING-CATEGORY", item_name: "Missing category label", quantity: 1 },
      { ...validItem, item_id: null },
      { ...validItem, item_name: null },
      { ...validItem, item_category: null },
      { ...validItem, item_id: "   " },
      { ...validItem, item_name: "\t" },
      { ...validItem, item_category: "\n" },
    ];
    const invalidLabels = [
      "Missing ID label",
      "MISSING-NAME",
      "MISSING-CATEGORY",
      "Mixed valid label",
      "Mixed invalid label",
    ];

    for (const [index, item] of invalidItems.entries()) {
      const minute = index * 4;
      const sessionId = `null-logic-${index}`;
      await insertEvent({
        sourceId: websiteSourceId,
        sessionId,
        anonymousId: `${sessionId}-visitor`,
        eventName: "page_view",
        occurredAt: `2026-08-12T16:${String(minute).padStart(2, "0")}:00.000Z`,
        path: "/products/null-logic",
      });
      await insertEvent({
        sourceId: websiteSourceId,
        sessionId,
        anonymousId: `${sessionId}-visitor`,
        eventName: "view_item",
        occurredAt: `2026-08-12T16:${String(minute + 1).padStart(2, "0")}:00.000Z`,
        path: "/products/null-logic",
        attributionContext: {},
        properties: {
          currency: "USD",
          value: 80,
          items: [item],
        },
      });
    }

    await insertEvent({
      sourceId: websiteSourceId,
      sessionId: "null-logic-mixed",
      anonymousId: "null-logic-mixed-visitor",
      eventName: "page_view",
      occurredAt: "2026-08-12T17:00:00.000Z",
      path: "/products/null-logic",
    });
    await insertEvent({
      sourceId: websiteSourceId,
      sessionId: "null-logic-mixed",
      anonymousId: "null-logic-mixed-visitor",
      eventName: "view_item",
      occurredAt: "2026-08-12T17:01:00.000Z",
      path: "/products/null-logic",
      attributionContext: {},
      properties: {
        currency: "USD",
        value: 80,
        items: [
          { ...validItem, item_id: "MIXED-VALID", item_name: "Mixed valid label" },
          { item_id: "MIXED-INVALID", item_name: "Mixed invalid label" },
        ],
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      sessionId: "null-logic-mixed",
      anonymousId: "null-logic-mixed-visitor",
      eventName: "add_to_cart",
      occurredAt: "2026-08-12T17:02:00.000Z",
      path: "/products/null-logic",
      attributionContext: {},
      properties: {
        currency: "USD",
        value: 80,
        items: [{ ...validItem, item_id: "RECOVERY-SKU", item_name: "Recovery product" }],
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      sessionId: "null-logic-mixed",
      anonymousId: "null-logic-mixed-visitor",
      eventName: "begin_checkout",
      occurredAt: "2026-08-12T17:03:00.000Z",
      path: "/products/null-logic",
      attributionContext: {},
      properties: {
        currency: "USD",
        value: 80,
        items: [{ ...validItem, item_id: "RECOVERY-SKU", item_name: "Recovery product" }],
      },
    });

    await insertEvent({
      sourceId: websiteSourceId,
      sessionId: "null-logic-control",
      anonymousId: "null-logic-control-visitor",
      eventName: "page_view",
      occurredAt: "2026-08-12T17:10:00.000Z",
      path: "/products/control",
    });
    for (const [offset, eventName] of ["view_item", "add_to_cart", "begin_checkout"].entries()) {
      await insertEvent({
        sourceId: websiteSourceId,
        sessionId: "null-logic-control",
        anonymousId: "null-logic-control-visitor",
        eventName,
        occurredAt: `2026-08-12T17:${String(11 + offset).padStart(2, "0")}:00.000Z`,
        path: "/products/control",
        attributionContext: {},
        properties: {
          currency: "USD",
          value: 80,
          items: [validItem],
        },
      });
    }

    const result = await getWebsiteFunnelAggregate({
      dataSpaceId,
      segment: "all",
      current: {
        startAt: "2026-08-12T07:00:00.000Z",
        endExclusive: "2026-08-13T07:00:00.000Z",
      },
      comparison: {
        startAt: "2026-08-11T07:00:00.000Z",
        endExclusive: "2026-08-12T07:00:00.000Z",
      },
      pagination: {
        groupLimit: 100,
      },
    });
    const currentStages = result.stages
      .filter((row) => row.period_key === "current")
      .map((row) => [row.stage_key, Number(row.sessions)]);

    expect(currentStages).toEqual([
      ["visit", 11],
      ["product_intent", 1],
      ["add_to_cart", 1],
      ["begin_checkout", 1],
    ]);
    expect(result.invalid_properties).toContainEqual({
      period_key: "current",
      event_name: "view_item",
      events: 10,
    });
    expect(result.products.find((row) => row.item_id === "Unknown / unmapped")).toMatchObject({
      stable_identity: false,
      product_view_events: 10,
    });
    const serialized = JSON.stringify(result);
    expect(invalidLabels.some((label) => serialized.includes(label))).toBe(false);
    expect(result.products.find((row) => row.item_id === "CONTROL-SKU")).toMatchObject({
      stable_identity: true,
      product_view_sessions: 1,
      add_to_cart_sessions: 1,
      matched_view_to_cart_sessions: 1,
    });
  });

  it("keeps every tied earliest page-view context for conflict normalization", async () => {
    const occurredAt = "2026-08-14T16:00:00.000Z";
    const sessionId = "tied-earliest-context";
    for (const [index, source] of ["tie-alpha", "tie-beta"].entries()) {
      await insertEvent({
        sourceId: websiteSourceId,
        sessionId,
        anonymousId: `tie-visitor-${index}`,
        eventName: "page_view",
        occurredAt,
        path: "/tied-context",
        attributionContext: {
          utm: { source, medium: "test", campaign: "tied-context" },
          landing_page: "/tied-context",
        },
      });
    }

    try {
      const result = await getWebsiteFunnelAggregate({
        dataSpaceId,
        segment: "all",
        current: {
          startAt: "2026-08-14T07:00:00.000Z",
          endExclusive: "2026-08-15T07:00:00.000Z",
        },
        comparison: {
          startAt: "2026-08-13T07:00:00.000Z",
          endExclusive: "2026-08-14T07:00:00.000Z",
        },
      });

      expect(result.stages.find(
        (row) => row.period_key === "current" && row.stage_key === "visit",
      )).toMatchObject({ sessions: 1, visitors: 0, events: 2 });
      expect(result.acquisition).toContainEqual(expect.objectContaining({
        period_key: "current",
        utm_source: "Unknown",
        utm_medium: "test",
        utm_campaign: "tied-context",
        landing_page: "/tied-context",
        sessions: 1,
        visitors: 0,
        events: 2,
      }));
      expect(result.filter_options.utm_sources).toEqual(["Unknown"]);
    } finally {
      await query(
        "delete from web_events where source_id = $1::uuid and session_id = $2::text",
        [websiteSourceId, sessionId],
      );
    }
  });

  it("matches recursive ECMAScript finite-number semantics for raw JSONB page-view properties", async () => {
    const overflowThreshold = BigInt(ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD);
    const belowOverflowThreshold = (overflowThreshold - BigInt(1)).toString();
    const aboveOverflowThreshold = (overflowThreshold + BigInt(1)).toString();
    const maximumFiniteInteger = (
      (BigInt(1) << BigInt(1024)) - (BigInt(1) << BigInt(971))
    ).toString();
    const numericTokens = [
      ["ordinary-positive", "42"],
      ["ordinary-negative", "-42"],
      ["positive-zero", "0"],
      ["negative-zero", "-0"],
      ["positive-fraction", "0.125"],
      ["negative-fraction", "-0.125"],
      ["smallest-subnormal", "5e-324"],
      ["underflow-to-zero", "1e-400"],
      ["beyond-max-safe-integer", "9007199254740993"],
      ["exact-maximum-finite-integer", maximumFiniteInteger],
      ["positive-below-overflow-threshold", belowOverflowThreshold],
      ["positive-overflow-threshold", ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD],
      ["positive-above-overflow-threshold", aboveOverflowThreshold],
      ["negative-below-overflow-threshold", `-${belowOverflowThreshold}`],
      ["negative-overflow-threshold", `-${ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD}`],
      ["negative-above-overflow-threshold", `-${aboveOverflowThreshold}`],
      ["rounded-maximum-finite", "1.7976931348623157e308"],
      ["rounded-finite-upper", "1.7976931348623158e308"],
      ["rounded-positive-overflow-higher", "1.7976931348623159e308"],
      ["positive-exponent-overflow", "1e309"],
      ["negative-exponent-overflow", "-1e309"],
    ] as const;
    const numericFixtures = numericTokens.map(([label, rawNumericToken]) => ({
      label,
      rawPropertiesJson: `{"nested":{"value":${rawNumericToken}}}`,
      expectedFinite: Number.isFinite(JSON.parse(rawNumericToken)),
    }));
    const structuralFixtures = [
      {
        label: "nested-object-safe",
        rawPropertiesJson: '{"outer":{"inner":42}}',
        expectedFinite: true,
      },
      {
        label: "nested-array-safe",
        rawPropertiesJson: '{"outer":[1,{"inner":-2.5}]}',
        expectedFinite: true,
      },
      {
        label: "multiple-numeric-leaves-safe",
        rawPropertiesJson: '{"first":1,"second":[2,3]}',
        expectedFinite: true,
      },
      {
        label: "numeric-looking-string-safe",
        rawPropertiesJson: '{"outer":{"inner":"1e309"}}',
        expectedFinite: true,
      },
      {
        label: "nested-object-overflow",
        rawPropertiesJson: '{"outer":{"inner":1e309}}',
        expectedFinite: false,
      },
      {
        label: "nested-array-overflow",
        rawPropertiesJson: '{"outer":[1,{"inner":1e309}]}',
        expectedFinite: false,
      },
      {
        label: "safe-earlier-unsafe-later",
        rawPropertiesJson: '{"first":1,"second":{"last":-1e309}}',
        expectedFinite: false,
      },
      {
        label: "page-view-attribution-overflow",
        rawPropertiesJson: '{"attribution":{"nested":{"value":1e309}}}',
        expectedFinite: false,
      },
    ] as const;
    const fixtures = [...numericFixtures, ...structuralFixtures];
    const unsafeLabels = fixtures
      .filter((fixture) => !fixture.expectedFinite)
      .map((fixture) => fixture.label);
    const safeLabels = fixtures
      .filter((fixture) => fixture.expectedFinite)
      .map((fixture) => fixture.label);
    const occurredAt = Date.parse("2026-08-18T16:00:00.000Z");

    expect((BigInt(belowOverflowThreshold) + BigInt(1)).toString()).toBe(
      ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD,
    );
    expect((BigInt(aboveOverflowThreshold) - BigInt(1)).toString()).toBe(
      ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD,
    );
    expect(numericFixtures.filter((fixture) => !fixture.expectedFinite).map(
      (fixture) => fixture.label,
    )).toEqual([
      "positive-overflow-threshold",
      "positive-above-overflow-threshold",
      "negative-overflow-threshold",
      "negative-above-overflow-threshold",
      "rounded-positive-overflow-higher",
      "positive-exponent-overflow",
      "negative-exponent-overflow",
    ]);

    try {
      for (const [index, fixture] of fixtures.entries()) {
        expect(validateWebsiteFunnelEventProperties(
          "page_view",
          JSON.parse(fixture.rawPropertiesJson),
        ).valid).toBe(fixture.expectedFinite);
        await insertEvent({
          sourceId: websiteSourceId,
          sessionId: `finite-page-${fixture.label}`,
          anonymousId: `finite-page-visitor-${fixture.label}`,
          eventName: "page_view",
          occurredAt: new Date(occurredAt + index * 1_000).toISOString(),
          path: `/finite/${fixture.label}`,
          rawPropertiesJson: fixture.rawPropertiesJson,
          attributionContext: {
            utm: {
              source: "finite-number-fixture",
              medium: "test",
              campaign: fixture.label,
            },
            landing_page: `/finite/${fixture.label}`,
          },
        });
      }

      const result = await getWebsiteFunnelAggregate({
        dataSpaceId,
        segment: "all",
        current: {
          startAt: "2026-08-18T07:00:00.000Z",
          endExclusive: "2026-08-19T07:00:00.000Z",
        },
        comparison: {
          startAt: "2026-08-17T07:00:00.000Z",
          endExclusive: "2026-08-18T07:00:00.000Z",
        },
        pagination: { groupLimit: 100 },
      });
      const visit = result.stages.find(
        (row) => row.period_key === "current" && row.stage_key === "visit",
      );
      const currentLandingPages = new Set(result.acquisition
        .filter((row) => row.period_key === "current")
        .map((row) => row.landing_page));

      expect(visit).toMatchObject({
        sessions: safeLabels.length,
        visitors: safeLabels.length,
        events: safeLabels.length,
      });
      expect(result.invalid_properties).toContainEqual({
        period_key: "current",
        event_name: "page_view",
        events: unsafeLabels.length,
      });
      expect(result.event_counts).toContainEqual({
        period_key: "current",
        accepted_events: fixtures.length,
        unfiltered_events: fixtures.length,
      });
      expect(Number(result.group_totals.acquisition)).toBe(safeLabels.length);
      for (const label of safeLabels) {
        expect(currentLandingPages.has(`/finite/${label}`)).toBe(true);
      }
      for (const label of unsafeLabels) {
        expect(currentLandingPages.has(`/finite/${label}`)).toBe(false);
        expect(result.filter_options.utm_campaigns).not.toContain(label);
        expect(JSON.stringify(result)).not.toContain(label);
      }
      expect(result.products).toEqual([]);
      expect(result.collections).toEqual([]);
    } finally {
      await query(
        "delete from web_events where source_id = $1::uuid and session_id like 'finite-page-%'",
        [websiteSourceId],
      );
    }
  });

  it("projects top-level attribution and rejects recursive overflow before funnel classification", async () => {
    const blockedSessionId = `finite-blocked-${randomUUID()}`;
    const unsafeSessionId = `finite-unsafe-${randomUUID()}`;
    const attributionSessionId = `finite-attribution-${randomUUID()}`;
    const readyItemJson = [
      '{"item_id":"ATTRIBUTION-CONTROL-SKU"',
      '"item_name":"Attribution control item"',
      '"item_category":"Ready-made"',
      '"item_list_name":"Attribution control list"',
      '"price":80',
      '"quantity":1}',
    ].join(",");
    const topLevelAttributionJson = '"attribution":{"nested":{"probe":1e309}}';
    const withTopLevelAttribution = (...fields: string[]) => (
      `{${[...fields, topLevelAttributionJson].join(",")}}`
    );
    const attributionControls = [
      {
        eventName: "view_item_list",
        rawPropertiesJson: withTopLevelAttribution(
          '"item_list_name":"Attribution control list"',
          `"items":[${readyItemJson}]`,
        ),
      },
      {
        eventName: "view_item",
        rawPropertiesJson: withTopLevelAttribution(
          '"currency":"USD"',
          '"value":80',
          `"items":[${readyItemJson}]`,
        ),
      },
      {
        eventName: "add_to_cart",
        rawPropertiesJson: withTopLevelAttribution(
          '"currency":"USD"',
          '"value":80',
          `"items":[${readyItemJson}]`,
        ),
      },
      {
        eventName: "begin_checkout",
        rawPropertiesJson: withTopLevelAttribution(
          '"currency":"USD"',
          '"value":80',
          `"items":[${readyItemJson}]`,
        ),
      },
      {
        eventName: "build_start",
        rawPropertiesJson: withTopLevelAttribution(
          '"item_category":"Build Your Own"',
        ),
      },
      {
        eventName: "build_complete",
        rawPropertiesJson: withTopLevelAttribution(
          '"currency":"USD"',
          '"item_category":"Build Your Own"',
          '"stone_count":2',
          '"value":80',
        ),
      },
      {
        eventName: "save_design",
        rawPropertiesJson: withTopLevelAttribution(
          '"currency":"USD"',
          '"item_category":"Build Your Own"',
          '"stone_count":2',
          '"value":80',
        ),
      },
      {
        eventName: "email_signup",
        rawPropertiesJson: withTopLevelAttribution(
          '"discount_code":"FINITE-CONTROL"',
          '"method":"footer"',
        ),
      },
    ] as const;
    const unsafeDownstream = [
      {
        eventName: "view_item",
        marker: "UNSAFE-COMMERCE-VALUE",
        rawPropertiesJson: [
          '{"currency":"USD","value":1e309,"items":[',
          '{"item_id":"UNSAFE-COMMERCE-VALUE","item_name":"Unsafe value"',
          ',"item_category":"Ready-made","quantity":1}]}',
        ].join(""),
      },
      {
        eventName: "view_item_list",
        marker: "UNSAFE-LIST-PRICE",
        rawPropertiesJson: [
          '{"item_list_name":"UNSAFE-LIST-PRICE","items":[',
          '{"item_id":"UNSAFE-LIST-PRICE","item_name":"Unsafe list price"',
          ',"item_category":"Ready-made","price":1e309,"quantity":1}]}',
        ].join(""),
      },
      {
        eventName: "add_to_cart",
        marker: "UNSAFE-ITEM-PRICE",
        rawPropertiesJson: [
          '{"currency":"USD","value":80,"items":[',
          '{"item_id":"UNSAFE-ITEM-PRICE","item_name":"Unsafe item price"',
          ',"item_category":"Ready-made","price":1e309,"quantity":1}]}',
        ].join(""),
      },
      {
        eventName: "begin_checkout",
        marker: "UNSAFE-ITEM-QUANTITY",
        rawPropertiesJson: [
          '{"currency":"USD","value":80,"items":[',
          '{"item_id":"UNSAFE-ITEM-QUANTITY","item_name":"Unsafe item quantity"',
          ',"item_category":"Ready-made","price":80,"quantity":1e309}]}',
        ].join(""),
      },
      {
        eventName: "build_complete",
        marker: "UNSAFE-STONE-COUNT",
        rawPropertiesJson: [
          '{"currency":"USD","item_category":"Build Your Own"',
          ',"stone_count":1e309,"value":80}',
        ].join(""),
      },
      {
        eventName: "save_design",
        marker: "UNSAFE-BUILD-VALUE",
        rawPropertiesJson: [
          '{"currency":"USD","item_category":"Build Your Own"',
          ',"stone_count":2,"value":1e309}',
        ].join(""),
      },
    ] as const;

    expect(validateWebsiteFunnelEventProperties(
      "page_view",
      JSON.parse('{"nested":{"value":1e309}}'),
    ).valid).toBe(false);
    for (const fixture of unsafeDownstream) {
      expect(validateWebsiteFunnelEventProperties(
        fixture.eventName,
        JSON.parse(fixture.rawPropertiesJson),
      ).valid).toBe(false);
    }
    for (const fixture of attributionControls) {
      expect(validateWebsiteFunnelEventProperties(
        fixture.eventName,
        JSON.parse(fixture.rawPropertiesJson),
      ).valid).toBe(true);
    }

    try {
      await insertEvent({
        sourceId: websiteSourceId,
        sessionId: blockedSessionId,
        anonymousId: `${blockedSessionId}-visitor`,
        eventName: "page_view",
        occurredAt: "2026-08-19T16:00:00.000Z",
        path: "/finite/blocked-context",
        rawPropertiesJson: '{"nested":{"value":1e309}}',
        attributionContext: {
          utm: { source: "finite-number-fixture", campaign: "blocked-context" },
          landing_page: "/finite/blocked-context",
        },
      });
      await insertEvent({
        sourceId: websiteSourceId,
        sessionId: blockedSessionId,
        anonymousId: `${blockedSessionId}-visitor`,
        eventName: "view_item",
        occurredAt: "2026-08-19T16:01:00.000Z",
        rawPropertiesJson: [
          '{"currency":"USD","value":80,"items":[',
          '{"item_id":"BLOCKED-CONTEXT-SKU","item_name":"Blocked context item"',
          ',"item_category":"Ready-made","quantity":1}]}',
        ].join(""),
        attributionContext: {},
      });

      await insertEvent({
        sourceId: websiteSourceId,
        sessionId: unsafeSessionId,
        anonymousId: `${unsafeSessionId}-visitor`,
        eventName: "page_view",
        occurredAt: "2026-08-19T17:00:00.000Z",
        path: "/finite/unsafe-downstream",
        attributionContext: {
          utm: { source: "finite-number-fixture", campaign: "unsafe-downstream" },
          landing_page: "/finite/unsafe-downstream",
        },
      });
      await insertEvent({
        sourceId: websiteSourceId,
        sessionId: unsafeSessionId,
        anonymousId: `${unsafeSessionId}-visitor`,
        eventName: "build_start",
        occurredAt: "2026-08-19T17:01:00.000Z",
        rawPropertiesJson: '{"item_category":"Build Your Own"}',
        attributionContext: {},
      });
      for (const [index, fixture] of unsafeDownstream.entries()) {
        await insertEvent({
          sourceId: websiteSourceId,
          sessionId: unsafeSessionId,
          anonymousId: `${unsafeSessionId}-visitor`,
          eventName: fixture.eventName,
          occurredAt: new Date(
            Date.parse("2026-08-19T17:02:00.000Z") + index * 60_000,
          ).toISOString(),
          rawPropertiesJson: fixture.rawPropertiesJson,
          attributionContext: {},
        });
      }

      await insertEvent({
        sourceId: websiteSourceId,
        sessionId: attributionSessionId,
        anonymousId: `${attributionSessionId}-visitor`,
        eventName: "page_view",
        occurredAt: "2026-08-19T18:00:00.000Z",
        path: "/finite/attribution-control",
        attributionContext: {
          utm: { source: "finite-number-fixture", campaign: "attribution-control" },
          landing_page: "/finite/attribution-control",
        },
      });
      for (const [index, fixture] of attributionControls.entries()) {
        await insertEvent({
          sourceId: websiteSourceId,
          sessionId: attributionSessionId,
          anonymousId: `${attributionSessionId}-visitor`,
          eventName: fixture.eventName,
          occurredAt: new Date(
            Date.parse("2026-08-19T18:01:00.000Z") + index * 60_000,
          ).toISOString(),
          rawPropertiesJson: fixture.rawPropertiesJson,
          attributionContext: {},
        });
      }

      const result = await getWebsiteFunnelAggregate({
        dataSpaceId,
        segment: "all",
        current: {
          startAt: "2026-08-19T07:00:00.000Z",
          endExclusive: "2026-08-20T07:00:00.000Z",
        },
        comparison: {
          startAt: "2026-08-18T07:00:00.000Z",
          endExclusive: "2026-08-19T07:00:00.000Z",
        },
        pagination: { groupLimit: 100 },
      });
      const currentStages = new Map(result.stages
        .filter((row) => row.period_key === "current")
        .map((row) => [row.stage_key, row]));
      const currentInvalid = result.invalid_properties
        .filter((row) => row.period_key === "current")
        .map((row): [string, number] => [row.event_name, Number(row.events)])
        .sort(([left], [right]) => left.localeCompare(right));

      expect(currentStages.get("visit")).toMatchObject({
        sessions: 2,
        visitors: 2,
        events: 2,
      });
      expect(currentStages.get("product_intent")).toMatchObject({
        sessions: 2,
        visitors: 2,
        events: 3,
      });
      expect(currentStages.get("add_to_cart")).toMatchObject({
        sessions: 1,
        visitors: 1,
        events: 1,
      });
      expect(currentStages.get("begin_checkout")).toMatchObject({
        sessions: 1,
        visitors: 1,
        events: 1,
      });
      expect(currentInvalid).toEqual([
        ["add_to_cart", 1],
        ["begin_checkout", 1],
        ["build_complete", 1],
        ["page_view", 1],
        ["save_design", 1],
        ["view_item", 1],
        ["view_item_list", 1],
      ]);
      expect(result.event_counts).toContainEqual({
        period_key: "current",
        accepted_events: 19,
        unfiltered_events: 19,
      });
      expect(result.products).toContainEqual(expect.objectContaining({
        period_key: "current",
        item_id: "ATTRIBUTION-CONTROL-SKU",
        stable_identity: true,
        product_view_events: 1,
        add_to_cart_events: 1,
      }));
      expect(result.products.find(
        (row) => row.item_id === "Unknown / unmapped",
      )).toBeUndefined();
      expect(result.collections).toContainEqual(expect.objectContaining({
        period_key: "current",
        item_list_name: "Attribution control list",
        collection_view_events: 1,
      }));
      expect(result.collections.find(
        (row) => row.item_list_name === "Unknown / unmapped",
      )).toBeUndefined();
      expect(result.group_totals).toEqual({
        products: 1,
        collections: 1,
        acquisition: 2,
      });
      expect(result.journeys.find(
        (row) => row.period_key === "current" && row.journey_key === "builder",
      )).toMatchObject({
        build_start_sessions: 2,
        build_complete_sessions: 1,
        save_design_sessions: 1,
        build_start_events: 2,
        build_complete_events: 1,
        save_design_events: 1,
      });
      expect(result.engagement.find(
        (row) => row.period_key === "current" && row.event_name === "email_signup",
      )).toMatchObject({ sessions: 1, visitors: 1, events: 1 });
      expect(result.quality.find(
        (row) => row.period_key === "current",
      )).toMatchObject({ unsequenced_intent_sessions: 1 });
      expect(result.filter_options.utm_campaigns).toEqual([
        "attribution-control",
        "unsafe-downstream",
      ]);
      expect(Number(result.group_totals.acquisition)).toBe(2);
      expect(JSON.stringify(result)).not.toContain("blocked-context");
      expect(JSON.stringify(result)).not.toContain("BLOCKED-CONTEXT-SKU");
      for (const fixture of unsafeDownstream) {
        expect(JSON.stringify(result)).not.toContain(fixture.marker);
      }
    } finally {
      await query(
        "delete from web_events where source_id = $1::uuid and session_id = any($2::text[])",
        [websiteSourceId, [blockedSessionId, unsafeSessionId, attributionSessionId]],
      );
    }
  });

  it("matches ECMAScript trimming for commerce, signup, and ready-made classification", async () => {
    const sessionId = `ecmascript-trim-${randomUUID()}`;
    const occurredAt = [
      "2026-08-17T16:00:00.000Z",
      "2026-08-17T16:01:00.000Z",
      "2026-08-17T16:02:00.000Z",
    ] as const;

    await insertEvent({
      sourceId: websiteSourceId,
      sessionId,
      anonymousId: `${sessionId}-visitor`,
      eventName: "page_view",
      occurredAt: occurredAt[0],
    });
    await insertEvent({
      sourceId: websiteSourceId,
      sessionId,
      anonymousId: `${sessionId}-visitor`,
      eventName: "view_item",
      occurredAt: occurredAt[1],
      properties: {
        currency: "\u00a0USD\ufeff",
        value: 80,
        items: [{
          item_id: "TRIM-FIXTURE",
          item_name: "Trim fixture",
          item_category: "\u00a0Build Your Own\ufeff",
          quantity: 1,
        }],
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      sessionId,
      anonymousId: `${sessionId}-visitor`,
      eventName: "email_signup",
      occurredAt: occurredAt[2],
      properties: {
        discount_code: "\u00a0",
        method: "\ufeff",
      },
    });

    const aggregateInput = {
      dataSpaceId,
      current: {
        startAt: "2026-08-17T07:00:00.000Z",
        endExclusive: "2026-08-18T07:00:00.000Z",
      },
      comparison: {
        startAt: "2026-08-16T07:00:00.000Z",
        endExclusive: "2026-08-17T07:00:00.000Z",
      },
      pagination: { groupLimit: 100 },
    } as const;

    try {
      const all = await getWebsiteFunnelAggregate({ ...aggregateInput, segment: "all" });
      expect(all.stages.find(
        (row) => row.period_key === "current" && row.stage_key === "product_intent",
      )).toMatchObject({ sessions: 1 });
      expect(all.engagement.find(
        (row) => row.period_key === "current" && row.event_name === "email_signup",
      )).toMatchObject({ sessions: 0, visitors: 0, events: 0 });
      expect(all.invalid_properties).toContainEqual({
        period_key: "current",
        event_name: "email_signup",
        events: 1,
      });
      expect(all.invalid_properties.find(
        (row) => row.period_key === "current" && row.event_name === "view_item",
      )).toBeUndefined();

      const readyMade = await getWebsiteFunnelAggregate({
        ...aggregateInput,
        segment: "ready-made",
      });
      expect(Number(readyMade.stages.find(
        (row) => row.period_key === "current" && row.stage_key === "product_intent",
      )?.sessions ?? 0)).toBe(0);
    } finally {
      await query(
        "delete from web_events where source_id = $1::uuid and session_id = $2::text",
        [websiteSourceId, sessionId],
      );
    }
  });

  describe("high-cardinality safe dimensions", () => {
    const scaleEventCount = 10_000;
    beforeAll(async () => {
      const inserted = await query(
        `
          insert into web_events (
            id,
            event_id,
            schema_version,
            event_source,
            source_id,
            anonymous_id,
            session_id,
            event_name,
            path,
            url,
            referrer,
            properties,
            attribution_context,
            consent_status,
            client_context,
            occurred_at,
            received_at,
            created_at
          )
          select
            md5('scale-row-' || fixture.event_index::text)::uuid,
            md5('scale-event-' || fixture.event_index::text)::uuid,
            '1.0',
            'first_party_tracker',
            $1::uuid,
            'scale-visitor-' || fixture.event_index::text,
            'scale-session-' || fixture.event_index::text,
            'page_view',
            '/scale-safe/' || fixture.event_index::text,
            'https://fixture.invalid/scale-safe/' || fixture.event_index::text,
            'https://editorial.example.invalid/archive',
            '{}'::jsonb,
            jsonb_build_object(
              'utm',
              jsonb_build_object(
                'source', 'scale-fixture-' || fixture.event_index::text,
                'medium', 'test',
                'campaign', 'catalog-cardinality-' || fixture.event_index::text
              ),
              'landing_page', '/scale-safe/' || fixture.event_index::text
            ),
            '{"analytics":"granted","marketing":"denied"}'::jsonb,
            '{"device_category":"desktop","page_type":"fixture"}'::jsonb,
            timestamptz '2026-08-15 16:00:00+00'
              + fixture.event_index * interval '1 millisecond',
            timestamptz '2026-08-15 16:00:01+00'
              + fixture.event_index * interval '1 millisecond',
            timestamptz '2026-08-15 16:00:01+00'
              + fixture.event_index * interval '1 millisecond'
          from generate_series(1, $2::integer) fixture(event_index)
        `,
        [websiteSourceId, scaleEventCount],
      );
      expect(inserted.rowCount).toBe(scaleEventCount);
    });

    afterAll(async () => {
      await query(
        "delete from web_events where source_id = $1::uuid and occurred_at >= $2::timestamptz and occurred_at < $3::timestamptz",
        [
          websiteSourceId,
          "2026-08-15T07:00:00.000Z",
          "2026-08-16T07:00:00.000Z",
        ],
      );
    });

    it("keeps the fixed privacy aggregate within its timeout", async () => {
      const result = await getWebsiteFunnelAggregate({
        dataSpaceId,
        segment: "all",
        current: {
          startAt: "2026-08-15T07:00:00.000Z",
          endExclusive: "2026-08-16T07:00:00.000Z",
        },
        comparison: {
          startAt: "2026-08-14T07:00:00.000Z",
          endExclusive: "2026-08-15T07:00:00.000Z",
        },
        pagination: {
          groupLimit: 100,
        },
      });

      expect(result.event_counts).toContainEqual({
        period_key: "current",
        accepted_events: scaleEventCount,
        unfiltered_events: scaleEventCount,
      });
      expect(result.stages.find(
        (row) => row.period_key === "current" && row.stage_key === "visit",
      )).toMatchObject({ sessions: scaleEventCount });
      expect(Number(result.group_totals.acquisition)).toBe(scaleEventCount);
      expect(result.acquisition).toHaveLength(100);
      expect(result.acquisition.every((row) => (
        row.period_key === "current"
        && Number(row.sessions) === 1
        && Number(row.visitors) === 1
        && Number(row.events) === 1
        && row.utm_source.startsWith("scale-fixture-")
        && row.utm_campaign.startsWith("catalog-cardinality-")
        && row.landing_page.startsWith("/scale-safe/")
        && row.referrer_host === "editorial.example.invalid"
      ))).toBe(true);
      expect(result.filter_options.utm_sources).toHaveLength(100);
      expect(result.filter_options.utm_mediums).toEqual(["test"]);
      expect(result.filter_options.utm_campaigns).toHaveLength(100);
      expect(result.filter_options.landing_pages).toHaveLength(100);
      expect(result.filter_options.referrer_hosts).toEqual(["editorial.example.invalid"]);
    });
  });
});
