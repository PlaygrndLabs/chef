---
id: session-stream
title: Sessions streamed to the app with CopilotKit
status: building
entrypoint: POST /api/projects/:name/copilotkit/agent/default/run
acceptance:
  - id: AC1
    text: A chat message is routed like a typed prompt and the reply says which feature and how many attempts it started
  - id: AC2
    text: Every session the message started streams as AG-UI events, coder text as messages, coder tools as tool calls and each state as a step
  - id: AC3
    text: The shared state carries each session's preview, review, gate, merge commit and stuck reason, and the dashboard renders it as session cards
  - id: AC4
    text: The run finishes with a summary once every session has merged, got stuck or been dropped
  - id: AC5
    text: The same runtime serves the dashboard on the Worker and from kargah serve on a local machine
---

The runtime is CopilotKit's; the agent is `KargahAgent` in `adapters/src/agui.ts`. Tests: `cli/test/e2e/copilotkit.test.ts` and the browser run in `cli/test/e2e/dashboard.test.ts`.
