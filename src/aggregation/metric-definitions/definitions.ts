import type { MetricDefinition, SourceTypeKey } from "@/storage/db/schema";

const now = "2026-04-22T00:00:00.000Z";

function metric(
  key: string,
  display_name: string,
  description: string,
  source_type_key: SourceTypeKey | null,
  category: string,
  unit = "count",
  higher_is_better = true,
): MetricDefinition {
  return {
    key,
    display_name,
    description,
    source_type_key,
    category,
    unit,
    higher_is_better,
    created_at: now,
    updated_at: now,
  };
}

export const metricDefinitions: MetricDefinition[] = [
  metric("page_views", "Page views", "Tracked website page view events.", "website", "Website"),
  metric("unique_visitors", "Unique visitors", "Distinct anonymous visitors observed by first-party tracking.", "website", "Website"),
  metric("sessions", "Sessions", "Distinct visitor sessions observed by first-party tracking.", "website", "Website"),
  metric("custom_events", "Custom events", "Named product or marketing events sent to /api/track.", "website", "Website"),
  metric("events_by_path", "Events by path", "Website events grouped by path.", "website", "Website"),
  metric("events_by_referrer", "Events by referrer", "Website events grouped by referrer.", "website", "Website"),
  metric("signups", "Signups", "New user signups from public profiles or Supabase Auth admin mode.", "supabase", "Users"),
  metric("users_total", "Total users", "Total known users from public profiles or server-side admin fallback.", "supabase", "Users"),
  metric("confirmed_users", "Confirmed users", "Users with confirmed email or equivalent profile state when available.", "supabase", "Users"),
  metric("signups_by_provider", "Signups by provider", "Signup count split by auth provider when available.", "supabase", "Users"),
  metric("deployment_count", "Deployments", "Future Vercel project deployment count.", "vercel_project", "Deployments"),
  metric("latest_deployment_status", "Deployment status", "Future Vercel latest deployment status.", "vercel_project", "Deployments"),
  metric("orders", "Orders", "Future Shopify order count.", "shopify", "Commerce"),
  metric("gross_sales", "Gross sales", "Future Shopify gross sales.", "shopify", "Commerce", "currency"),
  metric("current_total", "Current total", "Future Shopify current order total.", "shopify", "Commerce", "currency"),
  metric("net_payment", "Net payment", "Future Shopify net payment.", "shopify", "Commerce", "currency"),
  metric("refunds", "Refunds", "Future Shopify refund amount.", "shopify", "Commerce", "currency", false),
  metric("top_products", "Top products", "Future Shopify product ranking metric.", "shopify", "Commerce"),
  metric("video_views", "Video views", "Future TikTok video views.", "tiktok", "Content"),
  metric("likes", "Likes", "Future social likes.", "tiktok", "Content"),
  metric("comments", "Comments", "Future social comments.", "tiktok", "Content"),
  metric("shares", "Shares", "Future TikTok shares.", "tiktok", "Content"),
  metric("engagement_rate", "Engagement rate", "Engagement divided by reach, impressions, or views.", null, "Content", "percent"),
  metric("reach", "Reach", "Future Instagram reach.", "instagram", "Content"),
  metric("impressions", "Impressions", "Future Instagram impressions.", "instagram", "Content"),
  metric("followers", "Followers", "Future Instagram follower count.", "instagram", "Content"),
  metric("profile_views", "Profile views", "Future Instagram profile views.", "instagram", "Content"),
  metric("media_likes", "Media likes", "Future Instagram media likes.", "instagram", "Content"),
  metric("media_comments", "Media comments", "Future Instagram media comments.", "instagram", "Content"),
  metric("active_sources", "Active sources", "Sources currently enabled and healthy enough to collect data.", null, "System"),
  metric("sync_errors", "Sync errors", "Sync runs ending in an error state.", null, "System", "count", false),
];
