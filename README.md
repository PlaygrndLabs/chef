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
- **Or use your subscription.** Have a Claude subscription but no API key? [sub2api](https://github.com/PlaygrndLabs/sub2api) turns it into your own API on Cloudflare, so you can make an API key on your subscription and use it in Chef.
- **GitHub when you want it.** Projects live in your Cloudflare account. Connect GitHub only if you want a repo kept in sync.

## Under the hood

chef is a TypeScript monorepo that runs entirely on Cloudflare's developer platform.

- **Engine.** One Worker with Durable Objects: a `ProjectAgent` per project and a `SessionAgent` per session hold state and drive work, so nothing stops when the browser closes.
- **Repos.** Every project is a git repository in Cloudflare Artifacts. Each session works on its own fork, and only the merge gate can write `main`.
- **Routing.** Rules first, then Jev (TypeSafe's System One) answers typed choice questions with calibrated confidence. When it is unsure, a Claude planner writes the spec and splits the work into parallel sessions.
- **Coding.** The Claude Agent SDK runs inside a Cloudflare Sandbox (Containers) with role-scoped subagents for tests, code and review. The sandbox gets a read-only token, and its outbound proxy swaps in real keys only on approved hosts.
- **History.** Each agent turn is one commit, with its prompt, model and role stored in git notes (`refs/notes/chef`).
- **Gate.** Typecheck, lint, tests, spec lint, write-scope checks per role, locked tests, an independent AI review and a proof run against the live preview. Merges are serialized; if `main` moved, the session syncs and is gated again.
- **Previews.** `wrangler preview` publishes each feature branch as a Worker preview. Idle previews are removed and rebuilt on the next visit.
- **Memory.** Lessons and feature summaries are indexed in Vectorize with Workers AI embeddings and recalled before each turn.
- **Live UI.** Sessions stream to a React dashboard over AG-UI with CopilotKit: coder output, tool calls, steps, preview, review and merge.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

Run `pnpm install` and `pnpm run verify`. Repository layout and the CLI: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

[MIT](LICENSE)
