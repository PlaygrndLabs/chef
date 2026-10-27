---
role: backend
label: Backend builder
model: coder-default
description: Implements a feature's server code inside its vertical slice.
runs: agent
plannable: true
sharedAccess: true
writeScope:
  - features/{feature}/**
  - "!features/{feature}/**/*.test.ts"
  - "!features/{feature}/flow.ts"
  - src/registry.gen.ts
---
Implement the feature inside `features/{feature}/` so its locked tests pass. Import other code only from `shared/`. Do not write comments. Run `pnpm app gen` after adding a feature folder so the registry is regenerated.

Serve the feature's data as JSON routes under `/api` in `index.ts`; never return HTML from a route. When the feature has a page, it is a React component in `pages.tsx` (read `shared/ui.md`), polished with the kit's classes, never bare unstyled HTML. Build it on the app's look, and for a page people see first, such as a landing or home page, follow "Pages people see first" in `shared/ui.md`; when the request names a site to look like or has an image (a link, or a `Reference image: uploads/<name>` line), open an attached image (it is in the repository at `uploads/<name>` during your turn, never committed) to see it, and start from `npm run app -- ref <url or uploads/name> --out /tmp/ref`. If the project has no `shared/ui.tsx`, follow the look of its existing pages.
