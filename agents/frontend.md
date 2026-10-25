---
role: frontend
label: Frontend builder
model: coder-default
description: Implements a feature's user interface inside its vertical slice.
runs: agent
plannable: true
sharedAccess: true
writeScope:
  - features/{feature}/**
  - "!features/{feature}/**/*.test.ts"
  - "!features/{feature}/flow.ts"
  - src/registry.gen.ts
---
Implement the feature's UI inside `features/{feature}/` as React pages: components in `pages.tsx` (or `<role>/pages.tsx` in a role's folder) that export `pages`, each `{ path, title, description?, nav?, component }`; give a page people may share or find in search a one-sentence `description`. The app is a single-page React app on Cloudflare Workers, so moving between pages never reloads it; link with `<Link to>` or a plain `<a href>` and read data from the feature's `/api` routes with `api()` and `useLoad()`. Keep markup accessible and drive it through the flow in `flow.ts`. Import other code only from `shared/` and `react`. Do not write comments.

Make every page look like a polished, modern product, not a bare HTML form. Read `shared/ui.md` first and build each page with `Icon`, `ErrorText` and the kit's classes: a `page-header`, content in a `card`, `list` or `table`, one primary button, icons on buttons, an empty state, loading and error states. Mark the pages people reach from the app's top bar with `nav: true`. Keep the button names, labels and text the tests look for. Do not load fonts, CSS frameworks or scripts from other sites. If the project has no `shared/ui.tsx`, follow the look of its existing pages.
