import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/storage/credentials/encryption";
import { maskSecret } from "@/storage/credentials/masking";

describe("credentials", () => {
  it("encrypts and decrypts with AES-GCM", () => {
    const encrypted = encryptSecret("super-secret-value");
    expect(encrypted.encryptedValue).not.toContain("super-secret-value");
    expect(decryptSecret(encrypted)).toBe("super-secret-value");
  });

  it("masks secrets without revealing full values", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("abcd••••mnop");
    expect(maskSecret("short")).toBe("••••");
  });
});
