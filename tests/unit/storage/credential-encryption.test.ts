import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/storage/credentials/encryption";
import { maskSecret } from "@/storage/credentials/masking";
import { saveCredential, getDecryptedCredentialMap, listCredentialHints, deleteCredential } from "@/storage/repositories/credentials-repository";
import { resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

describe("credentials", () => {
  it("encrypts and decrypts with AES-GCM", () => {
    const encrypted = encryptSecret("super-secret-value");
    expect(encrypted.encryptedValue).not.toContain("super-secret-value");
    expect(decryptSecret(encrypted)).toBe("super-secret-value");
  });

  it("masks secrets without revealing full values", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("a••••p");
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("123456789")).toBe("••••");
    // A short secret, such as an Etsy app's shared secret, keeps eight of its ten characters hidden.
    expect(maskSecret("k2j9x8w7q1")).toBe("k••••1");
    expect(maskSecret("a".repeat(20) + "b".repeat(20))).toBe("aaaa••••bbbb");
  });

  it("saves encrypted credential hints without returning decrypted values", async () => {
    resetDemoStore();
    await saveCredential(DEMO_SOURCE_IDS.supabase, "service_role_key", "supabase-secret-value");
    const hints = await listCredentialHints(DEMO_SOURCE_IDS.supabase);
    expect(hints[0].value_hint).toBe("su••••ue");
    expect(JSON.stringify(hints)).not.toContain("supabase-secret-value");
    const decrypted = await getDecryptedCredentialMap(DEMO_SOURCE_IDS.supabase);
    expect(decrypted.service_role_key).toBe("supabase-secret-value");
    expect(await deleteCredential(DEMO_SOURCE_IDS.supabase, "service_role_key")).toBe(true);
  });
});
