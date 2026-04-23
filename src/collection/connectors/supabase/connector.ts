import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { ConnectorDefinition, RawPayload } from "@/collection/connectors/types";
import type { MetricDefinition, Source } from "@/storage/db/schema";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";

function normalizeSupabaseUrl(inputUrl: string) {
  try {
    const url = new URL(inputUrl);
    if (!/\.supabase\.co$/i.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const supabaseSetupSql = `-- MoonArq public.profiles setup
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  provider text,
  confirmed_at timestamptz,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, provider, confirmed_at, created_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    new.email_confirmed_at,
    new.created_at
  )
  on conflict (id) do update set
    email = excluded.email,
    provider = excluded.provider,
    confirmed_at = excluded.confirmed_at;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();`;

export const supabaseConnector: ConnectorDefinition = {
  key: "supabase",
  displayName: "Supabase",
  description: "Collect signup and user metrics from public.profiles webhooks or server-side Auth admin mode.",
  category: "Users",
  icon: "DatabaseZap",
  urlPatterns: [/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i],
  requiredFields: [],
  optionalFields: [
    {
      key: "service_role_key",
      label: "Service role key",
      description: "Server-only admin fallback for listing Auth users. Never sent to the browser.",
      required: false,
      secret: true,
      type: "password",
      placeholder: "eyJhbGciOi...",
    },
    {
      key: "anon_key",
      label: "Anon key",
      description: "Optional anon key for public profiles checks.",
      required: false,
      secret: true,
      type: "password",
      placeholder: "eyJhbGciOi...",
    },
  ],
  authType: "public_profiles_or_service_role",
  docsUrl: "https://supabase.com/docs/guides/auth/managing-user-data",
  capabilities: {
    supportsWebhook: true,
    supportsPolling: true,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 60,
    canBackfill: true,
    canTestConnection: true,
  },
  detect(inputUrl) {
    const normalized = normalizeSupabaseUrl(inputUrl);
    if (!normalized) return null;
    const projectRef = new URL(normalized).hostname.split(".")[0];
    return {
      sourceTypeKey: "supabase",
      displayName: "Supabase",
      confidence: 0.98,
      normalizedUrl: normalized,
      externalAccountId: projectRef,
      accountName: projectRef,
      reasons: ["URL host ends with .supabase.co."],
      requiredSetup: [
        "Use public.profiles for event-driven signup metrics, or add a service role key for server-side admin fallback.",
        "auth.users is not exposed through normal public APIs.",
        "Service role keys stay encrypted server-side and are never sent to browser code.",
      ],
      possibleMetrics: ["signups", "users_total", "confirmed_users", "signups_by_provider"],
      demoAvailable: true,
    };
  },
  async testConnection(ctx) {
    const projectUrl = ctx.source.normalized_url ?? ctx.source.input_url;
    const serviceRole = ctx.credentials.service_role_key;
    if (!projectUrl) {
      return { ok: false, status: "error", message: "Missing Supabase project URL." };
    }
    if (!serviceRole) {
      return {
        ok: true,
        status: "needs_credentials",
        message: "Supabase source is saved. Add public.profiles webhook setup or a service role key for real private metrics.",
        details: { mode: "demo_or_public_profiles" },
      };
    }
    try {
      const client = createClient(projectUrl, serviceRole, { auth: { persistSession: false } });
      const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) throw error;
      return { ok: true, status: "connected", message: "Supabase admin connection succeeded server-side." };
    } catch (error) {
      return {
        ok: false,
        status: "error",
        message: error instanceof Error ? error.message : "Supabase connection test failed.",
      };
    }
  },
  async sync(ctx) {
    const fetchedAt = new Date().toISOString();
    const projectUrl = ctx.source.normalized_url ?? ctx.source.input_url;
    const serviceRole = ctx.credentials.service_role_key;
    if (projectUrl && serviceRole) {
      const client = createClient(projectUrl, serviceRole, { auth: { persistSession: false } });
      const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      const payload = {
        mode: "admin_list_users",
        users: data.users.map((user) => ({
          id: user.id,
          email: user.email ?? null,
          created_at: user.created_at,
          confirmed_at: user.email_confirmed_at ?? null,
          provider: user.app_metadata?.provider ?? "email",
        })),
      };
      return {
        rawPayloads: [
          {
            externalId: `supabase-users-${ctx.source.id}`,
            fetchedAt,
            payload,
            payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
            cursor: { fetchedAt, mode: "admin" },
          },
        ],
        cursorAfter: { fetchedAt, mode: "admin" },
        recordsFetched: data.users.length,
        message: "Fetched Supabase Auth users with server-side service role.",
      };
    }

    const demoUsers = Array.from({ length: 8 }, (_, index) => ({
      id: `demo-user-${index + 1}`,
      provider: index % 3 === 0 ? "google" : "email",
      confirmed_at: fetchedAt,
      created_at: new Date(Date.now() - index * 86_400_000).toISOString(),
    }));
    const payload = { mode: "demo_public_profiles", users: demoUsers };
    return {
      rawPayloads: [
        {
          externalId: `supabase-demo-${ctx.source.id}`,
          fetchedAt,
          payload,
          payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
          cursor: { fetchedAt, mode: "demo" },
        },
      ],
      cursorAfter: { fetchedAt, mode: "demo" },
      recordsFetched: demoUsers.length,
      message: "Supabase demo/public profile sync completed.",
    };
  },
  async normalize(rawPayloads: RawPayload[], source: Source) {
    const today = new Date().toISOString().slice(0, 10);
    const users = rawPayloads.flatMap((payload) => {
      const value = payload.payload.users;
      return Array.isArray(value) ? value : [];
    });
    const confirmed = users.filter((user) => typeof user === "object" && user && "confirmed_at" in user).length;
    const providers = users.reduce<Record<string, number>>((acc, user) => {
      const provider =
        typeof user === "object" && user && "provider" in user && typeof user.provider === "string"
          ? user.provider
          : "unknown";
      acc[provider] = (acc[provider] ?? 0) + 1;
      return acc;
    }, {});
    return {
      metrics: [
        {
          date: today,
          sourceId: source.id,
          sourceTypeKey: "supabase",
          metricKey: "signups",
          metricValue: users.length,
          unit: "count",
          dimensions: { demo: source.status === "demo" },
        },
        {
          date: today,
          sourceId: source.id,
          sourceTypeKey: "supabase",
          metricKey: "users_total",
          metricValue: users.length,
          unit: "count",
          dimensions: { demo: source.status === "demo" },
        },
        {
          date: today,
          sourceId: source.id,
          sourceTypeKey: "supabase",
          metricKey: "confirmed_users",
          metricValue: confirmed,
          unit: "count",
          dimensions: { demo: source.status === "demo" },
        },
        ...Object.entries(providers).map(([provider, count]) => ({
          date: today,
          sourceId: source.id,
          sourceTypeKey: "supabase" as const,
          metricKey: "signups_by_provider",
          metricValue: count,
          unit: "count",
          dimensions: { provider, demo: source.status === "demo" },
        })),
      ],
    };
  },
  getMetricDefinitions(): MetricDefinition[] {
    return metricDefinitions.filter((metric) => metric.source_type_key === "supabase");
  },
  getSetupInstructions() {
    return [
      "Recommended mode: create public.profiles and mirror auth.users with the SQL generated by MoonArq.",
      "Set up a database webhook on public.profiles INSERT to POST to /api/webhooks/supabase/{sourceId}.",
      "Admin fallback mode: add the Supabase service role key as an encrypted per-source credential.",
      "Never put the service role key in frontend code, browser logs, screenshots, or public docs.",
      supabaseSetupSql,
    ];
  },
};
