# Developing Chef

## Repository layout

```
spec/        Chef's own feature map
core/        spec, router, state machine, orchestrator, merge, ports and fakes
adapters/    Artifacts, Jev, Claude planner and reviewer, Vectorize memory, guidance, GitHub, the CopilotKit agent
workers/     the engine, the Chef Worker: project and session Durable Objects, coder sandbox, sync workflow (configured by the root wrangler.jsonc)
apps/        dashboard: feature list, session tabs that open on each preview, and the CopilotKit project chat
agents/      default role profiles with write scopes
template/    the template every project Chef builds starts from
cli/         Chef CLI: spec lint, deploy script (`chef deploy`), benchmarks, the test server, local check runners
docs/        architecture, spikes, progress
```

## Commands

Requires Node 22.18 or later, pnpm 10 and git.

```
pnpm install
pnpm run deploy [--name n] [--dry-run]               # build and deploy the engine to Cloudflare; the deploy workflow runs the same script
pnpm run verify                                      # typecheck, lint, spec lint, dashboard build, unit and e2e tests (the browser test needs Chromium: pnpm --filter @chef/cli exec playwright install chromium)
node --import tsx cli/src/bin.ts serve               # dashboard and CopilotKit chat at http://127.0.0.1:8787, after pnpm build
node --import tsx cli/src/bin.ts demo                # one feature through every state with real tsc, tests and proof
node --import tsx cli/src/bin.ts route "fix the add button"
node --import tsx cli/src/bin.ts spike jev           # Jev routing spike; uses Jev when TYPESAFE_API_KEY is set
node --import tsx cli/src/bin.ts bench               # 10-feature benchmark, Phase 2 versus Phase 3 settings, real checks
node --import tsx cli/src/bin.ts bench --mode replay # learn on the benchmark, then replay it in a project seeded with that memory
node --import tsx cli/src/bin.ts voice --say "Add an item to a todo list"   # spoken request end to end; --live uses GPT-Live with OPENAI_API_KEY, or a custom Realtime provider with VOICE_BASE_URL and VOICE_API_KEY
node --import tsx cli/src/bin.ts tune data         # export reviewer examples from real benchmark runs into tune/data
node --import tsx cli/src/bin.ts llm check           # planner and reviewer through your model provider, see [Model provider for the CLI](#model-provider-for-the-cli)
node --import tsx cli/src/bin.ts demo --live         # one feature with the real planner, Claude coder and reviewer
```

## Checking on Cloudflare

CI deploys the engine after every green run on `main`. The `cloud` workflow sends one prompt to a deployed engine and follows it to the end, and the `ui` workflow drives a real build in the dashboard with Playwright and uploads the screenshots. Both need the deployment's Cloudflare and model provider secrets.

## Model provider for the CLI

The local CLI reads the same environment variables. The `llm` workflow (Actions, run by hand) runs `llm check` (mode `check`) or `demo --live` (mode `demo`) with the repository secrets `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`. `TYPESAFE_API_KEY`, when set, makes the demo route with Jev.
