# Phase 0 progress

Date: 2026-10-11. Branch `claude/kargah-build-t66ame`.

| Spike | Result | Note |
| --- | --- | --- |
| Copilot SDK in Sandbox | Coded, not run | [copilot-sandbox.md](../spikes/copilot-sandbox.md) |
| Preview from branch push | Coded, not run | [preview-from-branch.md](../spikes/preview-from-branch.md) |
| Jev routing quality | Harness and 104-prompt set ready, run on the fake only | [jev-routing.md](../spikes/jev-routing.md) |
| Artifacts fork and notes | Proven against real git over smart HTTP, not on Artifacts | [artifacts-fork-notes.md](../spikes/artifacts-fork-notes.md) |

None of the four spikes is done by its own definition yet, because each needs an account or key that is not available in this environment. Each spike's code path is built behind the port it needs, so finishing a spike means running it, not writing it.

## Commands run

```
pnpm run verify
node --import tsx cli/src/bin.ts spike jev --out docs/spikes/jev-routing/results-fake-keyword-classifier.md
npx wrangler deploy --dry-run   (in workers/, with the containers block removed because Docker is not available here)
```

The dry run bundled the Worker with the `PROJECT`, `SESSION`, `UPSTREAM_SYNC`, `ARTIFACTS` and `ASSETS` bindings. The bundle is 14.8 MB raw and 2.5 MB gzipped, most of it the TypeScript compiler used by the code rules; that fits the Workers Paid limit.

## Needed to finish Phase 0

- Cloudflare account on Workers Paid with Artifacts, Containers and Workers Builds: `CF_ACCOUNT_ID` and `CF_API_TOKEN` (Workers Builds read for the preview URL).
- `TYPESAFE_API_KEY` for the Jev spike.
- `COPILOT_GITHUB_TOKEN`: a GitHub token for an identity with Copilot access.
- Docker, or a prebuilt registry image, to build the sandbox image on deploy.
