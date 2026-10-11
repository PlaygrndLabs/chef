# Phase 5 progress

Date: 2026-10-11. Branch `claude/kargah-build-t66ame`.

## Voice front end

### Built

- **GPT-Live adapter** (`adapters/src/gpt-live.ts`). `GptLiveHost` exchanges a browser's WebRTC offer for a `gpt-live-1` session with client delegation (`POST /v1/live/sessions`) and attaches a sideband WebSocket to `/v1/live/sessions/{id}/attach`. `startServerSession` runs a server-side audio session over WebSocket (PCM 24 kHz, `session.start`, `session.input_audio.append`). `speak` synthesizes a request with OpenAI text to speech as raw PCM.
- **Spoken requests use the same router.** GPT-Live decides when the user asked for something and sends `session.delegation.created`. `VoiceDelegate` in `core/src/voice/delegate.ts` takes the transcript up to that point and calls `Orchestrator.submitSpoken`, which routes it like a typed prompt and records a `voice.request` event. It then answers with `session.commentary.append`; GPT-Live speaks the result in the user's language. GPT-Live never writes the spec and never picks a feature.
- **Worker route.** `POST /api/projects/:name/voice` takes `{ sdp }`, creates the session with the project's feature list in its instructions, keeps the sideband connection in `ProjectAgent`, and schedules the build like a typed prompt. The OpenAI key stays in the Worker.
- **Dashboard.** It has a Talk button (microphone over WebRTC, `oai-events` data channel), a live transcript, and the list of spoken requests with the feature each one started.
- **CLI.** `kargah voice --say "<request>"` runs the whole path with real checks. By default the transcript is scripted. With `--live`, the request is synthesized and spoken to a real GPT-Live session. The `live` GitHub Actions workflow runs that with the `OPENAI_API_KEY` repository secret.

### Evidence so far

`node --import tsx cli/src/bin.ts voice --say "Add an item to a to-do list."` (scripted voice, real `tsc`, tests, lint and proof):

```
"heard": "Add an item to a to-do list.",
"intent": "new_feature",
"featureId": "todo-add",
"reply": "Started a new feature, todo-add. It merges on its own once tests, review and proof pass; the dashboard shows its preview.",
"state": "merged",
"humanActions": 0
```

Tests:
- `core/test/e2e/voice.test.ts`: a spoken request ships a feature and a spoken question is answered from memory. It also covers an empty transcript, and speech after the delegation point being kept for the next request.
- `adapters/test/unit/gpt-live.test.ts`: the session request body, the sideband URL and auth header, event parsing and graceful close, the server-side `session.start` and audio chunking, early errors, and speech synthesis.
- `cli/test/e2e/voice.test.ts`: the CLI path with real checks.
- `apps/dashboard/test/unit/state.test.ts`: the transcript and the voice requests.

Not yet done: the definition of done asks for a spoken request, so the scripted run above does not count. It needs `OPENAI_API_KEY` as a repository secret for the `live` workflow, or as a Worker secret for the dashboard.

## Learning

In progress: export of merged and reverted sessions as training examples, and one tuned profile compared with its base on held-out benchmark items.
