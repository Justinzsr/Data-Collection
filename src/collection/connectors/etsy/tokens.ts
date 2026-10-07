import type { EtsyTokenResponse } from "@/collection/connectors/etsy/api";
import { ETSY_FIELDS, ETSY_REFRESH_TOKEN_LIFETIME_DAYS } from "@/collection/connectors/etsy/constants";
import { isRuntimeDatabaseConfigured, withDatabaseTransaction, type DatabaseExecutor } from "@/storage/db/client";
import { saveCredential } from "@/storage/repositories/credentials-repository";

const DAY_MS = 86_400_000;
const TOKEN_WRITE_ATTEMPTS = 3;

/**
 * Saves a fresh token pair and returns when each expires. The refresh token lasts
 * 90 days from now. With a database the pair is written in one transaction, so a
 * reader sees either the old pair or the new one, never a mix.
 */
export async function saveEtsyTokens(sourceId: string, token: EtsyTokenResponse, now = new Date()) {
  const expiresAt = new Date(now.getTime() + token.expires_in * 1000).toISOString();
  const refreshExpiresAt = new Date(now.getTime() + ETSY_REFRESH_TOKEN_LIFETIME_DAYS * DAY_MS).toISOString();
  const write = async (executor?: DatabaseExecutor) => {
    await saveCredential(sourceId, ETSY_FIELDS.refreshToken, token.refresh_token, executor);
    await saveCredential(sourceId, ETSY_FIELDS.accessToken, token.access_token, executor);
    await saveCredential(sourceId, ETSY_FIELDS.tokenExpiresAt, expiresAt, executor);
    await saveCredential(sourceId, ETSY_FIELDS.refreshExpiresAt, refreshExpiresAt, executor);
    if (token.scope) await saveCredential(sourceId, ETSY_FIELDS.scope, token.scope, executor);
  };
  if (!isRuntimeDatabaseConfigured()) {
    await write();
    return { expiresAt, refreshExpiresAt };
  }
  // Etsy has already retired the previous refresh token, so a brief database error is worth riding out.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await withDatabaseTransaction((client) => write(client));
      return { expiresAt, refreshExpiresAt };
    } catch (error) {
      if (attempt >= TOKEN_WRITE_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}
