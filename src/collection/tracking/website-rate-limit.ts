import { createHash, randomBytes } from "node:crypto";

export const DEFAULT_WEBSITE_TRACKING_RATE_LIMIT = 600;
export const DEFAULT_WEBSITE_TRACKING_RATE_WINDOW_MS = 60_000;
export const DEFAULT_WEBSITE_TRACKING_PREFLIGHT_RATE_LIMIT = 1_200;
export const MAX_WEBSITE_TRACKING_RATE_LIMIT_BUCKETS = 10_000;

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxBuckets = MAX_WEBSITE_TRACKING_RATE_LIMIT_BUCKETS,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error("Rate limit window must be a positive integer.");
    if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new Error("Rate limit bucket capacity must be a positive integer.");
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    let existing = this.buckets.get(key);
    if (existing && now >= existing.resetAt) {
      this.buckets.delete(key);
      existing = undefined;
    }
    if (!existing && this.buckets.size >= this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (oldestKey) this.buckets.delete(oldestKey);
    }
    const bucket = existing ?? { count: 0, resetAt: now + this.windowMs };
    bucket.count += 1;
    // Refresh insertion order so a rotating-identity flood stays bounded and
    // evicts the least recently used bucket in constant time.
    if (existing) this.buckets.delete(key);
    this.buckets.set(key, bucket);
    const allowed = bucket.count <= this.limit;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }

  reset() {
    this.buckets.clear();
  }

  get bucketCount() {
    return this.buckets.size;
  }
}

const processSalt = randomBytes(32);
let defaultLimiter: FixedWindowRateLimiter | null = null;
let defaultLimit = 0;
let preflightLimiter: FixedWindowRateLimiter | null = null;
let preflightLimit = 0;

function configuredLimit() {
  const candidate = Number(process.env.WEBSITE_TRACKING_RATE_LIMIT_PER_MINUTE);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 10_000) {
    return DEFAULT_WEBSITE_TRACKING_RATE_LIMIT;
  }
  return candidate;
}

function limiter() {
  const limit = configuredLimit();
  if (!defaultLimiter || defaultLimit !== limit) {
    defaultLimit = limit;
    defaultLimiter = new FixedWindowRateLimiter(limit, DEFAULT_WEBSITE_TRACKING_RATE_WINDOW_MS);
  }
  return defaultLimiter;
}

function privacySafeClientKey(input: { sourceId: string; ip?: string | null; anonymousId: string }) {
  // The required pseudonymous browser ID avoids pooling legitimate shoppers
  // behind carrier or corporate NAT. The coarser IP limiter runs separately
  // before body parsing to bound rotating-identity abuse.
  const clientIdentity = input.anonymousId.trim() || input.ip?.trim() || "unknown";
  return createHash("sha256")
    .update(processSalt)
    .update("\0")
    .update(input.sourceId)
    .update("\0")
    .update(clientIdentity)
    .digest("hex");
}

function hashPreflightIp(ip: string) {
  return createHash("sha256")
    .update(processSalt)
    .update("\0preflight\0")
    .update(ip.trim())
    .digest("hex");
}

export function consumeWebsiteTrackingRateLimit(input: {
  sourceId: string;
  ip?: string | null;
  anonymousId: string;
  now?: number;
}) {
  return limiter().consume(privacySafeClientKey(input), input.now);
}

export function consumeWebsiteTrackingPreflightRateLimit(input: { ip?: string | null; now?: number }): RateLimitDecision | null {
  const ip = input.ip?.trim();
  if (!ip) return null;
  const limit = Math.max(DEFAULT_WEBSITE_TRACKING_PREFLIGHT_RATE_LIMIT, configuredLimit() * 2);
  if (!preflightLimiter || preflightLimit !== limit) {
    preflightLimit = limit;
    preflightLimiter = new FixedWindowRateLimiter(limit, DEFAULT_WEBSITE_TRACKING_RATE_WINDOW_MS);
  }
  return preflightLimiter.consume(hashPreflightIp(ip), input.now);
}

export function resetWebsiteTrackingRateLimitForTests() {
  defaultLimiter?.reset();
  preflightLimiter?.reset();
  defaultLimiter = null;
  defaultLimit = 0;
  preflightLimiter = null;
  preflightLimit = 0;
}
