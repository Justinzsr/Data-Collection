type TrackingSnippetOptions = {
  endpoint: string;
  publicTrackingKey: string;
  sourceId: string;
};

export function generateTrackingSnippet(options: TrackingSnippetOptions) {
  return `<script>
(function () {
  var endpoint = ${JSON.stringify(options.endpoint)};
  var publicTrackingKey = ${JSON.stringify(options.publicTrackingKey)};
  var sourceId = ${JSON.stringify(options.sourceId)};
  var localKey = "moonarq_anonymous_id";
  var sessionKey = "moonarq_session_id";
  var attributionKey = "moonarq_first_attribution_v1";

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (character) {
      var random = Math.floor(Math.random() * 16);
      var value = character === "x" ? random : (random & 3) | 8;
      return value.toString(16);
    });
  }

  function getStoredId(storage, key) {
    try {
      var value = storage.getItem(key);
      if (!value) {
        value = uuid();
        storage.setItem(key, value);
      }
      return value;
    } catch (error) {
      return uuid();
    }
  }

  function safeUrl(value) {
    if (!value) return null;
    try {
      var parsed = new URL(value, window.location.origin);
      parsed.username = "";
      parsed.password = "";
      parsed.hash = "";
      // Campaign context is copied into the explicit attribution object. Keep
      // the page URL query-free so arbitrary storefront parameters cannot leak.
      parsed.search = "";
      return parsed.toString();
    } catch (error) {
      return null;
    }
  }

  function currentAttribution() {
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    var clickIds = {};
    ["source", "medium", "campaign", "content", "term"].forEach(function (key) {
      var value = params.get("utm_" + key);
      if (value) utm[key] = value.slice(0, 256);
    });
    ["fbclid", "gclid", "ttclid"].forEach(function (key) {
      var value = params.get(key);
      if (value) clickIds[key] = value.slice(0, 256);
    });
    var hasCurrent = Object.keys(utm).length > 0 || Object.keys(clickIds).length > 0;
    var current = {
      utm: Object.keys(utm).length ? utm : undefined,
      click_ids: Object.keys(clickIds).length ? clickIds : undefined,
      landing_page: (window.location.pathname || "/").slice(0, 500),
      first_referrer: safeUrl(document.referrer),
      touchpoint: hasCurrent ? "current" : "first"
    };
    try {
      var stored = window.localStorage.getItem(attributionKey);
      if (stored) {
        var parsed = JSON.parse(stored);
        if (!hasCurrent && parsed && typeof parsed === "object") return parsed;
      } else {
        window.localStorage.setItem(attributionKey, JSON.stringify(current));
      }
    } catch (error) {}
    return current;
  }

  function consentStatus() {
    var configured = window.moonarqConsent && typeof window.moonarqConsent === "object" ? window.moonarqConsent : {};
    var allowed = { granted: true, denied: true, unknown: true };
    var dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";
    return {
      analytics: dnt ? "denied" : allowed[configured.analytics] ? configured.analytics : "unknown",
      marketing: allowed[configured.marketing] ? configured.marketing : "unknown",
      do_not_track: dnt
    };
  }

  function clientContext() {
    var width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    var userAgent = navigator.userAgent || "";
    var currency = document.documentElement.getAttribute("data-currency") ||
      (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || null;
    var pageType = document.body && (document.body.getAttribute("data-page-type") || document.body.getAttribute("data-template"));
    return {
      language: (navigator.language || "en").slice(0, 35),
      currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : undefined,
      viewport_category: width < 480 ? "small" : width < 768 ? "medium" : width < 1200 ? "large" : "wide",
      device_category: /bot|crawler|spider/i.test(userAgent) ? "bot" : /ipad|tablet/i.test(userAgent) ? "tablet" : /mobi|android/i.test(userAgent) ? "mobile" : "desktop",
      page_type: pageType ? String(pageType).slice(0, 160) : undefined
    };
  }

  function payload(eventName, properties, consent) {
    return {
      event_id: uuid(),
      schema_version: "1.0",
      source_id: sourceId,
      public_tracking_key: publicTrackingKey,
      anonymous_id: getStoredId(window.localStorage, localKey),
      session_id: getStoredId(window.sessionStorage, sessionKey),
      event_name: String(eventName || "custom_event").slice(0, 80),
      path: (window.location.pathname || "/").slice(0, 500),
      url: safeUrl(window.location.href),
      referrer: safeUrl(document.referrer),
      properties: properties && typeof properties === "object" ? properties : {},
      attribution: currentAttribution(),
      consent: consent,
      client_context: clientContext(),
      occurred_at: new Date().toISOString()
    };
  }

  function post(data) {
    try {
      var body = JSON.stringify(data);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(endpoint, blob)) return;
      }
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body,
        keepalive: true,
        credentials: "omit"
      }).catch(function () {});
    } catch (error) {}
  }

  window.moonarqTrack = function moonarqTrack(eventName, properties) {
    var consent = consentStatus();
    if (consent.analytics === "denied") return;
    post(payload(eventName, properties, consent));
  };

  window.moonarqTrack("page_view", {});
})();
</script>`;
}

export function generateReactHelper(options: TrackingSnippetOptions) {
  return `"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type TrackProperties = Record<string, JsonValue>;
type ConsentValue = "granted" | "denied" | "unknown";

declare global {
  interface Window {
    moonarqConsent?: { analytics?: ConsentValue; marketing?: ConsentValue };
    Shopify?: { currency?: { active?: string } };
  }
}

const endpoint = ${JSON.stringify(options.endpoint)};
const publicTrackingKey = ${JSON.stringify(options.publicTrackingKey)};
const sourceId = ${JSON.stringify(options.sourceId)};

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 3) | 8).toString(16);
  });
}

function getId(storage: Storage, key: string) {
  try {
    let value = storage.getItem(key);
    if (!value) {
      value = uuid();
      storage.setItem(key, value);
    }
    return value;
  } catch {
    return uuid();
  }
}

function safeUrl(value: string) {
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    // Campaign context is copied into the explicit attribution object. Keep
    // the page URL query-free so arbitrary storefront parameters cannot leak.
    parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function attribution() {
  const params = new URLSearchParams(window.location.search);
  const utm = Object.fromEntries(["source", "medium", "campaign", "content", "term"]
    .map((key) => [key, params.get("utm_" + key)?.slice(0, 256)])
    .filter((entry): entry is [string, string] => Boolean(entry[1])));
  const clickIds = Object.fromEntries(["fbclid", "gclid", "ttclid"]
    .map((key) => [key, params.get(key)?.slice(0, 256)])
    .filter((entry): entry is [string, string] => Boolean(entry[1])));
  const current = {
    ...(Object.keys(utm).length ? { utm } : {}),
    ...(Object.keys(clickIds).length ? { click_ids: clickIds } : {}),
    landing_page: (window.location.pathname || "/").slice(0, 500),
    first_referrer: safeUrl(document.referrer),
    touchpoint: Object.keys(utm).length || Object.keys(clickIds).length ? "current" : "first",
  };
  try {
    const stored = window.localStorage.getItem("moonarq_first_attribution_v1");
    if (stored && current.touchpoint === "first") return JSON.parse(stored) as typeof current;
    if (!stored) window.localStorage.setItem("moonarq_first_attribution_v1", JSON.stringify(current));
  } catch {}
  return current;
}

function consent() {
  const configured = window.moonarqConsent ?? {};
  const dnt = navigator.doNotTrack === "1";
  const normalize = (value: ConsentValue | undefined, fallback: ConsentValue): ConsentValue =>
    value === "granted" || value === "denied" || value === "unknown" ? value : fallback;
  return {
    analytics: dnt ? "denied" : normalize(configured.analytics, "unknown"),
    marketing: normalize(configured.marketing, "unknown"),
    do_not_track: dnt,
  };
}

function clientContext() {
  const width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const userAgent = navigator.userAgent || "";
  const currency = document.documentElement.getAttribute("data-currency") || window.Shopify?.currency?.active;
  const pageType = document.body?.getAttribute("data-page-type") || document.body?.getAttribute("data-template");
  return {
    language: (navigator.language || "en").slice(0, 35),
    ...(currency && /^[A-Za-z]{3}$/.test(currency) ? { currency: currency.toUpperCase() } : {}),
    viewport_category: width < 480 ? "small" : width < 768 ? "medium" : width < 1200 ? "large" : "wide",
    device_category: /bot|crawler|spider/i.test(userAgent) ? "bot" : /ipad|tablet/i.test(userAgent) ? "tablet" : /mobi|android/i.test(userAgent) ? "mobile" : "desktop",
    ...(pageType ? { page_type: pageType.slice(0, 160) } : {}),
  };
}

export function trackEvent(eventName: string, properties: TrackProperties = {}) {
  if (typeof window === "undefined") return;
  const consentStatus = consent();
  if (consentStatus.analytics === "denied") return;
  const body = JSON.stringify({
    event_id: uuid(),
    schema_version: "1.0",
    source_id: sourceId,
    public_tracking_key: publicTrackingKey,
    anonymous_id: getId(window.localStorage, "moonarq_anonymous_id"),
    session_id: getId(window.sessionStorage, "moonarq_session_id"),
    event_name: String(eventName || "custom_event").slice(0, 80),
    path: (window.location.pathname || "/").slice(0, 500),
    url: safeUrl(window.location.href),
    referrer: safeUrl(document.referrer),
    properties,
    attribution: attribution(),
    consent: consentStatus,
    client_context: clientContext(),
    occurred_at: new Date().toISOString(),
  });
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
}

export function usePageViewTracking() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    trackEvent("page_view", {});
  }, [pathname, searchParams]);
}`;
}
