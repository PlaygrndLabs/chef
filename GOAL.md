# Goal: build chef end to end

Paste this whole file as the goal for a long-running coding agent working in this repository. The concept behind it is the chef concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77

## One-line goal

Build chef, a human-free, spec-driven software builder on Cloudflare, until a person can write a feature into the spec or send one prompt, and that feature reaches `main` of the project's canonical Artifacts repo with tests, review and proof of a real run, with zero human actions, across several features built in parallel.

## What chef is

- The spec is the memory, git is the state, chat is just input.
- A feature is one spec entry with one live preview. Each piece of work on a feature (first build, bug fix, refactor, competing attempts) is a session.
- A session is a Durable Object plus its own Artifacts fork named `<project>--<feature>--<session>`. Its agent holds a short-lived write token for that fork only.
- Every finished agent turn (`session.idle` with changed files) is one commit. The prompt, run id, model, agent role and spec revision go into git notes under `refs/notes/chef`.
- After each commit the orchestrator pushes the session head to `preview/<feature>` in the canonical repo, and Workers Builds turns that branch into a Worker Preview with its own URL.
- Every push to canonical `main` is merged into every active fork (continuous upstream sync). A conflict becomes a task for the same session.
- Only the merge gate writes to `main`. Nothing ever waits on a human click.
- Routing: rules first, then Jev (TypeSafe AI's System One model, `@typesafe-ai/sdk`) answers typed `choice` questions with calibrated confidence, then a planner LLM with structured output writes spec and work items when confidence is low or the feature is new. Jev never writes text.
- The coder is the Claude Agent SDK running inside a Cloudflare Sandbox on the fork's checkout. It reaches Claude through the CPA gateway (`CPA_BASE_URL`, `CPA_API_KEY`), the same endpoint the planner and reviewer use.
- Sessions are streamed to the app with CopilotKit: the chef Worker hosts the CopilotKit runtime, each prompt runs as an AG-UI agent that streams the session's coder text, tool calls, state steps, preview, review, gate and merge, and the dashboard's CopilotKit chat renders it live.

## Non-negotiables

1. No step in the build loop waits on a human. A feature that cannot finish becomes `stuck` on the dashboard and blocks nothing else.
2. No agent ever receives a token that can write to canonical `main`.
3. Never skip, disable, weaken or delete a test or acceptance criterion to get green. Only the planner changes the spec, through a `spec_change` item.
4. Fix every agent mistake at the highest layer that would have stopped it: codebase > architecture that makes it impossible > lint/typecheck/CI > rules and skills. Never only in a prompt.
5. Feature = folder. A session writes only inside its feature's vertical slice; `shared/` contracts change only through a stricter gated path.
6. Every external service sits behind a small interface with an in-memory fake: `RepoHost` (create, fork, token, push, merge, notes), `Coder`, `Classifier`, `Planner`, `PreviewHost`, `EventBus`. All tests run on fakes; real adapters are swapped in by config.
7. All code, file names, docs and commit messages are in English. No explanatory AI comments in code.
8. Commits use author and committer email `ma.karimi76@gmail.com` and never carry a `Co-Authored-By: Claude` trailer.

## Stack

TypeScript everywhere, pnpm workspaces, Wrangler 4.135.0 or later, Workers, Durable Objects (Agents SDK), Workflows, Queues, Cloudflare Sandbox, the Artifacts Workers binding, Vectorize, Workers AI, `@typesafe-ai/sdk`, the Claude Agent SDK, CopilotKit (runtime in the Worker, React chat in the dashboard, AG-UI between them), and a schema validator for the spec and every RPC edge. GitHub Actions runs typecheck, lint, unit tests and the fake end-to-end suite on every push.

Repository layout (already scaffolded):

```
spec/        feature map: spec/features/<id>.md with typed frontmatter (id, title, status, entrypoint, acceptance criteria)
workers/     router, session Durable Object, orchestrator, upstream sync workflow, merge gate
agents/      specialist profiles (planner, frontend, backend, test, reviewer, conflict-resolver, gardener)
apps/        dashboard: CopilotKit chat streaming sessions, features, commits, preview URLs, stuck items
template/    agent-friendly template for projects chef builds (Dune-style vertical slices)
cli/         chef CLI and the project CLI (app drive <flow>, app proof <feature>)
```

## Phase 0: spikes for the open questions

Each spike ends with a short note in `docs/spikes/<name>.md` that states the result, the evidence and the decision.

| Spike | Done when | Fallback if it fails |
| --- | --- | --- |
| Coder in Sandbox | A Claude Agent SDK session inside a Cloudflare Sandbox edits a cloned Artifacts fork, emits `assistant.message_delta` and `session.idle`, and the change is pushed back | Keep the `Coder` interface and run another headless coding agent in the Sandbox; record which |
| Preview from branch push | Pushing `preview/<feature>` to the canonical repo yields a reachable Worker Preview URL, read back through the API | Build the preview from the Sandbox with `wrangler preview` and record the URL |
| Jev routing quality | A labeled set of at least 100 prompts (half English, half Persian) is routed raw and translated-to-English; accuracy and misroutes at the chosen threshold are reported | Pick the better mode; tune per-action thresholds so accepted misroutes stay under 2% |
| Artifacts fork and notes | Create repo, fork, scoped token, push `refs/notes/*`, and receive `cf.artifacts.repo.pushed` on a Queue | Document the gap and emulate in the orchestrator |

## Phase 1: core loop

Build: spec format and `chef spec lint`; router (rules, Jev, planner); session Durable Object with the state machine `queued → planning → testing → coding → reviewing → gating → merged | stuck`; fork per session with scoped tokens; Claude Agent SDK coder in Sandbox; auto-commit on `session.idle` with git notes; preview push; the project template with import-boundary lint and a no-comment lint; the project CLI that drives the preview and stores proof next to the commit; a merge gate (typecheck, lint, tests, reviewer verdict, proof present); a minimal dashboard with the live event stream, streamed through CopilotKit; per-session budgets on tokens, time and attempts.

Done when:
- `pnpm test` and the fake end-to-end suite pass in CI.
- On a real Cloudflare account, a fresh project from `template/` plus one spec entry (for example "add an item to a todo list") reaches canonical `main` with proof, with zero human actions, on three consecutive runs.
- Every commit on that feature has git notes that trace it to the prompt that caused it.
- The feature had a reachable preview URL from its first commit.

## Phase 2: concurrency

Build: parallel sessions; the upstream sync Workflow triggered by pushes to `main` that ignores its own events and merges only between agent turns; conflict tasks routed to the owning session or the conflict-resolver; a serialized merge queue; automatic revert when `main` goes red after a merge, reopening the session with the failure log.

Done when:
- A scripted scenario with three features that touch the same `shared/` files reaches `main` with zero human actions, and no conflict is ever surfaced to a human.
- An injected post-merge failure is reverted automatically and its session reopens and fixes it.
- Event counts stay bounded in the scenario logs (no merge or push loops).

## Phase 3: specialization

Build: specialist profiles as coder subagents with write scopes enforced by the gate on the diff; test-first, where the test agent's failing tests are locked and the gate rejects coder commits that touch them (role read from git notes); a reviewer on a different model that checks the diff against the spec; parallel attempts as extra forks with the reviewer picking one; the full dashboard.

Done when:
- On a fixed benchmark of at least 10 features, the revert rate is lower than the Phase 2 baseline on the same benchmark.
- No write-scope or locked-test violation ever reaches `main`.

## Phase 4: memory

Build: project memory files in the repo indexed in Vectorize; session memory in each Durable Object's SQLite; git history and notes as episodic memory; the conversation tree and manager chat, where a merged feature's branch is condensed into project memory; a gardener that updates the feature map after every merge and turns repeated correction events into lint rules or template changes.

Done when:
- Replaying a benchmark item whose earlier attempt was reverted, a new session does not repeat the reverted mistake.
- The gardener has added at least one lint rule produced from real correction events, and the feature map matches the code after every merge.

## Phase 5: voice and learning

Build: GPT-Live-1 as a voice front end that hands requests to the same router; export of merged sessions as positive and reverted commits as negative examples; one fine-tuned profile (for example a LoRA on Workers AI).

Done when:
- A spoken request routes correctly and ships a feature with zero human actions.
- The tuned profile is compared with the base profile on a held-out benchmark and the result is recorded, whichever way it goes.

## Whole-project definition of done

- All phase criteria above are met, with evidence in `docs/progress/phase-<n>.md` (commands run, logs, preview URLs, commit ids).
- `README.md` lets someone deploy chef to a fresh Cloudflare account from zero, and doing so on a clean account works.
- Human actions per merged feature, measured by the dashboard, is zero.

## How to work

- Build the thinnest end-to-end slice on fakes first, then replace one fake at a time with a real adapter.
- Keep `docs/ARCHITECTURE.md` current with the code.
- When a credential is missing (Cloudflare API token and account id, TypeSafe API key, the CPA gateway URL and key for Claude, an OpenAI key for Phase 5), keep going on fakes and list exactly what is needed in the current progress file.
- When a phase's criteria are met, write its progress file before starting the next phase.
