import { EmailSignupSourceError } from "@/collection/connectors/supabase/email-signups-adapter";
import { getEmailMarketingSnapshot, type EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

type EmailSignupRouteDependencies = {
  env?: NodeJS.ProcessEnv;
  resolveDataSpace?: typeof getDataSpaceBySlug;
  loadSnapshot?: (dataSpaceId: string) => Promise<EmailMarketingSnapshot>;
};

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) headers.set(key, value);
  return Response.json(body, { ...init, headers });
}

function sourceErrorStatus(error: EmailSignupSourceError) {
  if (error.code === "source_ambiguous" || error.code === "source_mismatch") return 409;
  if (error.code === "source_not_configured" || error.code === "credential_missing") return 503;
  return 502;
}

export async function handleEmailSignupsGet(
  request: Request,
  dependencies: EmailSignupRouteDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  if (!(await isDashboardRequestAuthenticated(request, env))) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  const dataSpaceSlug = new URL(request.url).searchParams.get("dataSpaceSlug") ?? "moonarq";
  if (dataSpaceSlug !== "moonarq") {
    return json({ error: "Email marketing data is restricted to the MoonArq data space." }, { status: 403 });
  }

  try {
    const resolveDataSpace = dependencies.resolveDataSpace ?? getDataSpaceBySlug;
    const dataSpace = await resolveDataSpace(dataSpaceSlug);
    if (!dataSpace) return json({ error: "Unknown data space." }, { status: 404 });
    const loadSnapshot = dependencies.loadSnapshot ?? getEmailMarketingSnapshot;
    return json({ snapshot: await loadSnapshot(dataSpace.id) });
  } catch (error) {
    if (error instanceof EmailSignupSourceError) {
      return json({ error: error.message, code: error.code }, { status: sourceErrorStatus(error) });
    }
    return json(
      { error: "Email marketing data could not be refreshed. Previously loaded data remains safe to use." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleEmailSignupsGet(request);
}
