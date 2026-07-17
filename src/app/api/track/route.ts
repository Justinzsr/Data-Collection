import { ingestTrackEvent, TrackingIngestionError } from "@/collection/tracking/track-endpoint";
import { MAX_TRACKING_BODY_BYTES } from "@/collection/tracking/website-event-contract";
import { consumeWebsiteTrackingPreflightRateLimit } from "@/collection/tracking/website-rate-limit";

export const runtime = "nodejs";

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  let responseOrigin: string | null = null;
  if (origin) {
    try {
      const url = new URL(origin);
      if (["http:", "https:"].includes(url.protocol) && url.origin === origin) responseOrigin = origin;
    } catch {
      responseOrigin = null;
    }
  }
  return {
    ...(responseOrigin ? { "access-control-allow-origin": responseOrigin } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

function isJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "application/json";
}

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function readBodyWithLimit(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_TRACKING_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TrackingIngestionError("Tracking payload is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function safeErrorResponse(error: unknown, headers: Record<string, string>) {
  if (error instanceof TrackingIngestionError) {
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode, headers: { ...headers, ...error.responseHeaders } },
    );
  }
  return Response.json(
    { ok: false, error: "Tracking event could not be processed." },
    { status: 500, headers },
  );
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  const ip = requestIp(request);
  const preflightRateLimit = consumeWebsiteTrackingPreflightRateLimit({ ip, now: Date.now() });
  if (preflightRateLimit && !preflightRateLimit.allowed) {
    return Response.json(
      { ok: false, error: "Tracking rate limit exceeded." },
      { status: 429, headers: { ...headers, "retry-after": String(preflightRateLimit.retryAfterSeconds) } },
    );
  }
  if (!isJsonContentType(request)) {
    return Response.json({ ok: false, error: "Content-Type must be application/json." }, { status: 415, headers });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_TRACKING_BODY_BYTES) {
    return Response.json({ ok: false, error: "Tracking payload is too large." }, { status: 413, headers });
  }
  try {
    const rawBody = await readBodyWithLimit(request);
    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      throw new TrackingIngestionError("Tracking payload is invalid.", 400);
    }
    const result = await ingestTrackEvent(body, {
      origin: request.headers.get("origin"),
      ip,
      userAgent: request.headers.get("user-agent"),
      receivedAt: new Date(),
    });
    return Response.json(
      {
        ok: true,
        event_id: result.event.event_id,
        record_id: result.event.id,
        duplicate: !result.inserted,
      },
      { status: result.inserted ? 202 : 200, headers },
    );
  } catch (error) {
    return safeErrorResponse(error, headers);
  }
}
