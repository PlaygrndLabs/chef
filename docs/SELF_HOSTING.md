# Self-hosting chef

chef runs on Cloudflare: the dashboard, projects, agents, sandboxes, previews and repos all live in your Cloudflare account, so work goes on when no browser is open. You use it from any browser.

## What you need

- A Cloudflare account on the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) ($5 a month), with Containers and Artifacts available. Sandboxes and previews run there.
- A model provider: an Anthropic API key, or any Anthropic-compatible provider (base URL and key). You add it in Settings after the deploy.
- To deploy from the command line: Node 22.18 or later, pnpm 10, git and Docker (to build the sandbox image).

## Deploy to Cloudflare in one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PlaygrndLabs/chef)

1. Press the button. Cloudflare copies chef into a new repository on your GitHub or GitLab account and connects it to Workers Builds.
2. Set `CHEF_PASSWORD`, the password you will sign in with. Use at least 8 characters; `openssl rand -base64 24` makes a good one. If you leave the example value, chef ignores it and asks the first visitor to pick a password.
3. Deploy. The build runs chef's `deploy` script (`pnpm run deploy`): it builds the dashboard and the sandbox image, creates the memory index if it is missing, and deploys the Worker with its Durable Objects, container, Workflow and Artifacts namespace.
4. Open `https://chef.<your-subdomain>.workers.dev`, sign in, and fill in Settings: your model provider and the Cloudflare account for previews. Then create your first project.

To update, pull this repository into your copy and push; Workers Builds deploys every push to its `main` branch:

```
git pull https://github.com/PlaygrndLabs/chef main
git push
```

## Deploy from the command line

You need Docker running, to build the sandbox image.

```
pnpm install
npx wrangler login
pnpm run deploy
npx wrangler secret put CHEF_PASSWORD
```

`pnpm run deploy` is the same command the button and the `deploy` workflow run. It prints chef's address when it is done. Without `CHEF_PASSWORD`, the first visitor picks the password, so set it right away or open chef first.

## Deploy from GitHub Actions

1. Fork this repository.
2. Add the Actions secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token that can edit Workers Scripts, Containers, Vectorize, Workflows and Artifacts), and `CHEF_PASSWORD`.
3. Every green `ci` run on `main` now deploys with `pnpm run deploy`, then checks the Worker answers and accepts the password. You can also run the `deploy` workflow by hand.

Any secret from [Settings](#settings) that the repository has is passed to the Worker as a default.

## More than one chef in an account

`pnpm run deploy --name <name>`, or the `deploy` workflow's `name` input, deploys a separate chef with its own Artifacts namespace (`<name>`), Workflow (`<name>-upstream-sync`), memory index (`<name>-memory`) and project Workers (`<name>-<project>`). It is how changes to chef itself are tried on Cloudflare before they reach the main deploy. The `cleanup` workflow removes such a copy and everything it created.

## Scripts and the API

Scripts can call chef with `Authorization: Bearer <password>`. For example, `curl -X POST -H "Authorization: Bearer <password>" -H "content-type: application/json" -d '{"name":"shop"}' https://<chef>/api/projects` creates the project `shop` from `template/`. The `cloud` workflow (Actions, run by hand) bootstraps a project, sends a prompt, follows its sessions until they end and prints the Worker's logs.

## Models

Default models are in `wrangler.jsonc` (`PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `JEV_MODEL`, `VOICE_MODEL` for an OpenAI key, `REALTIME_MODEL` for any other voice provider); Settings > Models overrides all of them except `JEV_MODEL`.

Optional tuned reviewer: train it with `python tune/train.py` (see `tune/README.md`), upload it with `npx wrangler ai finetune create @cf/google/gemma-2b-it-lora chef-reviewer tune/out/adapter`, and set the var `REVIEWER_LORA` to `chef-reviewer`.

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
