import { beforeEach, describe, expect, it } from "vitest";
import { POST as saveSettings } from "@/app/api/sources/[id]/credentials/route";
import { DELETE as deleteSetting } from "@/app/api/sources/[id]/credentials/[fieldKey]/route";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

function sourceContext() {
  return { params: Promise.resolve({ id: DEMO_SOURCE_IDS.website }) };
}

describe("website source settings", () => {
  beforeEach(() => resetDemoStore());

  it("stores exact allowed origins as non-secret source metadata", async () => {
    const response = await saveSettings(new Request(
      `http://localhost:4000/api/sources/${DEMO_SOURCE_IDS.website}/credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentials: { allowed_origins: "https://shop.example, https://www.shop.example" } }),
      },
    ), sourceContext());
    const body = await response.json();
    const source = getDemoStore().sources.find((candidate) => candidate.id === DEMO_SOURCE_IDS.website);

    expect(response.status).toBe(200);
    expect(source?.metadata.allowed_origins).toEqual(["https://shop.example", "https://www.shop.example"]);
    expect(body.saved).toContainEqual(expect.objectContaining({
      field_key: "allowed_origins",
      value_hint: "https://shop.example, https://www.shop.example",
    }));
    expect(await listCredentialHints(DEMO_SOURCE_IDS.website)).not.toContainEqual(
      expect.objectContaining({ field_key: "allowed_origins" }),
    );
  });

  it("rejects non-origin values and clears the metadata setting through delete", async () => {
    const invalid = await saveSettings(new Request(
      `http://localhost:4000/api/sources/${DEMO_SOURCE_IDS.website}/credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentials: { allowed_origins: "https://shop.example/path" } }),
      },
    ), sourceContext());
    expect(invalid.status).toBe(400);

    const deleted = await deleteSetting(
      new Request(`http://localhost:4000/api/sources/${DEMO_SOURCE_IDS.website}/credentials/allowed_origins`, { method: "DELETE" }),
      { params: Promise.resolve({ id: DEMO_SOURCE_IDS.website, fieldKey: "allowed_origins" }) },
    );
    const source = getDemoStore().sources.find((candidate) => candidate.id === DEMO_SOURCE_IDS.website);

    expect(deleted.status).toBe(200);
    expect(source?.metadata.allowed_origins).toEqual([]);
  });
});
