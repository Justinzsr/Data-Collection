export function getPublicAppUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }
  if (process.env.NODE_ENV !== "production") {
    return "http://127.0.0.1:3100";
  }
  return null;
}

export function getPublicAppUrlWarning() {
  if (getPublicAppUrl()) return null;
  return "Set NEXT_PUBLIC_APP_URL for public snippets and webhook instructions. Vercel preview/default URLs can fall back to VERCEL_URL, but production should set NEXT_PUBLIC_APP_URL explicitly.";
}

export function isRuntimeDemoMode() {
  return !process.env.DATABASE_URL;
}
