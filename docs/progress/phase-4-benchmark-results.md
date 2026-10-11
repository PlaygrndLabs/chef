| Mode | Merged features | Merges | Reverts | Revert rate | Stuck | Test or scope violations on main | Check runs | Events | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| phase4 | 10/10 | 13 | 3 | 23.1% | 0 | 0 | 88 | 547 | 97 |
| replay | 10/10 | 10 | 0 | 0.0% | 0 | 0 | 62 | 464 | 72 |

| Mode | Lessons written | Own-feature lesson recalls | Lint rules added | Lint rules on main | Main commits | Main commits where the feature map disagrees with the code |
| --- | --- | --- | --- | --- | --- | --- |
| phase4 | 3 | 3 | 1 | 1 | 20 | 0 |
| replay | 0 | 6 | 0 | 1 | 14 | 0 |

Rule added in phase4: `mined-3cb00b7ca3`: Lines like `assert.deepEqual(…, …);` were removed in 3 corrections (red-tests) across 3 sessions

### phase4

| Feature | Injected mistake | Final state | Sessions | Merges | Reverts | Rejected turns | Pick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shout | vacuous-test | merged | 1 | 1 | 0 | red-tests 1 | n/a |
| slug | vacuous-test | merged | 1 | 1 | 0 | red-tests 1 | n/a |
| word-count | vacuous-test | merged | 1 | 1 | 0 | red-tests 1 | n/a |
| reverse | missed-edge | merged | 1 | 2 | 1 | none | n/a |
| initials | missed-edge | merged | 1 | 2 | 1 | none | n/a |
| vowels | missed-edge | merged | 1 | 2 | 1 | none | n/a |
| title-case | gate-caught | merged | 1 | 1 | 0 | none | n/a |
| digit-sum | gate-caught | merged | 1 | 1 | 0 | none | n/a |
| truncate | none | merged | 1 | 1 | 0 | none | n/a |
| palindrome | none | merged | 1 | 1 | 0 | none | n/a |

### replay

| Feature | Injected mistake | Final state | Sessions | Merges | Reverts | Rejected turns | Pick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shout | vacuous-test | merged | 1 | 1 | 0 | project-lint 1 | n/a |
| slug | vacuous-test | merged | 1 | 1 | 0 | project-lint 1 | n/a |
| word-count | vacuous-test | merged | 1 | 1 | 0 | project-lint 1 | n/a |
| reverse | missed-edge | merged | 1 | 1 | 0 | none | n/a |
| initials | missed-edge | merged | 1 | 1 | 0 | none | n/a |
| vowels | missed-edge | merged | 1 | 1 | 0 | none | n/a |
| title-case | gate-caught | merged | 1 | 1 | 0 | none | n/a |
| digit-sum | gate-caught | merged | 1 | 1 | 0 | none | n/a |
| truncate | none | merged | 1 | 1 | 0 | none | n/a |
| palindrome | none | merged | 1 | 1 | 0 | none | n/a |
