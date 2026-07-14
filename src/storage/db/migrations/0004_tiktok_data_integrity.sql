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
  (
    'tiktok_video_views',
    'TikTok video views',
    'Current cumulative views summed across videos returned by the latest TikTok video.list snapshot; do not sum snapshots across dates.',
    'tiktok',
    'Content',
    'count',
    true,
    now(),
    now()
  ),
  (
    'tiktok_likes',
    'TikTok video likes',
    'Current cumulative likes summed across videos returned by the latest TikTok video.list snapshot; distinct from profile likes.',
    'tiktok',
    'Content',
    'count',
    true,
    now(),
    now()
  ),
  (
    'tiktok_comments',
    'TikTok video comments',
    'Current cumulative comments summed across videos returned by the latest TikTok video.list snapshot.',
    'tiktok',
    'Content',
    'count',
    true,
    now(),
    now()
  ),
  (
    'tiktok_shares',
    'TikTok video shares',
    'Current cumulative shares summed across videos returned by the latest TikTok video.list snapshot.',
    'tiktok',
    'Content',
    'count',
    true,
    now(),
    now()
  ),
  (
    'tiktok_engagement_rate',
    'TikTok engagement rate',
    'Latest snapshot''s cumulative likes, comments, and shares divided by cumulative video views.',
    'tiktok',
    'Content',
    'percent',
    true,
    now(),
    now()
  ),
  (
    'tiktok_followers',
    'TikTok followers',
    'Current cumulative follower count from TikTok user.info.stats when granted.',
    'tiktok',
    'Content',
    'count',
    true,
    now(),
    now()
  ),
  (
    'tiktok_video_count',
    'TikTok video count',
    'Current public video count from TikTok user.info.stats when granted.',
    'tiktok',
    'Content',
    'count',
    true,
    now(),
    now()
  ),
  (
    'tiktok_profile_likes',
    'TikTok profile likes',
    'Current cumulative account likes_count from TikTok user.info.stats; may differ from the sum of returned public-video likes.',
    'tiktok',
    'Content',
    'count',
    true,
    now(),
    now()
  )
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  source_type_key = excluded.source_type_key,
  category = excluded.category,
  unit = excluded.unit,
  higher_is_better = excluded.higher_is_better,
  updated_at = excluded.updated_at;

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
  'xiaohongshu',
  '小红书 / Xiaohongshu',
  'Planned Xiaohongshu connector placeholder. It does not collect data or accept credentials.',
  'Content',
  'BookOpen',
  '["^https:\\/\\/([a-z0-9-]+\\.)?xiaohongshu\\.com(?:\\/|$)","^https:\\/\\/([a-z0-9-]+\\.)?xhslink\\.com(?:\\/|$)"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'planned_official_api',
  null,
  false,
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
set enabled = false,
    updated_at = now()
where key in ('vercel_project', 'shopify', 'custom_api', 'custom_csv', 'xiaohongshu');

update sources
set sync_mode = 'hourly',
    sync_frequency_minutes = 60,
    supports_webhook = false,
    next_sync_at = date_trunc('hour', now()) + interval '1 hour',
    updated_at = now()
where source_type_key in ('tiktok', 'instagram')
  and status <> 'disabled';

update sources
set input_url = 'https://www.tiktok.com/@' || regexp_replace(
      btrim(coalesce(nullif(metadata->>'tiktok_username', ''), account_name)),
      '^@+',
      ''
    ),
    normalized_url = 'https://www.tiktok.com/@' || regexp_replace(
      btrim(coalesce(nullif(metadata->>'tiktok_username', ''), account_name)),
      '^@+',
      ''
    ),
    updated_at = now()
where source_type_key = 'tiktok'
  and account_name is not null
  and regexp_replace(
    btrim(coalesce(nullif(metadata->>'tiktok_username', ''), account_name)),
    '^@+',
    ''
  ) ~ '^[A-Za-z0-9._]{2,24}$';

update sources
set input_url = 'https://www.instagram.com/' || regexp_replace(btrim(account_name), '^@+', '') || '/',
    normalized_url = 'https://www.instagram.com/' || regexp_replace(btrim(account_name), '^@+', '') || '/',
    updated_at = now()
where source_type_key = 'instagram'
  and account_name is not null
  and regexp_replace(btrim(account_name), '^@+', '') ~ '^[A-Za-z0-9._]{1,30}$';
