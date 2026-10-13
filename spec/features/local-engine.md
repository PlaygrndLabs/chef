---
id: local-engine
title: Run chef fully on this computer
status: building
entrypoint: LocalEngine
acceptance:
  - id: AC1
    text: pnpm start --local runs the dashboard and the whole engine on this computer, needing only Docker and a model key, with no Cloudflare account
  - id: AC2
    text: Project repos, the event log, sessions, settings and memory are kept on disk and survive a restart, and unfinished sessions carry on after it
  - id: AC3
    text: The coder, the checks, each feature's preview and its proof run in Docker containers that read the project repos without write access
  - id: AC4
    text: Previews start when opened, stop after they sit idle and are rebuilt on the next visit
  - id: AC5
    text: The dashboard shows that chef runs on this computer, needs no password and no Cloudflare account, and points GitHub links to a repository address with a token
---

Work pauses while the computer sleeps. Connect GitHub needs chef in Cloudflare, because GitHub must reach it.
