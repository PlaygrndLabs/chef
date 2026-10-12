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
  - id: AC4
    text: A first visit shows what chef does in three steps with example requests
  - id: AC5
    text: The sidebar lists features from main's spec and live sessions with a plain status, the ones that need a person first
  - id: AC6
    text: A feature page shows five plain steps and updates, with technical detail behind a Details toggle
  - id: AC7
    text: A person can stop a build, try a stuck one again with a hint, add a note to a running one and start over
  - id: AC8
    text: An on-demand panel shows the preview, the diff against main, and the repository, commits with turn notes, sandbox and budget
---

Served from the chef Worker's assets, built from `apps/dashboard` with Vite, Tailwind and shadcn/ui. The layout is chat first so a new person can start at once: a plain list of features on the left and the chat in the middle. Opening a feature shows its progress; the preview and the technical detail open in a side panel only when asked for. The chat is the CopilotKit stream in [session-stream](session-stream.md).

Read and control routes on the project:

- `GET spec` returns main's commit and its features.
- `GET sessions/:id` returns the record and the budget; `turns`, `changes` and `sandbox` return the commits with their notes, the diff against main, and the container state.
- `POST sessions/:id/drop`, `retry` with `{ guidance }` and `steer` with `{ message }`. Steering notes reach the next coder turn only.
