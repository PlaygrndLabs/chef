# Phase 5 progress

Date: 2026-10-11.

## Voice front end

### Built

- **GPT-Live adapter** (`adapters/src/gpt-live.ts`). `GptLiveHost` exchanges a browser's WebRTC offer for a `gpt-live-1` session with client delegation (`POST /v1/live/sessions`) and attaches a sideband WebSocket to `/v1/live/sessions/{id}/attach`. `startServerSession` runs a server-side audio session over WebSocket (PCM 24 kHz, `session.start`, `session.input_audio.append`). `speak` synthesizes a request with OpenAI text to speech as raw PCM.
- **Spoken requests use the same router.** GPT-Live decides when the user asked for something and sends `session.delegation.created`. `VoiceDelegate` in `core/src/voice/delegate.ts` takes the transcript up to that point and calls `Orchestrator.submitSpoken`, which routes it like a typed prompt and records a `voice.request` event. It then answers with `session.commentary.append`; GPT-Live speaks the result in the user's language. GPT-Live never writes the spec and never picks a feature.
- **Worker route.** `POST /api/projects/:name/voice` takes `{ sdp }`, creates the session with the project's feature list in its instructions, keeps the sideband connection in `ProjectAgent`, and schedules the build like a typed prompt. The OpenAI key stays in the Worker.
- **Dashboard.** It has a Talk button (microphone over WebRTC, `oai-events` data channel), a live transcript, and the list of spoken requests with the feature each one started.
- **CLI.** `chef voice --say "<request>"` runs the whole path with real checks. By default the transcript is scripted. With `--live`, the request is synthesized and spoken to a real GPT-Live session. The `live` GitHub Actions workflow runs that with the `OPENAI_API_KEY` repository secret.

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

### Built

- **Outcome export** (`core/src/learning`). `review.verdict` now records the reviewed head and base commits. Each approved review is followed to its outcome: `merged`, `reverted` (merged and later reverted from main), or `gate-failed`. It becomes a reviewer example with the spec's acceptance criteria and the feature's files as the prompt, and `approve` or `reject: <why>` as the answer. Each coder turn is exported with its prompt and changes, labelled positive or negative by the review it led to.
- **`chef tune data`** runs 20 training features (the 10 benchmark features plus 10 new ones) and 10 held-out features in separate projects with real checks, and writes `tune/data`.
- **`tune/train.py`** trains a rank 8 LoRA on the attention projections of Gemma 2B (`unsloth/gemma-2b-it`, the same weights as Workers AI's `@cf/google/gemma-2b-it-lora`) on CPU, with loss on the answer only. It scores the base and the tuned model on the held-out examples with greedy decoding and the same first-word parsing the Worker uses.
- **`WorkersAiReviewer`** (`adapters/src/workers-ai-reviewer.ts`) serves an uploaded adapter through `env.AI.run(..., { raw: true, lora })` when `REVIEWER_LORA` is set. It is off by default; see the result below.
- **Bench fix.** The bench measured session time on the fake clock, which advances one second per call across the whole project. With 20 features, three sessions ran out the one-hour time budget after a revert and got stuck. The bench now measures time on the wall clock, and all 30 features merge.

### Data

From `node --import tsx cli/src/bin.ts tune data` (`tune/data/summary.json`):

| Split | Features | Merged features | Review examples | Approve (merged) | Reject (reverted) | Reject (gate failed) | Coder turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| train | 20 | 20/20 | 35 | 20 | 7 | 8 | 55 |
| held-out | 10 | 10/10 | 18 | 10 | 6 | 2 | 28 |

The coding agents are the scripted benchmark agents with injected mistakes, so the bad changes are the benchmark's: a buggy implementation behind weak tests (reverted once the main monitor catches it) or behind good tests (failed at the gate). No held-out feature appears in training.

### Result

Held-out benchmark, 18 reviews (`docs/progress/phase-5-tuning-run-1.json` and `-run-2.json`):

| Profile | Accuracy | Bad changes caught | Good changes approved | Training accuracy |
| --- | --- | --- | --- | --- |
| Base Gemma 2B | 55.6% | 0/8 | 10/10 | n/a |
| LoRA run 1 (3 epochs, lr 2e-4, batch 4) | 50.0% | 6/8 | 3/10 | 45.7% |
| LoRA run 2 (4 epochs, lr 5e-4, batch 1) | 55.6% | 0/8 | 10/10 | 57.1% |

The tuned profile is not better than the base. The base approves every change. Run 1 stopped while the training loss was still 3.0; it moved toward rejecting and rejects most changes, good or bad, and does not separate them even on its own training set. Run 2's settings were chosen on training fit only, never on the held-out set. It reached a training loss of 0.19 by learning the fixed answer texts, and it answers `approve` to every change, including all 15 bad training changes. With 35 examples, the adapter learned the label mix, not how to read the code against the criteria.

Training took 17 and 19 minutes on 4 CPU cores. Scoring 18 reviews took about 2.5 minutes per model.

What would change the result is more varied data, not more epochs: real coding-agent sessions (with Copilot and Cloudflare keys) produce many more reverted and gate-failed changes, with different mistakes. `chef tune data` and `tune/train.py` rerun unchanged on that data. The adapter was not uploaded to Workers AI; that needs the Cloudflare account, and on this result it should stay off.

### Tests

- `core/test/unit/learning.test.ts`: the review prompt, answer parsing, the Gemma prompt format, outcome labelling across gate failures, reverts and re-merges, and JSONL output.
- `core/test/e2e/learning.test.ts`: a reverted then re-merged session exports as one reject and one approve, with its coder turns labelled.
- `adapters/test/unit/workers-ai-reviewer.test.ts`: the Workers AI call, answer parsing, a missing response, and picking left to the Claude reviewer.

## Phase 5 status

- Learning: done by the definition (the tuned profile was compared with the base on held-out features and the result is recorded).
- Voice: done on scripted voice; the live run needs `OPENAI_API_KEY` as a repository secret for the `live` workflow, or as a Worker secret.
