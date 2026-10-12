# Spike: preview from branch push

Status: Workers Builds path dropped on the first Cloudflare run (2026-10-12); previews now come from `wrangler preview` in the sandbox.

## Question

Does pushing `preview/<feature>` to the canonical Artifacts repo yield a reachable Worker Preview URL that chef can read back?

## What the docs say

- Workers Builds can build from an Artifacts repo (connected in the dashboard; the Builds API has no Artifacts provider type).
- The production branch is `main`. With "Builds for preview branches" on, every other branch runs `npx wrangler preview`, giving `<preview-name>-<worker>.<subdomain>.workers.dev`.
- The preview URL is only exposed by `GET /accounts/{id}/builds/builds/{build_uuid}`. Builds for a Worker are listed by `GET /accounts/{id}/builds/workers/{tag}/builds`. Build events carry no URL.
- Previews get their own Durable Object namespace; KV, D1 and R2 are shared unless rebound in a `previews` block. 500 previews per Worker.

## What was built

- `PreviewPublisher` in `core/src/orchestrator/capabilities.ts` is the only code that pushes, and only to `preview/*`.
- `adapters/src/workers-previews.ts`: `WorkersBuildsPreviewHost` lists builds for the project Worker, finds the build for the pushed commit and polls it until it has a preview URL or fails.
- The template sets `preview_urls: true` in `template/wrangler.jsonc`.
- On fakes, `MemoryPreviewHost` returns a URL per feature, and the e2e suite asserts a preview exists from the first commit.

## Decision

Use Workers Builds preview branches as the primary path. The fallback, if the field names below differ or builds are too slow, is to run `npx wrangler preview --name <feature> --json` in the session sandbox and read `.preview.urls[0]`. The `PreviewHost` interface stays the same either way.

## Run on Cloudflare (2026-10-12)

The first prompt on the deployed Worker got stuck at the first preview: `Cloudflare API /workers/scripts/chef-project/settings failed: 404 This Worker does not exist on your account.` The Workers Builds path needs a dashboard step per project (connect the Artifacts repo, turn on preview builds), and the Builds API cannot do it, so it breaks the human-free goal.

chef now takes the fallback as the only path. `SandboxPreviewHost` (`workers/src/sandbox-checks.ts`) clones the preview branch at the commit in a sandbox and runs `npx wrangler preview --name <feature> --worker-name chef-project-<project> --json`. Wrangler 4.149 creates the parent Worker when it is missing (`POST /accounts/{id}/workers/workers`), then the Preview and a deployment, and prints `{ preview: { urls }, deployment: { id, urls } }`. The sandbox gets `CLOUDFLARE_API_TOKEN=chef-placeholder`; the outbound handler swaps in `CF_API_TOKEN` only for `api.cloudflare.com` paths under that Worker (`sandbox-grants.ts`).

## Open (Workers Builds, kept for reference)

- The commit and URL field names on a build (`commit_hash`, `preview_url`) are inferred from the API reference and need confirming on a real build.
- The Artifacts repo must be connected to Workers Builds once in the dashboard. That is a one-time setup step in `README.md`, not a per-feature human action.
