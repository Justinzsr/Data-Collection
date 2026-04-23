import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { ConnectorDefinition, RawPayload } from "@/collection/connectors/types";
import type { JsonRecord, MetricDefinition, Source } from "@/storage/db/schema";
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

type SupabaseUserLike = {
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
  confirmed_at?: unknown;
  email_confirmed_at?: unknown;
  provider?: unknown;
  app_metadata?: unknown;
  raw_app_meta_data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateKey(value: unknown) {
  const fallback = new Date().toISOString().slice(0, 10);
  if (typeof value !== "string" || !value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().slice(0, 10);
}

function providerFor(user: SupabaseUserLike) {
  if (typeof user.provider === "string" && user.provider) return user.provider;
  if (isRecord(user.app_metadata) && typeof user.app_metadata.provider === "string") return user.app_metadata.provider;
  if (isRecord(user.raw_app_meta_data) && typeof user.raw_app_meta_data.provider === "string") return user.raw_app_meta_data.provider;
  return "email";
}

function isConfirmed(user: SupabaseUserLike) {
  return Boolean(user.confirmed_at || user.email_confirmed_at);
}

function extractProfileRecord(payload: JsonRecord): SupabaseUserLike | null {
  const record = payload.record ?? payload.new ?? payload.profile;
  if (isRecord(record)) return record;
  const data = payload.data;
  if (isRecord(data)) {
    const nestedRecord = data.record ?? data.new ?? data.profile;
    if (isRecord(nestedRecord)) return nestedRecord;
  }
  return null;
}

function extractUsers(rawPayloads: RawPayload[]): SupabaseUserLike[] {
  const extracted: SupabaseUserLike[] = [];
  for (const payload of rawPayloads) {
    const payloadUsers = payload.payload.users;
    if (Array.isArray(payloadUsers)) {
      for (const user of payloadUsers) {
        if (isRecord(user)) extracted.push(user);
      }
      continue;
    }
    const record = extractProfileRecord(payload.payload);
    if (record) extracted.push(record);
  }
  return extracted;
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
      const perPage = 1000;
      const users = [];
      for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < perPage) break;
      }
      const payload = {
        mode: "admin_list_users",
        pagination: { perPage, pagesFetched: Math.ceil(users.length / perPage), complete: users.length % perPage !== 0 || users.length === 0 },
        users: users.map((user) => ({
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
        recordsFetched: users.length,
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
    const users = extractUsers(rawPayloads);
    const demo = source.status === "demo";
    const byDate = new Map<string, SupabaseUserLike[]>();
    for (const user of users) {
      const date = dateKey(user.created_at);
      byDate.set(date, [...(byDate.get(date) ?? []), user]);
    }
    const dates = Array.from(byDate.keys()).sort();
    let cumulativeUsers = 0;
    let cumulativeConfirmed = 0;
    return {
      metrics: dates.flatMap((date) => {
        const usersForDate = byDate.get(date) ?? [];
        cumulativeUsers += usersForDate.length;
        cumulativeConfirmed += usersForDate.filter(isConfirmed).length;
        const providers = usersForDate.reduce<Record<string, number>>((acc, user) => {
          const provider = providerFor(user);
          acc[provider] = (acc[provider] ?? 0) + 1;
          return acc;
        }, {});
        return [
          {
            date,
            sourceId: source.id,
            sourceTypeKey: "supabase" as const,
            metricKey: "signups",
            metricValue: usersForDate.length,
            unit: "count",
            dimensions: { rollup: "daily", demo },
          },
          {
            date,
            sourceId: source.id,
            sourceTypeKey: "supabase" as const,
            metricKey: "users_total",
            metricValue: cumulativeUsers,
            unit: "count",
            dimensions: { rollup: "cumulative", demo },
          },
          {
            date,
            sourceId: source.id,
            sourceTypeKey: "supabase" as const,
            metricKey: "confirmed_users",
            metricValue: cumulativeConfirmed,
            unit: "count",
            dimensions: { rollup: "cumulative", demo },
          },
          ...Object.entries(providers).map(([provider, count]) => ({
            date,
            sourceId: source.id,
            sourceTypeKey: "supabase" as const,
            metricKey: "signups_by_provider",
            metricValue: count,
            unit: "count",
            dimensions: { provider, demo },
          })),
        ];
      }),
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
