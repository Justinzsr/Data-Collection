export function generateTrackingSnippet(options: { endpoint: string; publicTrackingKey: string }) {
  return `<script>
(function () {
  var endpoint = ${JSON.stringify(options.endpoint)};
  var publicTrackingKey = ${JSON.stringify(options.publicTrackingKey)};
  var localKey = "moonarq_anonymous_id";
  var sessionKey = "moonarq_session_id";

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "mq_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
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

  function payload(eventName, properties) {
    return {
      public_tracking_key: publicTrackingKey,
      anonymous_id: getStoredId(window.localStorage, localKey),
      session_id: getStoredId(window.sessionStorage, sessionKey),
      event_name: String(eventName || "custom_event").slice(0, 80),
      path: window.location.pathname || "/",
      url: window.location.href,
      referrer: document.referrer || null,
      properties: properties && typeof properties === "object" ? properties : {},
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
    post(payload(eventName, properties));
  };

  window.moonarqTrack("page_view", {});
})();
</script>`;
}

export function generateReactHelper(options: { endpoint: string; publicTrackingKey: string }) {
  return `"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const endpoint = ${JSON.stringify(options.endpoint)};
const publicTrackingKey = ${JSON.stringify(options.publicTrackingKey)};

function uuid() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "mq_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
}

function getId(storage, key) {
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

export function trackEvent(eventName, properties = {}) {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    public_tracking_key: publicTrackingKey,
    anonymous_id: getId(window.localStorage, "moonarq_anonymous_id"),
    session_id: getId(window.sessionStorage, "moonarq_session_id"),
    event_name: String(eventName || "custom_event").slice(0, 80),
    path: window.location.pathname || "/",
    url: window.location.href,
    referrer: document.referrer || null,
    properties,
    occurred_at: new Date().toISOString()
  });
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit"
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
