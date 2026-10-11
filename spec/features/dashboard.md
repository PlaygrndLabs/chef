---
id: dashboard
title: Live dashboard
status: building
entrypoint: GET /
acceptance:
  - id: AC1
    text: The dashboard lists features, sessions, states, commits and preview URLs
  - id: AC2
    text: Events arrive live over the project WebSocket and replay on connect
  - id: AC3
    text: Stuck sessions are shown with their last feedback
---

A single static page served from the kargah Worker's assets.
