---
id: share-links
title: Share a build or a preview with a link
status: building
entrypoint: share
acceptance:
  - id: AC1
    text: A build's Share button makes a link to the build (its preview, changes and commits) or only to its preview, lasting 7, 30 or 90 days or without an end
  - id: AC2
    text: The link opens a read-only page; its key opens only that session and its preview, and every other request with it is refused
  - id: AC3
    text: The key travels in the link's fragment, Chef keeps only its hash, and the dialog shows it once
  - id: AC4
    text: Ending a link stops it at once; a preview someone already has open through it closes within an hour, or at once when the project gets a new preview key
  - id: AC5
    text: An app that runs Chef for others can replace the share dialog or hide sharing
---

Share links are grants of the kind share, so they use the same hashing, expiry and last-used tracking as API keys.
