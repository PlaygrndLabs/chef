# Phase 4 progress

Date: 2026-10-11. Branch `claude/kargah-build-t66ame`.

## Built

- **Project memory in the repo.** Memory documents are Markdown files under `memory/` with `kind` and `feature` frontmatter, plus every spec entry (`core/src/memory/memory.ts`). They change only through commits on `main`, so git history is the history of the memory.
- **Lessons from reverts.** When the gate reverts a merge, the revert commit also writes `memory/lessons/<feature>-<commit>.md`: the failing checks on `main`, the acceptance criteria at the time, the prompts that produced the change, and what to do next time.
- **A search index for memory.** The `MemoryIndex` port has two implementations. `VectorizeIndex` (`adapters/src/vectorize.ts`) embeds documents with Workers AI `@cf/baai/bge-base-en-v1.5` and stores them in Vectorize with `project`, `path`, `kind`, `feature` and `text` metadata. `LexicalIndex` is a TF-IDF fake used in tests and the CLI. After bootstrap, every merge and every revert, `syncMemory` re-embeds only the documents whose content hash changed and removes deleted ones.
- **Recall before every turn.** Each coder turn queries the index with the feature's title, acceptance criteria and work item. Up to three lessons or feature memories are appended to the prompt, the same feature's first, and a `memory.recalled` event names them.
- **Session memory and the conversation tree.** Session records keep the feedback they received (`history`) and their `parent`: the previous live session of the same feature. Both live in the Durable Object's SQLite with the rest of the record.
- **Merged sessions condensed into project memory.** The gardener commit before each merge writes `memory/features/<id>.md`, which keeps one section per session: its parent, prompt, turns and the corrections it needed.
- **Feature map gardening.** The same gardener commit adds a spec entry for any feature folder that has none, with acceptance criteria taken from its test names. After every merge `verifyMain` runs a `feature-map` check, and a mismatch reverts the merge like any red check.
- **Lint rules learned from corrections** (`core/src/gardener/gardener.ts`). A correction is recorded when a rejected or failed turn is followed by an accepted turn for the same role. The gardener mines lines that corrections removed, generalizing literals. A rule is written to `lint/rules/<id>.json` only when corrections from at least three sessions share the line, no accepted turn and no file on `main` matches it, and no existing rule already forbids it. Turns rejected by a learned rule never produce new rules. Rules are enforced at turn time (a `project-lint` rejection with the rule's message) and by the gate through `checkTree`.
- **Questions answered from memory.** A prompt routed as a question starts no session. `submit` returns an `answer` built from the top memory hits, written by `LlmPlanner.answer` on Cloudflare, with the files it used.
- **Dashboard.** It shows lessons written and recalled, corrections and learned lint rules in the health figures, a Memory section listing lessons with their recall counts and the learned rules with their source sessions, each session's parent and recalled files, and answers to questions under the prompt box.

## Benchmark

`chef bench --mode replay` runs the 10 Phase 3 features twice with real `tsc`, `node --test`, lint, generated-file checks, proofs and the hidden monitor on `main`:

1. **Learning run** (`phase4`): one attempt per feature, with locked tests, the red check and memory. Each feature carries its Phase 3 injected mistake.
2. **Replay run** (`replay`): a new project created from the template plus the `memory/` and `lint/` files from the learning run's `main`. The same features are submitted again.

The scripted agents make the same mistakes as in Phase 3. They correct them only when they get the matching feedback, or when the prompt carries a recalled lesson for their own feature. Recalled feature memories do not count as feedback.

Result of `node --import tsx cli/src/bin.ts bench --mode replay --out docs/progress/phase-4-benchmark-results.md` (full tables in that file, raw data in the `.json` next to it):

| Run | Merged features | Merges | Reverts | Revert rate | Stuck | Check runs | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Learning | 10/10 | 13 | 3 | 23.1% | 0 | 88 | 97 |
| Replay | 10/10 | 10 | 0 | 0.0% | 0 | 62 | 72 |

| Run | Lessons written | Own-feature lesson recalls | Lint rules added | Main commits | Main commits where the feature map disagrees with the code |
| --- | --- | --- | --- | --- | --- |
| Learning | 3 | 3 | 1 | 20 | 0 |
| Replay | 0 | 6 | 0 | 14 | 0 |

- **Reverted mistakes were not repeated.** In the learning run reverse, initials and vowels each merged with a missed edge case and were reverted by the monitor, which wrote three lessons. In the replay each new session recalled its feature's lesson in both its test turn and its backend turn, and none of the three was reverted.
- **One lint rule was learned from real corrections.** The red check rejected the vacuous tests of shout, slug and word-count, three sessions. The gardener mined `mined-3cb00b7ca3`: "Lines like `assert.deepEqual(…, …);` were removed in 3 corrections (red-tests) across 3 sessions". It forbids asserting that one literal equals another in test files. In the replay that rule rejected each vacuous test at turn time (`project-lint 1` for each of the three), before any check ran, so the replay used 26 fewer check runs.
- **The feature map matched the code on every main commit** in both runs (34 commits checked).
- An earlier version of the miner also learned a second rule in the replay, forbidding non-async tests, from the turns the first rule had rejected. That rule was wrong, so turns rejected by a learned rule no longer produce new rules, and a unit test covers it.

What this does and does not show: the memory path works end to end with real checks. A revert writes a lesson, the lesson is indexed, a new session in another project recalls it, and the gardener turns real red-check rejections into an enforced rule. The agents are scripted to act on a lesson for their own feature, so the replay shows that the right lesson reaches the right session, not that a real Copilot agent follows it. Running the same benchmark on Cloudflare with Vectorize and the Copilot coder needs the credentials below.

## Evidence

| Done criterion | State |
| --- | --- |
| Replaying a benchmark item whose earlier attempt was reverted, a new session does not repeat the reverted mistake | 3 of 3 reverted items merged with no revert in the replay above. `cli/test/e2e/bench.test.ts` asserts it in CI on shout, slug, word-count and reverse; `core/test/e2e/memory.test.ts` checks the lesson reaches the first turn of a fresh project. |
| The gardener has added at least one lint rule produced from real correction events | `mined-3cb00b7ca3`, mined from three red-check rejections produced by real `node --test` runs, then enforced in the replay. |
| The feature map matches the code after every merge | The `feature-map` check runs in `verifyMain` after every merge. 0 of 34 `main` commits disagreed in the benchmark, and `core/test/e2e/memory.test.ts` checks every `main` commit. |

Tests:
- `core/test/unit/memory.test.ts`: memory documents, feature memory, the lexical index, feature-map gardening, literal generalization, mining thresholds and exclusions, and rule problems.
- `core/test/e2e/memory.test.ts`: the lesson in the revert commit and its recall in the reopened session and in a fresh project, the feature map on every commit, session parents, a question answered from memory, and a `project-lint` rejection with its recorded correction.
- `adapters/test/unit/memory-adapters.test.ts`: per-project and per-kind filtering in `VectorizeIndex` against a fake Vectorize, and `LlmPlanner.answer` through CPA.
- `cli/test/e2e/bench.test.ts`: the replay benchmark on four features.
- `apps/dashboard/test/unit/state.test.ts`: the memory figures.

`pnpm run verify`: typecheck, lint (121 files), spec lint (14 features), 50 unit tests and 27 e2e tests pass.

## Not yet run on Cloudflare

`VectorizeIndex`, the `MEMORY` and `AI` bindings, and `LlmPlanner.answer` are covered by unit tests with fakes only. To run them for real:

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with Workers, Vectorize, Workers AI, Artifacts, Containers and Workers Builds permissions.
- The `chef-memory` index and its `project` and `kind` metadata indexes, created as in `README.md` before the first deploy.
- For the rest of the loop, as in earlier phases: `TYPESAFE_API_KEY`, `COPILOT_GITHUB_TOKEN`, and a Claude login in chef's CPA with `CPA_API_KEY`.
