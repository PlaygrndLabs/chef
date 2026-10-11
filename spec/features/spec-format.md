---
id: spec-format
title: Spec format and spec lint
status: merged
entrypoint: kargah spec lint [dir]
acceptance:
  - id: AC1
    text: Each feature file has typed frontmatter (id, title, status, entrypoint, acceptance) validated by a schema
  - id: AC2
    text: spec lint fails when an id differs from its file name, ids or acceptance ids repeat, or the body is empty
---

The spec is the memory. Every feature is one file under `spec/features/<id>.md`, read by the router, the planner, the reviewer and the gate.
