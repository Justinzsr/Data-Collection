import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

function getEncryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "test") return Buffer.from("test-key-32-bytes-long-for-aes!!").subarray(0, 32);
    throw new Error("APP_ENCRYPTION_KEY is required to encrypt source credentials.");
  }
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) return base64;
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;
  throw new Error("APP_ENCRYPTION_KEY must be exactly 32 bytes or base64-encoded 32 bytes.");
}

export function encryptSecret(plainText: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
