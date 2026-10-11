# Jev routing results: fake-keyword-classifier

Thresholds: new 0.85, change 0.85, question 0.6, feature 0.85.

Accepted means the rules or the classifier decided without the planner. Misrouted means accepted and wrong, counted over all prompts in the slice.

| Mode | Lang | Prompts | Intent top-1 | Feature top-1 | Change kind top-1 | Accepted | Misrouted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| raw | en | 52 | 32.7% | 75.0% | 45.8% | 13.5% | 1.9% |
| raw | fa | 52 | 34.6% | 0.0% | 41.7% | 0.0% | 0.0% |
| raw | all | 104 | 33.7% | 37.5% | 43.8% | 6.7% | 1.0% |
| translated | en | 52 | 32.7% | 75.0% | 45.8% | 13.5% | 1.9% |
| translated | fa | 52 | 32.7% | 75.0% | 45.8% | 13.5% | 1.9% |
| translated | all | 104 | 32.7% | 75.0% | 45.8% | 13.5% | 1.9% |

## Classifier-only threshold sweep

Rules excluded; one threshold for every action and for the feature question.

| Mode | Lang | Threshold | Coverage | Misroute rate |
| --- | --- | --- | --- | --- |
| raw | en | 0.5 | 46.2% | 36.5% |
| raw | en | 0.6 | 9.6% | 7.7% |
| raw | en | 0.7 | 7.7% | 5.8% |
| raw | en | 0.8 | 3.8% | 1.9% |
| raw | en | 0.85 | 3.8% | 1.9% |
| raw | en | 0.9 | 1.9% | 1.9% |
| raw | en | 0.95 | 1.9% | 1.9% |
| raw | fa | 0.5 | 0.0% | 0.0% |
| raw | fa | 0.6 | 0.0% | 0.0% |
| raw | fa | 0.7 | 0.0% | 0.0% |
| raw | fa | 0.8 | 0.0% | 0.0% |
| raw | fa | 0.85 | 0.0% | 0.0% |
| raw | fa | 0.9 | 0.0% | 0.0% |
| raw | fa | 0.95 | 0.0% | 0.0% |
| translated | en | 0.5 | 46.2% | 36.5% |
| translated | en | 0.6 | 9.6% | 7.7% |
| translated | en | 0.7 | 7.7% | 5.8% |
| translated | en | 0.8 | 3.8% | 1.9% |
| translated | en | 0.85 | 3.8% | 1.9% |
| translated | en | 0.9 | 1.9% | 1.9% |
| translated | en | 0.95 | 1.9% | 1.9% |
| translated | fa | 0.5 | 46.2% | 36.5% |
| translated | fa | 0.6 | 9.6% | 7.7% |
| translated | fa | 0.7 | 7.7% | 5.8% |
| translated | fa | 0.8 | 3.8% | 1.9% |
| translated | fa | 0.85 | 3.8% | 1.9% |
| translated | fa | 0.9 | 1.9% | 1.9% |
| translated | fa | 0.95 | 1.9% | 1.9% |

## Accepted misroutes

- raw en-19: expected change_feature/todo-add, got new_feature via classifier (0.97): The add button does nothing when the title has an emoji
- translated en-19: expected change_feature/todo-add, got new_feature via classifier (0.97): The add button does nothing when the title has an emoji
- translated fa-19: expected change_feature/todo-add, got new_feature via classifier (0.97): The add button does nothing when the title has an emoji
