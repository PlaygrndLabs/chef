# Architecture

Chef turns a prompt or a spec entry into a merged feature on its own. The spec is the memory, git is the state, and chat is only input.

## Where things run

Chef runs on Cloudflare, in the person's own account.

The engine is the Chef Worker in that account: the HTTP API, the project and session Durable Objects, sandboxes, previews, Artifacts repos, memory and settings. Everything that does work or keeps state lives there, so work goes on when no client is open. The engine serves the dashboard itself, behind its password, which signs in from a browser only. Programs use API keys (`chef_<id>_<secret>`, kept as a hash in the `Settings` Durable Object, each named, with an optional end and its own revoke; `workers/src/grants.ts`). Every key carries a list of scopes, all full access for now, so narrower keys and share links are new scopes rather than a new mechanism. An engine can be run for people by a separate app: that app holds a controller key, usually the deployment's `CHEF_API_KEY` from `chef deploy --api-key`, and only a controller's requests may name the person they act for (`x-chef-user`) and the address their links use (`x-chef-origin`). An engine with a key and no password has no sign-in or setup page, and sends a browser that opens it to `CHEF_HOME` when that is set. Several such apps can drive one engine, each with its own key. A share link is the same kind of grant (`share`, `workers/src/shares.ts`) with narrow scopes: `session:<project>/<id>` reads that session, its commits and its changes, and `preview:<project>/<key>` opens that preview. The Worker turns a request into the scope it needs (`scopeFor`) and refuses everything else, so a link can never write, list or reach another project. The link itself is `<origin>/s#<key>`: the key stays in the fragment, which browsers never send, and the read-only page at `/s` (`apps/dashboard/src/components/shared-page.tsx`) sends it as a Bearer token. A preview opened through a share link remembers its visitor for one hour instead of twelve, so ending a link shuts it out within the hour, or at once with a new preview key. Who may open a link is up to whoever serves it: a Chef on its own gives it to anyone who has it, and an app that runs Chef for others can check people before it passes the request on. That app can swap in its own share dialog through the dashboard's `Host.Share`, or hide sharing with `Share: false`. A terminal or desktop app would be another client of the same API.

Every deploy goes through `chef deploy` (`pnpm run deploy`, `cli/src/deploy.ts`), from a terminal, the Deploy to Cloudflare button or the `deploy` workflow. It reads the root `wrangler.jsonc`, creates the Vectorize index when it is missing, and runs `wrangler deploy`. With `--name`, it writes a copy of the config where the Artifacts namespace, Workflow, memory index and project Worker prefix carry that name, so several chefs can share an account.

## Packages

| Package | Role |
| --- | --- |
| `core` | Spec format and lint, router, session state machine, orchestrator, merge, ports and their in-memory fakes, code rules. No I/O. |
| `adapters` | Real implementations of the ports: Artifacts over isomorphic-git, Jev classifier, Claude planner and reviewer, and `ChefAgent`, the AG-UI agent CopilotKit streams sessions through. |
| `workers` | The engine, the Chef Worker: `ProjectAgent` and `SessionAgent` Durable Objects, the coder sandbox, the `upstream-sync` Workflow, the HTTP API. |
| `template` | The vertical-slice template every project Chef builds starts from, with its own `app` CLI (`gen`, `drive`, `proof`). |
| `cli` | `chef` CLI: spec lint, code rules, routing, `chef deploy`, the local demo with real checks, benchmarks, the Jev spike, and `chef serve` (the dashboard on the in-memory world, used by the browser tests). |
| `apps/dashboard` | Dashboard served by the Chef Worker (React, built with Vite into `dist/`): the feature tree on the left (the app's live address on top, child features under their parent, working ones first; rename, move and delete in place), the features opened as tabs in the middle, each opening on its preview with its messages, changes, checks and details one click away, and on the right the CopilotKit chat, the only place a person asks for work. A site that runs engines for others can build the same dashboard with its own `src/host/` folder, which adds account, menu and settings parts through the `Host` interface in `src/lib/host.ts`; Chef's own `src/host/` adds nothing. |
| `agents` | Specialist profiles with write scopes. |

## Ports

Every external service sits behind a small interface in `core/src/ports` with a fake in `core/src/fakes`:

| Port | Fake | Real adapter |
| --- | --- | --- |
| `RepoHost` | `MemoryRepoHost` | `ArtifactsRepoHost` (`adapters/src/artifacts.ts`): reads through the Artifacts read API, writes over git smart HTTP with isomorphic-git |
| `Coder` | `ScriptedCoder` | `SandboxCoder` (`workers/src/sandbox-coder.ts`) |
| `Classifier` | `KeywordClassifier` | `JevClassifier` (`adapters/src/jev.ts`) |
| `Planner` | `TemplatePlanner` | `LlmPlanner` (`adapters/src/llm-planner.ts`) |
| `Reviewer` | `RuleReviewer` | `LlmReviewer` (`adapters/src/llm-reviewer.ts`), or `WorkersAiReviewer` (`adapters/src/workers-ai-reviewer.ts`, a tuned LoRA on Workers AI) when `REVIEWER_LORA` is set |
| `ExternalRemote` | `MemoryExternalRemote` | `GitRemote` (`adapters/src/external-git.ts`): any https git remote over smart HTTP, plus the GitHub pulls API |
| `PreviewHost` | `MemoryPreviewHost` | `SandboxPreviewHost` (`workers/src/sandbox-checks.ts`): runs `wrangler preview` for the branch in the session sandbox |
| `CheckRunner`, `ProofRunner` | `FakeCheckRunner`, `FakeProofRunner` | `LocalCheckRunner` and `LocalProofRunner` (`cli/src/local`), `SandboxCheckRunner` and `SandboxProofRunner` (`workers/src/sandbox-checks.ts`) |
| `VoiceHost` | `ScriptedVoiceHost` | `GptLiveHost` (`adapters/src/gpt-live.ts`, GPT-Live `gpt-live-1`), `RealtimeHost` (`adapters/src/realtime.ts`, a provider that serves the OpenAI Realtime API) |
| `MemoryIndex` | `LexicalIndex` (TF-IDF) | `VectorizeIndex` (`adapters/src/vectorize.ts`, Vectorize plus Workers AI `@cf/baai/bge-base-en-v1.5`) |
| `EventBus`, `KeyValueStore`, `Clock`, `IdSource` | memory versions | `DurableEventBus`, `DurableStore` in `workers/src` |

The planner and reviewer call Claude through `adapters/src/anthropic.ts` with structured output validated by zod. The model provider is the user's choice, like in any other app: an Anthropic API key, or a custom Anthropic-compatible provider with its base URL and key. `adapters/src/settings.ts` resolves it with the rest of the app's settings (Cloudflare account for previews, TypeSafe key, model ids, attempts, voice): settings saved in the dashboard (`/api/settings`, kept in the `Settings` Durable Object) win over the Worker's secrets. Without a TypeSafe key the router skips Jev (`NO_CLASSIFIER`) and the planner triages every request that rules do not settle. Only the direct Anthropic API path opts into server-side model fallbacks; a custom provider gets plain requests without beta headers.

## Flow of one prompt

1. **Route** (`core/src/router/router.ts`). Rules first (`/new`, `@feature` mentions, English questions). Then Jev answers three typed choice questions (intent, feature, change kind); its answer is used only above per-action confidence thresholds. Otherwise the planner triages.
2. **Split** (`Router.split`). For a new feature or a change the router did not settle by rules, the planner splits the request into independent parts, one session each, built in parallel. A part that adds a capability is a new feature; it names the existing feature it builds on as its `parent` (spec field), sits under it in the dashboard's feature tree and may also change that parent's folder. A fix or refactor of one feature stays a new build of that feature. `#feature`, `/new`, `/chore` and `/hotfix` requests are never split.
3. **Plan**. The planner returns the feature spec and work items. Existing acceptance criteria are never dropped, and a spec change is always the first item.
4. **Session**. The orchestrator forks canonical `main` into `<project>--<feature>--<session>` and drives the state machine in `core/src/session/machine.ts`:
   `queued → planning → testing → coding → reviewing → gating → merged | stuck | dropped`.
   A prompt can start several attempts. Each attempt is its own session with its own fork and its own preview branch `preview/<feature>--<session>` until it wins.
5. **Turns**. Each coder turn runs one work item under one profile. Its changed files become one commit on the fork with a note under `refs/notes/chef` (prompt, root prompt, run id, model, role, spec revision, paths). A turn is rejected before it is committed, and the reason fed back, when it writes outside its role's scope, when a non-test role changes a test the test role wrote (locked tests), when a test turn adds tests that pass against an empty stub of the feature (red check, using per-test results from node's TAP output), or when it breaks a project lint rule in `lint/rules/` (project-lint). Before each turn the orchestrator recalls up to three memory documents, lessons and feature memories of the same feature first, and appends them to the prompt. Each profile runs in the Claude Agent SDK as a subagent named `chef-<role>`; the profile model `coder-default` resolves to `CODER_MODEL`. Every turn, and the planner and reviewer, also get the project's guidance (see [Memory](#memory)).
   When a plan has build steps for two or more plannable roles, the roles work in lanes (`Orchestrator.laneRound`, `core/src/session/lanes.ts`): each role has a `lane/<role>` branch in the session's fork and its own sandbox (`SessionAgent` named `<session>--<role>`). Each round resets the lanes to the fork's head, runs one turn per lane in parallel, commits on each lane and merges the lanes back; lines two roles both changed go to the conflict-resolver. Tests are written before the lanes start, and chores never use lanes.
6. **Preview**. After each commit, `PreviewPublisher` pushes the fork head to `preview/<feature>` on the canonical repo, and the preview host runs `wrangler preview --name <feature>` on that commit in a sandbox, on the project Worker named after the project, and reads the Preview URL back (`<feature>-<project>.<subdomain>.workers.dev`). The sandbox only sees a placeholder Cloudflare token; the outbound handler swaps in `CF_API_TOKEN` for that Worker's API paths and nothing else. People open previews through Chef's own link, `/preview/<project>/<feature>`, so a preview can sleep (see [Resources](#resources)) and stays private (see [Private previews](#private-previews)).
7. **Review**. The reviewer compares the diff from the session's base to its head against the spec. When every live attempt of a prompt has reached the gate, each attempt's code runs against the tests of all attempts and the reviewer picks one; the others are `dropped`.
8. **Gate** (`Orchestrator.gate`). Sync from `main`, then typecheck, lint (no comments, import boundaries), tests, generated files, spec lint, write scope of every commit by the role in its note, no coder commit touching a locked test, a reviewer approval from a model that wrote no code in the session of the current head, and a proof: the feature's flow driven against its preview, stored under `refs/notes/chef-proof`. Merges run one at a time through a mutex; if `main` moved, the session syncs and is gated again.
9. **Merge**. A gardener commit sets the feature's status to `merged`, adds spec entries for feature folders that have none, condenses the session into `memory/features/<id>.md`, and writes any lint rule mined from corrections. Then `MainWriter.mergeFork` merges the fork into `main`. Only the gate holds `MainWriter`.

A prompt routed as a question starts no session: it is answered from the memory index, by the planner when it has an `answer` method, and the answer lists the files it used.

A failed gate or rejected review sends the session back to coding with the failure log. Budgets on attempts, tokens and time turn a session `stuck`; a stuck session blocks no other session.

### Work that outlives a deploy

`ProjectAgent.drive` runs in a Durable Object alarm. A deploy resets the object, and an alarm may run for at most fifteen minutes, while one coder turn often takes longer. So a coder turn does not run inside the call that starts it. Before it starts, the orchestrator saves the turn's id in the session record (`turns`, one per lane), and `SessionAgent` launches the runner as a detached process in the sandbox. The runner writes its events and result to files next to it. The alarm then follows the turn for a minute at a time (`FOLLOW_SECONDS`), passing on new events. When the minute is up and the turn is still running, the step ends with `TurnRunning` and `drive` comes back a second later. A step that starts after a deploy, a reset or an alarm timeout finds the saved turn and follows the same process from the last event it passed on, or takes its result when it has finished. The work is not started again. If the sandbox itself was replaced, that turn starts over with a notice in its activity. The session becomes `stuck` with the reason when this happens three times, or when a turn runs past ninety minutes, so a session never waits silently. Checks, previews and model calls are short and simply run again when a reset interrupts them.

A deploy does not switch every object at the same moment. A busy `ProjectAgent` can keep serving the previous version for minutes while its `SessionAgent`s already run the new one, so the two must understand each other across one deploy: a call between Durable Objects only ever gains new methods or optional fields, and an existing method keeps its arguments and its result's shape.

## Isolation

- Artifacts tokens are per repo, so each session has its own fork. The orchestrator holds the fork's write token; the coder receives a read token only.
- The coder runs in a Cloudflare Sandbox whose only network path is `SandboxOutbound`: it adds the read token for Artifacts, swaps a placeholder for the provider's API key on the provider's host, blocks `git-receive-pack`, and refuses other hosts. The sandbox returns changed files as data; it never commits or pushes.
- Capabilities are separate objects (`core/src/orchestrator/capabilities.ts`): `PreviewPublisher` can only push `preview/*`, `MainWriter` can only merge or revert `main`.

## Environment and secrets

Apps Chef builds often need keys for outside services (payments, maps, email) or plain settings like an API base URL. Values shared by every project live under Settings > Environment (`GET`/`PUT /api/env`, kept in the `Settings` object); each project keeps its own set under Project settings > Environment (`GET`/`PUT /api/projects/:name/env`, `adapters/src/project-env.ts`). A project gets the shared values plus its own, and its own value wins for a name both have (`mergeEnv`); its view marks each variable as shared, its own, or its own over a shared one. Saving a shared value tells every project, so waiting sessions resume and awake previews get it.

- **Storage.** `ProjectAgent` stores each value sealed with AES-GCM under a key the `Settings` object creates once per deployment. A secret is never returned again; a plain value is shown. Nothing goes into git, Artifacts or a sandbox.
- **Agents see names only.** The planner gets the names already set and lists the ones a feature reads in its spec entry (`env:` in the frontmatter, validated by `ENV_NAME` in `core/src/env/env.ts`). Each coder turn's prompt lists the project's names, the feature's names, and which are still missing. The app reads them from `context.env`; tests pass fake values to `createApp(features, store, env)`.
- **Previews get values.** Before each preview build, the Worker itself (not the sandbox) makes sure the project Worker `<project>` exists and writes the values into its previews' base config through the Cloudflare API (`PATCH /workers/workers/<worker>` with `previews_base_config.env`). A `wrangler preview` deployment does not take its env from the base config, so after each one Chef patches the values into that deployment (`PATCH …/previews/<name>/deployments/latest`) before the preview counts as ready. Saving a change also updates the base config and patches the latest deployment of every preview that is awake.
- **Needs a key.** A session whose feature lists a name that is not set stops before its gate, records `needs` and emits `session.needs`; the proof would only fail without it. It no longer counts as runnable, so `drive` stops rescheduling it. The dashboard shows it under "Needs you" with a field per missing key on the feature page. Saving a value calls `Orchestrator.environmentChanged`, which resumes every session that now has what it needs.

## Resources

Chef serves many projects from one Cloudflare account, so nothing stays up that nobody uses.

- **Sandboxes.** Each session has a `SessionAgent` container for its coder turns and checks, and each preview build has one too. A container stops five minutes after its last command (`sleepIfIdle`, plus the platform's inactivity timeout as a backstop), and the orchestrator stops a session's container as soon as the session merges, gets stuck or is dropped (`Coder.release`). The next command starts it again.
- **Live app.** Every project has one Worker named after the project (`<project>.<subdomain>.workers.dev`; a named Chef copy prefixes it with `<name>-`). Creating the project claims the name with the tag `chef-project`, and a project whose name belongs to a Worker Chef did not make is refused. Whenever `main` moves, `ProjectAgent.deployLive` runs `wrangler deploy --name <project>` on that commit in a sandbox and then writes the project's keys as the Worker's secrets (`PATCH /workers/scripts/<project>/secrets-bulk`). The state (`deploying`, `ready`, `failed`) is stored, sent as a `live.updated` event, returned with `/spec`, and shown in the project bar; `POST /api/projects/<project>/live` retries a failed deploy. The live app never sleeps: an idle Worker costs nothing, and it counts toward the account's Worker limit (100 on Free, 500 on Paid).
- **Private previews.** Every preview build runs `wrangler preview .chef/preview-gate.mjs`: Chef writes that file into the build's checkout (`gateModule`, `adapters/src/preview-gate.ts`), it re-exports the app's own entry module and puts a gate in front of its `fetch`. The gate checks HMAC-signed passes with the project's preview key, `CHEF_PREVIEW_KEY`, which the engine keeps in the `ProjectAgent` and writes into the previews' base config with the project's values; the sandbox never sees it, and the app's `fetch` gets its env without it. `/preview/<project>/<feature>` redirects to a link into the preview, `/__chef/enter?t=…&to=<path>`, that works for two minutes and only on that preview's host; the gate trades it for a cookie on the preview's own address (`__Host-chef_preview`, HttpOnly, `SameSite=None; Partitioned`, so it also works inside the dashboard's frame) and passes nothing of Chef's to the app. Proofs reach the preview with a pass in the `x-chef-preview-pass` header that the sandbox's outbound handler adds, so the sandbox never holds it either. Each pass carries its own storage scope: for a request with that pass, every Durable Object binding the app reaches by name (`idFromName`, `getByName`) is reached under that scope, so each proof run starts from empty storage, two runs never see each other's data, and proofs never touch what people saved in the preview. Anyone else who opens a preview's address gets a page that says to open it from Chef. A preview built without the gate is built again on its next visit (`PreviewEntry.gated`), and a new preview key would end every link and cookie at once.
- **Previews.** All previews of a project are Previews of that same Worker. `PreviewKeeper` (`core/src/previews/keeper.ts`) records every deploy and every visit to `/preview/<project>/<feature>`. When a project has had no visit and no deploy for its idle time (one hour by default, `previewIdleMinutes` in the project settings) and no session is running, `ProjectAgent.sweepPreviews` deletes those Previews through the Cloudflare API and keeps the live app. The next visit shows a "waking up" page that refreshes itself while Chef builds the preview again from `preview/<feature>` on the canonical repo, then redirects to it. Data a preview stored is gone after it sleeps.
- **Forks.** A fork lives only while its session does. When a session merges, its commits and notes are already on `main`, so the fork is deleted. When a session is dropped, its head and notes are first pushed to `archive/<session>` on the canonical repo, then the fork is deleted. Turns and changes of an ended session are read from the canonical repo. If a merged feature is reverted later, the orchestrator forks `main` again under the same name and restores the session's work there. `Orchestrator.reclaim` releases sessions that ended before this cleanup existed, or whose cleanup failed (`fork.kept`).
- **Seeing them.** The Details tab of a session lists all of the above for that session under "On Cloudflare" (see `GET /api/projects/:name/sessions/:id/cloudflare`). Durable Object namespace and container application ids are read once every ten minutes with the engine's Cloudflare token and left out when the token cannot read them.
- **Git in memory.** `ArtifactsRepoHost` reads through the Artifacts binding's read API (`log`, `readCommit`, `readTree`, `readBlob`) and keeps no git repository for reads; immutable commits and blobs sit in byte-bounded LRU caches. Only writes (commits, merges, ref and note pushes) use isomorphic-git, and they fetch just the refs they touch plus notes. At most three repos keep their in-memory git between operations, and one that grows past 48 MB is dropped and fetched again when next needed. Reads fall back to git smart HTTP when the binding has no read API.

## Merging and sync

- `threeWayMerge` in `core/src/git/tree.ts` merges trees line by line. Generated files such as `src/registry.gen.ts` are never merged; resolvers regenerate them from the merged tree.
- A push to canonical `main` emits `cf.artifacts.repo.pushed`, which starts the `upstream-sync` Workflow. It ignores forks and non-`main` refs and tells `ProjectAgent`, which marks every active session for sync. Sync runs between turns: a session that is mid-turn is synced when the turn ends.
- A conflicting sync is still committed: the fork gets a two-parent merge commit with hunk-level conflict markers, and the session gets a conflict work item, using the conflict-resolver profile when one exists. Since both parents are recorded, later syncs and the gate do not recompute the same conflict.
- After every merge the gate runs the checks on `main`. If they fail, the merge is reverted and the session reopens on its restored work with the failure log. `revertMerge` does the same for a failure reported later: it undoes only that merge when later merges allow it, and otherwise returns `main` to before it and reopens every session merged since, without charging their attempt budgets.

## External git

The project's code always lives on Artifacts, and every session, gate and preview works there. A project can be linked to an outside repository (GitHub first, any https git host for the branch mode) from the dashboard's "Project settings" dialog. The link is optional and only keeps the two in sync; unlinking leaves the project on Artifacts as it is.

- **Connect GitHub.** Like Vercel or Cloudflare's own Git integration, "Connect GitHub" sends the person to GitHub and back instead of asking for a token. Each Chef deployment owns its own GitHub App, created on first use through GitHub's [manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest): `GET /api/github/connect` posts a manifest (contents and pull requests write, push events, webhook and redirect URLs on this deployment) to GitHub for the person's account or an organization; GitHub calls back `GET /api/github/created` with a code that Chef trades for the app's id, private key and webhook secret, stored in the `Settings` object. Chef then sends the person to the app's install page, where they pick repositories, and GitHub returns them to `GET /api/github/installed`, which reopens the project's dialog. The dialog lists every repository the app's installations can reach; linking one stores the installation id instead of a token, and Chef mints a one-hour installation token (signed with the app's key, cached until five minutes before expiry) whenever it pulls, pushes or opens a pull request. Pushes reach Chef through the app's webhook, `POST /api/github/webhook`, which routes them to the projects linked to that repository. Other hosts, or a person who prefers it, still link with a URL and an access token.

- **First look.** After an import, Chef reads the project the way a new teammate would (`adapters/src/project-explorer.ts`: the file list plus README, task lists, `package.json`, spec and top-level docs) and asks the planner model for a short summary, the open problems it can see evidence for, and three first tasks. The dashboard shows them as chef's first message in the project, with a button per task that sends its prompt.
- **Import.** When a linked project has no `main` yet, `bootstrap` takes the repository in instead of the template: through Artifacts' own import when it can, otherwise by copying the branch over git. The repository has to follow the Chef template's layout (spec, `app` CLI, checks) for Chef's gate to pass.
- **Inbound.** `ExternalSync.pull` (`core/src/sync/external.ts`) copies the repository's main branch to `external/<branch>` on the canonical repo and merges it into `main` like any other change, so running sessions sync with it as usual. A conflict does not block anything else: Chef forks `main` to `<project>--sync--<id>`, commits the merge with conflict markers, lets the conflict-resolver profile fix it, runs the checks, merges it into `main` and deletes the fork. If that fails, `external.stuck` is emitted and Chef waits for a new push to that branch or "Sync now". Chef checks the repository every five minutes and at once when GitHub calls `POST /api/projects/:name/git/webhook` with a push to that branch (signed with the project's webhook secret).
- **Outbound.** A per-project setting decides how work goes back. Chef never pushes to the repository's main branch, and a merged pull request comes back as an ordinary inbound change:
  - `off`: pull only.
  - `branch`: `main` is mirrored to the sync branch (`chef` by default) after each merge.
  - `pull-request` (the default): the sync branch, plus one pull request that Chef keeps up to date. It lists the features merged on Chef but not yet on the repository's main branch, each with its preview link.
  - `feature-pull-requests`: the sync branch, plus one branch (`<sync branch>-<feature>`) and pull request per merged feature. Each is the feature's own diff applied on the repository's main branch.
- **Access.** A link through Connect GitHub stores only the installation id. A link by URL takes a token that can push branches and open pull requests; it is stored in the project's Durable Object, and only its last four characters come back to the dashboard.

## Memory

The project repo is the memory; the index is a cache of it.

| Kind | Where | Written by |
| --- | --- | --- |
| Project memory | `memory/**/*.md` with `kind` and `feature` frontmatter, and the spec | the gardener and the gate, through commits on `main` |
| Notes | `memory/notes/<slug>.md` | a person, from Project settings > Memory, which also edits or removes any memory document |
| Lessons | `memory/lessons/<feature>-<commit>.md`: the failing checks, the acceptance criteria and the prompts behind a reverted merge | the revert commit itself |
| Feature memory | `memory/features/<id>.md`: one section per session (parent session, prompt, turns, corrections) | the gardener commit before each merge |
| Learned lint rules | `lint/rules/<id>.json` (`files` glob, `forbid` line regex, evidence) | the gardener, from corrections |
| Session memory | the session record (`history` of feedback, `parent`) and pending corrections, in the Durable Object's SQLite | the orchestrator |
| Episodic memory | commits and their notes under `refs/notes/chef` | every turn |

After bootstrap, every merge and every revert, `syncMemory` compares content hashes of the memory documents on `main` with the last indexed set and upserts or removes only what changed. Sessions on the same feature form a tree: a new session's `parent` is the previous live session of its feature.

A correction is a rejected or failed turn followed by the turn that was accepted. For red-test corrections the candidate lines are the bodies of the tests that passed against the stub; for others, the lines the accepted turn removed. Literals are generalized. A line becomes a rule when corrections from at least three sessions share it, no accepted turn and no file on `main` matches it, and no rule already forbids it. Turns rejected by a learned rule do not produce new rules. `checkTree` also enforces the rules, so the gate fails on any match.

Guidance is read from `main` at each turn (`core/src/guidance`, `adapters/src/guidance.ts`): the instructions shared by every project (Settings > Instructions, kept in the `Settings` object), the project's `GOAL.md` and `AGENTS.md` at the repo root (Project settings > Instructions, committed to `main` under the merge lock), with the project's text winning where they disagree. The planner, every coder turn and the reviewer get it as one block.

The main chat keeps its own memory under `chat/turns` in the project's store: the recent messages plus a running summary of older ones, which the planner writes when the chat passes its token limit. Each feature keeps its own context in its session.

`verifyMain` adds a `feature-map` check after every merge: every `features/<id>/index.ts` has a spec entry and every merged spec entry has its folder.

The Worker binds the index as `MEMORY` (index `chef-memory`, 768 dimensions, cosine) and Workers AI as `AI`. Each project's documents live in their own Vectorize namespace, named after the project, and kinds are filtered after the query, so the index needs no metadata indexes. `pnpm run deploy` creates the index when it is missing.

## Voice

The voice front end hands spoken requests to the same router as typed prompts; the voice model only listens and speaks.

1. The live button in the chat composer (next to Send) opens a WebSocket to the project's agent (`/agents/project/:name?voice=1`). The browser captures the microphone with an AudioWorklet, resamples it to 24 kHz 16-bit PCM and sends it as binary frames; it plays Chef's audio from the same socket and stops playback when the user starts speaking.
2. `ProjectAgent` starts a server-side voice session with `VoiceHost.start` and relays the audio both ways: GPT-Live (`wss://api.openai.com/v1/live/sessions`) with an OpenAI key, or a custom provider's Realtime WebSocket (`/realtime?model=gpt-realtime`, server VAD, input transcription and a `chef_request` tool). Provider keys never leave the Worker. Browser WebRTC is not used, since the model gateway accepts Realtime voice only over WebSocket.
3. The voice model decides when the user asked for something: GPT-Live sends `session.delegation.created`, and the Realtime adapter turns a `chef_request` tool call into the same event with the request attached. `VoiceDelegate` (`core/src/voice/delegate.ts`) takes that request (or the transcript up to the delegation point), calls `Orchestrator.submitSpoken`, which routes it like a typed prompt and emits `voice.request`, and answers with `session.commentary.append`, which the model speaks in the user's language.
4. `SpokenTurns` (`core/src/voice/turns.ts`) joins the transcript deltas into turns, one per speaker, and `Orchestrator.recordSpoken` emits each as `voice.turn`. The chat shows those turns as spoken messages in the same conversation as typed ones, so they stay after the call and on other devices. A spoken request shows only the feature cards it started, since the turn already shows what was said.
5. While a call is live the composer is replaced by a panel with a pixel orb that follows the microphone and Chef's voice, a Mute button and an End button (or Esc). Ending stops the microphone and closes the socket; the agent then closes the provider session.

`chef voice --say "<request>"` runs the same path locally: scripted transcripts by default, or with `--live` the request is synthesized to speech (OpenAI text to speech, or the Realtime provider reading it aloud) and streamed as audio to the same server-side voice session.

## Streaming to the app

Sessions reach the app through CopilotKit. The Chef Worker hosts the CopilotKit runtime at `/api/projects/:name/copilotkit` (`workers/src/copilotkit.ts`) with one agent, `default`, a `ChefAgent` (`adapters/src/agui.ts`):

1. The dashboard's CopilotKit chat sends the user's message to the runtime, which runs `ChefAgent` and streams its AG-UI events back over SSE.
2. `ChefAgent` reads the project's event cursor, submits the prompt to `ProjectAgent`, answers with the route it took, and then follows the project's events from that cursor.
3. `SessionStream` maps each Chef event of the sessions the prompt started to AG-UI: coder text deltas become assistant messages, coder tool calls become tool calls, every state change is a step (`<session>:<state>`), and the preview, review, gate, merge and stuck results update a shared state snapshot (`ChefState`) that the chat renders as session cards.
4. The run ends with a summary line when every session has merged, got stuck or been dropped.

`chef serve` runs the same runtime and dashboard on a computer against the local world (fake coder, real or fake checks).

## Learning

Every session leaves a labelled record: the change the reviewer approved, and what happened to it afterwards.

1. `review.verdict` events carry the reviewed head and base commits. `reviewPoints` (`core/src/learning/export.ts`) follows each approved review to its outcome: `gate-failed` when the merge gate failed, `reverted` when the merge was later reverted from main, and `merged` otherwise.
2. `exportOutcomes` turns each point into a reviewer example: the spec's acceptance criteria and the feature's files (`reviewMessages` in `core/src/learning/review-prompt.ts`), with `approve` as the target for merged changes and `reject: <why>` for the others. Each coder turn (its prompt and its changes, from the commit's note) is labelled positive or negative by the review it led to.
3. `chef tune data` runs the benchmark's 20 training features and 10 held-out features in separate projects with real checks and writes `tune/data/{train,heldout}.jsonl`, the coder turns, and each run's benchmark report.
4. `tune/train.py` trains a LoRA (rank 8 on the attention projections) on Gemma 2B, the base Workers AI serves for LoRA adapters, and compares it with the base model on the held-out examples. It writes the adapter with `model_type: gemma`, which Workers AI requires.
5. In production the adapter is uploaded with `npx wrangler ai finetune create @cf/google/gemma-2b-it-lora chef-reviewer <adapter dir>` and turned on with the `REVIEWER_LORA` var. `WorkersAiReviewer` then reviews with `env.AI.run(model, { prompt, raw: true, lora })` and leaves picking between parallel attempts to the Claude reviewer.

## Template

Projects Chef builds use Dune-style vertical slices:

```
features/<id>/index.ts       routes for the feature
features/<id>/<id>.test.ts   node:test tests, one per acceptance criterion
features/<id>/flow.ts        the user flow the proof drives
shared/                      http, storage and flow contracts
src/registry.gen.ts          generated from features/
src/index.ts                 the Worker entry
spec/features/<id>.md        the feature's spec
```

A new project starts with no features. Until a feature serves its own `/`, browsers opening `/` get an index of the app's pages and API clients get `{ ok: true, pages }`, so a preview answers from the first commit. A page is a GET route with no path params, outside `/api`, whose last segment has no file extension. Every HTML page the app serves also carries a small script (`previewBridge` in `template/shared/http.ts`): when the page is framed, it posts the open path, its title and the app's pages to the frame's parent. The dashboard's Preview tab uses that for its address bar, back and forward, and its Pages row, and opens the page named in the feature's entrypoint (`GET /notes`) first.

Code rules (`core/src/checks/code-rules.ts`) parse the TypeScript AST: no comments except tool directives; a feature may not import another feature; `shared/` may not import features; the app shell imports only `features/<id>/index.ts`.

## HTTP API

Served by the Chef Worker (`workers/src/index.ts`):

| Method and path | Effect |
| --- | --- |
| `GET /api/keys` | The API keys: name, `chef_<id>_` prefix, kind (`key` or `controller`), scopes, whether it comes from the deployment's `CHEF_API_KEY`, when it was made, last used and ends; never the key itself |
| `POST /api/keys` | Makes a key from `{ name, kind?, expiresInDays? }` and returns it once as `token`; an ordinary key cannot make a controller key |
| `DELETE /api/keys/:id` | Revokes a key at once; the deployment's key is replaced by deploying again |
| `GET /api/projects/:name/shares` | The project's share links: what each opens (`session` or `preview` and its id), its name, when it was made, last opened and ends; never the link's key |
| `POST /api/projects/:name/shares` | Makes a share link from `{ kind, id, expiresInDays? }` (30 days unless given; `null` for no end) and returns its key once as `token`; the dashboard turns it into `<origin>/s#<token>` |
| `DELETE /api/shares/:id` | Ends a share link at once |
| `GET /api/share` | Called with a share link's key: what the link opens |
| `POST /api/projects/:name/preview-key` | Gives the project's previews a new key, so every open preview and every link into one has to be opened again |
| `GET /api/settings` | The settings in use (Claude and voice providers, Cloudflare account, TypeSafe key, models, attempts, password source), with only the last four characters of each key and whether each comes from the dashboard or the deployment |
| `PUT /api/settings` | Saves any of `llm` (`{ kind: "anthropic", apiKey }` or `{ kind: "custom", baseUrl, apiKey }`), `voice` (`{ kind: "openai", apiKey }` or `{ kind: "custom", baseUrl, apiKey }`), `cloudflare` (`{ accountId, apiToken }`), `jev` (`{ apiKey }`), `models` (`{ planner, reviewer, coder }`) and `attempts`; `null` falls back to the deployment. `{ password }` alone changes the password and returns a new session cookie |
| `GET /api/projects/:name/settings` | The project's own settings: `previewIdleMinutes`, and `git`, the linked repository (`url`, `branch`, `mode`, `syncBranch`, `webhookSecret`, the token's last four characters) or `null` |
| `GET`/`PUT /api/env` | Environment values every project gets; same body as a project's `env` |
| `GET`/`PUT /api/instructions` | Instructions shared by every project, with a `previous` check against overwriting a newer save |
| `GET`/`PUT /api/projects/:name/instructions` | The project's goal (`GOAL.md`) and instructions (`AGENTS.md`), committed to `main` |
| `GET`/`POST`/`PUT /api/projects/:name/memory` | Lists the project's memory documents, adds a note, or edits or removes one |
| `GET /api/projects/:name/spec` | The feature map, with the project's live address and its state |
| `POST /api/projects/:name/live` | Deploys `main` to the live address again after a failure |
| `GET`/`PUT /api/projects/:name/agents`, `POST /api/projects/:name/agents/restore` | The project's own agent settings, versioned like `/api/agents`. Roles it sets replace the shared ones, its skills join the shared ones (same name replaces), and its router replaces the shared router. The view is the merged result plus `scope`, which lists what the project sets itself |
| `PUT /api/projects/:name/settings` | Saves `previewIdleMinutes` (5 minutes to a week; `null` goes back to the default of 60), `attempts` (parallel tries for this project, 1 to 4; `null` uses the shared setting) and `git` (`{ url, branch, token, github, mode, syncBranch }`; `null` unlinks). With `github: true` Chef links through its GitHub App and needs no token; otherwise a token is required for every mode but `off`, and the pull request modes need a github.com repository |
| `GET /api/github` | Chef's GitHub App (or `null`) and the repositories its installations can reach |
| `GET /api/github/connect?returnTo=&organization=` | Starts Connect GitHub: creates the app through the manifest flow the first time, then opens its install page |
| `GET /api/github/created`, `GET /api/github/installed` | GitHub's redirects back after creating the app and after installing it |
| `DELETE /api/github` | Forgets the app's credentials (delete the app on GitHub too) |
| `POST /api/github/webhook` | The app's webhook; outside the password, checked with the app's webhook secret |
| `GET /api/projects/:name/overview` | What Chef learned from reading an imported project: `none`, `reading`, `failed` with the error, or `ready` with a summary, open problems and three suggested first tasks |
| `POST /api/projects/:name/overview` | Reads the project's code again (bootstrap does this on its own after importing a repository); the dashboard polls `GET` until it is ready |
| `GET /api/projects/:name/git` | The linked repository and its sync state: last commit taken in, last commit sent, a commit Chef could not merge, the rolling pull request |
| `POST /api/projects/:name/git/sync` | Clears a stuck sync and syncs now |
| `POST /api/projects/:name/git/webhook` | GitHub push webhook; outside the password, checked with the `x-hub-signature-256` HMAC instead |
| `GET /preview/:name/:feature` | Redirects to a short-lived link into the feature's preview (`?path=` picks the page), or wakes it up and shows a page that refreshes until it is ready; `?state=1` answers with the preview's state instead |
| `POST /api/projects/:name/bootstrap` | Creates the canonical repo if it does not exist: from the linked repository when there is one, otherwise from the template |
| `GET /agents/project/:name?voice=1` (WebSocket) | A live voice session: 24 kHz PCM from the browser in binary frames, Chef's audio, transcripts and status back as JSON events; spoken requests go to the router. GPT-Live with an OpenAI API key, or a custom provider that serves the OpenAI Realtime API |
| `POST /api/projects/:name/prompts` | Routes `{ prompt }` and starts a session when there is work; a question returns `answer` with its sources |
| `GET /api/projects/:name/sessions` | Session records |
| `GET /api/projects/:name/sessions/:id/cloudflare` | Every Cloudflare resource the session uses, with real names, ids, state and a dashboard link (`cloudflareView`, `core/src/session/cloudflare.ts`): its Artifacts repo and role branches, its sandbox containers and their Durable Object ids, its Worker preview and version, and the project's live app Worker, canonical repo, engine, `ProjectAgent`, Workflow and Vectorize index. Each resource lists the roles that use it (`agentsOf`: roles whose items run in the session sandbox, lane roles in their own sandbox and branch, the planner and reviewer in the engine). Shown in the session's Details tab and, filtered to one role, in that role's view. Never carries a token |
| `GET /api/projects/:name/events?after=<seq>` | Stored events after a sequence number |
| `GET /api/projects/:name/cursor` | The last event sequence number |
| `POST /api/projects/:name/copilotkit/*` | The CopilotKit runtime; `agent/default/run` streams a prompt's sessions as AG-UI events |
| `WS /agents/project/:name?after=<seq>` | Live events: replays events after `seq`, sends a `caughtUp` marker, then streams new ones |
