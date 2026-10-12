# chef

A human-free, spec-driven software builder on Cloudflare. Each feature has one spec entry and one live preview, and every piece of work on it runs as a session in its own Artifacts fork. Only the merge gate writes `main`.

- Concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77
- Implementation goal: [GOAL.md](GOAL.md)
- How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Status: Phases 0 to 4 (core loop, concurrency, specialist agents, memory) run on fakes, on real git and with real checks; not yet run on a Cloudflare account. See [docs/progress](docs/progress).

## Layout

```
spec/        chef's own feature map
core/        spec, router, state machine, orchestrator, merge, ports and fakes
adapters/    Artifacts, Jev, Claude planner and reviewer, Vectorize memory, the CopilotKit agent
workers/     the chef Worker: project and session Durable Objects, coder sandbox, sync workflow
apps/        dashboard: chat-first CopilotKit UI with a feature list, feature progress, controls and a preview panel
agents/      specialist profiles with write scopes
template/    the template every project chef builds starts from
cli/         chef CLI and local runners
docs/        architecture, spikes, progress
```

## Run locally

Requires Node 22.18 or later, pnpm 10 and git.

```
pnpm install
pnpm run verify                                      # typecheck, lint, spec lint, dashboard build, unit and e2e tests (the browser test needs Chromium: pnpm --filter @chef/cli exec playwright install chromium)
node --import tsx cli/src/bin.ts serve               # dashboard and CopilotKit chat at http://127.0.0.1:8787, after pnpm build
node --import tsx cli/src/bin.ts demo                # one feature through every state with real tsc, tests and proof
node --import tsx cli/src/bin.ts route "fix the add button"
node --import tsx cli/src/bin.ts spike jev           # Jev routing spike; uses Jev when TYPESAFE_API_KEY is set
node --import tsx cli/src/bin.ts bench               # 10-feature benchmark, Phase 2 versus Phase 3 settings, real checks
node --import tsx cli/src/bin.ts bench --mode replay # learn on the benchmark, then replay it in a project seeded with that memory
node --import tsx cli/src/bin.ts voice --say "Add an item to a todo list"   # spoken request end to end; --live uses GPT-Live with OPENAI_API_KEY, or a custom Realtime provider with VOICE_BASE_URL and VOICE_API_KEY
node --import tsx cli/src/bin.ts tune data         # export reviewer examples from real benchmark runs into tune/data
node --import tsx cli/src/bin.ts llm check           # planner and reviewer through your model provider, see below
node --import tsx cli/src/bin.ts demo --live         # one feature with the real planner, Claude coder and reviewer
```

## Model provider

The planner, the reviewer and the coder use Claude. Bring your own provider, like in any other app:

- An Anthropic API key: `ANTHROPIC_API_KEY`.
- A custom provider: any Anthropic-compatible endpoint, set by `LLM_BASE_URL` and `LLM_API_KEY`. It wins over `ANTHROPIC_API_KEY` when both are set.

Voice is optional: an OpenAI API key (`OPENAI_API_KEY`, used with GPT-Live), or a custom provider that serves the OpenAI Realtime API (`VOICE_BASE_URL`, including `/v1`, and `VOICE_API_KEY`).

On Cloudflare the same choices are in the dashboard under Settings, Model provider. What is saved there wins over the Worker's secrets, and the dashboard asks for a provider when none is set. Keys are never sent back to the browser; the dashboard shows only their last four characters. The coder sandbox gets only a placeholder key; the Worker's outbound handler swaps in the real one on the provider's host.

The `llm` workflow (Actions, run by hand) runs `llm check` (mode `check`) or `demo --live` (mode `demo`) with the repository secrets `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`. `TYPESAFE_API_KEY`, when set, makes the demo route with Jev.

## Deploy to a fresh Cloudflare account

1. Use an account on Workers Paid with Artifacts and Containers enabled. Docker must be running where you deploy, to build the sandbox image.
2. Set the secrets for the chef Worker:

   ```
   cd workers
   npx wrangler secret put CHEF_PASSWORD           # the dashboard and API refuse everyone until it is set
   npx wrangler secret put TYPESAFE_API_KEY
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_API_TOKEN            # can edit Workers; previews of project demo go to the Worker chef-project-demo
   ```

   The model provider can be set here too (`ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`; for voice `OPENAI_API_KEY`, or `VOICE_BASE_URL` and `VOICE_API_KEY`), or later in the dashboard.

3. Create the memory index and its metadata indexes, before the first deploy:

   ```
   npx wrangler vectorize create chef-memory --dimensions=768 --metric=cosine
   npx wrangler vectorize create-metadata-index chef-memory --property-name=project --type=string
   npx wrangler vectorize create-metadata-index chef-memory --property-name=kind --type=string
   ```

4. Deploy: `pnpm --filter @chef/workers run deploy`. The `deploy` workflow (Actions, run by hand) does steps 2 to 4 from the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TYPESAFE_API_KEY`, `CHEF_PASSWORD` and, if set, the model provider secrets above. Scripts can call the API with `Authorization: Bearer <CHEF_PASSWORD>`.
5. Create a project: `curl -X POST https://<chef-worker>/api/projects/demo/bootstrap`. This creates the canonical repo `demo` in the `chef` Artifacts namespace from `template/`.
6. Open `https://<chef-worker>/?project=demo` and send a prompt such as "Add an item to a todo list".

The `cloud` workflow (Actions, run by hand) does steps 5 and 6 from CI: it bootstraps a project, sends a prompt, follows its sessions until they end and prints the Worker's logs from `wrangler tail`.

Models are set in `workers/wrangler.jsonc` (`PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `JEV_MODEL`, `VOICE_MODEL`).

Optional tuned reviewer: train it with `python tune/train.py` (see `tune/README.md`), upload it with `npx wrangler ai finetune create @cf/google/gemma-2b-it-lora chef-reviewer tune/out/adapter`, and set the var `REVIEWER_LORA` to `chef-reviewer`.
