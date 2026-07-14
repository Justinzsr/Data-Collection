import { beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchSourceRoute } from "@/app/api/sources/[id]/route";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import {
  createSource,
  getSource,
  nextAlignedSyncAt,
  updateSource,
  type SourceUpdatePatch,
} from "@/storage/repositories/sources-repository";
import { resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

function patchRequest(body: unknown, dataSpaceSlug = "moonarq") {
  return new Request(
    `https://app.example.com/api/sources/${DEMO_SOURCE_IDS.website}?dataSpaceSlug=${dataSpaceSlug}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("source update safety", () => {
  beforeEach(() => resetDemoStore());

  it("rejects immutable, unknown, and SQL-shaped PATCH fields without mutating the source", async () => {
    const before = await getSource(DEMO_SOURCE_IDS.website, { dataSpaceId: DATA_SPACE_IDS.moonarq });
    const response = await patchSourceRoute(
      patchRequest({
        display_name: "Should not be applied",
        data_space_id: DATA_SPACE_IDS.autoLab,
        "display_name = $2 where true --": "unsafe",
      }),
      { params: Promise.resolve({ id: DEMO_SOURCE_IDS.website }) },
    );
    const after = await getSource(DEMO_SOURCE_IDS.website, { dataSpaceId: DATA_SPACE_IDS.moonarq });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid source update." });
    expect(after).toEqual(before);
  });

  it("validates connector sync capabilities and accepts a supported mutable patch", async () => {
    const unsupported = await patchSourceRoute(
      patchRequest({ sync_mode: "hourly" }),
      { params: Promise.resolve({ id: DEMO_SOURCE_IDS.website }) },
    );
    expect(unsupported.status).toBe(400);

    const unsafeUrl = await patchSourceRoute(
      patchRequest({ normalized_url: "javascript:alert(1)" }),
      { params: Promise.resolve({ id: DEMO_SOURCE_IDS.website }) },
    );
    expect(unsafeUrl.status).toBe(400);

    const response = await patchSourceRoute(
      patchRequest({
        display_name: "MoonArq Website Tracker",
        sync_mode: "webhook",
        sync_frequency_minutes: 30,
        status: "disabled",
      }),
      { params: Promise.resolve({ id: DEMO_SOURCE_IDS.website }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toMatchObject({
      id: DEMO_SOURCE_IDS.website,
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "website",
      display_name: "MoonArq Website Tracker",
      sync_mode: "webhook",
      sync_frequency_minutes: 30,
      status: "disabled",
    });
  });

  it("enforces the data-space scope and repository immutable-field guard", async () => {
    await expect(
      updateSource(
        DEMO_SOURCE_IDS.website,
        { display_name: "Wrong workspace" },
        { dataSpaceId: DATA_SPACE_IDS.autoLab },
      ),
    ).resolves.toBeNull();

    const unsafePatch = { data_space_id: DATA_SPACE_IDS.autoLab } as unknown as SourceUpdatePatch;
    await expect(updateSource(DEMO_SOURCE_IDS.website, unsafePatch)).rejects.toThrow(
      "immutable or unknown field",
    );

    const source = await getSource(DEMO_SOURCE_IDS.website, { dataSpaceId: DATA_SPACE_IDS.moonarq });
    expect(source?.display_name).not.toBe("Wrong workspace");
    expect(source?.data_space_id).toBe(DATA_SPACE_IDS.moonarq);
  });

  it("uses connector scheduling defaults and aligns polling to cron boundaries", async () => {
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.autoLab,
      source_type_key: "tiktok",
      display_name: "Auto Lab TikTok test",
    });

    expect(source).toMatchObject({
      sync_mode: "hourly",
      sync_frequency_minutes: 60,
      supports_webhook: false,
    });
    expect(nextAlignedSyncAt(new Date("2026-07-14T18:00:56.000Z"), 60)).toBe("2026-07-14T19:00:00.000Z");
  });
});
