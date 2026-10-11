# kargah

A human-free, spec-driven software builder on Cloudflare: each feature = one agent session = one folder = one branch = one live preview.

- Concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77
- Status: design only; no code yet.

## Layout

```
kargah/
  spec/        feature map and acceptance criteria for each feature
  apps/        dashboard (watch sessions, commits, previews)
  workers/     router, session Durable Objects, merge gate
  agents/      specialist agent profiles (planner, frontend, backend, test, reviewer, gardener)
  template/    agent-friendly template for the projects kargah builds
  cli/         tools that run the app and collect proof
```
