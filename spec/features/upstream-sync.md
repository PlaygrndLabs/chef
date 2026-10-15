---
id: upstream-sync
title: Continuous upstream sync
status: building
entrypoint: cf.artifacts.repo.pushed
acceptance:
  - id: AC1
    text: Every push to canonical main is merged into every active fork between agent turns
  - id: AC2
    text: Pushes to forks do not trigger a sync
  - id: AC3
    text: A merge conflict becomes a work item for the owning session
---

A Workflow receives push events and asks the project agent to sync.
