# Phase 3 progress

Date: 2026-10-11.

## Built

- **Specialist profiles as Copilot custom agents.** `customAgent()` in `core/src/profiles/profile.ts` turns each profile in `agents/` into a Copilot SDK `CustomAgentConfig` (`chef-<role>`, its instructions, its write scope, its model and optional tool list). The sandbox runner starts every session with that agent selected.
- **Write scopes on the diff.** These were already in place from Phase 1. Every turn's changed paths are checked against the role's scope before commit, and the gate re-checks every commit by the role in its git note.
- **Locked tests.** Paths written by the `test` role (read from git notes) are locked. A coder turn that changes one is rejected with feedback, whatever its write scope says, and the gate's `locked-tests` check fails any commit that slipped through. A conflict-resolver may only edit a locked file that contains conflict markers.
- **Test first, really failing.** A test turn's new tests run against an empty stub of the feature (`renderStub` in `template/app/gen.ts`) before they are committed. Any new test that passes is vacuous, so the turn is rejected and the test agent retries with the names of the passing tests. Per-test results come from node's TAP output (`parseTap`).
- **Reviewer on a different model.** The gate's `review` check fails when the verdict's model wrote any code in the session (models read from git notes).
- **Parallel attempts.** `submit(prompt, { attempts })`, or `ATTEMPTS` on the Worker, starts one session per attempt with its own fork and preview branch. When every live attempt reaches the gate, each attempt's code runs against the tests of all attempts, and `Reviewer.pick` chooses one (the LLM reviewer gets the diffs and scores; the fake picks by score, then size). The winner takes `preview/<feature>` and is gated; the others are `dropped`.
- **Dashboard.** It now shows health figures (merged features, merges, reverts, revert rate, human actions per merged feature, attempt picks, rejected turns by rule), merges and reverts per feature, an attempts panel with cross-test scores, each session's gate checks and its rejected turns.
- **Reverts of older merges.** `revertMerge` now undoes only the reverted merge (an inverse three-way merge). When later merges conflict with that, it returns `main` to before the merge and reopens every session merged since; those reopens and sync conflicts no longer spend the attempt budget.

## Benchmark

`chef bench` runs 10 features on the project template with real `tsc`, `node --test`, lint, generated-file checks and proofs, once with Phase 2 settings (one attempt, no locked or red-test checks) and once with Phase 3 settings (two attempts, locked tests, red check). After every merge a hidden monitor suite runs on `main`, playing the part of production monitoring; when it fails, the gate reverts the merge.

The coding and test agents are scripted. Each feature carries one injected mistake that real agents make, and the agents fix their work when they get the matching feedback:

| Mistake | Features | What the agent does |
| --- | --- | --- |
| `vacuous-test` | shout, slug, word-count | The test for the edge case asserts a constant, and the first implementation misses the edge case. |
| `missed-edge` | reverse, initials, vowels | Attempt 1 tests a non-edge input and misses the edge case in code; attempt 2 gets both right. |
| `gate-caught` | title-case, digit-sum | The first implementation fails the visible tests. |
| `none` | truncate, palindrome | Everything is right the first time. |

Result of `node --import tsx cli/src/bin.ts bench --out docs/progress/phase-3-benchmark-results.md` (full tables in that file, raw data in the `.json` next to it):

| Settings | Merged features | Merges | Reverts | Revert rate | Stuck | Violations on main | Check runs | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 2 | 10/10 | 16 | 6 | 37.5% | 0 | 0 | 108 | 114 |
| Phase 3 | 10/10 | 10 | 0 | 0.0% | 0 | 0 | 81 | 77 |

In Phase 2 every `vacuous-test` and `missed-edge` feature reached `main` and was reverted once by the monitor. In Phase 3 the red check rejected each vacuous test before commit (6 rejected turns), and the cross-attempt pick chose attempt 2 for every `missed-edge` feature, so nothing was reverted. `gate-caught` and clean features behave the same under both settings.

What this does and does not show: the mechanisms catch these mistake classes for real, with real checks, and the benchmark is fixed and repeatable. The mistake mix is chosen, so 37.5% against 0% is not an estimate of how real Copilot agents behave. The same benchmark with the Copilot coder needs `COPILOT_GITHUB_TOKEN` and a Cloudflare account.

## Evidence

| Done criterion | State |
| --- | --- |
| Revert rate on a fixed benchmark of at least 10 features is lower than the Phase 2 baseline | 0.0% against 37.5% above; `cli/test/e2e/bench.test.ts` asserts it on two features in CI |
| No write-scope or locked-test violation ever reaches `main` | Turn rejection plus gate checks; `core/test/e2e/specialization.test.ts` covers a coder whose scope allows tests, and a commit injected straight into a fork that the gate refuses. The benchmark reports 0 violations on `main` in both runs. |

Tests: `core/test/e2e/specialization.test.ts` (locked tests at turn and gate, same-model reviewer, two attempts, late revert, cascading revert), `core/test/unit/specialization.test.ts`, the red check with real runners in `cli/test/e2e/local-runners.test.ts`, the dashboard state in `apps/dashboard/test/unit/state.test.ts`.
