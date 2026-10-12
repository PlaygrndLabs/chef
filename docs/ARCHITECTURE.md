# Architecture

kargah turns a prompt or a spec entry into a merged feature with no human step. The spec is the memory, git is the state, and chat is only input.

## Packages

| Package | Role |
| --- | --- |
| `core` | Spec format and lint, router, session state machine, orchestrator, merge, ports and their in-memory fakes, code rules. No I/O. |
| `adapters` | Real implementations of the ports: Artifacts over isomorphic-git, Jev classifier, Claude planner and reviewer, Workers Builds previews, and `KargahAgent`, the AG-UI agent CopilotKit streams sessions through. |
| `workers` | The kargah Worker: `ProjectAgent` and `SessionAgent` Durable Objects, the coder sandbox, the `upstream-sync` Workflow, the HTTP API. |
| `template` | The vertical-slice template every project kargah builds starts from, with its own `app` CLI (`gen`, `drive`, `proof`). |
| `cli` | `kargah` CLI: spec lint, code rules, routing, the local demo with real checks, the Jev spike, and `kargah serve`, the dashboard and CopilotKit runtime on the local world. |
| `apps/dashboard` | Dashboard served by the kargah Worker: a CopilotKit chat (React, built with Vite into `dist/`) that streams sessions, next to the event panels. |
| `agents` | Specialist profiles with write scopes. |

## Ports

Every external service sits behind a small interface in `core/src/ports` with a fake in `core/src/fakes`:

| Port | Fake | Real adapter |
| --- | --- | --- |
| `RepoHost` | `MemoryRepoHost` | `ArtifactsRepoHost` (`adapters/src/artifacts.ts`) |
| `Coder` | `ScriptedCoder` | `SandboxCoder` (`workers/src/sandbox-coder.ts`) |
| `Classifier` | `KeywordClassifier` | `JevClassifier` (`adapters/src/jev.ts`) |
| `Planner` | `TemplatePlanner` | `LlmPlanner` (`adapters/src/llm-planner.ts`) |
| `Reviewer` | `RuleReviewer` | `LlmReviewer` (`adapters/src/llm-reviewer.ts`), or `WorkersAiReviewer` (`adapters/src/workers-ai-reviewer.ts`, a tuned LoRA on Workers AI) when `REVIEWER_LORA` is set |
| `PreviewHost` | `MemoryPreviewHost` | `WorkersBuildsPreviewHost` (`adapters/src/workers-previews.ts`) |
| `CheckRunner`, `ProofRunner` | `FakeCheckRunner`, `FakeProofRunner` | `LocalCheckRunner` and `LocalProofRunner` (`cli/src/local`), `SandboxCheckRunner` and `SandboxProofRunner` (`workers/src/sandbox-checks.ts`) |
| `VoiceHost` | `ScriptedVoiceHost` | `GptLiveHost` (`adapters/src/gpt-live.ts`, GPT-Live `gpt-live-1`) |
| `MemoryIndex` | `LexicalIndex` (TF-IDF) | `VectorizeIndex` (`adapters/src/vectorize.ts`, Vectorize plus Workers AI `@cf/baai/bge-base-en-v1.5`) |
| `EventBus`, `KeyValueStore`, `Clock`, `IdSource` | memory versions | `DurableEventBus`, `DurableStore` in `workers/src` |

The planner and reviewer call Claude through `adapters/src/anthropic.ts` with structured output validated by zod. `llmFromEnv` picks the endpoint: CPA (CLIProxyAPI with a Claude subscription login, `CPA_BASE_URL` and `CPA_API_KEY`) when it is configured, otherwise the Anthropic API with `ANTHROPIC_API_KEY`. Only the direct API path opts into server-side model fallbacks; CPA does not pass beta headers. The local CPA setup is in `dev/cpa`.

## Flow of one prompt

1. **Route** (`core/src/router/router.ts`). Rules first (`/new`, `@feature` mentions, English questions). Then Jev answers three typed choice questions (intent, feature, change kind); its answer is used only above per-action confidence thresholds. Otherwise the planner triages.
2. **Plan**. The planner returns the feature spec and work items. Existing acceptance criteria are never dropped, and a spec change is always the first item.
3. **Session**. The orchestrator forks canonical `main` into `<project>--<feature>--<session>` and drives the state machine in `core/src/session/machine.ts`:
   `queued → planning → testing → coding → reviewing → gating → merged | stuck | dropped`.
   A prompt can start several attempts. Each attempt is its own session with its own fork and its own preview branch `preview/<feature>--<session>` until it wins.
4. **Turns**. Each coder turn runs one work item under one profile. Its changed files become one commit on the fork with a note under `refs/notes/kargah` (prompt, root prompt, run id, model, role, spec revision, paths). A turn is rejected before it is committed, and the reason fed back, when it writes outside its role's scope, when a non-test role changes a test the test role wrote (locked tests), when a test turn adds tests that pass against an empty stub of the feature (red check, using per-test results from node's TAP output), or when it breaks a project lint rule in `lint/rules/` (project-lint). Before each turn the orchestrator recalls up to three memory documents, lessons and feature memories of the same feature first, and appends them to the prompt. Each profile runs in the Claude Agent SDK as a subagent named `kargah-<role>`; the profile model `coder-default` resolves to `CODER_MODEL`.
5. **Preview**. After each commit, `PreviewPublisher` pushes the fork head to `preview/<feature>` on the canonical repo, and the preview host reads the deployed URL back.
6. **Review**. The reviewer compares the diff from the session's base to its head against the spec. When every live attempt of a prompt has reached the gate, each attempt's code runs against the tests of all attempts and the reviewer picks one; the others are `dropped`.
7. **Gate** (`Orchestrator.gate`). Sync from `main`, then typecheck, lint (no comments, import boundaries), tests, generated files, spec lint, write scope of every commit by the role in its note, no coder commit touching a locked test, a reviewer approval from a model that wrote no code in the session of the current head, and a proof: the feature's flow driven against its preview, stored under `refs/notes/kargah-proof`. Merges run one at a time through a mutex; if `main` moved, the session syncs and is gated again.
8. **Merge**. A gardener commit sets the feature's status to `merged`, adds spec entries for feature folders that have none, condenses the session into `memory/features/<id>.md`, and writes any lint rule mined from corrections. Then `MainWriter.mergeFork` merges the fork into `main`. Only the gate holds `MainWriter`.

A prompt routed as a question starts no session: it is answered from the memory index, by the planner when it has an `answer` method, and the answer lists the files it used.

A failed gate or rejected review sends the session back to coding with the failure log. Budgets on attempts, tokens and time turn a session `stuck`; a stuck session blocks no other session.

## Isolation

- Artifacts tokens are per repo, so each session has its own fork. The orchestrator holds the fork's write token; the coder receives a read token only.
- The coder runs in a Cloudflare Sandbox whose only network path is `SandboxOutbound`: it adds the read token for Artifacts, swaps a placeholder for `CPA_API_KEY` on the CPA gateway's host, blocks `git-receive-pack`, and refuses other hosts. The sandbox returns changed files as data; it never commits or pushes.
- Capabilities are separate objects (`core/src/orchestrator/capabilities.ts`): `PreviewPublisher` can only push `preview/*`, `MainWriter` can only merge or revert `main`.

## Merging and sync

- `threeWayMerge` in `core/src/git/tree.ts` merges trees line by line. Generated files such as `src/registry.gen.ts` are never merged; resolvers regenerate them from the merged tree.
- A push to canonical `main` emits `cf.artifacts.repo.pushed`, which starts the `upstream-sync` Workflow. It ignores forks and non-`main` refs and tells `ProjectAgent`, which marks every active session for sync. Sync runs between turns: a session that is mid-turn is synced when the turn ends.
- A conflicting sync is still committed: the fork gets a two-parent merge commit with hunk-level conflict markers, and the session gets a conflict work item, using the conflict-resolver profile when one exists. Since both parents are recorded, later syncs and the gate do not recompute the same conflict.
- After every merge the gate runs the checks on `main`. If they fail, the merge is reverted and the session reopens on its restored work with the failure log. `revertMerge` does the same for a failure reported later: it undoes only that merge when later merges allow it, and otherwise returns `main` to before it and reopens every session merged since, without charging their attempt budgets.

## Memory

The project repo is the memory; the index is a cache of it.

| Kind | Where | Written by |
| --- | --- | --- |
| Project memory | `memory/**/*.md` with `kind` and `feature` frontmatter, and the spec | the gardener and the gate, through commits on `main` |
| Lessons | `memory/lessons/<feature>-<commit>.md`: the failing checks, the acceptance criteria and the prompts behind a reverted merge | the revert commit itself |
| Feature memory | `memory/features/<id>.md`: one section per session (parent session, prompt, turns, corrections) | the gardener commit before each merge |
| Learned lint rules | `lint/rules/<id>.json` (`files` glob, `forbid` line regex, evidence) | the gardener, from corrections |
| Session memory | the session record (`history` of feedback, `parent`) and pending corrections, in the Durable Object's SQLite | the orchestrator |
| Episodic memory | commits and their notes under `refs/notes/kargah` | every turn |

After bootstrap, every merge and every revert, `syncMemory` compares content hashes of the memory documents on `main` with the last indexed set and upserts or removes only what changed. Sessions on the same feature form a tree: a new session's `parent` is the previous live session of its feature.

A correction is a rejected or failed turn followed by the turn that was accepted. For red-test corrections the candidate lines are the bodies of the tests that passed against the stub; for others, the lines the accepted turn removed. Literals are generalized. A line becomes a rule when corrections from at least three sessions share it, no accepted turn and no file on `main` matches it, and no rule already forbids it. Turns rejected by a learned rule do not produce new rules. `checkTree` also enforces the rules, so the gate fails on any match.

`verifyMain` adds a `feature-map` check after every merge: every `features/<id>/index.ts` has a spec entry and every merged spec entry has its folder.

The Worker binds the index as `MEMORY` (index `kargah-memory`, 768 dimensions, cosine) and Workers AI as `AI`. Queries filter on the `project` and `kind` metadata fields, which need metadata indexes created before any vector is inserted:

```
npx wrangler vectorize create kargah-memory --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index kargah-memory --property-name=project --type=string
npx wrangler vectorize create-metadata-index kargah-memory --property-name=kind --type=string
```

## Voice

The voice front end hands spoken requests to the same router as typed prompts; GPT-Live only listens and speaks.

1. The dashboard's Talk button opens a WebRTC connection with the microphone and an `oai-events` data channel, and posts its SDP offer to `POST /api/projects/:name/voice`.
2. `ProjectAgent` creates the GPT-Live session with `POST https://api.openai.com/v1/live/sessions` (`gpt-live-1`, client delegation, instructions listing the project's features), returns the SDP answer to the browser, and attaches a sideband WebSocket to `/v1/live/sessions/{id}/attach`. The OpenAI key never leaves the Worker.
3. GPT-Live decides when the user asked for something and sends `session.delegation.created`. `VoiceDelegate` (`core/src/voice/delegate.ts`) takes the user's transcript up to the delegation point, calls `Orchestrator.submitSpoken`, which routes it like a typed prompt and emits `voice.request`, and answers with `session.commentary.append`, which GPT-Live speaks in the user's language.
4. From there the session runs as any other; the dashboard shows the transcript and the spoken requests.

`kargah voice --say "<request>"` runs the same path locally: scripted transcripts by default, or with `--live` the request is synthesized with OpenAI text to speech and streamed to a server-side GPT-Live session over WebSocket.

## Streaming to the app

Sessions reach the app through CopilotKit. The kargah Worker hosts the CopilotKit runtime at `/api/projects/:name/copilotkit` (`workers/src/copilotkit.ts`) with one agent, `default`, a `KargahAgent` (`adapters/src/agui.ts`):

1. The dashboard's CopilotKit chat sends the user's message to the runtime, which runs `KargahAgent` and streams its AG-UI events back over SSE.
2. `KargahAgent` reads the project's event cursor, submits the prompt to `ProjectAgent`, answers with the route it took, and then follows the project's events from that cursor.
3. `SessionStream` maps each kargah event of the sessions the prompt started to AG-UI: coder text deltas become assistant messages, coder tool calls become tool calls, every state change is a step (`<session>:<state>`), and the preview, review, gate, merge and stuck results update a shared state snapshot (`KargahState`) that the chat renders as session cards.
4. The run ends with a summary line when every session has merged, got stuck or been dropped.

`kargah serve` runs the same runtime and dashboard on the Mac against the local world (fake coder, real or fake checks).

## Learning

Every session leaves a labelled record: the change the reviewer approved, and what happened to it afterwards.

1. `review.verdict` events carry the reviewed head and base commits. `reviewPoints` (`core/src/learning/export.ts`) follows each approved review to its outcome: `gate-failed` when the merge gate failed, `reverted` when the merge was later reverted from main, and `merged` otherwise.
2. `exportOutcomes` turns each point into a reviewer example: the spec's acceptance criteria and the feature's files (`reviewMessages` in `core/src/learning/review-prompt.ts`), with `approve` as the target for merged changes and `reject: <why>` for the others. Each coder turn (its prompt and its changes, from the commit's note) is labelled positive or negative by the review it led to.
3. `kargah tune data` runs the benchmark's 20 training features and 10 held-out features in separate projects with real checks and writes `tune/data/{train,heldout}.jsonl`, the coder turns, and each run's benchmark report.
4. `tune/train.py` trains a LoRA (rank 8 on the attention projections) on Gemma 2B, the base Workers AI serves for LoRA adapters, and compares it with the base model on the held-out examples. It writes the adapter with `model_type: gemma`, which Workers AI requires.
5. In production the adapter is uploaded with `npx wrangler ai finetune create @cf/google/gemma-2b-it-lora kargah-reviewer <adapter dir>` and turned on with the `REVIEWER_LORA` var. `WorkersAiReviewer` then reviews with `env.AI.run(model, { prompt, raw: true, lora })` and leaves picking between parallel attempts to the Claude reviewer.

## Template

Projects kargah builds use Dune-style vertical slices:

```
features/<id>/index.ts       routes for the feature
features/<id>/<id>.test.ts   node:test tests, one per acceptance criterion
features/<id>/flow.ts        the user flow the proof drives
shared/                      http, storage and flow contracts
src/registry.gen.ts          generated from features/
src/index.ts                 the Worker entry
spec/features/<id>.md        the feature's spec
```

Code rules (`core/src/checks/code-rules.ts`) parse the TypeScript AST: no comments except tool directives; a feature may not import another feature; `shared/` may not import features; the app shell imports only `features/<id>/index.ts`.

## HTTP API

Served by the kargah Worker (`workers/src/index.ts`):

| Method and path | Effect |
| --- | --- |
| `POST /api/projects/:name/bootstrap` | Creates the canonical repo from the template if it does not exist |
| `POST /api/projects/:name/voice` | Exchanges a WebRTC `{ sdp }` offer for a voice session that delegates spoken requests to the router: GPT-Live with `OPENAI_API_KEY`, otherwise the Realtime API through the CPA gateway, where a `kargah_request` tool call stands in for client delegation |
| `POST /api/projects/:name/prompts` | Routes `{ prompt }` and starts a session when there is work; a question returns `answer` with its sources |
| `GET /api/projects/:name/sessions` | Session records |
| `GET /api/projects/:name/events?after=<seq>` | Stored events after a sequence number |
| `GET /api/projects/:name/cursor` | The last event sequence number |
| `POST /api/projects/:name/copilotkit/*` | The CopilotKit runtime; `agent/default/run` streams a prompt's sessions as AG-UI events |
| `WS /agents/project-agent/:name` | Live events, replayed from the start on connect |
