# agents

One file per specialist profile. The frontmatter is validated by `AgentProfile` in `core/src/profiles/profile.ts`; the body is the profile's system prompt. `{feature}` in a write scope or prompt is replaced with the feature id, and a leading `!` excludes paths. The merge gate rejects any commit whose role, read from its git note, wrote outside its scope.

- `label`: the name the app shows.
- `runs`: `agent` (Claude Code agent in a sandbox), `api` (one Claude call) or `rules` (code, no model).
- `plannable`: the planner may assign this role to code, fix and refactor steps.

These files are chef's defaults. The Agents page in the app edits names, prompts, models and skills, adds new builder roles and tunes the router, and keeps every saved version so any change can be undone.
