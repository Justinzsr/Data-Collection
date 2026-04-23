import { randomUUID } from "node:crypto";
import type { SourceCredential } from "@/storage/db/schema";
import { encryptSecret, decryptSecret } from "@/storage/credentials/encryption";
import { maskSecret } from "@/storage/credentials/masking";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function saveCredential(sourceId: string, fieldKey: string, value: string): Promise<SourceCredential> {
  const now = new Date().toISOString();
  const encrypted = encryptSecret(value);
  const store = getDemoStore();
  const existing = store.credentials.find((credential) => credential.source_id === sourceId && credential.field_key === fieldKey);
  const next: SourceCredential = {
    id: existing?.id ?? randomUUID(),
    source_id: sourceId,
    field_key: fieldKey,
    encrypted_value: encrypted.encryptedValue,
    iv: encrypted.iv,
    auth_tag: encrypted.authTag,
    value_hint: maskSecret(value),
    key_version: 1,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  if (existing) Object.assign(existing, next);
  else store.credentials.push(next);
  return next;
}

export async function listCredentialHints(sourceId: string) {
  return getDemoStore().credentials
    .filter((credential) => credential.source_id === sourceId)
    .map((credential) => ({
      field_key: credential.field_key,
      value_hint: credential.value_hint,
      created_at: credential.created_at,
      updated_at: credential.updated_at,
    }));
}

export async function deleteCredential(sourceId: string, fieldKey: string): Promise<boolean> {
  const store = getDemoStore();
  const before = store.credentials.length;
  store.credentials = store.credentials.filter((credential) => credential.source_id !== sourceId || credential.field_key !== fieldKey);
  return store.credentials.length !== before;
}

export async function getDecryptedCredentialMap(sourceId: string): Promise<Record<string, string>> {
  const entries = getDemoStore().credentials.filter((credential) => credential.source_id === sourceId);
  return Object.fromEntries(
    entries.map((credential) => [
      credential.field_key,
      decryptSecret({
        encryptedValue: credential.encrypted_value,
        iv: credential.iv,
        authTag: credential.auth_tag,
      }),
    ]),
  );
}
