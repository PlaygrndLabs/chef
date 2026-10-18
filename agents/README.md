# agents

One file per specialist profile. The frontmatter is validated by `AgentProfile` in `core/src/profiles/profile.ts`; the body is the profile's system prompt. `{feature}` in a write scope or prompt is replaced with the feature id, and a leading `!` excludes paths. The merge gate rejects any commit whose role, read from its git note, wrote outside its scope.

- `label`: the name the app shows.
- `runs`: `agent` (Claude Code agent in a sandbox), `api` (one Claude call) or `rules` (code, no model).
- `plannable`: the planner may assign this role to code, fix and refactor steps. Steps for different plannable roles in one feature run at the same time, each role on its own branch (`lane/<role>` in the session's fork) and in its own sandbox; Chef merges every branch into the feature after each round, and the conflict fixer settles lines two roles both changed. A file belongs to the role that first wrote it, and a change another role makes to it is discarded. Review and gate feedback goes to the roles whose files it names.

Write scopes are written for Chef's template. On a project with its own structure (no `app/gen.ts` and `src/registry.gen.ts`; `usesChefTemplate` in `core/src/structure/structure.ts`) Chef reads them for the repository's real files instead (`ownScope`): `features/{feature}/**` becomes the whole repository except Chef's own `spec/features`, `memory`, `.chef` and `lint/rules`, test patterns become the usual test files and folders (`*.test.*`, `*.spec.*`, `test/`, `tests/`, `spec/`, `__tests__/`), and `flow.ts`, `src/registry.gen.ts` and patterns for every feature (`features/*/...`) drop out.

`chore.md` does work outside one feature folder (requests that start with `/chore`, or that the router sorts as a chore). It may change anything except specs, memory and the locked feature tests and flows, and its build proves every live feature still works.

These files are Chef's defaults. Settings > Agents (for every project, or per project from Project settings) edits names, prompts, models and skills (shared by every role, or chosen per role), adds new builder roles and tunes the router, and keeps every saved version so any change can be undone.
