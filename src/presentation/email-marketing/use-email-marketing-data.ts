"use client";

import { useCallback, useEffect, useRef, useReducer } from "react";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";

export const EMAIL_MARKETING_REFRESH_INTERVAL_MS = 60_000;

export type EmailMarketingLoadState = {
  snapshot: EmailMarketingSnapshot | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  error: string | null;
};

export const INITIAL_EMAIL_MARKETING_STATE: EmailMarketingLoadState = {
  snapshot: null,
  isLoading: true,
  isRefreshing: false,
  isStale: false,
  error: null,
};

export type EmailMarketingLoadAction =
  | { type: "start" }
  | { type: "success"; snapshot: EmailMarketingSnapshot }
  | { type: "failure"; error: string };

export function reduceEmailMarketingLoadState(
  state: EmailMarketingLoadState,
  action: EmailMarketingLoadAction,
): EmailMarketingLoadState {
  if (action.type === "start") {
    return {
      ...state,
      isLoading: state.snapshot === null,
      isRefreshing: state.snapshot !== null,
    };
  }
  if (action.type === "success") {
    return {
      snapshot: action.snapshot,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      error: null,
    };
  }
  return {
    ...state,
    isLoading: false,
    isRefreshing: false,
    isStale: state.snapshot !== null,
    error: action.error,
  };
}

function isSnapshot(value: unknown): value is EmailMarketingSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EmailMarketingSnapshot>;
  return (
    Array.isArray(candidate.rows) &&
    typeof candidate.fetchedAt === "string" &&
    typeof candidate.kpis === "object" &&
    candidate.kpis !== null &&
    typeof candidate.source === "object" &&
    candidate.source !== null
  );
}

type ActiveRequest = {
  id: symbol;
  controller: AbortController;
  promise: Promise<void>;
};

export function useEmailMarketingData(dataSpaceSlug: string) {
  const [state, dispatch] = useReducer(reduceEmailMarketingLoadState, INITIAL_EMAIL_MARKETING_STATE);
  const activeRequest = useRef<ActiveRequest | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(() => {
    if (activeRequest.current) return activeRequest.current.promise;

    const id = Symbol("email-marketing-request");
    const controller = new AbortController();
    dispatch({ type: "start" });
    const promise = (async () => {
      try {
        const response = await fetch(
          `/api/metrics/email-signups?dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | { snapshot?: unknown; error?: unknown }
          | null;
        if (!response.ok) {
          const message =
            payload && typeof payload.error === "string"
              ? payload.error
              : "Email marketing data could not be refreshed.";
          throw new Error(message);
        }
        if (!isSnapshot(payload?.snapshot)) {
          throw new Error("Email marketing data returned an invalid response.");
        }
        if (mounted.current) dispatch({ type: "success", snapshot: payload.snapshot });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (mounted.current) {
          dispatch({
            type: "failure",
            error: error instanceof Error ? error.message : "Email marketing data could not be refreshed.",
          });
        }
      } finally {
        if (activeRequest.current?.id === id) activeRequest.current = null;
      }
    })();

    activeRequest.current = { id, controller, promise };
    return promise;
  }, [dataSpaceSlug]);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, EMAIL_MARKETING_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const request = activeRequest.current;
      request?.controller.abort();
      if (activeRequest.current?.id === request?.id) activeRequest.current = null;
    };
  }, [refresh]);

  return { ...state, refresh };
}
