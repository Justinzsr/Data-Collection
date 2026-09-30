import { createPlannedConnector, validUrl } from "@/collection/connectors/future-connectors";

const ETSY_HOSTS = new Set(["etsy.com", "www.etsy.com"]);

export function detectEtsy(inputUrl: string) {
  const url = validUrl(inputUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (host === "etsy.me") {
    return {
      confidence: 0.75,
      normalizedUrl: url.toString(),
      reasons: ["Etsy short link detected. Paste the shop URL (etsy.com/shop/…) to identify the shop. Etsy is planned."],
    };
  }
  if (!ETSY_HOSTS.has(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  // Localized paths look like /uk/shop/Name or /de/listing/123.
  const offset = parts[0] && /^[a-z]{2}(-[a-z]{2})?$/iu.test(parts[0]) && parts[1] ? 1 : 0;
  const section = parts[offset]?.toLowerCase();
  const value = parts[offset + 1];
  if (section === "shop" && value) {
    return {
      confidence: 0.97,
      normalizedUrl: `https://www.etsy.com/shop/${value}`,
      accountName: value,
      reasons: ["Etsy shop detected. Etsy orders and listings are planned."],
    };
  }
  if (section === "listing" && value && /^\d+$/u.test(value)) {
    return {
      confidence: 0.8,
      normalizedUrl: `https://www.etsy.com/listing/${value}`,
      reasons: ["Etsy listing detected. Connect the shop that owns it (etsy.com/shop/…). Etsy is planned."],
    };
  }
  return null;
}

export const etsyConnector = createPlannedConnector({
  key: "etsy",
  displayName: "Etsy",
  description: "Planned Etsy shop orders and listings through the official Etsy Open API v3. It does not collect data or accept credentials yet.",
  category: "Commerce",
  icon: "Store",
  urlPatterns: [
    /^https:\/\/(www\.)?etsy\.com\/([a-z]{2}(-[a-z]{2})?\/)?(shop|listing)\/[^/?#]+/i,
    /^https:\/\/etsy\.me\/[^/?#]+/i,
  ],
  authType: "etsy_oauth2_pkce",
  docsUrl: "https://developer.etsy.com/documentation/",
  supportedMetrics: [
    "Orders",
    "Gross revenue",
    "Units sold",
    "Refunds",
    "Active listings",
  ],
  detect: detectEtsy,
  setup: [
    "Etsy is planned. MoonArq does not collect Etsy data yet and does not ask for credentials.",
    "It will use the official Etsy Open API v3 with OAuth 2.0 (PKCE) and read-only scopes: shops_r, listings_r, transactions_r.",
    "Needed later: create an app at etsy.com/developers to get an API keystring and shared secret, and register this Data Hub's /api/oauth/etsy/callback URL.",
    "Planned daily metrics: orders, gross revenue, units sold, refunds, and active listings. Etsy's API does not provide shop visits, so traffic stays with the Website tracker.",
  ],
});
