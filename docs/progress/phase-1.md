# Phase 1 progress

Date: 2026-10-11. Branch `claude/kargah-build-t66ame`.

## Built

- Spec format with typed frontmatter and `kargah spec lint`; kargah's own feature map in `spec/features`.
- Router with rules, Jev and planner tiers.
- Session state machine with budgets on attempts, tokens and time.
- Fork per session with scoped tokens; the coder never gets a write token.
- One commit per agent turn with git notes; proofs in their own notes namespace.
- Preview push to `preview/<feature>` after every commit.
- Project template with import-boundary and no-comment rules, and the `app` CLI that drives a flow and records proof.
- Merge gate: typecheck, lint, tests, generated files, spec lint, write scope, reviewer verdict, proof; serialized merges.
- Dashboard with the live event stream, features, sessions, stuck items, merges and previews.
- Worker shells: `ProjectAgent`, `SessionAgent` with the Copilot sandbox, `upstream-sync` Workflow.
- CI on GitHub Actions: typecheck, lint, spec lint, unit and end-to-end tests.

## Evidence

`pnpm run verify` passes locally: 5 packages typecheck, ESLint and the code rules report 0 problems, 10 spec features lint clean, and 39 tests pass across unit and end-to-end suites.

| Done criterion | State |
| --- | --- |
| `pnpm test` and the fake end-to-end suite pass in CI | Pass locally; CI runs on the PR |
| A fresh project plus one spec entry reaches `main` with proof, zero human actions, three runs in a row | On fakes: `core/test/e2e/core-loop.test.ts` "three consecutive runs". On real git: `adapters/test/e2e/artifacts-git.test.ts`. With real typecheck, tests and proof: `cli/test/e2e/local-runners.test.ts` and `kargah demo`. Not yet on a Cloudflare account. |
| Every commit on the feature has notes tracing it to the prompt | Asserted on fakes and on real git with `git notes --ref=kargah` |
| Reachable preview URL from the first commit | Asserted on fakes; real previews need Workers Builds |

`kargah demo` runs the todo feature through every state with real `tsc`, `node --test` and the proof flow in about three seconds.

## Needed to finish Phase 1 on a real account

The same credentials as Phase 0, plus a CPA endpoint for the planner and reviewer (`CPA_BASE_URL`, `CPA_API_KEY`; see `dev/cpa/README.md`). Deploy steps are in `README.md`. After deploy, the three-run criterion is: bootstrap a project, send "Add an item to a todo list", and check the dashboard shows `merged` with a preview URL, three times.

## Started for Phase 2

Upstream sync between turns, conflict work items, the serialized merge queue and `revertMerge` exist in the orchestrator, but have no scenario tests yet. They are Phase 2 work.
