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
