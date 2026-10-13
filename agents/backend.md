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

When the feature serves a page, make it look polished: read `shared/ui.md` and build the page with `page()`, `html` and `icon()` from `shared/ui.ts` and its classes, never as bare unstyled HTML. If the project has no `shared/ui.ts`, follow the look of its existing pages.
