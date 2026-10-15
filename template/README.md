# template

Agent-friendly template for the projects Chef builds: one folder per feature, typed edges in shared/, import boundaries enforced in CI.

`compose.yaml` runs the whole app: Chef starts it in each branch's sandbox, so every branch has its own running app. Where it runs in production is up to you; `npm run deploy` puts it on Cloudflare Workers.

Pages are built with the UI kit in `shared/ui.ts` (guide in `shared/ui.md`): `page()`, `html` and `icon()` give every page a polished look in light and dark mode with no packages, fonts or CDNs.

Feature tests run with `node --test`. Page-level tests use `openPage` from `app/browser.ts`, which loads a route in headless Chromium and serves every request from the app in memory.

Keys and settings for outside services are set per project in Chef and reach routes as strings in `context.env`. Their values never go in the code; tests pass fake ones with `createApp(features, store, { NAME: "test" })` or `openPage(features, path, store, { NAME: "test" })`.
