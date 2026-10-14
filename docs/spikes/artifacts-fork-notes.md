# Spike: Artifacts fork and notes

Status: partly proven locally, not yet run on a Cloudflare account.

## Question

Can Chef create a canonical repo, fork it per session, issue a token scoped to the fork, push `refs/notes/*`, and learn about pushes to `main` through `cf.artifacts.repo.pushed`?

## What the docs say

- Git remote: `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<namespace>/<repo>.git`. Auth is `Authorization: Bearer <token>` or Basic `x:<secret>`, where the secret is the token without `?expires=`. Push uses protocol v1.
- Tokens are `read` or `write` for one repo. There are no branch-scoped tokens, so a fork per session is the only way to give an agent write access without access to canonical `main`.
- There is no merge or commit API. Merges happen in a git client: isomorphic-git inside the Worker, or git in a Sandbox.
- Pushes emit `cf.artifacts.repo.pushed` with `{ ref, before, after, commits, totalCommitsCount, commitsTruncated }`, filterable by namespace and repo name but not by ref.
- `refs/notes/*` pushes are recommended by the Artifacts best-practices page.
- Limits: 2000 requests per 10 s per namespace and per repo, 1 GB per repo, 32 MB per file. Open beta since 2026-10-01, billing from 2026-10-14, Workers Paid only.

## What was built

- `adapters/src/artifacts.ts`: `ArtifactsRepoHost` implements `RepoHost` over isomorphic-git with an in-memory git directory per repo. It fetches and pushes notes refs, merges with the core three-way merge and copies notes between repos on fork, push and merge.
- `bindingControl()` adapts the `ARTIFACTS` Workers binding (create, fork, info, createToken, revokeToken) to the control interface the host needs.
- `adapters/test/git-server.ts`: a local smart-HTTP server around `git http-backend` that enforces per-repo read and write tokens, so the adapter is tested against real git, not a fake.

## Evidence

`pnpm test:e2e` runs `adapters/test/e2e/artifacts-git.test.ts`:

- `ArtifactsRepoHost` commits, merges, writes notes and pushes a preview branch; the server rejects a push made with a read token.
- The full Phase 1 loop (route, plan, test, code, review, gate, merge) runs on real git repos served over HTTP; `git log` and `git notes --ref=chef` on the canonical repo show each turn's commit and its note after the merge.

## Decision

- Fork per session with a write token for that fork only, held by the orchestrator. The coder gets a read token and its sandbox cannot push (see [coder-sandbox.md](coder-sandbox.md)).
- Push events go to the `upstream-sync` Workflow through `triggers.events` in `wrangler.jsonc`, not a Queue. The Workflow ignores fork repos (names with `--`) and non-`main` refs, since the event cannot be filtered by ref.
- Wrangler 4.149 requires the trigger as `targets: [{ type: "workflow", workflow_name }]`; the guide's single `target` object is rejected.

## Open

- The binding's exact method names and return shapes are taken from the docs and are cast in `workers/src/project-agent.ts`. They need one run on an account.
- Maximum repo name length is undocumented. Fork names are `<project>--<feature>--<session>` and stay under 63 characters.
