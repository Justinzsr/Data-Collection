import {
  getWebsiteCommerceFunnelV2Snapshot,
  type WebsiteCommerceFunnelV2Input,
} from "@/aggregation/services/website-commerce-funnel-v2-service";
import type { WebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-types";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function normalizeResponseKey(key: string) {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function responseKeySegments(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "anonymous_id",
  "checkout_event_id",
  "checkout_event_id_hash",
  "cookie",
  "customer_id",
  "email",
  "event_id",
  "item_instance_id",
  "item_instance_id_hash",
  "order_id",
  "referrer",
  "session_id",
  "shopify_line_item_id_hash",
  "shopify_order_id_hash",
  "source_id",
  "token",
  "url",
  "user_id",
].map(normalizeResponseKey));

const FORBIDDEN_RESPONSE_KEY_SUFFIXES = [
  ["id"],
  ["ids"],
  ["id", "hash"],
  ["id", "hashes"],
  ["uuid"],
  ["uuids"],
  ["uuid", "hash"],
  ["uuid", "hashes"],
  ["cookie"],
  ["cookies"],
  ["email"],
  ["emails"],
  ["referrer"],
  ["referrers"],
  ["token"],
  ["tokens"],
  ["url"],
  ["urls"],
] as const;

function hasResponseKeySegmentSuffix(
  segments: string[],
  suffix: readonly string[],
) {
  if (segments.length < suffix.length) return false;
  const offset = segments.length - suffix.length;
  return suffix.every((segment, index) => segments[offset + index] === segment);
}

function isForbiddenResponseKey(key: string) {
  if (FORBIDDEN_RESPONSE_KEYS.has(normalizeResponseKey(key))) return true;
  const segments = responseKeySegments(key);
  return FORBIDDEN_RESPONSE_KEY_SUFFIXES.some((suffix) => (
    hasResponseKeySegmentSuffix(segments, suffix)
  ));
}

type RouteDependencies = {
  env?: NodeJS.ProcessEnv;
  authenticate?: typeof isDashboardRequestAuthenticated;
  resolveDataSpace?: typeof getDataSpaceBySlug;
  loadSnapshot?: (
    input: WebsiteCommerceFunnelV2Input,
  ) => Promise<WebsiteCommerceFunnelV2Snapshot>;
};

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) headers.set(key, value);
  return Response.json(body, { ...init, headers });
}

export function assertWebsiteCommerceFunnelV2AggregateOnly(value: unknown, path = "snapshot") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertWebsiteCommerceFunnelV2AggregateOnly(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenResponseKey(key)) {
      throw new Error(`V2 aggregate response contains a forbidden field at ${path}.${key}.`);
    }
    assertWebsiteCommerceFunnelV2AggregateOnly(entry, `${path}.${key}`);
  }
}

function parseInput(request: Request) {
  const search = new URL(request.url).searchParams;
  const rangeValue = search.get("range");
  const segmentValue = search.get("segment");
  if (rangeValue !== null && !["today", "7d", "30d"].includes(rangeValue)) return null;
  if (segmentValue !== null && !["all", "ready-made", "builder"].includes(segmentValue)) return null;
  return {
    dataSpaceSlug: search.get("dataSpaceSlug") ?? "moonarq",
    range: (rangeValue ?? "30d") as WebsiteCommerceFunnelV2Input["range"],
    segment: (segmentValue ?? "all") as WebsiteCommerceFunnelV2Input["segment"],
  };
}

export async function handleWebsiteCommerceFunnelV2Get(
  request: Request,
  dependencies: RouteDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  const authenticate = dependencies.authenticate ?? isDashboardRequestAuthenticated;
  if (!(await authenticate(request, env))) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  const input = parseInput(request);
  if (!input) return json({ error: "Invalid V2 funnel range or segment." }, { status: 400 });
  if (input.dataSpaceSlug !== "moonarq") {
    return json({ error: "The V2 commerce funnel is restricted to the MoonArq data space." }, { status: 403 });
  }

  try {
    const resolveDataSpace = dependencies.resolveDataSpace ?? getDataSpaceBySlug;
    const dataSpace = await resolveDataSpace(input.dataSpaceSlug);
    if (!dataSpace) return json({ error: "Unknown data space." }, { status: 404 });
    const loadSnapshot = dependencies.loadSnapshot
      ?? ((serviceInput: WebsiteCommerceFunnelV2Input) => getWebsiteCommerceFunnelV2Snapshot(
        serviceInput,
        { env },
      ));
    const snapshot = await loadSnapshot({
      dataSpaceId: dataSpace.id,
      range: input.range,
      segment: input.segment,
    });
    assertWebsiteCommerceFunnelV2AggregateOnly(snapshot);
    return json({ snapshot });
  } catch {
    return json(
      { error: "The V2 commerce funnel could not be refreshed safely." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleWebsiteCommerceFunnelV2Get(request);
}
