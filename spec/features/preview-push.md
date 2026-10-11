---
id: preview-push
title: Live preview per feature
status: building
entrypoint: preview/<feature>
acceptance:
  - id: AC1
    text: After each commit the session head is pushed to preview/<feature> in the canonical repo
  - id: AC2
    text: The preview URL is read back and recorded on the session from the first commit
---

Only the preview publisher can push, and only to preview branches.
