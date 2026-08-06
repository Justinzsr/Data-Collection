import { describe, expect, it } from "vitest";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";
import {
  EMAIL_MARKETING_REFRESH_INTERVAL_MS,
  INITIAL_EMAIL_MARKETING_STATE,
  reduceEmailMarketingLoadState,
} from "@/presentation/email-marketing/use-email-marketing-data";

const snapshot: EmailMarketingSnapshot = {
  rows: [],
  kpis: {
    totalSignups: 0,
    consentedSignups: 0,
    promoEmailsSent: 0,
    pendingPromoEmails: 0,
    promoEmailSendRate: 0,
    shopifyLinkedCustomers: 0,
    signupsLast24Hours: 0,
    signupsLast7Days: 0,
  },
  fetchedAt: "2026-07-18T18:00:00.000Z",
  source: {
    project: "moonarq-web",
    schema: "public",
    table: "email_signups",
    connection: "direct_supabase",
  },
};

describe("email marketing refresh state", () => {
  it("uses the required one-minute visible-page refresh cadence", () => {
    expect(EMAIL_MARKETING_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it("keeps the last successful snapshot and marks it stale after a transient refresh failure", () => {
    const loaded = reduceEmailMarketingLoadState(INITIAL_EMAIL_MARKETING_STATE, {
      type: "success",
      snapshot,
    });
    const refreshing = reduceEmailMarketingLoadState(loaded, { type: "start" });
    const failed = reduceEmailMarketingLoadState(refreshing, {
      type: "transientFailure",
      error: "Temporary source failure.",
    });

    expect(refreshing).toMatchObject({ isLoading: false, isRefreshing: true });
    expect(failed.snapshot).toBe(snapshot);
    expect(failed).toMatchObject({
      isLoading: false,
      isRefreshing: false,
      isStale: true,
      isAuthLocked: false,
      error: "Temporary source failure.",
    });
  });

  it("clears the last successful snapshot and enters a distinct locked state after auth failure", () => {
    const loaded = reduceEmailMarketingLoadState(INITIAL_EMAIL_MARKETING_STATE, {
      type: "success",
      snapshot,
    });
    const failed = reduceEmailMarketingLoadState(loaded, { type: "authFailure" });

    expect(failed).toEqual({
      snapshot: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      isAuthLocked: true,
      error: null,
    });
  });

  it("clears the last snapshot without confusing a fatal response with stale or locked data", () => {
    const loaded = reduceEmailMarketingLoadState(INITIAL_EMAIL_MARKETING_STATE, {
      type: "success",
      snapshot,
    });
    const failed = reduceEmailMarketingLoadState(loaded, {
      type: "fatalFailure",
      error: "The response could not be used safely.",
    });

    expect(failed).toEqual({
      snapshot: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      isAuthLocked: false,
      error: "The response could not be used safely.",
    });
  });
});
