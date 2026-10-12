# kargah

A human-free, spec-driven software builder on Cloudflare. Each feature has one spec entry and one live preview, and every piece of work on it runs as a session in its own Artifacts fork. Only the merge gate writes `main`.

- Concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77
- Implementation goal: [GOAL.md](GOAL.md)
- How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Status: Phases 0 to 4 (core loop, concurrency, specialist agents, memory) run on fakes, on real git and with real checks; not yet run on a Cloudflare account. See [docs/progress](docs/progress).

## Layout

```
spec/        kargah's own feature map
core/        spec, router, state machine, orchestrator, merge, ports and fakes
adapters/    Artifacts, Jev, Claude planner and reviewer, Workers Builds previews, Vectorize memory, the CopilotKit agent
workers/     the kargah Worker: project and session Durable Objects, coder sandbox, sync workflow
apps/        dashboard with a CopilotKit chat that streams sessions
agents/      specialist profiles with write scopes
template/    the template every project kargah builds starts from
cli/         kargah CLI and local runners
docs/        architecture, spikes, progress
```

## Run locally

Requires Node 22.18 or later, pnpm 10 and git.

```
pnpm install
pnpm run verify                                      # typecheck, lint, spec lint, dashboard build, unit and e2e tests (the browser test needs Chromium: pnpm --filter @kargah/cli exec playwright install chromium)
node --import tsx cli/src/bin.ts serve               # dashboard and CopilotKit chat at http://127.0.0.1:8787, after pnpm build
node --import tsx cli/src/bin.ts demo                # one feature through every state with real tsc, tests and proof
node --import tsx cli/src/bin.ts route "fix the add button"
node --import tsx cli/src/bin.ts spike jev           # Jev routing spike; uses Jev when TYPESAFE_API_KEY is set
node --import tsx cli/src/bin.ts bench               # 10-feature benchmark, Phase 2 versus Phase 3 settings, real checks
node --import tsx cli/src/bin.ts bench --mode replay # learn on the benchmark, then replay it in a project seeded with that memory
node --import tsx cli/src/bin.ts voice --say "Add an item to a todo list"   # spoken request end to end; --live uses GPT-Live with OPENAI_API_KEY
node --import tsx cli/src/bin.ts tune data         # export reviewer examples from real benchmark runs into tune/data
node --import tsx cli/src/bin.ts llm check           # planner and reviewer through the local CPA, see dev/cpa/README.md
node --import tsx cli/src/bin.ts demo --live         # one feature with the real planner, Claude coder and reviewer
```

The `llm` workflow (Actions, run by hand) runs `llm check` (mode `check`) or `demo --live` (mode `demo`) against the gateway in the `CPA_BASE_URL` secret, falling back to `https://llm-gateway.playgrndlabs.workers.dev`, with the `CPA_API_KEY` secret. `TYPESAFE_API_KEY`, when set, makes the demo route with Jev.

The planner, the reviewer and the coder reach Claude through CPA (CLIProxyAPI) with a subscription login, set by `CPA_BASE_URL` and `CPA_API_KEY`. On Cloudflare `CPA_BASE_URL` is a public HTTPS gateway in front of CPA. The coder sandbox gets only a placeholder key; the Worker's outbound handler swaps in `CPA_API_KEY`. `ANTHROPIC_API_KEY` is used by the planner and reviewer only when `CPA_BASE_URL` is not set.

## Deploy to a fresh Cloudflare account

1. Use an account on Workers Paid with Artifacts, Containers and Workers Builds enabled. Docker must be running where you deploy, to build the sandbox image.
2. Set the secrets for the kargah Worker:

   ```
   cd workers
   npx wrangler secret put CPA_BASE_URL            # the CPA gateway's public HTTPS URL
   npx wrangler secret put CPA_API_KEY
   npx wrangler secret put TYPESAFE_API_KEY
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_API_TOKEN            # can read Workers Builds for the account
   npx wrangler secret put OPENAI_API_KEY          # optional: the voice front end (GPT-Live)
   ```

3. Create the memory index and its metadata indexes, before the first deploy:

   ```
   npx wrangler vectorize create kargah-memory --dimensions=768 --metric=cosine
   npx wrangler vectorize create-metadata-index kargah-memory --property-name=project --type=string
   npx wrangler vectorize create-metadata-index kargah-memory --property-name=kind --type=string
   ```

4. Deploy: `pnpm --filter @kargah/workers run deploy`. The `deploy` workflow (Actions, run by hand) does steps 2 to 4 from the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CPA_BASE_URL`, `CPA_API_KEY`, `TYPESAFE_API_KEY` and, if set, `OPENAI_API_KEY`.
5. Create a project: `curl -X POST https://<kargah-worker>/api/projects/demo/bootstrap`. This creates the canonical repo `demo` in the `kargah` Artifacts namespace from `template/`.
6. One-time: in the dashboard, connect the `demo` Artifacts repo to Workers Builds as the Worker `kargah-project` and turn on builds for preview branches.
7. Open `https://<kargah-worker>/?project=demo` and send a prompt such as "Add an item to a todo list".

Models are set in `workers/wrangler.jsonc` (`PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `JEV_MODEL`, `VOICE_MODEL`).

Optional tuned reviewer: train it with `python tune/train.py` (see `tune/README.md`), upload it with `npx wrangler ai finetune create @cf/google/gemma-2b-it-lora kargah-reviewer tune/out/adapter`, and set the var `REVIEWER_LORA` to `kargah-reviewer`.
