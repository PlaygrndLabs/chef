# template

Agent-friendly template for the projects Chef builds: a React app on Cloudflare Workers, one folder per feature, typed edges in shared/, import boundaries enforced in CI.

Each feature lives in `features/<id>/`: its JSON routes under `/api` in `index.ts`, its React pages in `pages.tsx`, its tests and its `flow.ts`. The Worker (`src/index.ts`) answers the routes and keeps data in a Durable Object; every other page address gets a small HTML shell that loads the React client, which `npm run build` bundles from every feature's `pages.tsx` into `dist/client/`, served as static assets. Moving between pages happens in the browser, so the app never reloads.

`npm run dev` runs the whole app with `wrangler dev`, building the client first; that is how Chef runs it in each branch's sandbox, with no Docker. `npm run deploy` puts it on Cloudflare Workers.

Pages are built with the UI kit in `shared/ui.tsx` (guide in `shared/ui.md`): `Icon`, `api`, `useLoad`, `ErrorText` and the kit's classes give every page a polished look in light and dark mode with no fonts, CSS frameworks or CDNs.

Feature tests run with `node --test`. Each test makes its app with `testApp(t, features)` from `app/testing.ts`, which gives that test its own empty store: `app.fetch(path, init)` calls a route, `app.store` holds the test's data, and `app.open(path)` loads the React page in headless Chromium, serving every request from the same app in memory. Each step waits at most five seconds (`STEP_TIMEOUT_MS`), so a test against a page that is not built yet fails fast.

Keys and settings for outside services are set per project in Chef and reach routes as strings in `context.env`. Their values never go in the code; tests pass fake ones with `testApp(t, features, { NAME: "test" })`.
