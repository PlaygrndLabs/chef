# site

The landing page at `getchef.<subdomain>.workers.dev`. Visitors sign in with Cloudflare (OAuth), pick an account and a password, and chef is set up on their own account:

1. `/start` sends them to Cloudflare's consent page; `/callback` trades the code for a short-lived token kept only in a `Setup` Durable Object for this visit.
2. `/setup` lists their accounts. Starting setup runs `installer/install.mjs` in the `Setup` container: it copies the prebuilt sandbox image into the account's registry, creates a token limited to Workers scripts for previews, and runs the same `chef deploy` script as the Deploy to Cloudflare button with `--image`.
3. The token is revoked when setup ends, or after an hour.

The `site` workflow publishes the sandbox image, deploys this Worker after every green CI on `main`, and creates the OAuth client once (scopes in `oauth-scopes.json`). Make the client public in the Cloudflare dashboard after verifying a domain for it.
