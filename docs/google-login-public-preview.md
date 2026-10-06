# Google login and public preview

DataHub has two separate entry paths:

- `/` displays an interactive fictional workspace to visitors. A valid existing private session redirects to `/w/moonarq/dashboard`.
- `/demo` always displays the same sample workspace, including for signed-in users.
- `/login` offers Google sign-in for one configured owner and the existing dashboard password for everyone else.
- MoonArq, Auto Lab, source credentials, customer data, reports, and private APIs retain the existing server-side session gate.

The public preview lives entirely in `src/presentation/public-preview`. It never imports the private dashboard, database repositories, aggregation services, or the mutable development demo store. Its controls only switch between local sample values. Do not feed it production data or add private API requests, workspace links, exports, or sync actions.

## Configure Google sign-in

Keep the current `DASHBOARD_ADMIN_PASSWORD`, `DASHBOARD_SESSION_SECRET`, database settings, and platform credentials unchanged. No database migration or platform reconnection is required.

Use Node.js 22 or newer for development and deployment, as required by the pinned Google authentication library. CI already uses Node.js 22.

1. In Google Cloud, create a **Web application** OAuth client for DataHub. Configure its branding/consent screen. Only the `openid` and `email` scopes are needed; no Google Drive, Gmail, or offline access is requested.
2. Register the exact production callback:

   `https://moonarq-data-hub.vercel.app/api/auth/google/callback`

   For local verification, also register:

   `http://localhost:4000/api/auth/google/callback`

3. Set these server-side variables for the target deployment using the secure environment settings, never chat or source control:

   - `GOOGLE_CLIENT_ID`: the Web application's client ID.
   - `GOOGLE_CLIENT_SECRET`: its client secret.
   - `GOOGLE_ALLOWED_EMAIL`: the owner's exact verified Gmail address (one address, not a comma-separated list).
   - `NEXT_PUBLIC_APP_URL`: the canonical origin, e.g. `https://moonarq-data-hub.vercel.app`. Do not use an arbitrary preview hostname or a URL with a path.

4. This flow requests only `openid` and `email`. Google's [basic identity scope exception](https://support.google.com/cloud/answer/15549945) allows sign-in even while the OAuth app is in testing status, without adding test users or publishing the existing Google project. DataHub still enforces its own owner allowlist on the server.
5. Release the reviewed code only after deployment authorization. Verify owner login, another-account denial/password fallback, logout, and anonymous private-route rejection on the actual production alias.

Do not prefix the Google secret or allowlist variable with `NEXT_PUBLIC_`. The application never places them in client props, HTML, error messages, logs, or URLs. The Google client ID is necessarily included in Google's authorization URL; the client secret is not.

Google's official `google-auth-library` verifies the returned ID token. The application additionally checks the nonce, verified email, and exact server allowlist, and binds the callback to a signed, expiring, HttpOnly state cookie and PKCE verifier. Only a successful owner verification creates a private dashboard session. A different account returns to password login with a generic message, without exposing the owner address.

Google does not let DataHub inspect the Chrome account directly. First use requires the Google sign-in action and any consent Google requests. Once DataHub has issued its private session, reopening `/` enters the dashboard until that session expires. Signing out of Google alone does not revoke a DataHub session; use DataHub's Sign out action on shared devices.

Reference: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) and [server-side ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Local verification

Use port **4000**. Use synthetic local/test secrets only; do not copy production credentials into a worktree. To exercise the private fallback, set `DEV_AUTH_BYPASS=false` and provide a local password and session secret. Google configuration is optional: missing configuration must leave the public preview and password login usable.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`. The browser suite uses the existing synthetic database mode and password. Google tests mock provider responses and never claim a live Google consent flow. A real owner-account smoke test requires the configured OAuth client and user interaction.

Manual checks cover 1440, 1024, 768, 390, and 320-pixel layouts, demo interactions, sign-in navigation, both private workspaces, and direct metrics/source/credential API requests. Anonymous HTML and network activity must contain only demo content; changing `next`, workspace slugs, query parameters, or client storage must never authorize real data.
