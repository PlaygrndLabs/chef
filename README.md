<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/chef-logo-dark.svg">
    <img src="docs/assets/chef-logo.svg" alt="chef" width="236">
  </picture>
</p>

# chef: an AI app builder that runs on your Cloudflare account

[![CI](https://github.com/PlaygrndLabs/chef/actions/workflows/ci.yml/badge.svg)](https://github.com/PlaygrndLabs/chef/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Build apps with AI, in your own Cloudflare account.** Tell chef what you want. It plans the work, builds every feature in its own sandbox with a live preview, and ships it once the checks pass.

Like ChatGPT or Claude Code, you talk to it. Unlike them, you own every part: the app, the code, the keys and the infrastructure.

<p align="center"><strong><a href="https://chef.playgrndlabs.com">Sign in with Cloudflare and start building →</a></strong></p>

## Why chef

AI can write code fast. Everything around the code is still slow: starting and tracking agent sessions, juggling branches and merge conflicts, setting up an environment to try each change, and checking that nothing broke before it ships.

chef takes that work off your plate, so you spend your time on what to build, not on keeping the build running.

## What chef takes off your plate

- **Sessions run themselves.** Each request becomes a session that chef starts, tracks, keeps up to date and closes for you. Run many at once and none blocks another.
- **No git chores.** No branches, merges, rebases or conflicts to handle. chef keeps every session in sync with `main` and merges finished work for you.
- **A preview for everything.** Every change builds in its own isolated sandbox with a live link. Previews sleep when idle and wake on the next click.
- **A live address for every project.** Each project's `main` is always online at its own address, updated on every merge.
- **Checked before it ships.** Tests, typecheck and an AI review must pass before anything reaches `main`.
- **Your keys stay yours.** Bring an Anthropic API key or any compatible provider. Keys stay in your Cloudflare account, never in the browser or the sandbox.
- **GitHub when you want it.** Projects live in your Cloudflare account. Connect GitHub only if you want a repo kept in sync.

## Develop

Run `pnpm install` and `pnpm run verify`. Repository layout and the CLI: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
