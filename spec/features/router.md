---
id: router
title: Prompt router
status: building
entrypoint: chef route <prompt> [--spec dir]
acceptance:
  - id: AC1
    text: Rules decide explicit commands and feature mentions without calling a model
  - id: AC2
    text: The classifier answers typed choice questions and its answer is accepted only above the per-action confidence threshold
  - id: AC3
    text: Low confidence or a new feature goes to the planner, which returns a structured decision
---

Three tiers: rules, then Jev through `@typesafe-ai/sdk`, then the planner. Jev never writes text.
