# site

The hosted chef at chef.playgrndlabs.com (also `chef-site.<subdomain>.workers.dev`): the landing page and the chef app on one site. The app's UI and sign-in live here; each person's chef engine (agents, sandboxes, repositories, keys and previews) runs in their own Cloudflare account.

1. `/auth/start` sends a visitor to Cloudflare's consent page; `/auth/callback` trades the code for a short-lived token, reads their Cloudflare user and signs them in with a signed session cookie. Each person has a `Member` Durable Object holding their email, their engine's address and the key this site uses to reach it.
2. `/setup` lists their accounts. Setting up runs `installer/install.mjs` in the `Member` container: it copies the prebuilt sandbox image into the account's registry, creates a token limited to Workers scripts for previews, and runs `chef deploy --image` with a generated `CHEF_PASSWORD` that only this site knows.
3. Signed-in members get the dashboard at `/`, and `/api`, `/agents` and `/preview` are proxied to their engine with that key. The engine sends GitHub back to this site through the `x-chef-origin` header.
4. A `Members` Durable Object lists every member and how their setup went. People who can see the PlaygrndLabs account itself (the account in `CF_ACCOUNT_ID`) when they sign in are admins and see that list at `/admin`.
5. The Cloudflare token is revoked as soon as setup ends. When a newer engine is out, it is updated the next time the person signs in.

The `site` workflow publishes the sandbox image, deploys this Worker after every green CI on `main`, and creates the OAuth client once (scopes in `oauth-scopes.json`). The client is private until a verified domain makes it public.
