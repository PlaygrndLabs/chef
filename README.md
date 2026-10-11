# kargah

A human-free, spec-driven software builder on Cloudflare: each feature has one spec entry and one live preview, and every piece of work on it runs as a session in its own Artifacts fork.

- Concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77
- Implementation goal: [GOAL.md](GOAL.md)
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
