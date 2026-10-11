---
id: project-memory
title: Project memory and recall
status: building
entrypoint: Orchestrator.submit
acceptance:
  - id: AC1
    text: A reverted merge writes a lesson under memory/lessons in the revert commit
  - id: AC2
    text: Memory files on main are indexed after bootstrap, merges and reverts, and only changed files are re-embedded
  - id: AC3
    text: Every coder turn's prompt carries the most relevant memory, lessons and feature memories of the same feature first
  - id: AC4
    text: A question prompt starts no session and is answered from memory with its sources
---

The index is `VectorizeIndex` on Cloudflare and `LexicalIndex` in tests and the CLI.
