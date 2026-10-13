# chef: open-source AI app builder on Cloudflare

[![CI](https://github.com/PlaygrndLabs/chef/actions/workflows/ci.yml/badge.svg)](https://github.com/PlaygrndLabs/chef/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Describe a feature in chat. chef plans it, tests it, builds it and ships it with a live preview, all in your own Cloudflare account.**

chef is a self-hosted, spec-driven AI coding agent. Type (or say) "Add an item to a todo list" and chef turns it into a spec, tests, code, a review and a merge, so you can focus on what to build next.

## Why chef

- **Chat in, working feature out.** One message goes through Plan, Tests, Build, Check and Live on its own.
- **A live preview for every feature.** Open the link to try it. Previews sleep when idle and wake on the next click, so your account stays clean.
- **Safe by design.** Every piece of work runs in its own fork and sandbox. Only the merge gate writes `main`, and only after tests and review pass.
- **Parallel by default.** Many features, and several attempts per feature, build at once without blocking each other.
- **Your keys, your account.** Use your Anthropic API key or any Anthropic-compatible provider. Keys never reach the browser or the sandbox.
- **GitHub is optional.** Connect GitHub to keep a project in sync with a repo you pick.

## How it works

1. **Plan:** chef routes your request and writes it into the project's spec.
2. **Tests:** acceptance tests are written before any code.
3. **Build:** a Claude Agent SDK coder works in a Cloudflare Sandbox on its own fork.
4. **Check:** typecheck, tests and an AI review must all pass the merge gate.
5. **Live:** the feature merges to `main` and its preview goes live.

Built on Cloudflare Workers, Durable Objects, Containers and Artifacts. See the [architecture](docs/ARCHITECTURE.md).

## Deploy your own

You need a Cloudflare account on Workers Paid with Containers and Artifacts enabled.

1. Fork this repository.
2. Add the Actions secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
3. Run the `deploy` workflow and open the URL it prints.
4. Pick a password, add your model provider in Settings and create your first project.

Full guide and every setting: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Develop

```
pnpm install
pnpm run verify
```

Requires Node 22.18+, pnpm 10 and git. Layout and CLI: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## FAQ

**Which models does chef use?** Claude, through your Anthropic API key or any Anthropic-compatible provider. Routing can optionally use TypeSafe's Jev, and voice can use OpenAI's Realtime API.

**Do I need GitHub?** No. Projects live in Cloudflare Artifacts. GitHub sync is optional.

**What does it cost?** chef is free and MIT licensed. You pay only for your own Cloudflare and model usage.

## License

[MIT](LICENSE)
