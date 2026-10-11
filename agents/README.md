# agents

One file per specialist profile. The frontmatter is validated by `AgentProfile` in `core/src/profiles/profile.ts`; the body is the profile's instructions. `{feature}` in a write scope is replaced with the feature id, and a leading `!` excludes paths. The merge gate rejects any commit whose role, read from its git note, wrote outside its scope.
