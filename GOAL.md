# Goal: Chef

This is the goal for anyone, person or coding agent, working in this repository. How the code works today is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the original concept is the Chef concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77

## One-line goal

Chef is an AI app builder that runs on a person's own Cloudflare account: they describe what they want in one chat, and Chef splits it into features, builds each one in its own session with tests, review and a live preview, and merges it into the project's `main`, which is always online at the project's live address.

## What Chef is

- **The person's own engine.** Chef deploys its engine (the Chef Worker, `workers/`) on the person's Cloudflare account with `chef deploy` or the Deploy to Cloudflare button. Agents, sandboxes, repositories, keys and previews all run there. Chef runs on Cloudflare only.
- **The spec is the memory, git is the state, chat is just input.**
- **One chat, many sessions.** The project page has the feature tree on the left, session tabs in the middle (each opens on its preview), and the main chat on the right, the only place a person asks for work. The app row on top opens the live app and the History of `main`, with every commit's changed files and diffs. The chat keeps a running summary of older messages, like a project's main thread.
- **Every feature is a session.** A feature is one spec entry with one live preview. The router splits a request into independent parts that build in parallel, and a part that adds a capability becomes a child feature under the one it builds on. A session is a Durable Object plus its own Artifacts fork named `<project>--<feature>--<session>`.
- **Roles work side by side.** When a plan has build steps for several roles (frontend, backend, designer and others), each role works on its own `lane/<role>` branch in its own sandbox, and Chef merges the lanes after each round.
- **Every turn is a commit.** Each accepted agent turn is one commit with the prompt, run id, model, role and spec revision in git notes under `refs/notes/chef`.
- **Previews and a live address.** After each commit the session head goes to `preview/<feature>`, and `wrangler preview` in the sandbox publishes it as a Preview of the project's Worker. Previews sleep when idle and wake on the next visit. The project's `main` is deployed to its own Worker on every merge and never sleeps.
- **Continuous sync.** Every push to `main` is merged into every active fork between turns. A conflict becomes a task for the same session or the conflict-resolver.
- **Only the merge gate writes to `main`.** It runs typecheck, lint, tests, spec lint, write scopes, locked tests, a reviewer verdict and a proof of the feature's flow on its preview. A merge that turns `main` red is reverted and its session reopens with the failure.
- **Routing.** Rules first, then Jev (TypeSafe AI's System One model) answers typed choice questions with calibrated confidence, then the planner when confidence is low or the feature is new. Jev never writes text.
- **Guidance and memory.** Instructions shared by every project and each project's `GOAL.md` and `AGENTS.md` reach the planner, every coder turn and the reviewer. Each turn also recalls the most relevant documents from the project's memory (`memory/**/*.md`), which people can read and edit in Project settings.
- **The coder** is the Claude Agent SDK in a Cloudflare Sandbox on the fork's checkout. It reaches Claude through the person's own model provider (an Anthropic API key or any Anthropic-compatible provider), the same one the planner and reviewer use.
- **Keys stay in the account.** Project keys are sealed in the project's Durable Object; agents see names only, previews and the live app get the values.
- **GitHub is optional.** Work always runs on Artifacts. A project can link a repository through Chef's own GitHub App to keep it in sync; Chef never pushes to its main branch.
- **Streaming.** Sessions reach the app through CopilotKit (AG-UI) and the project's live event socket.

## Non-negotiables

1. The build loop runs on its own. A feature that cannot finish becomes `stuck` and blocks nothing else.
2. No agent ever receives a token that can write to canonical `main`.
3. Never skip, disable, weaken or delete a test or acceptance criterion to get green. Only the planner changes the spec, through a `spec_change` item.
4. Fix every agent mistake at the highest layer that would have stopped it: codebase > architecture that makes it impossible > lint/typecheck/CI > rules and skills. Never only in a prompt.
5. Feature = folder. A session writes only inside its feature's vertical slice (a child feature may also change its parent's folder); `shared/` contracts change only through a stricter gated path.
6. Every external service sits behind a small interface in `core/src/ports` with an in-memory fake. All tests run on fakes; real adapters are swapped in by config.
7. Chef is provider-neutral: code, docs, defaults and tests name only generic model provider settings.
8. All code, file names, docs and commit messages are in English. No explanatory AI comments in code.
9. Commits use author and committer email `ma.karimi76@gmail.com` and never carry a `Co-Authored-By: Claude` trailer.

## Stack

TypeScript everywhere, pnpm workspaces, Wrangler, Workers, Durable Objects (Agents SDK), Workflows, Cloudflare Containers and Sandbox, the Artifacts Workers binding, Vectorize, Workers AI, `@typesafe-ai/sdk`, the Claude Agent SDK, CopilotKit, React with shadcn/ui for the app, and zod at every edge. GitHub Actions runs typecheck, lint, unit tests and the fake end-to-end suite on every push, and deploys after green CI on `main`.

```
workers/     the engine: ProjectAgent and SessionAgent Durable Objects, coder sandbox, sync workflow, HTTP API
core/        spec, router, session state machine, orchestrator, merge gate, ports and fakes (no I/O)
adapters/    Artifacts, Jev, Claude planner and reviewer, Vectorize memory, CopilotKit agent, GitHub
apps/        the dashboard
agents/      default role profiles (planner, test, frontend, backend, designer, reviewer, conflict-resolver, gardener, chore)
template/    the template every project starts from, with its UI kit and the app CLI (drive, proof)
cli/         Chef CLI: spec lint, deploy, benchmarks, test server
spec/        Chef's own feature map
```

## Where it stands

Phases 0 to 5 of the original plan (spikes, core loop, concurrency, specialization, memory, voice and learning) are done, with evidence in `docs/progress/`. Since then Chef gained the tree, tabs and chat project page, request splitting into child features, parallel role lanes, per-project live addresses, project keys, guidance and memory, and a UI kit so the apps it builds look polished by default.

## Definition of done

- A new person goes from deploying Chef on their Cloudflare account to a merged feature at their project's live address, with no step outside Chef beyond the deploy and adding a model key.
- Several features requested in one message build in parallel and all reach `main` with tests, review and proof.
- Steps a person takes per merged feature, measured by the dashboard, are zero.

## How to work

- Build the thinnest end-to-end slice on fakes first, then replace one fake at a time with a real adapter.
- Keep `docs/ARCHITECTURE.md` current with the code.
- Check changes on the real app: the `ui` workflow drives a build on the deployed engine and uploads screenshots.
- When a credential is missing, keep going on fakes and list exactly what is needed.
