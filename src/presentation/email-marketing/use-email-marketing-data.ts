"use client";

import { useCallback, useEffect, useRef, useReducer } from "react";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";

export const EMAIL_MARKETING_REFRESH_INTERVAL_MS = 60_000;

export type EmailMarketingLoadState = {
  snapshot: EmailMarketingSnapshot | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  isAuthLocked: boolean;
  error: string | null;
};

export const INITIAL_EMAIL_MARKETING_STATE: EmailMarketingLoadState = {
  snapshot: null,
  isLoading: true,
  isRefreshing: false,
  isStale: false,
  isAuthLocked: false,
  error: null,
};

export type EmailMarketingLoadAction =
  | { type: "start" }
  | { type: "success"; snapshot: EmailMarketingSnapshot }
  | { type: "authFailure" }
  | { type: "transientFailure"; error: string }
  | { type: "fatalFailure"; error: string };

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
      isAuthLocked: false,
      error: null,
    };
  }
  if (action.type === "authFailure") {
    return {
      snapshot: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      isAuthLocked: true,
      error: null,
    };
  }
  if (action.type === "fatalFailure") {
    return {
      snapshot: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      isAuthLocked: false,
      error: action.error,
    };
  }
  return {
    ...state,
    isLoading: false,
    isRefreshing: false,
    isStale: state.snapshot !== null,
    isAuthLocked: false,
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
  const authLocked = useRef(false);

  const refresh = useCallback(() => {
    if (!mounted.current || authLocked.current) return Promise.resolve();
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
        if (response.status === 401 || response.status === 403) {
          authLocked.current = true;
          if (mounted.current) dispatch({ type: "authFailure" });
          return;
        }
        if (!response.ok) {
          if (response.status === 408 || response.status >= 500) {
            if (mounted.current) {
              dispatch({
                type: "transientFailure",
                error: "Email marketing data could not be refreshed. Try again when the source is available.",
              });
            }
          } else if (mounted.current) {
            dispatch({
              type: "fatalFailure",
              error: "Email marketing data could not be loaded safely. Try again after checking the source configuration.",
            });
          }
          return;
        }
        const payload = (await response.json().catch(() => null)) as
          | { snapshot?: unknown }
          | null;
        if (!isSnapshot(payload?.snapshot)) {
          if (mounted.current) {
            dispatch({
              type: "fatalFailure",
              error: "Email marketing data returned an invalid response.",
            });
          }
          return;
        }
        authLocked.current = false;
        if (mounted.current) dispatch({ type: "success", snapshot: payload.snapshot });
      } catch {
        if (controller.signal.aborted) return;
        if (mounted.current) {
          dispatch({
            type: "transientFailure",
            error: "Email marketing data could not be refreshed. Try again when the source is available.",
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
    authLocked.current = false;
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
