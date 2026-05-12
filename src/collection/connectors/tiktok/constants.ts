export const AUTO_LAB_TIKTOK_SOURCE_ID = "dfb2d0d1-471e-4905-9a8a-1875a39e66b5";

export const TIKTOK_OAUTH_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
];

export const TIKTOK_TOKEN_FIELD_KEYS = new Set([
  "tiktok_access_token",
  "tiktok_refresh_token",
]);

export const TIKTOK_USER_FIELDS = [
  "open_id",
  "union_id",
  "avatar_url",
  "display_name",
  "bio_description",
  "profile_deep_link",
  "is_verified",
  "username",
  "follower_count",
  "following_count",
  "likes_count",
  "video_count",
];

export const TIKTOK_VIDEO_FIELDS = [
  "id",
  "create_time",
  "cover_image_url",
  "share_url",
  "video_description",
  "duration",
  "height",
  "width",
  "title",
  "embed_link",
  "like_count",
  "comment_count",
  "share_count",
  "view_count",
];
