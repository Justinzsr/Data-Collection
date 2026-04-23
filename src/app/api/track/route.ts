import { ingestTrackEvent } from "@/collection/tracking/track-endpoint";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const event = await ingestTrackEvent(body, {
      origin: request.headers.get("origin"),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    return Response.json({ ok: true, event_id: event.id }, { status: 202 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Invalid tracking event." }, { status: 400 });
  }
}
