import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncRun } from "@/storage/db/schema";

const { queryRowsMock } = vi.hoisted(() => ({ queryRowsMock: vi.fn() }));

vi.mock("@/storage/db/client", () => ({
  isRuntimeDatabaseConfigured: () => true,
  queryRows: queryRowsMock,
}));

import { createOrGetSyncRun } from "@/storage/repositories/sync-runs-repository";

function persistedRun(overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    source_id: "22222222-2222-4222-8222-222222222222",
    source_type_key: "supabase",
    trigger: "cron",
    status: "success",
    idempotency_key: "source:cron:2026-07-14T02",
    lock_key: null,
    started_at: "2026-07-14T02:00:00.000Z",
    finished_at: "2026-07-14T02:00:01.000Z",
    duration_ms: 1000,
    records_fetched: 1,
    records_inserted: 1,
    records_updated: 0,
    metrics_upserted: 1,
    error_message: null,
    error_stack: null,
    cursor_before: null,
    cursor_after: null,
    metadata: {},
    created_at: "2026-07-14T02:00:00.000Z",
    ...overrides,
  };
}

describe("database sync-run idempotency", () => {
  beforeEach(() => queryRowsMock.mockReset());

  it("uses ON CONFLICT and returns the existing run after a duplicate key", async () => {
    const existing = persistedRun();
    queryRowsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([existing]);

    const result = await createOrGetSyncRun({
      source_id: existing.source_id,
      source_type_key: existing.source_type_key,
      trigger: existing.trigger,
      idempotency_key: existing.idempotency_key,
    });

    expect(result).toEqual({ run: existing, created: false });
    expect(queryRowsMock).toHaveBeenCalledTimes(2);
    expect(String(queryRowsMock.mock.calls[0]?.[0])).toContain(
      "on conflict (idempotency_key) do nothing",
    );
    expect(String(queryRowsMock.mock.calls[1]?.[0])).toContain(
      "where idempotency_key = $1",
    );
  });

  it("marks a newly inserted database run as created", async () => {
    const inserted = persistedRun({ status: "queued", finished_at: null });
    queryRowsMock.mockResolvedValueOnce([inserted]);

    const result = await createOrGetSyncRun({
      source_id: inserted.source_id,
      source_type_key: inserted.source_type_key,
      trigger: inserted.trigger,
      idempotency_key: inserted.idempotency_key,
    });

    expect(result).toEqual({ run: inserted, created: true });
    expect(queryRowsMock).toHaveBeenCalledTimes(1);
  });
});
