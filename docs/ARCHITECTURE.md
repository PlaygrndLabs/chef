# Architecture

kargah turns a prompt or a spec entry into a merged feature with no human step. The spec is the memory, git is the state, and chat is only input.

## Packages

| Package | Role |
| --- | --- |
| `core` | Spec format and lint, router, session state machine, orchestrator, merge, ports and their in-memory fakes, code rules. No I/O. |
| `adapters` | Real implementations of the ports: Artifacts over isomorphic-git, Jev classifier, Claude planner and reviewer, Workers Builds previews. |
| `workers` | The kargah Worker: `ProjectAgent` and `SessionAgent` Durable Objects, the Copilot sandbox, the `upstream-sync` Workflow, the HTTP API. |
| `template` | The vertical-slice template every project kargah builds starts from, with its own `app` CLI (`gen`, `drive`, `proof`). |
| `cli` | `kargah` CLI: spec lint, code rules, routing, the local demo with real checks, and the Jev spike. |
| `apps/dashboard` | Static dashboard served by the kargah Worker. |
| `agents` | Specialist profiles with write scopes. |

## Ports

Every external service sits behind a small interface in `core/src/ports` with a fake in `core/src/fakes`:

| Port | Fake | Real adapter |
| --- | --- | --- |
| `RepoHost` | `MemoryRepoHost` | `ArtifactsRepoHost` (`adapters/src/artifacts.ts`) |
| `Coder` | `ScriptedCoder` | `SandboxCoder` (`workers/src/sandbox-coder.ts`) |
| `Classifier` | `KeywordClassifier` | `JevClassifier` (`adapters/src/jev.ts`) |
| `Planner` | `TemplatePlanner` | `LlmPlanner` (`adapters/src/llm-planner.ts`) |
| `Reviewer` | `RuleReviewer` | `LlmReviewer` (`adapters/src/llm-reviewer.ts`) |
| `PreviewHost` | `MemoryPreviewHost` | `WorkersBuildsPreviewHost` (`adapters/src/workers-previews.ts`) |
| `CheckRunner`, `ProofRunner` | `FakeCheckRunner`, `FakeProofRunner` | `LocalCheckRunner` and `LocalProofRunner` (`cli/src/local`), `SandboxCheckRunner` and `SandboxProofRunner` (`workers/src/sandbox-checks.ts`) |
| `EventBus`, `KeyValueStore`, `Clock`, `IdSource` | memory versions | `DurableEventBus`, `DurableStore` in `workers/src` |

The planner and reviewer call Claude through `adapters/src/anthropic.ts` with structured output validated by zod. `llmFromEnv` picks the endpoint: CPA (CLIProxyAPI with a Claude subscription login, `CPA_BASE_URL` and `CPA_API_KEY`) when it is configured, otherwise the Anthropic API with `ANTHROPIC_API_KEY`. Only the direct API path opts into server-side model fallbacks; CPA does not pass beta headers. The local CPA setup is in `dev/cpa`.

## Flow of one prompt

1. **Route** (`core/src/router/router.ts`). Rules first (`/new`, `@feature` mentions, English questions). Then Jev answers three typed choice questions (intent, feature, change kind); its answer is used only above per-action confidence thresholds. Otherwise the planner triages.
2. **Plan**. The planner returns the feature spec and work items. Existing acceptance criteria are never dropped, and a spec change is always the first item.
3. **Session**. The orchestrator forks canonical `main` into `<project>--<feature>--<session>` and drives the state machine in `core/src/session/machine.ts`:
   `queued → planning → testing → coding → reviewing → gating → merged | stuck`.
4. **Turns**. Each coder turn runs one work item under one profile. Its changed files become one commit on the fork with a note under `refs/notes/kargah` (prompt, root prompt, run id, model, role, spec revision, paths). A turn that writes outside its role's scope is rejected before it is committed and fed back as the next attempt.
5. **Preview**. After each commit, `PreviewPublisher` pushes the fork head to `preview/<feature>` on the canonical repo, and the preview host reads the deployed URL back.
6. **Review**. The reviewer compares the diff from the session's base to its head against the spec.
7. **Gate** (`Orchestrator.gate`). Sync from `main`, then typecheck, lint (no comments, import boundaries), tests, generated files, spec lint, write scope of every commit by the role in its note, a reviewer approval of the current head, and a proof: the feature's flow driven against its preview, stored under `refs/notes/kargah-proof`. Merges run one at a time through a mutex; if `main` moved, the session syncs and is gated again.
8. **Merge**. A gardener commit sets the feature's status to `merged`, then `MainWriter.mergeFork` merges the fork into `main`. Only the gate holds `MainWriter`.

A failed gate or rejected review sends the session back to coding with the failure log. Budgets on attempts, tokens and time turn a session `stuck`; a stuck session blocks no other session.

## Isolation

- Artifacts tokens are per repo, so each session has its own fork. The orchestrator holds the fork's write token; the coder receives a read token only.
- The coder runs in a Cloudflare Sandbox whose only network path is `SandboxOutbound`: it adds the read token for Artifacts, swaps a placeholder for the Copilot token on Copilot hosts, blocks `git-receive-pack`, and refuses other hosts. The sandbox returns changed files as data; it never commits or pushes.
- Capabilities are separate objects (`core/src/orchestrator/capabilities.ts`): `PreviewPublisher` can only push `preview/*`, `MainWriter` can only merge or revert `main`.

## Merging and sync

- `threeWayMerge` in `core/src/git/tree.ts` merges trees line by line. Generated files such as `src/registry.gen.ts` are never merged; resolvers regenerate them from the merged tree.
- A push to canonical `main` emits `cf.artifacts.repo.pushed`, which starts the `upstream-sync` Workflow. It ignores forks and non-`main` refs and tells `ProjectAgent`, which marks every active session for sync. Sync runs between turns. A conflict becomes a conflict work item for the same session, using the conflict-resolver profile when one exists.
- `revertMerge` reverts a merge when `main` goes red and reopens its session with the failure log.

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
| `POST /api/projects/:name/prompts` | Routes `{ prompt }` and starts a session when there is work |
| `GET /api/projects/:name/sessions` | Session records |
| `GET /api/projects/:name/events?after=<seq>` | Stored events after a sequence number |
| `WS /agents/project-agent/:name` | Live events, replayed from the start on connect |
