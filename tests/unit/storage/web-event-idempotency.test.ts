import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebEvent } from "@/storage/db/schema";

const { queryRowsMock } = vi.hoisted(() => ({ queryRowsMock: vi.fn() }));

vi.mock("@/storage/db/client", () => ({
  isRuntimeDatabaseConfigured: () => true,
  queryRows: queryRowsMock,
}));

import { storeWebEvent } from "@/storage/repositories/events-repository";

function persistedEvent(overrides: Partial<WebEvent> = {}): WebEvent {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    schema_version: "1.0",
    event_source: "first_party_tracker",
    source_id: "11111111-1111-4111-8111-111111111111",
    public_tracking_key: "mq_public_test",
    anonymous_id: "anon-1",
    session_id: "session-1",
    user_id: null,
    event_name: "page_view",
    path: "/collections/core",
    url: "https://moonarqstudio.com/collections/core",
    referrer: null,
    user_agent: null,
    ip_hash: null,
    country: "US",
    device_type: "desktop",
    properties: { page_title: "Core Collection" },
    attribution_context: { utm_source: "instagram" },
    consent_status: { analytics: "granted", marketing: "denied" },
    client_context: { language: "en-US", currency: "USD" },
    occurred_at: "2026-07-17T18:00:00.000Z",
    received_at: "2026-07-17T18:00:01.000Z",
    created_at: "2026-07-17T18:00:01.000Z",
    ...overrides,
  };
}

function eventInput(event: WebEvent): Omit<WebEvent, "id" | "created_at"> {
  return {
    event_id: event.event_id,
    schema_version: event.schema_version,
    event_source: event.event_source,
    source_id: event.source_id,
    public_tracking_key: event.public_tracking_key,
    anonymous_id: event.anonymous_id,
    session_id: event.session_id,
    user_id: event.user_id,
    event_name: event.event_name,
    path: event.path,
    url: event.url,
    referrer: event.referrer,
    user_agent: event.user_agent,
    ip_hash: event.ip_hash,
    country: event.country,
    device_type: event.device_type,
    properties: event.properties,
    attribution_context: event.attribution_context,
    consent_status: event.consent_status,
    client_context: event.client_context,
    occurred_at: event.occurred_at,
    received_at: event.received_at,
  };
}

describe("database web-event idempotency", () => {
  beforeEach(() => queryRowsMock.mockReset());

  it("uses the source/event conflict key and reports a new insert", async () => {
    const inserted = persistedEvent();
    queryRowsMock.mockResolvedValueOnce([inserted]);

    const result = await storeWebEvent(eventInput(inserted));

    expect(result).toEqual({ event: inserted, inserted: true });
    expect(queryRowsMock).toHaveBeenCalledTimes(1);
    expect(String(queryRowsMock.mock.calls[0]?.[0])).toMatch(
      /on conflict \(source_id, event_id\) do nothing/i,
    );
  });

  it("selects and reports the existing event when the insert conflicts", async () => {
    const existing = persistedEvent();
    queryRowsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([existing]);

    const result = await storeWebEvent(eventInput(existing));

    expect(result).toEqual({ event: existing, inserted: false });
    expect(queryRowsMock).toHaveBeenCalledTimes(2);
    expect(String(queryRowsMock.mock.calls[0]?.[0])).toMatch(
      /on conflict \(source_id, event_id\) do nothing/i,
    );
    expect(String(queryRowsMock.mock.calls[1]?.[0])).toContain(
      "where source_id is not distinct from $1",
    );
    expect(String(queryRowsMock.mock.calls[1]?.[0])).toContain("and event_id = $2");
    expect(queryRowsMock.mock.calls[1]?.[1]).toEqual([existing.source_id, existing.event_id]);
  });
});
