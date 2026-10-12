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
    text: The sidebar is a feature map tree from main's spec and live sessions, with each node's state
  - id: AC5
    text: A person can drop a session, retry a stuck one with guidance, steer a running one and start a new attempt
  - id: AC6
    text: The inspector shows a session's preview, its diff against main, its Artifacts repos and commits with turn notes, its sandbox and its budget
---

Served from the kargah Worker's assets, built from `apps/dashboard` with Vite, Tailwind and shadcn/ui. The layout follows a coding agent workspace: the feature map on the left, the chat in the middle (project chat, a feature, or one session's timeline), and the inspector on the right. The chat is the CopilotKit stream in [session-stream](session-stream.md).

Read and control routes on the project:

- `GET spec` returns main's commit and its features.
- `GET sessions/:id` returns the record and the budget; `turns`, `changes` and `sandbox` return the commits with their notes, the diff against main, and the container state.
- `POST sessions/:id/drop`, `retry` with `{ guidance }` and `steer` with `{ message }`. Steering notes reach the next coder turn only.
