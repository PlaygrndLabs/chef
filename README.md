<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/chef-logo-dark.svg">
    <img src="docs/assets/chef-logo.svg" alt="chef" width="193">
  </picture>
</p>

# chef: a self-hosted AI coding agent that builds and ships your app

[![CI](https://github.com/PlaygrndLabs/chef/actions/workflows/ci.yml/badge.svg)](https://github.com/PlaygrndLabs/chef/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**chef is an AI app builder you host yourself, on your own computer or in your own cloud.** Like ChatGPT or Claude Code, you talk to it. Unlike them, you own every part: the app, the code, the keys and the infrastructure.

Run chef on your PC and the app and its management stay on your machine, while the agents work in your Cloudflare account. Deploy the whole thing to Cloudflare in one click and use it from any browser. Or keep everything on your own machine with Docker.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PlaygrndLabs/chef)

## What chef takes off your plate

- **Sessions run themselves.** Each request becomes a session that chef starts, tracks, keeps up to date and closes for you. Run many at once and none blocks another.
- **No git chores.** No branches, merges, rebases or conflicts to handle. chef keeps every session in sync with `main` and merges finished work for you.
- **A preview for everything.** Every change builds in its own isolated sandbox with a live link. Previews sleep when idle and wake on the next click.
- **Checked before it ships.** Tests, typecheck and an AI review must pass before anything reaches `main`.
- **Your keys stay yours.** Bring an Anthropic API key or any compatible provider. Keys stay on your server, never in the browser or the sandbox.
- **GitHub when you want it.** Projects live with chef, in Cloudflare or on your computer. Connect GitHub only if you want a repo kept in sync.

## Self-host chef

Working in Cloudflare needs a Cloudflare account on the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) with Containers and Artifacts enabled. That is where the agents, sandboxes and previews run.

### In the cloud

1. Press **Deploy to Cloudflare** above and set `CHEF_PASSWORD`, the password you will sign in with.
2. Open `https://chef.<your-subdomain>.workers.dev` and sign in.
3. In Settings, add your model provider and the Cloudflare account for previews. Then create your first project.

### On your computer

1. Install Node 22.18+ and pnpm 10, clone this repository, then run `pnpm install` and `pnpm start`.
2. Open `http://localhost:4300` and choose where chef works:
   - **On Cloudflare** (recommended): this computer shows the app and the work runs in your Cloudflare account, so it stays light and the work goes on while your laptop sleeps. Connect to your chef there, or let the app check your account and set chef up for you.
   - **On this computer**: agents, sandboxes, previews and git repositories run in Docker on your machine, and your projects stay in `~/.chef/local`. No Cloudflare account needed.
3. Add your model key in Settings and create your first project.

You can switch between the two in Settings at any time.

Every setting and the manual deploy steps: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Coming soon

- **Terminal app:** use chef from your terminal, like Claude Code.
- **Desktop app:** the same chat-first interface as a native app.

## Develop

Run `pnpm install` and `pnpm run verify`. Repository layout and the CLI: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
