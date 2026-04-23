import "server-only";

import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/storage/credentials/encryption";
import { maskSecret } from "@/storage/credentials/masking";
import { isRuntimeDatabaseConfigured, query, queryRows } from "@/storage/db/client";
import type { SourceCredential } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function saveCredential(sourceId: string, fieldKey: string, value: string): Promise<SourceCredential> {
  const now = new Date().toISOString();
  const encrypted = encryptSecret(value);

  if (!isRuntimeDatabaseConfigured()) {
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

  const rows = await queryRows<SourceCredential>(
    `
      insert into source_credentials (
        id,
        source_id,
        field_key,
        encrypted_value,
        iv,
        auth_tag,
        value_hint,
        key_version,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)
      on conflict (source_id, field_key) do update set
        encrypted_value = excluded.encrypted_value,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        value_hint = excluded.value_hint,
        updated_at = excluded.updated_at
      returning *
    `,
    [randomUUID(), sourceId, fieldKey, encrypted.encryptedValue, encrypted.iv, encrypted.authTag, maskSecret(value), now, now],
  );
  return rows[0];
}

export async function listCredentialHints(sourceId: string) {
  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().credentials
      .filter((credential) => credential.source_id === sourceId)
      .map((credential) => ({
        field_key: credential.field_key,
        value_hint: credential.value_hint,
        created_at: credential.created_at,
        updated_at: credential.updated_at,
      }));
  }
  return queryRows<Pick<SourceCredential, "field_key" | "value_hint" | "created_at" | "updated_at">>(
    `
      select field_key, value_hint, created_at, updated_at
      from source_credentials
      where source_id = $1
      order by field_key asc
    `,
    [sourceId],
  );
}

export async function deleteCredential(sourceId: string, fieldKey: string): Promise<boolean> {
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const before = store.credentials.length;
    store.credentials = store.credentials.filter((credential) => credential.source_id !== sourceId || credential.field_key !== fieldKey);
    return store.credentials.length !== before;
  }
  const result = await query("delete from source_credentials where source_id = $1 and field_key = $2", [sourceId, fieldKey]);
  return (result.rowCount ?? 0) > 0;
}

export async function getDecryptedCredentialMap(sourceId: string): Promise<Record<string, string>> {
  const entries = !isRuntimeDatabaseConfigured()
    ? getDemoStore().credentials.filter((credential) => credential.source_id === sourceId)
    : await queryRows<SourceCredential>(
        `
          select *
          from source_credentials
          where source_id = $1
          order by field_key asc
        `,
        [sourceId],
      );

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
