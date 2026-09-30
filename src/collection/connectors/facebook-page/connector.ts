import { createPlannedConnector, validUrl } from "@/collection/connectors/future-connectors";

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "www.fb.com"]);

/** First path segments that are Facebook features, not Page handles. */
const RESERVED_PATHS = new Set([
  "adsmanager", "ads", "business", "business_help", "bookmarks", "dialog", "events", "friends", "fundraisers",
  "gaming", "groups", "hashtag", "help", "home.php", "l.php", "login", "marketplace", "messages", "notifications",
  "permalink.php", "photo", "photo.php", "plugins", "policies", "privacy", "reel", "reels", "saved", "search",
  "settings", "share", "sharer", "sharer.php", "stories", "story.php", "watch",
]);

export function detectFacebookPage(inputUrl: string) {
  const url = validUrl(inputUrl);
  if (!url || !FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0]?.toLowerCase();
  if (!first) return null;

  if (first === "profile.php") {
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/u.test(id)) return null;
    return {
      confidence: 0.9,
      normalizedUrl: `https://www.facebook.com/profile.php?id=${id}`,
      accountName: id,
      reasons: ["Facebook Page (numeric ID) detected. Facebook Page insights are planned."],
    };
  }
  if (first === "pages" && parts.length >= 2) {
    const name = parts[1];
    return {
      confidence: 0.9,
      normalizedUrl: `https://www.facebook.com/${parts.slice(0, 3).join("/")}`,
      accountName: name,
      reasons: ["Facebook Page detected. Facebook Page insights are planned."],
    };
  }
  if (RESERVED_PATHS.has(first)) return null;
  const handle = parts[0];
  return {
    confidence: 0.93,
    normalizedUrl: `https://www.facebook.com/${handle}`,
    accountName: handle,
    reasons: ["Facebook Page detected. Facebook Page insights are planned."],
  };
}

export const facebookPageConnector = createPlannedConnector({
  key: "facebook_page",
  displayName: "Facebook Page",
  description: "Planned Facebook Page insights through the official Meta Graph API, reusing the existing Meta login. It does not collect data or accept credentials yet.",
  category: "Social",
  icon: "ThumbsUp",
  urlPatterns: [/^https:\/\/((www|m|web)\.)?(facebook|fb)\.com\/[^/?#]+/i],
  authType: "meta_oauth_page_insights",
  docsUrl: "https://developers.facebook.com/docs/graph-api/reference/insights",
  supportedMetrics: [
    "Page followers",
    "Page reach and impressions",
    "Post engagement and reactions",
    "Link clicks",
  ],
  detect: detectFacebookPage,
  setup: [
    "Facebook Page is planned. MoonArq does not collect Facebook Page data yet and does not ask for credentials.",
    "It will use the official Meta Graph API Page Insights through the Meta app and Facebook Login that Instagram and Meta Ads already use, so one Meta connection can cover all three.",
    "Needed later: you must be an admin of the Page, and the Meta app needs pages_show_list, pages_read_engagement, and read_insights with Advanced Access (Meta App Review).",
    "Planned daily metrics: followers, reach, impressions, post engagement, and link clicks.",
  ],
});
