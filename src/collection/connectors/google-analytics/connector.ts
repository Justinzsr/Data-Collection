import { createPlannedConnector, validUrl } from "@/collection/connectors/future-connectors";

export function detectGoogleAnalytics(inputUrl: string) {
  const url = validUrl(inputUrl);
  if (!url || url.hostname.toLowerCase() !== "analytics.google.com") return null;
  // GA4 property IDs appear in the hash route, e.g. #/p123456789/reports/intelligenthome.
  const propertyId = /(?:^|[/#])p(\d{6,})(?=\/|$)/u.exec(`${url.pathname}${url.hash}`)?.[1] ?? null;
  if (!propertyId) {
    return {
      confidence: 0.8,
      normalizedUrl: "https://analytics.google.com/analytics/web/",
      reasons: ["Google Analytics detected. Open your GA4 property and paste that URL so the property ID is included. GA4 is planned."],
    };
  }
  return {
    confidence: 0.96,
    normalizedUrl: `https://analytics.google.com/analytics/web/#/p${propertyId}/`,
    accountName: `GA4 property ${propertyId}`,
    reasons: ["Google Analytics 4 property detected. GA4 reporting is planned."],
  };
}

export const googleAnalyticsConnector = createPlannedConnector({
  key: "google_analytics",
  displayName: "Google Analytics 4",
  description: "Planned GA4 traffic and conversion reporting through the official Google Analytics Data API. It does not collect data or accept credentials yet.",
  category: "Analytics",
  icon: "ChartColumn",
  urlPatterns: [/^https:\/\/analytics\.google\.com\//i],
  authType: "google_oauth_or_service_account",
  docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
  supportedMetrics: [
    "Sessions and users",
    "Engaged sessions",
    "Key events",
    "Revenue by channel",
  ],
  detect: detectGoogleAnalytics,
  setup: [
    "Google Analytics 4 is planned. MoonArq does not collect GA4 data yet and does not ask for credentials.",
    "It will use the official Google Analytics Data API (runReport) with read-only access (analytics.readonly).",
    "Needed later: a Google Cloud project with the Analytics Data API enabled, then either Google sign-in (OAuth) or a service account added as Viewer on the GA4 property, plus the GA4 property ID.",
    "GA4 stays auxiliary: the first-party Website tracker remains the source of truth for the storefront funnel. Planned daily metrics: sessions, users, engaged sessions, key events, and revenue by channel.",
  ],
});
