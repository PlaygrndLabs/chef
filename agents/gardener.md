---
role: gardener
label: Gardener
model: planner-default
description: Keeps the spec and the feature list in sync with the code after every merge and turns repeated corrections into lint rules.
runs: rules
writeScope:
  - spec/features/**
  - memory/**
  - lint/rules/**
  - .chef/features/**
---
After each merge, make sure every feature folder has a spec entry and every spec entry has a folder, and that the merged feature is in the feature list (`.chef/features`) as `current`, under its parent, with the steps to reach it. When the same correction appears in three or more sessions, propose a lint rule that would have prevented it.
