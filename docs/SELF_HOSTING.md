# Self-hosting chef

chef is an app you host yourself. Pick where it runs:

- **In the cloud.** The whole of chef runs in your Cloudflare account and you use it from any browser.
- **On your computer, working in the cloud.** The app and project management run on your computer, and the work (sessions, sandboxes, previews and project repos) runs in your Cloudflare account. Like ChatGPT or Claude Code, the app is only the window: close your laptop and the work goes on, and your computer stays light.
- **Fully on your computer.** Everything runs on your machine: the app, projects, agents, sandboxes, previews and plain git repositories. You need Docker and a model key, and no Cloudflare account.

On your computer one app covers both of the last two. `pnpm start` opens a first screen that asks where chef should work, checks your Cloudflare account and sets chef up there if it is not there yet. You can change the choice later in Settings.

| | In the cloud | On your computer, working in the cloud | Fully on your computer |
| --- | --- | --- | --- |
| Start it with | the Deploy button | `pnpm start`, then **On Cloudflare** | `pnpm start`, then **On this computer** (or `pnpm start --local`) |
| Interface | served by your chef Worker | `http://localhost:4300` | `http://localhost:4300` |
| Projects, settings, keys | your chef in Cloudflare | your chef in Cloudflare; this computer keeps only its address and password | `~/.chef/local` on this computer |
| Sessions, sandboxes, previews, repos | Cloudflare | Cloudflare | Docker and git on this computer |
| Keeps working when your computer sleeps | yes | yes | no, it carries on when the computer wakes |
| Needs | a Cloudflare account | a Cloudflare account | Docker and enough CPU, memory and disk for the sandboxes |

## What you need

- A Cloudflare account on the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) ($5 a month), with Containers and Artifacts available. Sandboxes and previews run there.
- A model provider: an Anthropic API key, or any Anthropic-compatible provider (base URL and key). You add it in Settings after the deploy.
- For the local app: Node 22.18 or later, pnpm 10 and git.

Running fully on your computer needs only Node 22.18 or later, pnpm 10, git, Docker and a model provider.

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

## Run chef on your computer

Clone this repository, then:

```
pnpm install
pnpm start
```

`pnpm start` builds the app and opens it at `http://localhost:4300` (`--port` or `PORT` changes the port). The first screen asks where chef should work:

- **On Cloudflare** (recommended). The work runs in your Cloudflare account, so this computer only shows the app. Choose it when your computer is short on CPU, memory or disk, or when work should go on while it sleeps.
  - **I have chef there**: enter your chef's address and password. If that chef has no password yet, the one you enter becomes its password.
  - **Set it up**: create an API token in Cloudflare from the Edit Cloudflare Workers template, with edit access to Containers, Vectorize, Workflows and Artifacts added, and copy your account id. **Check my account** looks for chef in that account. If it is there, enter its password to connect. If it is not, pick a password and **Set up chef on Cloudflare** deploys it from this computer (this needs Docker, to build the sandbox image) and connects when it is up. Without Docker, use the Deploy button above and then connect.
- **On this computer**. Everything runs here in Docker; see [Run chef fully on your computer](#run-chef-fully-on-your-computer).

From then on `pnpm start` opens straight into your projects. The choice, and the address and password of a chef in Cloudflare, are kept in `~/.chef/connection.json`, readable only by you (`CHEF_HOME` moves the folder). `CHEF_URL` and `CHEF_PASSWORD` in the environment connect without the file, and `pnpm start --local` runs on this computer without asking.

To switch, open Settings: **Password** (when working in Cloudflare) or **This computer** (when working here) has **Choose where chef works**, which takes you back to the first screen. Projects stay where they were made: projects on this computer stay in `~/.chef/local`, and projects in Cloudflare stay there, ready for when you switch back.

How it works: when working in Cloudflare, the local app serves the dashboard and passes every API call, live update and preview link on to your chef, adding the password on the way. The password never reaches the browser. The app listens on `127.0.0.1` only and answers only its own pages, so other websites you visit cannot use it. A future terminal app and desktop app will talk to chef the same way.

## Run chef fully on your computer

1. Install and start [Docker](https://docs.docker.com/get-docker/) (Docker Desktop on macOS and Windows, Docker Engine on Linux).
2. Clone this repository, run `pnpm install` and `pnpm start`, and choose **On this computer** on the first screen (or run `pnpm start --local` to skip the question). The first start builds the sandbox image, which takes a few minutes; later starts skip it.
3. Add your model provider in Settings and create your first project.

Everything chef keeps lives in `~/.chef/local` (`CHEF_HOME` moves it): the project repos as plain git repositories, each project's sessions and event log, its memory, and your settings, readable only by you. `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` and `LLM_API_KEY`, in the environment work as defaults, as do the other [Settings](#settings) variables. Stop chef with Ctrl+C; unfinished sessions pick up where they left off on the next start.

How it works: the same engine that runs in the Worker runs inside the local app. Each coder turn, each check run, each proof and each preview runs in its own Docker container from the sandbox image. Containers read the project repos through a read-only mount and hand their changes back to chef, which commits them. A preview is the project's Worker in `wrangler dev`, on a `localhost` port; it starts when you open its link, stops after it sits idle (Project settings sets how long) and is rebuilt on the next visit. The app listens on `127.0.0.1` only and answers only its own pages, so it needs no password.

Differences from chef in Cloudflare:

- Work pauses while the computer sleeps or chef is stopped.
- Connect GitHub needs chef in Cloudflare, because GitHub has to reach it. To keep a project in sync with GitHub or any other git host, choose Other git host and give the repository's address and an access token; chef pulls every few minutes and pushes after each merge.
- A sandbox can reach the internet freely; in Cloudflare it reaches only the hosts it needs.
- A custom model provider on `localhost` is reached from the containers as `host.docker.internal`, so on Linux it has to listen on more than `127.0.0.1`. Behind a proxy on `localhost`, set `CHEF_SANDBOX_NETWORK=host`.

## Deploy from your computer

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
3. Every green `ci` run on `main` now deploys with `pnpm run deploy`, then checks the Worker answers and that the local app reaches it. You can also run the `deploy` workflow by hand.

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
| Previews | Cloudflare account id and an API token that can edit Workers, for each feature's live preview | In Cloudflare only | `CF_ACCOUNT_ID`, `CF_API_TOKEN` |
| Voice | An OpenAI key (GPT-Live), or a provider that serves the OpenAI Realtime API (base URL with `/v1`, and key) | No | `OPENAI_API_KEY`, or `VOICE_BASE_URL` and `VOICE_API_KEY` |
| Routing | A TypeSafe key, so Jev routes requests in about 100ms; without it Claude routes them | No | `TYPESAFE_API_KEY` |
| Password | The dashboard password, also accepted as a Bearer token by scripts | In Cloudflare only | `CHEF_PASSWORD` |

What is saved in the dashboard wins over the Worker's secrets, so the secrets are only defaults for a scripted deploy. Saved settings live in the `Settings` Durable Object; the password is stored as a salted PBKDF2 hash. Keys never go back to the browser; the dashboard shows only their last four characters. The coder sandbox gets only placeholders; the Worker's outbound handler swaps in the real keys on the provider's and Cloudflare's hosts.
