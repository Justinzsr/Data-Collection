/** Where the Etsy sign-in starts and where Etsy sends the seller back. Safe on the server and in the browser. */
export const ETSY_CALLBACK_PATH = "/api/oauth/etsy/callback";

export function etsyOAuthStartPath(input: { sourceId: string; dataSpaceSlug: string; returnPath: string }) {
  const query = new URLSearchParams({ sourceId: input.sourceId, dataSpaceSlug: input.dataSpaceSlug, returnPath: input.returnPath });
  return `/api/oauth/etsy/start?${query.toString()}`;
}
