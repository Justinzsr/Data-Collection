import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WEBSITE_TRACKING_RATE_LIMIT,
  FixedWindowRateLimiter,
  consumeWebsiteTrackingRateLimit,
  resetWebsiteTrackingRateLimitForTests,
} from "@/collection/tracking/website-rate-limit";

describe("website tracking rate limiter", () => {
  afterEach(() => {
    resetWebsiteTrackingRateLimitForTests();
    vi.unstubAllEnvs();
  });

  it("allows requests through the limit and rejects the next request", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);

    expect(limiter.consume("client", 5_000)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume("client", 5_100)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume("client", 5_200)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 1,
    });
  });

  it("starts a fresh bucket exactly at the window boundary", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);

    expect(limiter.consume("client", 10_000).allowed).toBe(true);
    expect(limiter.consume("client", 10_999).allowed).toBe(false);
    expect(limiter.consume("client", 11_000)).toEqual({
      allowed: true,
      limit: 1,
      remaining: 0,
      retryAfterSeconds: 0,
    });
  });

  it("isolates client buckets and clears them on reset", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);

    expect(limiter.consume("client-a", 20_000).allowed).toBe(true);
    expect(limiter.consume("client-a", 20_100).allowed).toBe(false);
    expect(limiter.consume("client-b", 20_100).allowed).toBe(true);

    limiter.reset();

    expect(limiter.consume("client-a", 20_200).allowed).toBe(true);
  });

  it("falls back to the safe default when the environment limit is invalid", () => {
    vi.stubEnv("WEBSITE_TRACKING_RATE_LIMIT_PER_MINUTE", "not-a-number");
    const input = {
      sourceId: "11111111-1111-4111-8111-111111111111",
      ip: "203.0.113.10",
      anonymousId: "anon-1",
      now: 30_000,
    };

    let decision = consumeWebsiteTrackingRateLimit(input);
    for (let request = 2; request <= DEFAULT_WEBSITE_TRACKING_RATE_LIMIT; request += 1) {
      decision = consumeWebsiteTrackingRateLimit(input);
    }

    expect(decision).toMatchObject({
      allowed: true,
      limit: DEFAULT_WEBSITE_TRACKING_RATE_LIMIT,
      remaining: 0,
    });
    expect(consumeWebsiteTrackingRateLimit(input)).toMatchObject({
      allowed: false,
      limit: DEFAULT_WEBSITE_TRACKING_RATE_LIMIT,
      remaining: 0,
    });
  });

  it("keeps the client bucket map strictly bounded under rotating identities", () => {
    const limiter = new FixedWindowRateLimiter(10, 60_000, 3);

    limiter.consume("one", 0);
    limiter.consume("two", 0);
    limiter.consume("three", 0);
    limiter.consume("four", 0);
    limiter.consume("five", 0);

    expect(limiter.bucketCount).toBe(3);
  });

  it("does not pool distinct pseudonymous clients that share an IP address", () => {
    vi.stubEnv("WEBSITE_TRACKING_RATE_LIMIT_PER_MINUTE", "1");
    const shared = {
      sourceId: "11111111-1111-4111-8111-111111111111",
      ip: "203.0.113.10",
      now: 30_000,
    };

    expect(consumeWebsiteTrackingRateLimit({ ...shared, anonymousId: "anon-a" }).allowed).toBe(true);
    expect(consumeWebsiteTrackingRateLimit({ ...shared, anonymousId: "anon-a" }).allowed).toBe(false);
    expect(consumeWebsiteTrackingRateLimit({ ...shared, anonymousId: "anon-b" }).allowed).toBe(true);
  });
});
