import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { JsonRecord, JsonValue } from "@/storage/db/schema";

export const WEBSITE_EVENT_SCHEMA_VERSION = "1.0" as const;
export const LEGACY_WEBSITE_EVENT_SCHEMA_VERSION = "legacy" as const;
export const MAX_TRACKING_BODY_BYTES = 32 * 1024;
export const MAX_PROPERTIES_BYTES = 8 * 1024;
export const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;

const MAX_PROPERTY_DEPTH = 8;
const MAX_PROPERTY_KEYS = 100;
const MAX_PROPERTY_ARRAY_LENGTH = 100;
const MAX_PROPERTY_STRING_LENGTH = 2_048;
const piiExemptRootFields = new Set(["event_id", "schema_version", "source_id", "public_tracking_key", "occurred_at"]);
const commerceNumericIdentifierKeys = new Set([
  "product_id",
  "variant_id",
  "collection_id",
  "cart_id",
  "checkout_id",
  "order_id",
  "order_number",
]);
const commerceNumericUrlKeys = new Set(["product", "product_id", "variant", "variant_id", "collection", "collection_id", "page", "quantity"]);
const uuidValueSchema = z.string().uuid();

const consentValueSchema = z.enum(["granted", "denied", "unknown"]);
const contextValueSchema = z.string().trim().min(1).max(160);
const attributionValueSchema = z.string().trim().min(1).max(256);
const attributionLandingPageSchema = z.string().trim().min(1).max(500).refine(
  (value) => value.startsWith("/") && !value.includes("?") && !value.includes("#"),
  "landing_page must be a site-relative pathname without a query string or fragment.",
);
const attributionReferrerSchema = z.string().trim().max(1_200).refine((value) => {
  if (!value) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "first_referrer must use HTTP(S).");

const attributionSchema = z.object({
  utm: z.object({
    source: attributionValueSchema.optional(),
    medium: attributionValueSchema.optional(),
    campaign: attributionValueSchema.optional(),
    content: attributionValueSchema.optional(),
    term: attributionValueSchema.optional(),
  }).optional(),
  click_ids: z.object({
    fbclid: attributionValueSchema.optional(),
    gclid: attributionValueSchema.optional(),
    ttclid: attributionValueSchema.optional(),
  }).optional(),
  landing_page: attributionLandingPageSchema.optional(),
  first_referrer: attributionReferrerSchema.nullable().optional(),
  touchpoint: z.enum(["first", "session", "current"]).optional(),
});

const consentSchema = z.object({
  analytics: consentValueSchema.default("unknown"),
  marketing: consentValueSchema.default("unknown"),
  do_not_track: z.boolean().optional(),
});

const clientContextSchema = z.object({
  language: z.string().trim().min(1).max(35).regex(/^[A-Za-z0-9-]+$/u).optional(),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/u).transform((value) => value.toUpperCase()).optional(),
  viewport_category: z.enum(["small", "medium", "large", "wide", "unknown"]).optional(),
  device_category: z.enum(["mobile", "tablet", "desktop", "bot", "unknown"]).optional(),
  traffic_type: z.enum(["production", "synthetic", "local", "test"]).optional(),
  page_type: contextValueSchema.optional(),
});

const httpUrlSchema = z.string().trim().min(1).max(1_200).url().refine((value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "URL must use http or https.");

const rawTrackEventSchema = z.object({
  event_id: uuidValueSchema.optional(),
  schema_version: z.literal(WEBSITE_EVENT_SCHEMA_VERSION).optional(),
  source_id: uuidValueSchema.optional(),
  public_tracking_key: z.string().trim().min(4).max(120).optional(),
  anonymous_id: z.string().trim().min(1).max(160),
  session_id: z.string().trim().min(1).max(160),
  user_id: z.string().trim().max(160).nullable().optional(),
  event_name: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/u),
  path: z.string().trim().min(1).max(500),
  url: z.string().trim().min(1).max(1_200).url(),
  referrer: z.string().trim().max(1_200).nullable().optional(),
  user_agent: z.string().trim().max(1_000).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  attribution: attributionSchema.optional(),
  consent: consentSchema.optional(),
  client_context: clientContextSchema.optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, context) => {
  if (!value.source_id && !value.public_tracking_key) {
    context.addIssue({
      code: "custom",
      path: ["source_id"],
      message: "source_id or public_tracking_key is required.",
    });
  }
  if (value.schema_version === WEBSITE_EVENT_SCHEMA_VERSION) {
    for (const field of ["event_id", "source_id", "public_tracking_key", "occurred_at", "consent", "client_context"] as const) {
      if (value[field] === undefined) {
        context.addIssue({ code: "custom", path: [field], message: `${field} is required for schema_version 1.0.` });
      }
    }
    if (!value.path.startsWith("/")) {
      context.addIssue({ code: "custom", path: ["path"], message: "path must begin with / for schema_version 1.0." });
    }
    if (value.path.includes("?") || value.path.includes("#")) {
      context.addIssue({ code: "custom", path: ["path"], message: "path must not include a query string or fragment for schema_version 1.0." });
    }
    if (!httpUrlSchema.safeParse(value.url).success) {
      context.addIssue({ code: "custom", path: ["url"], message: "url must use HTTP(S) for schema_version 1.0." });
    }
    if (value.referrer && !httpUrlSchema.safeParse(value.referrer).success) {
      context.addIssue({ code: "custom", path: ["referrer"], message: "referrer must use HTTP(S) for schema_version 1.0." });
    }
    if (value.user_id !== undefined && value.user_id !== null && value.user_id.length === 0) {
      context.addIssue({ code: "custom", path: ["user_id"], message: "user_id must not be empty for schema_version 1.0." });
    }
  }
});

export type WebsiteAttributionContext = z.infer<typeof attributionSchema>;
export type WebsiteConsentStatus = z.infer<typeof consentSchema>;
export type WebsiteClientContext = z.infer<typeof clientContextSchema>;

export interface CanonicalWebsiteEvent {
  eventId: string;
  schemaVersion: typeof WEBSITE_EVENT_SCHEMA_VERSION | typeof LEGACY_WEBSITE_EVENT_SCHEMA_VERSION;
  sourceId: string | null;
  publicTrackingKey: string | null;
  anonymousId: string;
  sessionId: string;
  userId: string | null;
  eventName: string;
  path: string;
  url: string;
  referrer: string | null;
  userAgent: string | null;
  properties: JsonRecord;
  attributionContext: WebsiteAttributionContext;
  consentStatus: WebsiteConsentStatus;
  clientContext: WebsiteClientContext;
  occurredAt: string;
  receivedAt: string;
}

const obviousEmailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const streetAddressPattern = /\b[0-9]{1,6}\s+(?:[A-Z0-9.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy)\b/iu;
const postOfficeBoxPattern = /\bP(?:OST)?\.?\s*O(?:FFICE)?\.?\s+BOX\s+[A-Z0-9-]+\b/iu;
const prohibitedCanonicalKeyFragments = [
  "email",
  "phone",
  "telephone",
  "mobilenumber",
  "shippingaddress",
  "billingaddress",
  "streetaddress",
  "fulladdress",
  "postaladdress",
  "customeraddress",
  "cardnumber",
  "creditcard",
  "cardholder",
  "cardlast",
  "paymenttoken",
  "paymentdata",
  "paymentmethod",
  "paymentintent",
  "cvv",
  "cvc",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "password",
  "secret",
  "firstname",
  "lastname",
  "fullname",
  "customername",
] as const;

function canonicalFieldKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isProhibitedFieldKey(key: string) {
  const canonical = canonicalFieldKey(key);
  if (prohibitedCanonicalKeyFragments.some((fragment) => canonical.includes(fragment))) return true;
  return canonical === "ip"
    || canonical === "ipaddress"
    || canonical.endsWith("ipaddress")
    || canonical.endsWith("clientip")
    || canonical.endsWith("remoteip");
}

function decodeUrlComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodedVariants(value: string) {
  const variants = [value];
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = decodeUrlComponent(variants.at(-1) ?? value);
    if (decoded === variants.at(-1)) break;
    variants.push(decoded);
  }
  return [...new Set(variants)];
}

function parsedUrlCandidates(value: string) {
  let url: URL;
  try {
    url = value.trim().startsWith("/")
      ? new URL(value.trim(), "https://tracking.invalid")
      : new URL(value.trim());
  } catch {
    return [];
  }
  return [
    ...url.pathname.split("/").filter(Boolean).map(decodeUrlComponent),
    ...url.searchParams.keys(),
    ...url.searchParams.values(),
  ];
}

function containsUnsafeNestedUrlData(value: string) {
  return decodedVariants(value).some((variant) => {
    try {
      const trimmed = variant.trim();
      const url = trimmed.startsWith("/")
        ? new URL(trimmed, "https://tracking.invalid")
        : new URL(trimmed);
      return Boolean(url.username || url.password || url.hash || url.search);
    } catch {
      return false;
    }
  });
}

function containsProhibitedEmail(value: string) {
  const candidates = decodedVariants(value).flatMap((variant) => [variant, ...parsedUrlCandidates(variant)]);
  return candidates.some((candidate) => obviousEmailPattern.test(candidate));
}

function containsProhibitedAddress(value: string) {
  const candidates = decodedVariants(value).flatMap((variant) => [variant, ...parsedUrlCandidates(variant)]);
  return candidates.some((candidate) => {
    const normalized = candidate.replace(/[-_]+/gu, " ");
    return streetAddressPattern.test(normalized) || postOfficeBoxPattern.test(normalized);
  });
}

function containsRawIpCandidate(value: string, path: string) {
  const trimmed = value.trim();
  if (isIP(trimmed.replace(/^\[|\]$/gu, "")) !== 0) return true;
  try {
    const url = trimmed.startsWith("/")
      ? new URL(trimmed, "https://tracking.invalid")
      : new URL(trimmed);
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    if (isIP(hostname) !== 0) return true;
    if (parsedUrlCandidates(trimmed).some((candidate) => isIP(candidate.trim()) !== 0)) return true;
  } catch {
    // Non-URL property strings are scanned below.
  }

  const embeddedIpv4 = /(^|[^0-9])((?:[0-9]{1,3}\.){3}[0-9]{1,3})(?=$|[^0-9])/gu;
  for (const match of value.matchAll(embeddedIpv4)) {
    const candidate = match[2];
    if (isIP(candidate) === 0) continue;
    const candidateIndex = (match.index ?? 0) + match[1].length;
    const productPrefix = value.slice(Math.max(0, candidateIndex - 20), candidateIndex);
    const looksLikeUserAgentVersion = /(?:user_agent|useragent)$/iu.test(path)
      && /(?:Chrome|Chromium|CriOS|Edg|OPR|Version)\/$/iu.test(productPrefix);
    if (!looksLikeUserAgentVersion) return true;
  }
  const embeddedIpv6 = value.match(/[A-Fa-f0-9]*:[A-Fa-f0-9:]+/gu) ?? [];
  return embeddedIpv6.some((candidate) => isIP(candidate) !== 0);
}

function containsRawIp(value: string, path: string) {
  return decodedVariants(value).some((candidate) => containsRawIpCandidate(candidate, path));
}

function passesLuhnCheck(digits: string) {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function isLikelyPhoneNumber(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/gu, "");
  if (trimmed.startsWith("+")) {
    return /^[+0-9 ().-]+$/u.test(trimmed) && digits.length >= 7 && digits.length <= 15;
  }
  const internationalPrefix = /^(?:20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98)/u;
  if (/^[0-9]{9,15}$/u.test(trimmed) && (trimmed.startsWith("0") || internationalPrefix.test(trimmed))) {
    return true;
  }
  const separators = trimmed.match(/[ ()-]/gu)?.length ?? 0;
  if (
    digits.length >= 9
    && digits.length <= 15
    && separators >= 2
    && /^[0-9 ()-]+$/u.test(trimmed)
  ) {
    return true;
  }
  const nationalDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const plausibleNanp = nationalDigits.length === 10
    && /^[2-9][0-9]{2}[2-9][0-9]{6}$/u.test(nationalDigits);
  if (!plausibleNanp) return false;
  if (/^[0-9]{10,11}$/u.test(trimmed)) return true;
  // Match common 3-3-4 formatting without treating ISO dates, short SKUs,
  // order tokens, or dotted application versions as phone numbers.
  return /^(?:1[ .-])?\(?[2-9][0-9]{2}\)?[ .-][2-9][0-9]{2}[ .-][0-9]{4}$/u.test(trimmed);
}

function isLikelyPaymentCard(value: string) {
  const trimmed = value.trim();
  if (!/^[0-9 -]+$/u.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/gu, "");
  if (digits.length < 13 || digits.length > 19) return false;
  return passesLuhnCheck(digits);
}

function withoutCommerceNumericUrlParameters(value: string, path?: string) {
  if (!/^event\.(?:url|referrer|path)$/u.test(path ?? "")) return value;
  try {
    const trimmed = value.trim();
    const url = trimmed.startsWith("/")
      ? new URL(trimmed, "https://tracking.invalid")
      : new URL(trimmed);
    for (const [key, parameterValue] of [...url.searchParams.entries()]) {
      if (commerceNumericUrlKeys.has(key.toLowerCase()) && /^[0-9]{1,20}$/u.test(parameterValue)) {
        url.searchParams.delete(key);
      }
    }
    return trimmed.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    return value;
  }
}

function containsProhibitedNumber(value: string, path?: string) {
  const variants = decodedVariants(withoutCommerceNumericUrlParameters(value, path));
  if (variants.some((candidate) => isLikelyPhoneNumber(candidate) || isLikelyPaymentCard(candidate))) return true;
  const embeddedCandidates = variants.flatMap((variant) => variant.match(/[+0-9][+0-9 ().-]{6,24}/gu) ?? []);
  const candidates = [
    ...variants.flatMap(parsedUrlCandidates),
    ...embeddedCandidates.map((candidate) => candidate.trim().replace(/[\s)\]},'"!?;:.]+$/gu, "")),
  ];
  return candidates.some((candidate) => isLikelyPhoneNumber(candidate) || isLikelyPaymentCard(candidate));
}

function assertNoProhibitedPii(value: unknown, path = "event", depth = 0): void {
  if (depth > MAX_PROPERTY_DEPTH) throw new Error(`${path} exceeds the maximum nesting depth.`);
  if (typeof value === "string") {
    if (/(?:anonymous_id|session_id|user_id)$/u.test(path) && uuidValueSchema.safeParse(value).success) return;
    const fieldKey = path.split(".").at(-1) ?? "";
    if (commerceNumericIdentifierKeys.has(fieldKey) && /^[0-9]{1,20}$/u.test(value)) return;
    if (value.length > MAX_PROPERTY_STRING_LENGTH && path.includes("properties")) {
      throw new Error(`${path} contains a string that is too long.`);
    }
    if (containsProhibitedEmail(value)) throw new Error(`${path} contains prohibited personal data.`);
    if (containsProhibitedAddress(value) || containsProhibitedNumber(value, path) || containsRawIp(value, path)) {
      throw new Error(`${path} contains prohibited personal data.`);
    }
    if (!/^event\.(?:url|referrer)$/u.test(path) && containsUnsafeNestedUrlData(value)) {
      throw new Error(`${path} contains URL data that is not permitted by the analytics contract.`);
    }
    return;
  }
  if (typeof value === "number") {
    const fieldKey = path.split(".").at(-1) ?? "";
    if (
      Number.isSafeInteger(value)
      && !commerceNumericIdentifierKeys.has(fieldKey)
      && (isLikelyPhoneNumber(String(value)) || isLikelyPaymentCard(String(value)))
    ) {
      throw new Error(`${path} contains prohibited personal data.`);
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > MAX_PROPERTY_ARRAY_LENGTH) throw new Error(`${path} contains too many items.`);
    value.forEach((item, index) => assertNoProhibitedPii(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} must contain JSON values only.`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_PROPERTY_KEYS) throw new Error(`${path} contains too many fields.`);
  for (const [key, nested] of entries) {
    if (key.length === 0 || key.length > 120) throw new Error(`${path} contains an invalid field name.`);
    if (
      isProhibitedFieldKey(key)
      || containsProhibitedEmail(key)
      || containsProhibitedAddress(key)
      || containsProhibitedNumber(key)
      || containsRawIp(key, `${path}.field_name`)
    ) {
      throw new Error(`${path} contains a field name that is not permitted by the analytics contract.`);
    }
    // JSON.stringify omits undefined object fields. Accept that common direct-call
    // representation so internal callers behave exactly like HTTP JSON clients.
    if (nested === undefined) continue;
    // These values are validated as contract metadata (UUID, literal version,
    // timestamp, or a source-resolved public key) and are not user content.
    if (path === "event" && piiExemptRootFields.has(key)) continue;
    assertNoProhibitedPii(nested, `${path}.${key}`, depth + 1);
  }
}

function assertJsonValue(value: unknown, path = "properties", depth = 0): asserts value is JsonValue {
  if (depth > MAX_PROPERTY_DEPTH) throw new Error(`${path} exceeds the maximum nesting depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (value.length > MAX_PROPERTY_ARRAY_LENGTH) throw new Error(`${path} contains too many items.`);
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") throw new Error(`${path} must contain JSON values only.`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_PROPERTY_KEYS) throw new Error(`${path} contains too many fields.`);
  for (const [key, nested] of entries) {
    if (key.length === 0 || key.length > 120) throw new Error(`${path} contains an invalid field name.`);
    assertJsonValue(nested, `${path}.${key}`, depth + 1);
  }
}

function sanitizeUrl(value: string, options: { stripQuery?: boolean } = {}) {
  const original = value.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Legacy referrer values were only length-validated. Preserve them so the
    // v1 rollout does not break existing installations; v1 requires HTTP(S).
    return original;
  }
  let changed = false;
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
    changed = true;
  }
  if (url.hash) {
    url.hash = "";
    changed = true;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (
      decodedVariants(key).some(isProhibitedFieldKey)
      || containsProhibitedEmail(key)
      || containsProhibitedNumber(key)
      || containsRawIp(key, "url.parameter")
    ) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (options.stripQuery && url.search) {
    url.search = "";
    changed = true;
  }
  return changed ? url.toString() : original;
}

function assertTimestampSanity(occurredAt: string, receivedAt: string) {
  const occurredTime = Date.parse(occurredAt);
  const receivedTime = Date.parse(receivedAt);
  if (!Number.isFinite(occurredTime) || !Number.isFinite(receivedTime)) throw new Error("Event timestamp is invalid.");
  if (occurredTime > receivedTime + MAX_EVENT_FUTURE_SKEW_MS) throw new Error("Event timestamp is too far in the future.");
  if (occurredTime < receivedTime - MAX_EVENT_AGE_MS) throw new Error("Event timestamp is too old.");
}

function propertiesSize(properties: JsonRecord) {
  return Buffer.byteLength(JSON.stringify(properties), "utf8");
}

function normalizeLegacyAttributionShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const rawUtm = record.utm;
  if (!rawUtm || typeof rawUtm !== "object" || Array.isArray(rawUtm)) return record;
  const utm = rawUtm as Record<string, unknown>;
  return {
    ...record,
    utm: {
      source: utm.source ?? utm.utm_source,
      medium: utm.medium ?? utm.utm_medium,
      campaign: utm.campaign ?? utm.utm_campaign,
      content: utm.content ?? utm.utm_content,
      term: utm.term ?? utm.utm_term,
    },
  };
}

export function normalizeWebsiteEventPayload(input: unknown, options: { receivedAt?: Date } = {}): CanonicalWebsiteEvent {
  // Start above the contract envelope so the documented property depth is
  // measured from the properties object itself, matching assertJsonValue.
  assertNoProhibitedPii(input, "event", -1);
  const parsed = rawTrackEventSchema.parse(input);
  assertJsonValue(parsed.properties);
  const properties = parsed.properties as JsonRecord;
  if (propertiesSize(properties) > MAX_PROPERTIES_BYTES) {
    throw new Error(`Event properties are too large. Limit is ${MAX_PROPERTIES_BYTES} bytes.`);
  }

  const receivedAt = (options.receivedAt ?? new Date()).toISOString();
  const occurredAt = parsed.occurred_at ?? receivedAt;
  assertTimestampSanity(occurredAt, receivedAt);

  const legacyAttributionPresent = Object.prototype.hasOwnProperty.call(properties, "attribution");
  const legacyAttribution = attributionSchema.safeParse(
    normalizeLegacyAttributionShape(properties.attribution),
  );
  const attributionContext = parsed.attribution ?? (legacyAttribution.success ? legacyAttribution.data : {});
  const consentStatus = parsed.consent ?? { analytics: "unknown", marketing: "unknown" };
  const clientContext = parsed.client_context ?? {};
  const baseProperties = legacyAttributionPresent
    ? Object.fromEntries(Object.entries(properties).filter(([key]) => key !== "attribution")) as JsonRecord
    : properties;
  const normalizedProperties: JsonRecord = Object.keys(attributionContext).length > 0
    ? { ...baseProperties, attribution: attributionContext as JsonRecord }
    : baseProperties;
  const stripQuery = parsed.schema_version === WEBSITE_EVENT_SCHEMA_VERSION;
  const url = sanitizeUrl(parsed.url, { stripQuery });
  const referrer = parsed.referrer ? sanitizeUrl(parsed.referrer, { stripQuery }) : null;
  const eventId = parsed.event_id ?? randomUUID();

  return {
    eventId,
    schemaVersion: parsed.schema_version ?? LEGACY_WEBSITE_EVENT_SCHEMA_VERSION,
    sourceId: parsed.source_id ?? null,
    publicTrackingKey: parsed.public_tracking_key ?? null,
    anonymousId: parsed.anonymous_id,
    sessionId: parsed.session_id,
    userId: parsed.user_id ?? null,
    eventName: parsed.event_name,
    path: parsed.path,
    url,
    referrer,
    userAgent: parsed.user_agent ?? null,
    properties: normalizedProperties,
    attributionContext,
    consentStatus,
    clientContext,
    occurredAt,
    receivedAt,
  };
}
