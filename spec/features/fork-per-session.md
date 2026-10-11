---
id: fork-per-session
title: Fork per session with scoped tokens
status: building
entrypoint: RepoHost.fork
acceptance:
  - id: AC1
    text: Every session works in a fork named project--feature--session
  - id: AC2
    text: The coder only ever receives a token scoped to its own fork, and never one that can write canonical main
---

Artifacts tokens are scoped per repo, so the fork is the isolation boundary.
