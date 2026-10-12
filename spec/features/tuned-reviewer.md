---
id: tuned-reviewer
title: Reviewer tuned on merged and reverted changes
status: building
entrypoint: chef tune data
acceptance:
  - id: AC1
    text: Every approved review is labelled by its outcome, merged, reverted or failed at the gate, and exported with the spec and the feature's files
  - id: AC2
    text: Each coder turn is exported with its prompt and changes and labelled positive or negative by the review it led to
  - id: AC3
    text: A LoRA trained on the training features is compared with its base model on held-out features and the result is recorded
  - id: AC4
    text: With REVIEWER_LORA set, the Worker reviews with the tuned adapter on Workers AI and keeps picking between attempts on the Claude reviewer
---

Training runs on CPU with `tune/train.py`; see `tune/README.md`.
