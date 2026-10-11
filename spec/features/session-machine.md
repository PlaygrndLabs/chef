---
id: session-machine
title: Session state machine and budgets
status: merged
entrypoint: POST /api/projects/:name/prompts
acceptance:
  - id: AC1
    text: A session moves queued, planning, testing, coding, reviewing, gating, then merged or stuck
  - id: AC2
    text: A session that exhausts its attempt, token or time budget becomes stuck and blocks no other session
---

Each session is a Durable Object with its own fork. Feedback from a failed gate or rejected turn becomes the next work item.
