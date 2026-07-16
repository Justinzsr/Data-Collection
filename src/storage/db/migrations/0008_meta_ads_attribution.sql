insert into source_types (
  key,
  display_name,
  description,
  category,
  icon,
  url_patterns,
  required_fields,
  optional_fields,
  supported_metrics,
  auth_type,
  docs_url,
  enabled,
  created_at,
  updated_at
) values (
  'meta_ads',
  'Meta Ads',
  'Read-only Meta Marketing API connector for ad delivery, cost, conversion, revenue, ROAS, and creative-level UTM attribution.',
  'Marketing',
  'Megaphone',
  '["^https:\/\/(?:business\\.|www\\.|adsmanager\\.)?facebook\\.com\/adsmanager\/"]'::jsonb,
  '[
    {
      "key": "meta_ads_long_lived_access_token",
      "label": "Meta Ads access token",
      "description": "Encrypted server-only OAuth token with ads_read plus the existing read-only Instagram/Page scopes used by this shared Meta connection.",
      "required": false,
      "secret": true,
      "type": "password"
    },
    {
      "key": "meta_ad_account_id",
      "label": "Meta ad account ID",
      "description": "Ad account selected during OAuth, stored as act_<account-id>.",
      "required": true,
      "secret": false,
      "type": "text"
    }
  ]'::jsonb,
  '[
    {
      "key": "meta_ads_access_token",
      "label": "Short-lived access token",
      "description": "Encrypted short-lived token when returned by OAuth.",
      "required": false,
      "secret": true,
      "type": "password"
    },
    {
      "key": "meta_ads_expires_at",
      "label": "Token expires at",
      "description": "OAuth token expiration timestamp when provided.",
      "required": false,
      "secret": false,
      "type": "text"
    },
    {
      "key": "meta_ads_graph_api_version",
      "label": "Graph API version",
      "description": "Pinned Meta Graph API version; defaults to v25.0.",
      "required": false,
      "secret": false,
      "type": "text"
    },
    {
      "key": "meta_ads_lookback_days",
      "label": "Attribution lookback",
      "description": "Overlapping daily window to recompute, from 1 to 90 days; defaults to 30.",
      "required": false,
      "secret": false,
      "type": "text"
    }
  ]'::jsonb,
  '[
    "meta_ads_spend",
    "meta_ads_impressions",
    "meta_ads_reach",
    "meta_ads_frequency",
    "meta_ads_clicks",
    "meta_ads_outbound_clicks",
    "meta_ads_inline_link_clicks",
    "meta_ads_ctr",
    "meta_ads_cpc",
    "meta_ads_cpm",
    "meta_ads_landing_page_views",
    "meta_ads_view_content",
    "meta_ads_add_to_cart",
    "meta_ads_initiate_checkout",
    "meta_ads_purchases",
    "meta_ads_purchase_value",
    "meta_ads_cost_per_purchase",
    "meta_ads_purchase_roas",
    "meta_ads_website_purchase_roas",
    "meta_ads_post_saves",
    "meta_ads_post_reactions",
    "meta_ads_comments",
    "meta_ads_post_engagements",
    "meta_ads_video_p25",
    "meta_ads_video_p50",
    "meta_ads_video_p75",
    "meta_ads_video_p95",
    "meta_ads_video_p100",
    "meta_ads_video_thruplay"
  ]'::jsonb,
  'meta_marketing_api_oauth',
  'https://developers.facebook.com/docs/marketing-api/insights/',
  true,
  now(),
  now()
)
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  category = excluded.category,
  icon = excluded.icon,
  url_patterns = excluded.url_patterns,
  required_fields = excluded.required_fields,
  optional_fields = excluded.optional_fields,
  supported_metrics = excluded.supported_metrics,
  auth_type = excluded.auth_type,
  docs_url = excluded.docs_url,
  enabled = excluded.enabled,
  updated_at = excluded.updated_at;

update source_types
set
  supported_metrics = '["orders","gross_sales","current_total","net_payment","refunds","top_products","shopify_attributed_orders","shopify_attributed_gross_sales","shopify_attributed_discounts","shopify_attributed_current_total","shopify_attributed_refunds","shopify_attributed_net_revenue"]'::jsonb,
  updated_at = now()
where key = 'shopify';

create unique index if not exists sources_meta_ads_linked_instagram_uidx
  on sources ((metadata ->> 'linked_instagram_source_id'))
  where source_type_key = 'meta_ads'
    and metadata ->> 'linked_instagram_source_id' is not null;

insert into metric_definitions (
  key,
  display_name,
  description,
  source_type_key,
  category,
  unit,
  higher_is_better,
  created_at,
  updated_at
) values
  ('meta_ads_spend', 'Meta Ads spend', 'Amount spent for the reporting day in the Meta ad account currency.', 'meta_ads', 'Paid media', 'currency', false, now(), now()),
  ('meta_ads_impressions', 'Meta Ads impressions', 'Paid ad impressions reported by Meta Ads Insights.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_reach', 'Meta Ads ad-day reach', 'Estimated reach reported for each ad/day row. Summing rows is an ad-day reach total, not unique period reach.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_frequency', 'Meta Ads frequency', 'Average paid impressions per reached account for the reporting day.', 'meta_ads', 'Paid media', 'ratio', false, now(), now()),
  ('meta_ads_clicks', 'Meta Ads clicks', 'All clicks reported by Meta Ads Insights.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_outbound_clicks', 'Meta Ads outbound clicks', 'Clicks that sent people away from Meta-owned surfaces.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_inline_link_clicks', 'Meta Ads link clicks', 'Inline link clicks reported by Meta Ads Insights.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_ctr', 'Meta Ads CTR', 'Click-through rate reported by Meta Ads Insights.', 'meta_ads', 'Paid media', 'percent', true, now(), now()),
  ('meta_ads_cpc', 'Meta Ads CPC', 'Average cost per click reported by Meta Ads Insights.', 'meta_ads', 'Paid media', 'currency', false, now(), now()),
  ('meta_ads_cpm', 'Meta Ads CPM', 'Average cost per thousand impressions reported by Meta Ads Insights.', 'meta_ads', 'Paid media', 'currency', false, now(), now()),
  ('meta_ads_landing_page_views', 'Meta landing page views', 'Landing page view actions attributed by Meta.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_view_content', 'Meta content views', 'View-content actions attributed by Meta.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_add_to_cart', 'Meta adds to cart', 'Add-to-cart actions attributed by Meta.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_initiate_checkout', 'Meta checkouts initiated', 'Initiate-checkout actions attributed by Meta.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_purchases', 'Meta purchases', 'Purchase actions attributed by Meta under the selected attribution window.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_purchase_value', 'Meta purchase value', 'Purchase value attributed by Meta in the ad account currency.', 'meta_ads', 'Paid media', 'currency', true, now(), now()),
  ('meta_ads_cost_per_purchase', 'Meta cost per purchase', 'Spend divided by Meta-attributed purchases when purchases are reported.', 'meta_ads', 'Paid media', 'currency', false, now(), now()),
  ('meta_ads_purchase_roas', 'Meta purchase ROAS', 'Purchase return on ad spend reported by Meta.', 'meta_ads', 'Paid media', 'ratio', true, now(), now()),
  ('meta_ads_website_purchase_roas', 'Meta website purchase ROAS', 'Website purchase return on ad spend reported by Meta.', 'meta_ads', 'Paid media', 'ratio', true, now(), now()),
  ('meta_ads_post_saves', 'Meta post saves', 'Post saves attributed to the ad by Meta, preferring the post_save action over its onsite conversion alias without double counting.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_post_reactions', 'Meta post reactions', 'Post reaction actions attributed to the ad by Meta.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_comments', 'Meta ad comments', 'Comment actions attributed to the ad by Meta.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_post_engagements', 'Meta post engagements', 'Post engagement actions attributed to the ad by Meta.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_video_p25', 'Meta video 25% views', 'Video-play actions reaching at least 25 percent.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_video_p50', 'Meta video 50% views', 'Video-play actions reaching at least 50 percent.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_video_p75', 'Meta video 75% views', 'Video-play actions reaching at least 75 percent.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_video_p95', 'Meta video 95% views', 'Video-play actions reaching at least 95 percent.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_video_p100', 'Meta completed video views', 'Video-play actions reaching 100 percent.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('meta_ads_video_thruplay', 'Meta ThruPlays', 'ThruPlay actions reported by Meta for video creative.', 'meta_ads', 'Paid media', 'count', true, now(), now()),
  ('shopify_attributed_orders', 'Shopify UTM-attributed orders', 'Non-test Shopify orders whose ready customer journey exactly matches the stored UTM dimensions.', 'shopify', 'Attribution', 'count', true, now(), now()),
  ('shopify_attributed_gross_sales', 'Shopify UTM-attributed gross sales', 'Gross sales for non-test Shopify orders grouped by ready first- or last-visit UTM dimensions.', 'shopify', 'Attribution', 'currency', true, now(), now()),
  ('shopify_attributed_discounts', 'Shopify UTM-attributed discounts', 'Discounts applied to non-test Shopify orders grouped by ready first- or last-visit UTM dimensions.', 'shopify', 'Attribution', 'currency', false, now(), now()),
  ('shopify_attributed_current_total', 'Shopify UTM-attributed current total', 'Current order total after returns, refunds, edits, and cancellations for non-test Shopify orders grouped by ready first- or last-visit UTM dimensions.', 'shopify', 'Attribution', 'currency', true, now(), now()),
  ('shopify_attributed_refunds', 'Shopify UTM-attributed refunds', 'Refunded amount attached to non-test Shopify orders grouped by ready first- or last-visit UTM dimensions and the order creation date.', 'shopify', 'Attribution', 'currency', false, now(), now()),
  ('shopify_attributed_net_revenue', 'Shopify UTM-attributed net revenue', 'Net payment for non-test Shopify orders grouped by ready first- or last-visit UTM dimensions.', 'shopify', 'Attribution', 'currency', true, now(), now())
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  source_type_key = excluded.source_type_key,
  category = excluded.category,
  unit = excluded.unit,
  higher_is_better = excluded.higher_is_better,
  updated_at = excluded.updated_at;
