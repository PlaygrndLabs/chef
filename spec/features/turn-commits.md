---
id: turn-commits
title: One commit per agent turn with git notes
status: building
entrypoint: refs/notes/chef
acceptance:
  - id: AC1
    text: Every agent turn with changed files becomes exactly one commit on the session fork
  - id: AC2
    text: Each commit carries a note with prompt, root prompt, run id, model, role and spec revision
  - id: AC3
    text: Notes survive merges into canonical main
---

Git notes trace every line on main back to the prompt that caused it.
