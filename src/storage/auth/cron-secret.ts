export function isCronRequestAuthorized(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret) return env.NODE_ENV !== "production";
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (env.NODE_ENV === "production") return bearer === secret;
  return bearer === secret || url.searchParams.get("secret") === secret;
}
