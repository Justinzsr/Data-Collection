import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeWebsiteDisplayDimension } from "@/collection/tracking/website-display-privacy";
import { closeDatabasePool, query } from "@/storage/db/client";
import { getWebsiteFunnelAggregate } from "@/storage/repositories/website-funnel-repository";

const enabled = process.env.RUN_WEBSITE_FUNNEL_POSTGRES_TEST === "true";
const databaseUrl = process.env.DATABASE_URL;
const dataSpaceId = randomUUID();
const websiteSourceId = randomUUID();
const otherSourceId = randomUUID();
let insertedWebsiteSourceType = false;

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

async function insertEvent(input: {
  sourceId: string;
  eventName: string;
  occurredAt: string;
  properties?: unknown;
  eventSource?: "first_party_tracker" | "vercel_drain";
  schemaVersion?: "1.0" | "legacy";
  anonymousId?: string;
  sessionId?: string;
  path?: string;
  url?: string;
  referrer?: string | null;
  attributionContext?: unknown;
}) {
  const path = input.path ?? "/products/fixture";
  const properties = Object.hasOwn(input, "properties") ? input.properties : {};
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
      JSON.stringify(properties),
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
    const syntheticCard = ["4242", "4242", "4242", "4242"].join(" ");
    const syntheticPan13 = ["700", "000", "000", "000", "3"].join("");
    const syntheticPan16 = ["7000", "0000", "0000", "0005"].join("");
    const syntheticPan19 = ["700", "0000", "0000", "0000", "000", "3"].join("");
    const dottedPan16 = syntheticPan16.match(/.{1,4}/gu)!.join(".");
    const invalidDottedPan16 = ["7000", "0000", "0000", "0100"].join(".");
    const slashPan16 = syntheticPan16.match(/.{1,4}/gu)!.join("/");
    const uninterruptedTwentyDigitIdentifier = `${syntheticPan19}5`;
    const syntheticSecret = ["to", "ken", "=", "synthetic_value_12345678"].join("");
    const syntheticAddress = ["123", " Main", " Street"].join("");
    const controlValue = `archive${String.fromCharCode(7)}control`;
    const paymentPrivacyFixtures = [
      { label: "dotted", value: dottedPan16, unsafe: true },
      { label: "embedded", value: `launch-${dottedPan16}-archive`, unsafe: true },
      { label: "mixed-separators", value: "7000,0000_0000/0005", unsafe: true },
      { label: "punctuation-separators", value: "7000;0000!0000=0005", unsafe: true },
      { label: "unicode-separators", value: "7000\u00a00000\u20140000\u20090005", unsafe: true },
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
      ...encodedPrivacyFixtures,
    ] as const;

    for (const fixture of privacyFixtures) {
      await insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: fixture.sessionId,
        anonymousId: `${fixture.sessionId}-visitor`,
        eventName: "page_view",
        occurredAt: `2026-08-10T16:${String(fixture.minute).padStart(2, "0")}:00.000Z`,
        path: "/collections/archive",
        attributionContext: fixture.attributionContext,
        referrer: "referrer" in fixture ? fixture.referrer : null,
      });
    }

    for (const [index, fixture] of paymentPrivacyFixtures.entries()) {
      await insertEvent({
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
            campaign: `payment-${fixture.label}-case`,
          },
          landing_page: "/collections/archive",
        },
      });
    }

    for (const [index, fixture] of paymentDimensionFixtures.entries()) {
      const isLanding = fixture.kind === "landing_path";
      await insertEvent({
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
    }

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
    ] as const;

    for (const fixture of unsafeItemFixtures) {
      await insertEvent({
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
      });
      await insertEvent({
        sourceId: websiteSourceId,
        schemaVersion: "legacy",
        sessionId: fixture.sessionId,
        anonymousId: `${fixture.sessionId}-visitor`,
        eventName: "view_item",
        occurredAt: `2026-08-10T16:${String(fixture.minute + 1).padStart(2, "0")}:00.000Z`,
        path: "/products/archive-safe",
        attributionContext: {},
        properties: fixture.properties,
      });
    }

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
        groupLimit: 100,
      },
    };
    const result = await getWebsiteFunnelAggregate(aggregateInput);
    const unsafeCanaries = [
      rawEmail,
      encodedEmail,
      doubleEncodedEmail,
      unsafeCredentialUrl,
      syntheticIpv4,
      syntheticIpv6,
      syntheticPhone,
      syntheticCard,
      syntheticSecret,
      syntheticAddress,
      controlValue,
      ...encodedPrivacyFixtures.map((fixture) => fixture.attributionContext.utm.source),
      ...paymentPrivacyFixtures.filter((fixture) => fixture.unsafe).map((fixture) => fixture.value),
      ...paymentDimensionFixtures.filter((fixture) => fixture.unsafe).map((fixture) => fixture.value),
      ...unsafeUnknownEventNames,
    ];

    const returnedStrings = collectStringValues(result);
    const approvedSafePaymentStrings = new Set([
      ...paymentPrivacyFixtures
        .filter((fixture) => !fixture.unsafe)
        .flatMap((fixture) => [fixture.value, fixture.value.toLowerCase()]),
      ...paymentDimensionFixtures
        .filter((fixture) => !fixture.unsafe)
        .flatMap((fixture) => [fixture.value, fixture.value.toLowerCase()]),
    ]);
    expect(unsafeCanaries.findIndex((canary) =>
      returnedStrings.some((value) =>
        value.includes(canary) && !approvedSafePaymentStrings.has(value)))).toBe(-1);
    expect(result.filter_options.utm_sources).not.toContain(rawEmail);
    expect(result.filter_options.utm_sources).not.toContain(encodedEmail);
    expect(result.filter_options.utm_sources).not.toContain(doubleEncodedEmail);
    expect(result.filter_options.utm_sources).toContain("Unknown");
    expect(result.filter_options.utm_sources).toContain("archive");
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
      ...paymentPrivacyFixtures
        .filter((fixture) => fixture.unsafe)
        .map((fixture) => `payment-${fixture.label}-case`),
    ]) {
      expect(result.acquisition.find((row) => row.utm_campaign === campaign)).toMatchObject({
        utm_source: "Unknown",
      });
    }
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
    ]) {
      expect(result.acquisition.find((row) => row.utm_campaign === campaign)).toMatchObject({
        referrer_host: "Unknown",
      });
    }
    expect(result.acquisition.find((row) => row.utm_campaign === "safe-control")).toMatchObject({
      utm_source: "archive",
      utm_medium: "referral",
      landing_page: "/collections/archive",
      referrer_host: "editorial.example.invalid",
    });
    for (const fixture of paymentPrivacyFixtures.filter((candidate) => !candidate.unsafe)) {
      expect(result.acquisition.find(
        (row) => row.utm_campaign === `payment-${fixture.label}-case`,
      )).toMatchObject({
        utm_source: fixture.value.toLowerCase(),
        sessions: 1,
      });
    }
    for (const fixture of paymentPrivacyFixtures.filter((candidate) => candidate.unsafe)) {
      expect(result.acquisition.find(
        (row) => row.utm_campaign === `payment-${fixture.label}-case`,
      )).toMatchObject({ utm_source: "Unknown", sessions: 1 });
    }
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
      product_view_events: 4,
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
      17
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
});
