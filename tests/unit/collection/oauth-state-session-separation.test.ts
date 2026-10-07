import { describe, expect, it } from "vitest";
import {
  createInstagramOAuthState,
  validateInstagramOAuthState,
  validateSignedInstagramOAuthState,
} from "@/collection/connectors/instagram/oauth-state";
import {
  createTikTokOAuthState,
  validateSignedTikTokOAuthState,
  validateTikTokOAuthState,
} from "@/collection/connectors/tiktok/oauth-state";
import { signDashboardSession, verifyDashboardSession } from "@/storage/auth/dashboard-session";

const SECRET = "session-secret-with-enough-entropy-for-tests";
const ENV = { NODE_ENV: "test", DASHBOARD_SESSION_SECRET: SECRET } as NodeJS.ProcessEnv;
const INPUT = { sourceId: "source-1", dataSpaceSlug: "moonarq", returnPath: "/w/moonarq/dashboard/sources/source-1" };

describe("OAuth state and dashboard session separation", () => {
  it("never accepts an OAuth state, which travels in URLs, as a dashboard session", async () => {
    for (const state of [createTikTokOAuthState(INPUT, ENV), createInstagramOAuthState(INPUT, ENV), createInstagramOAuthState({ ...INPUT, connectMetaAds: true }, ENV)]) {
      await expect(verifyDashboardSession(state, SECRET)).resolves.toBe(false);
    }
    // A real session still verifies with the same secret.
    await expect(verifyDashboardSession(await signDashboardSession(SECRET), SECRET)).resolves.toBe(true);
  });

  it("never accepts a dashboard session as an OAuth state", async () => {
    const session = await signDashboardSession(SECRET);
    expect(() => validateSignedTikTokOAuthState(session, ENV)).toThrow("Invalid TikTok OAuth state.");
    expect(() => validateSignedInstagramOAuthState(session, ENV)).toThrow("Invalid Instagram OAuth state.");
  });

  it("keeps each platform's states to itself and still validates its own", () => {
    const tiktok = createTikTokOAuthState(INPUT, ENV);
    const instagram = createInstagramOAuthState(INPUT, ENV);
    expect(validateTikTokOAuthState(tiktok, tiktok, ENV)).toMatchObject(INPUT);
    expect(validateInstagramOAuthState(instagram, instagram, ENV)).toMatchObject(INPUT);
    expect(() => validateSignedTikTokOAuthState(instagram, ENV)).toThrow("Invalid TikTok OAuth state.");
    expect(() => validateSignedInstagramOAuthState(tiktok, ENV)).toThrow("Invalid Instagram OAuth state.");
    expect(() => validateSignedTikTokOAuthState(`${tiktok.slice(0, -2)}xx`, ENV)).toThrow("Invalid TikTok OAuth state.");
  });
});
