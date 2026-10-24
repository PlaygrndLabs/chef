# Self-hosting Chef

Chef runs on Cloudflare: the dashboard, projects, agents, sandboxes with your running apps, and repos all live in your Cloudflare account, so work goes on when no browser is open. You use it from any browser.

## What you need

- A Cloudflare account on the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) ($5 a month), with Containers and Artifacts available. Sandboxes run there, each with Docker and the whole app of one branch.
- A model provider: an Anthropic API key, or any Anthropic-compatible provider (base URL and key). You add it in Settings after the deploy.
- To deploy from the command line: Node 22.18 or later, pnpm 10, git and Docker (to build the sandbox image).

## Deploy to Cloudflare in one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PlaygrndLabs/chef)

1. Press the button. Cloudflare copies Chef into a new repository on your GitHub or GitLab account and connects it to Workers Builds. If you give the Worker another name than `chef`, its Artifacts namespace, Workflow, memory index and app router take that name too, so several Chefs can share an account.
2. Set `CHEF_PASSWORD`, the password you will sign in with. Use at least 8 characters; `openssl rand -base64 24` makes a good one. If you leave the example value, Chef ignores it and asks the first visitor to pick a password.
3. Deploy. The build runs Chef's `deploy` script (`pnpm run deploy`): it builds the dashboard and the sandbox image, creates the memory index and the R2 bucket that keeps the coders' Claude transcripts if they are missing, and deploys the Worker with its Durable Objects, container, Workflow and Artifacts namespace.
4. The API token Workers Builds makes can edit Workers Scripts, KV and R2 only, so the first build stops with a message about the token. Open the Worker's Settings > Builds to see which token it uses, add Containers, Artifacts and Vectorize (Edit) to it under My Profile > API Tokens, and retry the build.
5. Open `https://<worker name>.<your-subdomain>.workers.dev`, sign in, and fill in Settings: your model provider and the Cloudflare account that gives running apps their addresses. Then create your first project.

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

`pnpm run deploy` is the same command the button and the `deploy` workflow run. It prints Chef's address when it is done. Without `CHEF_PASSWORD`, the first visitor picks the password, so set it right away or open Chef first.

## Deploy from GitHub Actions

1. Fork this repository.
2. Add the Actions secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token that can edit Workers Scripts, Containers, Vectorize, Workflows, Artifacts and Workers R2 Storage), and `CHEF_PASSWORD`. Without R2 Chef still deploys, but keeps no transcripts of its coders' work, so a turn whose sandbox restarts starts over.
3. Every green `ci` run on `main` now deploys with `pnpm run deploy`, then checks the Worker answers and that the password signs in. You can also run the `deploy` workflow by hand.

Any secret from [Settings](#settings) that the repository has is passed to the Worker as a default.

## More than one Chef in an account

`pnpm run deploy --name chef-trial`, or the `deploy` workflow's `name` input, deploys a separate Chef named `chef-trial` with its own Artifacts namespace, Workflow, memory index, transcript bucket and app router, all named after it as in the table below. It is how changes to Chef itself are tried on Cloudflare before they reach the main deploy; the workflows name such test copies `chef-test-…`, for example `chef-test-resume`. The `cleanup` workflow removes such a copy and everything it created.

## Names on Cloudflare

Everything Chef makes in a Cloudflare account starts with `chef`, so it never mixes with your other work and can be found, or removed by hand, by that name. A Chef's own name is `chef` or starts with `chef-` (`chef deploy --name` refuses any other), and each of its resources starts with that name. For the main Chef, `chef`, and a second one named `chef-dev`:

| Resource | `chef` | `chef-dev` |
| --- | --- | --- |
| Engine Worker, its Durable Objects and event trigger | `chef` | `chef-dev` |
| Sandboxes (container application) | `chef-sessionagent` | `chef-dev-sessionagent` |
| Workflow | `chef-upstream-sync` | `chef-dev-upstream-sync` |
| App router Worker, one preview per running app | `chef-app` | `chef-dev-app` |
| A running app, for example main of the project `notes` | `main-notes-chef-app.example.workers.dev` | `main-notes-chef-dev-app.example.workers.dev` |
| Artifacts namespace (each project's repos inside it) | `chef` | `chef-dev` |
| Memory index | `chef-memory` | `chef-dev-memory` |
| Transcript bucket | `chef-transcripts` | `chef-dev-transcripts` |

A Worker the Deploy to Cloudflare button renamed keeps that name for its resources instead.

## Scripts and the API

Scripts and other apps call Chef with an API key: `Authorization: Bearer chef_…`. Make one in Settings > API keys; Chef shows it once and keeps only a hash. For example, `curl -X POST -H "Authorization: Bearer <key>" -H "content-type: application/json" -d '{"name":"shop"}' https://<chef>/api/projects` creates the project `shop` from `template/`. Each key has a name, can end after a set time, and can be revoked on its own. The password only signs in from a browser; it is never accepted as a Bearer token.

`pnpm run deploy --api-key` makes a new key during the deploy, sends it as the `CHEF_API_KEY` secret and prints it once; `--api-key-file <path>` writes it to that file instead. It is the key for an app that manages Chef for other people: requests made with it may say which person they act for (`x-chef-user`) and which address their links should use (`x-chef-origin`), which Chef ignores from any other caller. Each such deploy replaces the earlier key. A Chef with a key but no password never shows a sign-in or setup page; set `CHEF_HOME` to the address browsers should be sent to instead. The `cloud` workflow (Actions, run by hand) bootstraps a project, sends a prompt, follows its sessions until they end and prints the Worker's logs.

## Models

Default models are in `wrangler.jsonc` (`PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `JEV_MODEL`, `VOICE_MODEL` for an OpenAI key, `REALTIME_MODEL` for any other voice provider); Settings > Models overrides all of them except `JEV_MODEL`.

Optional tuned reviewer: train it with `python tune/train.py` (see `tune/README.md`), upload it with `npx wrangler ai finetune create @cf/google/gemma-2b-it-lora chef-reviewer tune/out/adapter`, and set the var `REVIEWER_LORA` to `chef-reviewer`.

## Settings

A self-hosted Chef is set up from its own dashboard, like any other app. On the first visit it asks for a password, then Settings opens on whatever is still missing:

| Tab | What it holds | Needed | Same thing as a Worker secret |
| --- | --- | --- | --- |
| Model | Claude through your Anthropic API key, or any Anthropic-compatible provider (base URL and key); the planner, reviewer and coder model ids; parallel attempts per feature | Yes | `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`; `PLANNER_MODEL`, `REVIEWER_MODEL`, `CODER_MODEL`, `ATTEMPTS` |
| App addresses | Cloudflare account id and an API token that can edit Workers, for the small router that gives each branch's running app its address | Yes | `CF_ACCOUNT_ID`, `CF_API_TOKEN` |
| Voice | An OpenAI key (GPT-Live), or a provider that serves the OpenAI Realtime API (base URL with `/v1`, and key) | No | `OPENAI_API_KEY`, or `VOICE_BASE_URL` and `VOICE_API_KEY` |
| Routing | A TypeSafe key, so Jev routes requests in about 100ms; without it Claude routes them | No | `TYPESAFE_API_KEY` |
| Password | The password for signing in from a browser | For browsers | `CHEF_PASSWORD` |
| API keys | Named keys for scripts and apps, each revocable | No | `CHEF_API_KEY`, one key for an app that manages Chef |

What is saved in the dashboard wins over the Worker's secrets, so the secrets are only defaults for a scripted deploy. Saved settings live in the `Settings` Durable Object; the password is stored as a salted PBKDF2 hash. Keys never go back to the browser; the dashboard shows only their last four characters. The coder sandbox gets only placeholders; the Worker's outbound handler swaps in the real keys on the provider's and Cloudflare's hosts.
