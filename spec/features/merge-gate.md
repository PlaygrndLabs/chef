---
id: merge-gate
title: Merge gate
status: building
entrypoint: Orchestrator.gate
acceptance:
  - id: AC1
    text: The gate requires typecheck, lint, tests, generated files, spec lint, write scope, a passing review and stored proof
  - id: AC2
    text: Merges run one at a time and a session is requeued when main moved under it
  - id: AC3
    text: Only the gate writes canonical main
---

The proof is a real run of the feature's flow against its preview, stored under `refs/notes/chef-proof`.
