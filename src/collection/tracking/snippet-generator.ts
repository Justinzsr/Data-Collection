export function generateTrackingSnippet(options: { endpoint: string; publicTrackingKey: string }) {
  return `<script>
(function () {
  var endpoint = ${JSON.stringify(options.endpoint)};
  var key = ${JSON.stringify(options.publicTrackingKey)};
  var anon = localStorage.getItem("moonarq_anonymous_id") || crypto.randomUUID();
  localStorage.setItem("moonarq_anonymous_id", anon);
  var session = sessionStorage.getItem("moonarq_session_id") || crypto.randomUUID();
  sessionStorage.setItem("moonarq_session_id", session);
  function send(eventName, properties) {
    navigator.sendBeacon
      ? navigator.sendBeacon(endpoint, new Blob([JSON.stringify({
          public_tracking_key: key,
          anonymous_id: anon,
          session_id: session,
          event_name: eventName,
          path: location.pathname,
          url: location.href,
          referrer: document.referrer || null,
          properties: properties || {},
          occurred_at: new Date().toISOString()
        })], { type: "application/json" }))
      : fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            public_tracking_key: key,
            anonymous_id: anon,
            session_id: session,
            event_name: eventName,
            path: location.pathname,
            url: location.href,
            referrer: document.referrer || null,
            properties: properties || {},
            occurred_at: new Date().toISOString()
          }),
          keepalive: true
        });
  }
  window.moonarqTrack = send;
  send("page_view", {});
})();
</script>`;
}

export function generateReactHelper(options: { endpoint: string; publicTrackingKey: string }) {
  return `"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const endpoint = ${JSON.stringify(options.endpoint)};
const publicTrackingKey = ${JSON.stringify(options.publicTrackingKey)};

function getId(storage, key) {
  var value = storage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    storage.setItem(key, value);
  }
  return value;
}

export function trackEvent(eventName, properties) {
  if (typeof window === "undefined") return;
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      public_tracking_key: publicTrackingKey,
      anonymous_id: getId(localStorage, "moonarq_anonymous_id"),
      session_id: getId(sessionStorage, "moonarq_session_id"),
      event_name: eventName,
      path: location.pathname,
      url: location.href,
      referrer: document.referrer || null,
      properties: properties || {},
      occurred_at: new Date().toISOString()
    }),
    keepalive: true
  });
}

export function usePageViewTracking() {
  const pathname = usePathname();
  useEffect(() => {
    trackEvent("page_view", {});
  }, [pathname]);
}`;
}
