# kargah

A human-free, spec-driven software builder on Cloudflare. Each feature has one spec entry and one live preview, and every piece of work on it runs as a session in its own Artifacts fork. Only the merge gate writes `main`.

- Concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77
- Implementation goal: [GOAL.md](GOAL.md)
- How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Status: Phase 1 core loop runs on fakes, on real git and with real checks; not yet run on a Cloudflare account. See [docs/progress](docs/progress).

## Layout

```
spec/        kargah's own feature map
core/        spec, router, state machine, orchestrator, merge, ports and fakes
adapters/    Artifacts, Jev, Claude planner and reviewer, Workers Builds previews
workers/     the kargah Worker: project and session Durable Objects, Copilot sandbox, sync workflow
apps/        dashboard
agents/      specialist profiles with write scopes
template/    the template every project kargah builds starts from
cli/         kargah CLI and local runners
docs/        architecture, spikes, progress
```

## Run locally

Requires Node 22.18 or later, pnpm 10 and git.

```
pnpm install
pnpm run verify                                      # typecheck, lint, spec lint, unit and e2e tests
node --import tsx cli/src/bin.ts demo                # one feature through every state with real tsc, tests and proof
node --import tsx cli/src/bin.ts route "fix the add button"
node --import tsx cli/src/bin.ts spike jev           # Jev routing spike; uses Jev when TYPESAFE_API_KEY is set
```

## Deploy to a fresh Cloudflare account

1. Use an account on Workers Paid with Artifacts, Containers and Workers Builds enabled. Docker must be running where you deploy, to build the sandbox image.
2. Set the secrets for the kargah Worker:

   ```
   cd workers
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put TYPESAFE_API_KEY
   npx wrangler secret put COPILOT_GITHUB_TOKEN    # a GitHub identity with Copilot access
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_API_TOKEN            # can read Workers Builds for the account
   ```

3. Deploy: `pnpm --filter @kargah/workers run deploy`.
4. Create a project: `curl -X POST https://<kargah-worker>/api/projects/demo/bootstrap`. This creates the canonical repo `demo` in the `kargah` Artifacts namespace from `template/`.
5. One-time: in the dashboard, connect the `demo` Artifacts repo to Workers Builds as the Worker `kargah-project` and turn on builds for preview branches.
6. Open `https://<kargah-worker>/?project=demo` and send a prompt such as "Add an item to a todo list".

Models are set in `workers/wrangler.jsonc` (`PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `JEV_MODEL`).
