import { ETSY_BACKFILL_DAYS, ETSY_SYNC_WINDOW_DAYS } from "@/collection/connectors/etsy/constants";
import { addDaysToDateKey, dateKeyInAppTimeZone } from "@/storage/runtime/app-time";

/**
 * The first Pacific date a sync recomputes: a year back for a shop's first sync;
 * after that, 35 days before the last successful sync. Hourly syncs therefore
 * recompute the last five weeks, and the first sync after an outage also covers
 * the outage and the five weeks the last good sync was still keeping up to date.
 */
export function etsySyncStartDate(endDate: string, lastSuccessAt: string | null) {
  const backfillStart = addDaysToDateKey(endDate, -ETSY_BACKFILL_DAYS);
  if (!lastSuccessAt) return backfillStart;
  const recentStart = addDaysToDateKey(endDate, -ETSY_SYNC_WINDOW_DAYS);
  const lastSuccessDate = dateKeyInAppTimeZone(lastSuccessAt);
  const sinceLastSuccess = addDaysToDateKey(lastSuccessDate < endDate ? lastSuccessDate : endDate, -ETSY_SYNC_WINDOW_DAYS);
  const start = sinceLastSuccess < recentStart ? sinceLastSuccess : recentStart;
  return start < backfillStart ? backfillStart : start;
}
