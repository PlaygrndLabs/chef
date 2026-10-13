# Phase 2 progress

Date: 2026-10-11.

## Built

- Parallel sessions: `Orchestrator.drain` steps every active session each round.
- Sync between turns: a push to `main` marks idle sessions for sync at once, and running sessions as soon as their current turn ends (`syncAfterRun`), so no session merges `main` mid-turn.
- Conflicts never reach a human. `threeWayMerge` can write hunk-level markers (`conflictMarkers` in `core/src/git/tree.ts`); the repo host then records a two-parent merge commit holding the markers (`onConflict: "commit-markers"`, outcome `conflicted`), and the session gets a conflict work item handled by the conflict-resolver profile. Because the merge has both parents, the next sync and the gate see `main` as already merged and do not loop.
- Serialized merge queue: the gate takes a lock, requeues when `main` moved since the session's base, and stores `mainBefore` on the record.
- Automatic revert: after each merge the gate runs the checks on canonical `main`. If they fail, `main` is reverted to `mainBefore`, `main.reverted` is emitted with the log, and the session reopens (`merged` to `coding`) on a fork restored from its work, with the failure log in the next prompt.

## Evidence

`pnpm run verify`: 5 packages typecheck, ESLint and the code rules report 0 problems on 105 files, 10 spec features lint clean, 33 unit and 15 end-to-end tests pass.

| Done criterion | State |
| --- | --- |
| Three features that touch the same `shared/` files reach `main` with zero human actions, no conflict surfaced to a human | `core/test/e2e/concurrency.test.ts` "merges three parallel features". Features `notes`, `tags` and `search` each add an entry to `shared/menu.ts`. All three merge, the menu has every entry and no markers, and `session.stuck` is never emitted. |
| An injected post-merge failure is reverted and its session reopens and fixes it | Same file, "reverts a merge that turns main red". `main` history: merge, `Revert todo-add: main went red`, `Restore todo-add work after revert`, merge again. The revert tree equals the bootstrap tree and the retry prompt carries the failure log. |
| Event counts stay bounded | Asserted in both tests (below). |

Event counts from one run of each scenario:

| Event | Three features | Revert |
| --- | --- | --- |
| total | 111 | 40 |
| `session.state` | 27 | 10 |
| `commit.created` | 15 | 5 |
| `preview.updated` | 15 | 6 |
| `coder.event` | 33 | 10 |
| `sync.conflict` | 3 | 0 |
| `review.verdict` | 6 | 2 |
| `gate.result` | 3 | 2 |
| `main.merged` | 3 | 2 |
| `main.reverted` | 0 | 1 |

Coder turns in the three-feature run: 3 test, 3 backend, 3 conflict-resolver. `main` ends with 9 commits, each with a `refs/notes/chef` note.

## Not yet on a real account

These scenarios run on the in-memory fakes. The same orchestrator code runs in `ProjectAgent`, and the Artifacts adapter implements the marker merge, but the upstream-sync Workflow and parallel Copilot sandboxes have not run on Cloudflare: that needs the credentials listed in `README.md`.
