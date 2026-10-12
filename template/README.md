# template

Agent-friendly template for the projects chef builds: one folder per feature, typed edges in shared/, import boundaries enforced in CI.

Feature tests run with `node --test`. Page-level tests use `openPage` from `app/browser.ts`, which loads a route in headless Chromium and serves every request from the app in memory.
