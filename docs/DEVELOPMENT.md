# Developing chef

## Repository layout

```
spec/        chef's own feature map
core/        spec, router, state machine, orchestrator, merge, ports and fakes
adapters/    Artifacts, Jev, Claude planner and reviewer, Vectorize memory, the CopilotKit agent
workers/     the chef Worker: project and session Durable Objects, coder sandbox, sync workflow (configured by the root wrangler.jsonc)
apps/        dashboard: chat-first CopilotKit UI with a feature list, feature progress, controls and a preview panel
agents/      specialist profiles with write scopes
template/    the template every project chef builds starts from
cli/         chef CLI, the local app (chef app) and deploy script (chef deploy), local runners
docs/        architecture, spikes, progress
```

## Run locally

Requires Node 22.18 or later, pnpm 10 and git.

```
pnpm install
pnpm start                                           # the app on this computer; its first screen chooses Cloudflare or this computer (see docs/SELF_HOSTING.md)
pnpm start --local                                   # everything on this computer without asking: the engine runs in-process and agents, checks and previews run in Docker
pnpm run deploy [--name n] [--dry-run]               # build and deploy to Cloudflare; the Deploy button and the deploy workflow run the same script
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

## Testing the local engine

`cli/test/unit/engine.test.ts` runs the local engine with a stand-in for Docker. `CHEF_DOCKER_E2E=1 pnpm exec vitest run --project e2e cli/test/e2e/local-sandbox.test.ts` takes a feature through checks, a preview and its proof in real containers (it builds the sandbox image the first time). `CHEF_LIVE_LOCAL=1` with a model key runs `cli/test/e2e/local-live.test.ts`, a whole feature with a real model; CI runs it on pull requests labelled `live-local`. Behind a proxy on `localhost`, set `CHEF_SANDBOX_NETWORK=host`.

## Model provider for the CLI

The local CLI reads the same environment variables. The `llm` workflow (Actions, run by hand) runs `llm check` (mode `check`) or `demo --live` (mode `demo`) with the repository secrets `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`. `TYPESAFE_API_KEY`, when set, makes the demo route with Jev.
