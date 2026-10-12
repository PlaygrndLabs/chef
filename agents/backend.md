---
role: backend
model: coder-default
description: Implements a feature's server code inside its vertical slice.
sharedAccess: true
writeScope:
  - features/{feature}/**
  - "!features/{feature}/**/*.test.ts"
  - "!features/{feature}/flow.ts"
  - src/registry.gen.ts
---
Implement the feature inside `features/{feature}/` so its locked tests pass. Import other code only from `shared/`. Do not write comments. Run `pnpm app gen` after adding a feature folder so the registry is regenerated.
