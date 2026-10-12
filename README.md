# chef

A human-free, spec-driven software builder on Cloudflare. Each feature has one spec entry and one live preview, and every piece of work on it runs as a session in its own Artifacts fork. Only the merge gate writes `main`.

- Concept doc: https://claude.ai/code/artifact/21197d74-c9ea-42da-b7ba-c34d4b201e77
- Implementation goal: [GOAL.md](GOAL.md)
- How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Status: runs on Cloudflare (Workers, Durable Objects, Containers, Artifacts) with real Claude; progress notes in [docs/progress](docs/progress).

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

## Settings

A self-hosted chef is set up from its own dashboard, like any other app. On the first visit it asks for a password, then Settings opens on whatever is still missing:

| Tab | What it holds | Needed | Same thing as a Worker secret |
| --- | --- | --- | --- |
| Model | Claude through your Anthropic API key, or any Anthropic-compatible provider (base URL and key); the planner, reviewer and coder model ids; parallel attempts per feature | Yes | `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`; `PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `ATTEMPTS` |
| Previews | Cloudflare account id and an API token that can edit Workers, for each feature's live preview | Yes | `CF_ACCOUNT_ID`, `CF_API_TOKEN` |
| Voice | An OpenAI key (GPT-Live), or a provider that serves the OpenAI Realtime API (base URL with `/v1`, and key) | No | `OPENAI_API_KEY`, or `VOICE_BASE_URL` and `VOICE_API_KEY` |
| Routing | A TypeSafe key, so Jev routes requests in about 100ms; without it Claude routes them | No | `TYPESAFE_API_KEY` |
| Password | The dashboard password, also accepted as a Bearer token by scripts | Yes | `CHEF_PASSWORD` |

What is saved in the dashboard wins over the Worker's secrets, so the secrets are only defaults for a scripted deploy. Saved settings live in the `Settings` Durable Object; the password is stored as a salted PBKDF2 hash. Keys never go back to the browser; the dashboard shows only their last four characters. The coder sandbox gets only placeholders; the Worker's outbound handler swaps in the real keys on the provider's and Cloudflare's hosts.

The local CLI reads the same environment variables. The `llm` workflow (Actions, run by hand) runs `llm check` (mode `check`) or `demo --live` (mode `demo`) with the repository secrets `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`. `TYPESAFE_API_KEY`, when set, makes the demo route with Jev.

## Host your own

The shortest way, with no tools on your machine:

1. Fork this repository on GitHub.
2. In the fork, add two Actions secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token that can edit Workers, Containers, Vectorize and Artifacts). The account needs Workers Paid with Artifacts and Containers enabled.
3. Run the `deploy` workflow from the Actions tab. It creates the memory index, builds the sandbox image and prints chef's URL.
4. Open the URL, pick a password, and fill in Settings: your Claude provider and the Cloudflare account for previews. Everything else is optional.

A Deploy to Cloudflare button is not offered yet: the button builds a self-contained Worker folder and does not document Containers or Artifacts, both of which chef needs.

## Deploy to a fresh Cloudflare account by hand

1. Use an account on Workers Paid with Artifacts and Containers enabled. Docker must be running where you deploy, to build the sandbox image.
2. Optional: set any of the secrets from [Settings](#settings) with `npx wrangler secret put <NAME>` in `workers/`. Everything can also be set in the dashboard after the deploy.

3. Create the memory index and its metadata indexes, before the first deploy:

   ```
   npx wrangler vectorize create chef-memory --dimensions=768 --metric=cosine
   npx wrangler vectorize create-metadata-index chef-memory --property-name=project --type=string
   npx wrangler vectorize create-metadata-index chef-memory --property-name=kind --type=string
   ```

4. Deploy: `pnpm --filter @chef/workers run deploy`. The `deploy` workflow (Actions, run by hand) does steps 2 to 4 from the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus whichever secrets from [Settings](#settings) the repository has. Scripts can call the API with `Authorization: Bearer <password>`.
5. Open `https://<chef-worker>/`, pick a password and fill in Settings. Create a project from the dashboard, or with `curl -X POST -H "Authorization: Bearer <password>" https://<chef-worker>/api/projects/demo/bootstrap`. This creates the canonical repo `demo` in the `chef` Artifacts namespace from `template/`.
6. Open `https://<chef-worker>/?project=demo` and send a prompt such as "Add an item to a todo list".

The `cloud` workflow (Actions, run by hand) does steps 5 and 6 from CI: it bootstraps a project, sends a prompt, follows its sessions until they end and prints the Worker's logs from `wrangler tail`.

Default models are in `workers/wrangler.jsonc` (`PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `JEV_MODEL`, `VOICE_MODEL`); Settings overrides the first three.

Optional tuned reviewer: train it with `python tune/train.py` (see `tune/README.md`), upload it with `npx wrangler ai finetune create @cf/google/gemma-2b-it-lora chef-reviewer tune/out/adapter`, and set the var `REVIEWER_LORA` to `chef-reviewer`.
