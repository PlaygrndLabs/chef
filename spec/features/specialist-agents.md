---
id: specialist-agents
title: Specialist agents with locked, failing-first tests
status: building
entrypoint: Orchestrator.coderTurn
acceptance:
  - id: AC1
    text: Each profile in agents/ runs as a Copilot custom agent named kargah-<role> with its write scope
  - id: AC2
    text: A coder turn that changes a test written by the test role is rejected, and the gate fails any commit that did
  - id: AC3
    text: New tests that pass against an empty stub of the feature are rejected before they are committed
  - id: AC4
    text: The review check fails when the reviewer's model wrote code in the session
---

Roles are read from the git note on each commit, so the rules hold for commits made outside the orchestrator too.
