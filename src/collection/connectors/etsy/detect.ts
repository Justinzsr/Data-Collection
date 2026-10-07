import { validUrl } from "@/collection/connectors/future-connectors";

/*
 * Etsy URL detection. Kept apart from the connector so OAuth routes and pages can
 * use it without loading the connector registry.
 */

const ETSY_HOSTS = new Set(["etsy.com", "www.etsy.com", "m.etsy.com"]);
/** Etsy's own sites on etsy.com subdomains; every other single-label subdomain is a shop (yourshop.etsy.com). */
const ETSY_SERVICE_SUBDOMAINS = new Set([
  "api", "openapi", "developer", "developers", "help", "support", "community", "blog", "investors", "careers",
  "news", "newsroom", "press", "partners", "affiliates", "ads", "advertising", "accounts", "admin", "mail",
  "static", "img", "i", "stories", "status", "accessibility",
]);

export function detectEtsy(inputUrl: string) {
  const url = validUrl(inputUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (host === "etsy.me") {
    return {
      confidence: 0.75,
      normalizedUrl: url.toString(),
      reasons: ["Etsy short link detected. Paste the shop URL (etsy.com/shop/…) to name the source."],
    };
  }
  const subdomainShop = /^([a-z0-9][a-z0-9-]{0,62})\.etsy\.com$/u.exec(host)?.[1];
  if (subdomainShop && !ETSY_HOSTS.has(host) && !ETSY_SERVICE_SUBDOMAINS.has(subdomainShop)) {
    return {
      confidence: 0.95,
      normalizedUrl: `https://www.etsy.com/shop/${subdomainShop}`,
      accountName: subdomainShop,
      reasons: ["Etsy shop detected. Orders, sales, refunds, and active listings come from the official Etsy Open API v3."],
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
      reasons: ["Etsy shop detected. Orders, sales, refunds, and active listings come from the official Etsy Open API v3."],
    };
  }
  if (section === "listing" && value && /^\d+$/u.test(value)) {
    return {
      confidence: 0.8,
      normalizedUrl: `https://www.etsy.com/listing/${value}`,
      reasons: ["Etsy listing detected. Connect the shop that owns it (etsy.com/shop/…)."],
    };
  }
  return null;
}
