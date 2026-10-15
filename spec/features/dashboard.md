---
id: dashboard
title: Live dashboard
status: building
entrypoint: GET /
acceptance:
  - id: AC1
    text: The dashboard lists features, sessions, states, commits and each branch's running app
  - id: AC2
    text: Events arrive live over the project WebSocket and replay on connect
  - id: AC3
    text: Stuck sessions are shown with their last feedback
  - id: AC4
    text: A first visit shows what Chef does in three steps with example requests
  - id: AC5
    text: The feature list lists main, with its running app, and every feature from main's spec and live sessions with a plain status, child features under their parent and working ones first
  - id: AC6
    text: Opening a feature adds a tab that opens on its running app, with its messages, changes, checks and details one click away
  - id: AC7
    text: A person can stop a build, try a stuck one again with a hint, add a note to a running one and start over
  - id: AC8
    text: A feature tab shows the diff against main, and under Details the repository, commits with turn notes, sandbox and budget
  - id: AC9
    text: The project chat on the right is the only place a person asks for work, and shows how much of its memory is in use
---

Served from the Chef Worker's assets, built from `apps/dashboard` with Vite, Tailwind and shadcn/ui. The project page has three plain panes: the feature list on the left, the features opened as tabs in the middle, and the project chat on the right. Each tab opens on the feature's running app; its messages, changes, checks and details sit one click away. The chat is the CopilotKit stream in [session-stream](session-stream.md).

Read and control routes on the project:

- `GET spec` returns main's commit and its features.
- `GET sessions/:id` returns the record and the budget; `turns`, `changes` and `sandbox` return the commits with their notes, the diff against main, and the container state.
- `POST sessions/:id/drop`, `retry` with `{ guidance }` and `steer` with `{ message }`. Steering notes reach the next coder turn only.
