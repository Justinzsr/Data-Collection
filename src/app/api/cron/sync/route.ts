import { runScheduledSync } from "@/collection/sync/scheduler";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";

export const runtime = "nodejs";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return bearer === secret || url.searchParams.get("secret") === secret;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    await recordConnectorEvent({
      source_id: null,
      event_type: "cron_unauthorized",
      severity: "warning",
      message: "Rejected cron sync request without CRON_SECRET.",
    });
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const runs = await runScheduledSync();
    return Response.json({ runs });
  } catch (error) {
    await recordConnectorEvent({
      source_id: null,
      event_type: "cron_error",
      severity: "error",
      message: error instanceof Error ? error.message : "Cron sync failed.",
    });
    return Response.json({ error: error instanceof Error ? error.message : "Cron sync failed." }, { status: 500 });
  }
}
