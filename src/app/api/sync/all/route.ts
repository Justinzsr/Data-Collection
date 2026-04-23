import { runDueSources } from "@/collection/sync/engine";

export const runtime = "nodejs";

export async function POST() {
  const runs = await runDueSources("manual");
  return Response.json({ runs });
}
