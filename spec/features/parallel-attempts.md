---
id: parallel-attempts
title: Parallel attempts picked by the reviewer
status: building
entrypoint: Orchestrator.submit
acceptance:
  - id: AC1
    text: A prompt with N attempts starts N sessions, each with its own fork and sandbox
  - id: AC2
    text: When every live attempt reaches the gate, each attempt's code runs against all attempts' tests and the reviewer picks one
  - id: AC3
    text: Only the picked attempt is gated and merged; the others end dropped
---

The benchmark in `cli/src/bench` measures revert rates with and without attempts and test locking.
