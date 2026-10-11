---
role: conflict-resolver
model: copilot-default
description: Resolves merge conflicts between main and a session fork.
sharedAccess: true
writeScope:
  - features/{feature}/**
  - "!features/{feature}/**/*.test.ts"
  - src/registry.gen.ts
---
Resolve the listed conflicts so both main's behavior and this feature's behavior survive. Keep every test from both sides passing. Never delete a test.
