"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  WebsiteCommerceFunnelV2Snapshot,
  WebsiteCommerceRangeKey,
  WebsiteCommerceSegment,
} from "@/aggregation/services/website-commerce-funnel-v2-types";

export const WEBSITE_COMMERCE_FUNNEL_V2_REFRESH_INTERVAL_MS = 60_000;

export type WebsiteCommerceFunnelV2LoadState = {
  snapshot: WebsiteCommerceFunnelV2Snapshot | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  isAuthLocked: boolean;
  error: string | null;
};

export const INITIAL_WEBSITE_COMMERCE_FUNNEL_V2_STATE: WebsiteCommerceFunnelV2LoadState = {
  snapshot: null,
  isLoading: true,
  isRefreshing: false,
  isStale: false,
  isAuthLocked: false,
  error: null,
};

export type WebsiteCommerceFunnelV2LoadAction =
  | { type: "reset" }
  | { type: "start" }
  | { type: "success"; snapshot: WebsiteCommerceFunnelV2Snapshot }
  | { type: "authFailure" }
  | { type: "transientFailure"; error: string }
  | { type: "fatalFailure"; error: string };

export function reduceWebsiteCommerceFunnelV2LoadState(
  state: WebsiteCommerceFunnelV2LoadState,
  action: WebsiteCommerceFunnelV2LoadAction,
): WebsiteCommerceFunnelV2LoadState {
  if (action.type === "reset") return INITIAL_WEBSITE_COMMERCE_FUNNEL_V2_STATE;
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

export function isWebsiteCommerceFunnelV2Snapshot(
  value: unknown,
): value is WebsiteCommerceFunnelV2Snapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<WebsiteCommerceFunnelV2Snapshot>;
  return snapshot.schemaVersion === 1
    && snapshot.definitionVersion === "website-commerce-funnel-v2"
    && ["not_measured", "partial", "healthy"].includes(snapshot.state ?? "")
    && typeof snapshot.generatedAt === "string"
    && typeof snapshot.reason === "string"
    && Boolean(snapshot.range && typeof snapshot.range === "object")
    && Boolean(snapshot.sources && typeof snapshot.sources === "object")
    && Array.isArray(snapshot.funnel)
    && Boolean(snapshot.commerce && typeof snapshot.commerce === "object")
    && Boolean(snapshot.builder && typeof snapshot.builder === "object")
    && Boolean(snapshot.diagnostics && typeof snapshot.diagnostics === "object")
    && Boolean(snapshot.meta && typeof snapshot.meta === "object")
    && Array.isArray(snapshot.caveats);
}

type ActiveRequest = {
  id: symbol;
  controller: AbortController;
  promise: Promise<void>;
};

export function useWebsiteCommerceFunnelV2Data(input: {
  dataSpaceSlug: string;
  range: WebsiteCommerceRangeKey;
  segment: WebsiteCommerceSegment;
}) {
  const [state, dispatch] = useReducer(
    reduceWebsiteCommerceFunnelV2LoadState,
    INITIAL_WEBSITE_COMMERCE_FUNNEL_V2_STATE,
  );
  const activeRequest = useRef<ActiveRequest | null>(null);
  const mounted = useRef(false);
  const authLocked = useRef(false);
  const scope = `${input.dataSpaceSlug}\u0000${input.range}\u0000${input.segment}`;

  const refresh = useCallback(() => {
    if (!mounted.current || authLocked.current) return Promise.resolve();
    if (activeRequest.current) return activeRequest.current.promise;

    const id = Symbol("website-commerce-funnel-v2-request");
    const controller = new AbortController();
    dispatch({ type: "start" });
    const search = new URLSearchParams({
      dataSpaceSlug: input.dataSpaceSlug,
      range: input.range,
      segment: input.segment,
    });
    const promise = (async () => {
      try {
        const response = await fetch(`/api/metrics/website-commerce-funnel-v2?${search}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
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
                error: "The V2 commerce funnel could not be refreshed. Previously loaded aggregate data is marked stale.",
              });
            }
          } else if (mounted.current) {
            dispatch({
              type: "fatalFailure",
              error: "The V2 commerce funnel could not be loaded safely for this scope.",
            });
          }
          return;
        }
        const payload = await response.json().catch(() => null) as { snapshot?: unknown } | null;
        if (!isWebsiteCommerceFunnelV2Snapshot(payload?.snapshot)) {
          if (mounted.current) {
            dispatch({
              type: "fatalFailure",
              error: "The V2 commerce funnel returned an invalid aggregate response.",
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
            error: "The V2 commerce funnel could not be refreshed. Previously loaded aggregate data is marked stale.",
          });
        }
      } finally {
        if (activeRequest.current?.id === id) activeRequest.current = null;
      }
    })();

    activeRequest.current = { id, controller, promise };
    return promise;
  }, [input.dataSpaceSlug, input.range, input.segment]);

  useEffect(() => {
    mounted.current = true;
    authLocked.current = false;
    dispatch({ type: "reset" });
    void refresh();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, WEBSITE_COMMERCE_FUNNEL_V2_REFRESH_INTERVAL_MS);
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
  }, [refresh, scope]);

  return { ...state, refresh };
}
