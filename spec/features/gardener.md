---
id: gardener
title: Gardener for the feature map and learned lint rules
status: building
entrypoint: Orchestrator.gate
acceptance:
  - id: AC1
    text: Before each merge the gardener marks the feature merged, adds spec entries for feature folders without one and condenses the session into memory/features
  - id: AC2
    text: After each merge main fails the feature-map check when a feature folder and the spec disagree
  - id: AC3
    text: A line removed by corrections in at least three sessions becomes a rule in lint/rules when no accepted code or file on main matches it
  - id: AC4
    text: A coder turn that breaks a project lint rule is rejected before commit, and the gate fails any file that breaks one
---

Corrections are kept in the project's store; rules carry the ids of the corrections they came from.
