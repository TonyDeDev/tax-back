# Setup

How to configure the environment, Google sign-in, and "Sign in with SnapTrade".
Read `docs/dev.md` first for the local quick start.

## Environment Variables

All variables live in `.env.local` locally and in the Vercel project settings in production.
`src/server/env.ts` validates them on first use and fails fast with a named error.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon connection string. |
| `BETTER_AUTH_SECRET` | Yes | At least 32 characters: `openssl rand -base64 32`. Signs sessions and encrypts the stored SnapTrade tokens, so rotating it signs everyone out and every user must sign in with SnapTrade again. |
| `BETTER_AUTH_URL` | Yes | The public origin: `http://localhost:3000` locally, `https://<project>.vercel.app` in production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | Google sign-in. Set both or neither. |
| `SNAPTRADE_OAUTH_CLIENT_ID`, `SNAPTRADE_OAUTH_CLIENT_SECRET` | No | The SnapTrade OAuth app: sign-in and brokerage access. Set both or neither. Without it nobody can connect brokerages. |
| `CRON_SECRET` | No | At least 32 characters. Protects `/api/cron/sync`. |
| `DEMO_USER_EMAIL` | No | Defaults to `demo@taxback.invalid`. Keep the `.invalid` domain so no provider can verify it. |

Empty values count as unset.
The Commercial API keys (`SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`) are not used.

## Google OAuth Client

Google sign-in lets people try TaxBack before they set up SnapTrade.
It is free and needs no credit card.

1. Google Cloud Console, then APIs and Services, then Credentials, then Create credentials, then OAuth client ID.
2. Configure the consent screen first if asked: External, app name TaxBack, scopes `openid`, `email`, `profile` only.
3. Application type: Web application.
4. Authorized JavaScript origins: `http://localhost:3000` and the production origin.
5. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` and `<production origin>/api/auth/callback/google`.
6. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

While the consent screen is in Testing mode, only the Google accounts listed as test users can sign in; publish it to allow anyone.

## SnapTrade OAuth App

TaxBack reads the brokerages users connected in their SnapTrade Personal account.
The same OAuth app serves "Continue with SnapTrade" on the sign-in page and "Connect with SnapTrade" in Settings.
See SnapTrade's guide: https://docs.snaptrade.com/docs/oauth-apps.

1. Sign in to the SnapTrade Dashboard (https://dashboard.snaptrade.com) with the developer account.
2. Open **OAuth Apps** and create the **Test** app.
   The consent screen shows the name of the SnapTrade customer account.
3. Add the redirect URI, which must match exactly:
   - Local: `http://localhost:3000/api/auth/callback/snaptrade`
   - Production: `https://<project>.vercel.app/api/auth/callback/snaptrade`
4. Copy the `client_id` and `client_secret` into `SNAPTRADE_OAUTH_CLIENT_ID` and `SNAPTRADE_OAUTH_CLIENT_SECRET`.
   The secret is shown only once; if it is lost or leaked, rotate it on the app's page.
5. Do not enable `trade`. TaxBack requests `openid email profile read` only.

### Cost and limits (checked 2026-10-05)

- The Test app is free, needs no KYC, and allows **5 users**.
  It supports every scope and real brokerage connections.
- OAuth app access is a **free preview** with no per-user fee; SnapTrade says paid pricing will be announced later.
- SnapTrade Personal accounts, which the users sign in with, are free.
- A Production app (more than 5 users) requires SnapTrade's KYC approval (Production Access Application).

### Testing it

1. Create a SnapTrade Personal account (free) and connect the **SnapTrade Sandbox** brokerage or a real one in the Dashboard.
2. Run `pnpm dev`, open `/sign-in`, and choose "Continue with SnapTrade".
   Approve the consent screen; you land on `/hub` signed in.
3. Or sign in with Google, open Settings, and choose "Connect with SnapTrade".
   Approve the consent screen; you come back to Settings with "SnapTrade is connected".

## How Sign-In Works

- Better Auth serves every auth endpoint under `/api/auth/*` (`src/app/api/auth/[...all]/route.ts`).
- "Continue with SnapTrade" is an OpenID Connect authorization code flow with PKCE, `state`, and `nonce`.
  Better Auth reads SnapTrade's discovery document and verifies every id_token against SnapTrade's JWKS, issuer, audience, expiry, and nonce; if discovery fails, the provider is disabled rather than trusting unverified tokens.
- The SnapTrade identity is keyed on the id_token `sub` (the SnapTrade Personal user id).
  A user who signs up with SnapTrade and declines the `email` scope gets a placeholder `@users.taxback.invalid` address.
- A Google user connects SnapTrade from Settings with Better Auth's `linkSocial`, which adds the SnapTrade grant to the signed-in account.
  The SnapTrade email may differ or be missing; the signed-in session plus SnapTrade's consent is the proof.
  A SnapTrade identity can belong to only one TaxBack account (`accounts_provider_account_key`).
- Accounts are never merged by matching email at sign-in.
  If someone who signed up with Google later clicks "Continue with SnapTrade" with the same email, they get "That email already has a TaxBack account" and are told to sign in with Google and connect SnapTrade in Settings.
  Merging by email would let anyone who registers a SnapTrade account under someone else's address take over that person's TaxBack account.
- The SnapTrade access and refresh tokens are stored encrypted in `accounts`.
  The endpoints that return them (`/get-access-token`, `/refresh-token`, `/account-info`) answer 404 over HTTP; server code reads them through `auth.api`.
- "Try the demo" calls `POST /api/auth/demo/sign-in`, which signs the visitor in as the shared demo user.
  It is rate limited to 10 per minute per client.
- The demo user is shared, so a demo session may only call the auth endpoints in the allowlist in `src/server/auth/demo-plugin.ts`; everything else returns 403.
  App actions that write data use `requireWritableUser()`, which rejects the demo user.
- `src/proxy.ts` redirects requests without a session cookie away from `/hub`, `/tax`, and `/settings`, and sets the security headers and the nonce-based Content Security Policy.
  The real check is `requireUser()` in each page and `requireUserForAction()` in each action.
