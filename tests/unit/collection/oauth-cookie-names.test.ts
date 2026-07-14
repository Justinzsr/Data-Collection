import { describe, expect, it } from "vitest";
import {
  getInstagramOAuthStateCookieName,
  INSTAGRAM_OAUTH_STATE_COOKIE,
  SECURE_INSTAGRAM_OAUTH_STATE_COOKIE,
} from "@/collection/connectors/instagram/oauth-state";
import {
  getTikTokOAuthStateCookieName,
  SECURE_TIKTOK_OAUTH_STATE_COOKIE,
  TIKTOK_OAUTH_STATE_COOKIE,
} from "@/collection/connectors/tiktok/oauth-state";

describe("OAuth state cookie names", () => {
  it("uses browser-compatible local names and __Host names in production", () => {
    expect(getInstagramOAuthStateCookieName({ NODE_ENV: "test" })).toBe(INSTAGRAM_OAUTH_STATE_COOKIE);
    expect(getInstagramOAuthStateCookieName({ NODE_ENV: "production" })).toBe(
      SECURE_INSTAGRAM_OAUTH_STATE_COOKIE,
    );
    expect(getTikTokOAuthStateCookieName({ NODE_ENV: "development" })).toBe(TIKTOK_OAUTH_STATE_COOKIE);
    expect(getTikTokOAuthStateCookieName({ NODE_ENV: "production" })).toBe(
      SECURE_TIKTOK_OAUTH_STATE_COOKIE,
    );
  });
});
