import { beforeEach, describe, expect, it } from "vitest";
import { supabaseConnector } from "@/collection/connectors/supabase/connector";
import type { RawPayload } from "@/collection/connectors/types";
import { getSource } from "@/storage/repositories/sources-repository";
import { resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

function raw(payload: RawPayload["payload"]): RawPayload {
  return {
    externalId: "test",
    fetchedAt: "2026-04-22T12:00:00.000Z",
    payload,
    payloadHash: "hash",
    cursor: null,
  };
}

describe("Supabase connector normalization", () => {
  beforeEach(() => resetDemoStore());

  it("skips production polling when only webhook ingestion is configured", async () => {
    const source = await getSource(DEMO_SOURCE_IDS.supabase);
    if (!source) throw new Error("Missing demo source");

    const result = await supabaseConnector.sync({
      source,
      credentials: {},
      trigger: "cron",
      isDemoMode: false,
    });

    expect(result).toMatchObject({
      recordsFetched: 0,
      skippedReason: "No polling credential configured; awaiting authenticated Supabase webhooks.",
    });
  });

  it("groups signups by created_at date and writes snapshot totals on sync date", async () => {
    const source = await getSource(DEMO_SOURCE_IDS.supabase);
    if (!source) throw new Error("Missing demo source");
    const bundle = await supabaseConnector.normalize(
      [
        {
          ...raw({
            users: [
              {
                id: "user-1",
                created_at: "2026-02-20T10:00:00.000Z",
                confirmed_at: "2026-02-20T10:05:00.000Z",
                provider: "email",
              },
              {
                id: "user-2",
                created_at: "2026-04-21T10:00:00.000Z",
                confirmed_at: null,
                provider: "google",
              },
              {
                id: "user-3",
                created_at: "2026-04-21T12:00:00.000Z",
                email_confirmed_at: "2026-04-21T12:05:00.000Z",
                provider: "email",
              },
            ],
            mode: "admin_list_users",
          }),
          fetchedAt: "2026-04-22T12:00:00.000Z",
        },
      ],
      source,
    );
    const signups = bundle.metrics.filter((metric) => metric.metricKey === "signups");
    const usersTotal = bundle.metrics.filter((metric) => metric.metricKey === "users_total");
    const confirmed = bundle.metrics.filter((metric) => metric.metricKey === "confirmed_users");
    const provider = bundle.metrics.find((metric) => metric.metricKey === "signups_by_provider" && metric.date === "2026-04-21" && metric.dimensions?.provider === "google");

    expect(signups.find((metric) => metric.date === "2026-02-20")?.metricValue).toBe(1);
    expect(signups.find((metric) => metric.date === "2026-04-21")?.metricValue).toBe(2);
    expect(usersTotal).toHaveLength(1);
    expect(usersTotal[0]).toMatchObject({ date: "2026-04-22", metricValue: 3, dimensions: { rollup: "snapshot" } });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ date: "2026-04-22", metricValue: 2, dimensions: { rollup: "snapshot" } });
    expect(usersTotal[0]?.date).not.toBe("2026-02-20");
    expect(provider?.metricValue).toBe(1);
  });

  it("writes admin snapshot totals on the Pacific sync date even when users are historical", async () => {
    const source = await getSource(DEMO_SOURCE_IDS.supabase);
    if (!source) throw new Error("Missing demo source");
    const bundle = await supabaseConnector.normalize(
      [
        {
          ...raw({
            users: [
              {
                id: "user-1",
                created_at: "2026-02-20T10:00:00.000Z",
                confirmed_at: "2026-02-20T10:05:00.000Z",
                provider: "email",
              },
              {
                id: "user-2",
                created_at: "2026-02-21T10:00:00.000Z",
                email_confirmed_at: "2026-02-21T10:05:00.000Z",
                provider: "google",
              },
            ],
            mode: "admin_list_users",
          }),
          fetchedAt: "2026-04-27T06:30:00.000Z",
        },
      ],
      source,
    );

    const usersTotal = bundle.metrics.find((metric) => metric.metricKey === "users_total");
    const confirmed = bundle.metrics.find((metric) => metric.metricKey === "confirmed_users");
    const signupDates = bundle.metrics
      .filter((metric) => metric.metricKey === "signups")
      .map((metric) => metric.date);

    expect(usersTotal).toMatchObject({ date: "2026-04-26", metricValue: 2, dimensions: { rollup: "snapshot" } });
    expect(confirmed).toMatchObject({ date: "2026-04-26", metricValue: 2, dimensions: { rollup: "snapshot" } });
    expect(signupDates).toEqual(["2026-02-20", "2026-02-21"]);
  });

  it("uses Pacific business dates for signups near UTC midnight", async () => {
    const source = await getSource(DEMO_SOURCE_IDS.supabase);
    if (!source) throw new Error("Missing demo source");
    const bundle = await supabaseConnector.normalize(
      [
        raw({
          users: [
            {
              id: "user-late-pt",
              created_at: "2026-04-27T06:30:00.000Z",
              confirmed_at: null,
              provider: "email",
            },
          ],
          mode: "admin_list_users",
        }),
      ],
      source,
    );

    expect(bundle.metrics.find((metric) => metric.metricKey === "signups")?.date).toBe("2026-04-26");
  });

  it("normalizes public.profiles insert webhook payloads", async () => {
    const source = await getSource(DEMO_SOURCE_IDS.supabase);
    if (!source) throw new Error("Missing demo source");
    const bundle = await supabaseConnector.normalize(
      [
        raw({
          type: "INSERT",
          table: "profiles",
          record: {
            id: "profile-1",
            created_at: "2026-04-18T08:00:00.000Z",
            confirmed_at: "2026-04-18T08:03:00.000Z",
            provider: "github",
          },
        }),
      ],
      source,
    );
    expect(bundle.metrics.find((metric) => metric.metricKey === "signups")?.date).toBe("2026-04-18");
    expect(bundle.metrics.find((metric) => metric.metricKey === "signups_by_provider")?.dimensions?.provider).toBe("github");
  });
});
