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
Implement the feature's UI inside `features/{feature}/`. Keep markup accessible and drive it through the flow in `flow.ts`. Import other code only from `shared/`. Do not write comments.

Make every page look like a polished, modern product, not a bare HTML form. Read `shared/ui.md` first and build each page with `page()`, `html` and `icon()` from `shared/ui.ts` and its classes: a `page-header`, content in a `card`, `list` or `table`, one primary button, icons on buttons, an empty state, loading and error states, and one `accent` color that fits the app. Keep the button names, labels and text the tests look for. Do not load fonts, CSS frameworks or scripts from other sites. If the project has no `shared/ui.ts`, follow the look of its existing pages.
