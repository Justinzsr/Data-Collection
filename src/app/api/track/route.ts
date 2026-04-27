import { ingestTrackEvent, TrackingIngestionError } from "@/collection/tracking/track-endpoint";

export const runtime = "nodejs";

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  return {
    ...(origin ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    const body = await request.json();
    const event = await ingestTrackEvent(body, {
      origin: request.headers.get("origin"),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    return Response.json({ ok: true, event_id: event.id }, { status: 202, headers });
  } catch (error) {
    const status = error instanceof TrackingIngestionError ? error.statusCode : 400;
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Invalid tracking event." }, { status, headers });
  }
}
