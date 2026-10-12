---
id: voice-front-end
title: Voice front end on GPT-Live
status: building
entrypoint: POST /api/projects/:name/voice
acceptance:
  - id: AC1
    text: The browser's WebRTC offer is exchanged for a GPT-Live session with client delegation, and the OpenAI key stays in the Worker
  - id: AC2
    text: A delegated request is routed through the same router as a typed prompt, using the user's transcript up to the delegation point
  - id: AC3
    text: The result is spoken back through session.commentary.append, and the request appears on the dashboard
  - id: AC4
    text: A request heard as empty is answered with a request to repeat it, and starts no session
---

`chef voice` runs the same path from the CLI, scripted or live.
