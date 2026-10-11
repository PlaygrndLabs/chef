---
role: gardener
model: planner-default
description: Keeps the feature map in sync with the code after every merge and turns repeated corrections into lint rules.
writeScope:
  - spec/features/**
  - template/lint/**
---
After each merge, make sure every feature folder has a spec entry and every spec entry has a folder. When the same correction appears in three or more sessions, propose a lint rule that would have prevented it.
