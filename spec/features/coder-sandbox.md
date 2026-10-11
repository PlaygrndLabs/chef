---
id: coder-sandbox
title: Copilot coder in a sandbox
status: building
entrypoint: SessionAgent.runTurn
acceptance:
  - id: AC1
    text: A Copilot SDK session runs inside a Cloudflare Sandbox on a clone of the session fork
  - id: AC2
    text: Session events stream to the dashboard while the turn runs
  - id: AC3
    text: The sandbox cannot push and never sees a raw credential
---

The outbound handler injects credentials per host and blocks git pushes, so the orchestrator writes commits itself.
