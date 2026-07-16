import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { fetchMetaAdAccounts, getMetaAdsConfig, normalizeMetaAdAccountId, selectMetaAdsAccessToken, type MetaAdAccount } from "@/collection/connectors/meta-ads/api";
import { isRuntimeDatabaseConfigured, query, withDatabaseTransaction, type DatabaseExecutor } from "@/storage/db/client";
import { getDecryptedCredentialMap, saveCredential } from "@/storage/repositories/credentials-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { getSource, updateSource } from "@/storage/repositories/sources-repository";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
import type { JsonRecord } from "@/storage/db/schema";

export const runtime = "nodejs";

type CandidateAdAccount = {
  id: string;
  name: string | null;
  accountStatus: number | null;
  currency: string | null;
  timezone: string | null;
};

function stringValue(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function candidateAccounts(metadata: JsonRecord): CandidateAdAccount[] {
  const candidates = metadata.candidate_ad_accounts;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const record = candidate as JsonRecord;
    const id = stringValue(record, "id");
    if (!id) return [];
    try {
      return [{
        id: normalizeMetaAdAccountId(id),
        name: stringValue(record, "name"),
        accountStatus: numberValue(record, "account_status"),
        currency: stringValue(record, "currency"),
        timezone: stringValue(record, "timezone_name"),
      }];
    } catch {
      return [];
    }
  });
}

function requestedAccountId(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as { accountId?: unknown }).accountId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isDashboardRequestAuthenticated(request))) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const dataSpace = await resolveDataSpaceFromRequest(request);
    if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
    const requested = requestedAccountId(await request.json().catch(() => null));
    if (!requested) return Response.json({ error: "Meta ad account ID is required." }, { status: 400 });
    let normalizedRequested: string;
    try {
      normalizedRequested = normalizeMetaAdAccountId(requested);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid Meta ad account ID." }, { status: 400 });
    }
    const preflightSource = await getSource(id, { dataSpaceId: dataSpace.id });
    if (!preflightSource) return Response.json({ error: "Source not found." }, { status: 404 });
    if (preflightSource.source_type_key !== "meta_ads") {
      return Response.json({ error: "Ad account selection is only available for Meta Ads sources." }, { status: 409 });
    }
    let verifiedAccount: MetaAdAccount | null = null;
    if (isRuntimeDatabaseConfigured()) {
      const credentials = await getDecryptedCredentialMap(id);
      const accessToken = selectMetaAdsAccessToken(credentials);
      if (!accessToken) return Response.json({ error: "Reconnect Meta Ads before selecting an ad account." }, { status: 409 });
      const liveAccounts = await fetchMetaAdAccounts(accessToken, getMetaAdsConfig(credentials));
      verifiedAccount = liveAccounts.find((account) => normalizeMetaAdAccountId(account.id) === normalizedRequested) ?? null;
      if (!verifiedAccount) {
        return Response.json({ error: "The requested Meta ad account is no longer available to this OAuth connection. Reconnect Meta Ads." }, { status: 403 });
      }
    }
    const persistSelection = async (executor?: DatabaseExecutor) => {
    if (executor) {
      await query("select id from sources where id = $1 and data_space_id = $2 for update", [id, dataSpace.id], executor);
    }
    const source = await getSource(id, { dataSpaceId: dataSpace.id }, executor);
    if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
    if (source.source_type_key !== "meta_ads") {
      return Response.json({ error: "Ad account selection is only available for Meta Ads sources." }, { status: 409 });
    }
    if (source.metadata.oauth_connected !== true) {
      return Response.json({ error: "Connect Meta Ads with OAuth before selecting an ad account." }, { status: 409 });
    }

    const candidates = candidateAccounts(source.metadata);
    const candidate = candidates.find((item) => item.id === normalizedRequested);
    const selected = candidate && verifiedAccount
      ? {
          ...candidate,
          name: verifiedAccount.name ?? candidate.name,
          accountStatus: verifiedAccount.account_status ?? candidate.accountStatus,
          currency: verifiedAccount.currency ?? candidate.currency,
          timezone: verifiedAccount.timezone_name ?? candidate.timezone,
        }
      : candidate;
    if (!selected) {
      return Response.json(
        { error: "The selected Meta ad account is not one of the accounts returned by this OAuth connection." },
        { status: 403 },
      );
    }
    const accountOperational = selected.accountStatus === null || selected.accountStatus === 1;
    const metadataAccountId = stringValue(source.metadata, "selected_ad_account_id");
    const previousAccountId = source.external_account_id
      ? normalizeMetaAdAccountId(source.external_account_id)
      : metadataAccountId
        ? normalizeMetaAdAccountId(metadataAccountId)
        : null;
    const accountChanged = previousAccountId !== selected.id;
    const selectedAt = new Date().toISOString();

    await saveCredential(source.id, "meta_ad_account_id", selected.id, executor);
    const updatedSource = await updateSource(source.id, {
      status: accountOperational ? "healthy" : "warning",
      external_account_id: selected.id,
      account_name: selected.name ?? selected.id,
      last_error: accountOperational
        ? null
        : "The selected Meta ad account is not active. Run Test Connection to verify Insights access.",
      last_error_at: accountOperational ? null : new Date().toISOString(),
      last_manual_sync_at: accountChanged ? null : source.last_manual_sync_at,
      last_cron_sync_at: accountChanged ? null : source.last_cron_sync_at,
      last_webhook_sync_at: accountChanged ? null : source.last_webhook_sync_at,
      last_success_at: accountChanged ? null : source.last_success_at,
      next_sync_at: accountChanged ? selectedAt : source.next_sync_at,
      metadata: {
        ...source.metadata,
        selected_ad_account_id: selected.id,
        selected_ad_account_name: selected.name ?? selected.id,
        account_currency: selected.currency,
        account_timezone: selected.timezone,
        selected_ad_account_status: selected.accountStatus,
        account_selection_required: false,
        account_selected_at: selectedAt,
        ...(accountChanged ? {
          campaign_id: null,
          adset_name: null,
          ad_id: null,
          ad_name: null,
          delivery_status: null,
          attribution_setting: null,
        } : {}),
      },
    }, { dataSpaceId: dataSpace.id }, executor);
    if (!updatedSource) return Response.json({ error: "Meta Ads source could not be updated." }, { status: 409 });

    const linkedInstagramSourceId = stringValue(source.metadata, "linked_instagram_source_id");
    let linkedInstagramUpdated = false;
    if (linkedInstagramSourceId) {
      const linkedInstagram = await getSource(linkedInstagramSourceId, { dataSpaceId: dataSpace.id }, executor);
      if (linkedInstagram?.source_type_key === "instagram") {
        linkedInstagramUpdated = Boolean(await updateSource(linkedInstagram.id, {
          metadata: {
            ...linkedInstagram.metadata,
            meta_ads_source_id: updatedSource.id,
            meta_ads_connected: true,
            meta_ads_account_id: selected.id,
          },
        }, { dataSpaceId: dataSpace.id }, executor));
      }
    }

    await recordConnectorEvent({
      source_id: updatedSource.id,
      event_type: "meta_ads_account_selected",
      severity: accountOperational ? "info" : "warning",
      message: `Meta Ads account selected for ${selected.name ?? selected.id}${accountOperational ? "." : "; the account state requires verification."}`,
      metadata: {
        selectedAccountId: selected.id,
        linkedInstagramUpdated,
        candidateCount: candidates.length,
        accountChanged,
        sanitized: true,
      },
    }, executor);

    return Response.json({
      ok: true,
      source: {
        id: updatedSource.id,
        status: updatedSource.status,
        external_account_id: updatedSource.external_account_id,
        account_name: updatedSource.account_name,
      },
    });
    };
    return isRuntimeDatabaseConfigured()
      ? withDatabaseTransaction((client) => persistSelection(client))
      : persistSelection();
  } catch {
    return Response.json(
      { error: "Could not select the Meta ad account." },
      { status: 500 },
    );
  }
}
