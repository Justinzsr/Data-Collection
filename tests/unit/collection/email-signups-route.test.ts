import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";
import { EmailSignupSourceError } from "@/collection/connectors/supabase/email-signups-adapter";
import { handleEmailSignupsGet } from "@/app/api/metrics/email-signups/route";
import {
  getDashboardSessionCookieName,
  signDashboardSession,
} from "@/storage/auth/dashboard-session";
import type { DataSpace } from "@/storage/db/schema";

const AUTH_ENV = {
  NODE_ENV: "production",
  DEV_AUTH_BYPASS: "false",
  DASHBOARD_ADMIN_PASSWORD: "dashboard-password-for-tests",
  DASHBOARD_SESSION_SECRET: "dashboard-session-secret-for-tests",
} as NodeJS.ProcessEnv;

const DATA_SPACE: DataSpace = {
  id: "data-space-moonarq",
  slug: "moonarq",
  display_name: "MoonArq",
  description: null,
  category: "business",
  icon: null,
  is_default: true,
  status: "active",
  metadata: {},
  created_at: "2026-07-18T18:00:00.000Z",
  updated_at: "2026-07-18T18:00:00.000Z",
};

const SNAPSHOT: EmailMarketingSnapshot = {
  rows: [],
  kpis: {
    totalSignups: 0,
    consentedSignups: 0,
    promoEmailsSent: 0,
    pendingPromoEmails: 0,
    promoEmailSendRate: 0,
    shopifyLinkedCustomers: 0,
    signupsLast24Hours: 0,
    signupsLast7Days: 0,
  },
  fetchedAt: "2026-07-18T18:00:00.000Z",
  source: {
    project: "moonarq-web",
    schema: "public",
    table: "email_signups",
    connection: "direct_supabase",
  },
};

async function routeRequest(
  path = "/api/metrics/email-signups?dataSpaceSlug=moonarq",
  authenticated = true,
) {
  const session = authenticated
    ? await signDashboardSession(AUTH_ENV.DASHBOARD_SESSION_SECRET!)
    : null;
  return new Request(`https://app.example.com${path}`, {
    headers: session
      ? {
          cookie: `${getDashboardSessionCookieName(AUTH_ENV)}=${encodeURIComponent(session)}`,
        }
      : undefined,
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie");
}

describe("email signups authenticated API route", () => {
  it("rejects unauthenticated requests before resolving a data space or reading PII", async () => {
    const resolveDataSpace = vi.fn(async () => DATA_SPACE);
    const loadSnapshot = vi.fn(async () => SNAPSHOT);

    const response = await handleEmailSignupsGet(await routeRequest(undefined, false), {
      env: AUTH_ENV,
      resolveDataSpace,
      loadSnapshot,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
    expect(resolveDataSpace).not.toHaveBeenCalled();
    expect(loadSnapshot).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("does not allow an authenticated request to select a different data space", async () => {
    const loadSnapshot = vi.fn(async () => SNAPSHOT);
    const response = await handleEmailSignupsGet(
      await routeRequest("/api/metrics/email-signups?dataSpaceSlug=auto-lab"),
      {
        env: AUTH_ENV,
        resolveDataSpace: vi.fn(async () => DATA_SPACE),
        loadSnapshot,
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Email marketing data is restricted to the MoonArq data space.",
    });
    expect(loadSnapshot).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("returns the protected snapshot with no-store headers", async () => {
    const loadSnapshot = vi.fn(async () => SNAPSHOT);
    const response = await handleEmailSignupsGet(await routeRequest(), {
      env: AUTH_ENV,
      resolveDataSpace: vi.fn(async () => DATA_SPACE),
      loadSnapshot,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ snapshot: SNAPSHOT });
    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(loadSnapshot).toHaveBeenCalledWith(DATA_SPACE.id);
    expectNoStore(response);
  });

  it("maps a selected-project mismatch to a conflict without exposing stack data", async () => {
    const response = await handleEmailSignupsGet(await routeRequest(), {
      env: AUTH_ENV,
      resolveDataSpace: vi.fn(async () => DATA_SPACE),
      loadSnapshot: vi.fn(async () => {
        throw new EmailSignupSourceError(
          "source_mismatch",
          "The selected source is not the monitored MoonArq website Supabase project.",
        );
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "The selected source is not the monitored MoonArq website Supabase project.",
      code: "source_mismatch",
    });
    expect(JSON.stringify(body)).not.toMatch(/stack|service[_-]?role|authorization|secret/i);
    expectNoStore(response);
  });

  it("sanitizes unexpected backend failures instead of returning their message", async () => {
    const sensitiveFailure = new Error(
      "upstream rejected Authorization: Bearer do-not-leak-service-role-value",
    );
    sensitiveFailure.stack = "stack contains do-not-leak-service-role-value";
    const response = await handleEmailSignupsGet(await routeRequest(), {
      env: AUTH_ENV,
      resolveDataSpace: vi.fn(async () => DATA_SPACE),
      loadSnapshot: vi.fn(async () => {
        throw sensitiveFailure;
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Email marketing data could not be refreshed. Previously loaded data remains safe to use.",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /do-not-leak|authorization|bearer|service[_-]?role|stack/i,
    );
    expectNoStore(response);
  });
});

describe("email marketing client security boundary", () => {
  it("contains no service-role, global secret, or environment access in client modules", () => {
    const directory = join(process.cwd(), "src/presentation/email-marketing");
    const clientModules = readdirSync(directory)
      .filter((fileName) => /\.tsx?$/u.test(fileName))
      .map((fileName) => ({
        fileName,
        source: readFileSync(join(directory, fileName), "utf8"),
      }))
      .filter(({ source }) => /^\s*["']use client["'];/u.test(source));

    expect(clientModules.map(({ fileName }) => fileName).sort()).toEqual([
      "email-marketing-dashboard.tsx",
      "use-email-marketing-data.ts",
    ]);

    const forbiddenPatterns = [
      /service[_ -]?role/iu,
      /\bSUPABASE_(?:SERVICE_ROLE|SECRET)_KEY\b/u,
      /\bprocess\.env\b/u,
      /\bimport\.meta\.env\b/u,
      /\bNEXT_PUBLIC_[A-Z0-9_]+\b/u,
      /\b(?:DATA_HUB_EMAIL_SIGNUPS_SECRET|DASHBOARD_SESSION_SECRET|DASHBOARD_ADMIN_PASSWORD|MOONARQ_EMAIL_SIGNUPS_EXPORT_URL)\b/u,
    ];

    for (const { fileName, source } of clientModules) {
      for (const pattern of forbiddenPatterns) {
        expect(source, `${fileName} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
