import { describe, expect, it } from "vitest";
import { isCronRequestAuthorized } from "@/app/api/cron/sync/route";

describe("cron route authorization", () => {
  it("requires Authorization Bearer in production", () => {
    const env = {
      NODE_ENV: "production",
      CRON_SECRET: "secret",
    } as NodeJS.ProcessEnv;

    expect(isCronRequestAuthorized(new Request("https://app.example.com/api/cron/sync?secret=secret"), env)).toBe(false);
    expect(isCronRequestAuthorized(new Request("https://app.example.com/api/cron/sync", {
      headers: { authorization: "Bearer secret" },
    }), env)).toBe(true);
  });

  it("keeps query-param cron secret available outside production", () => {
    const env = {
      NODE_ENV: "development",
      CRON_SECRET: "secret",
    } as NodeJS.ProcessEnv;

    expect(isCronRequestAuthorized(new Request("http://localhost:3100/api/cron/sync?secret=secret"), env)).toBe(true);
  });
});
