# Spike: Jev routing quality

Status: harness and labeled set ready; real results need `TYPESAFE_API_KEY`.

## Question

How well does Jev route raw prompts versus prompts translated to English, in English and Persian, and which thresholds keep accepted misroutes under 2%?

## What the docs say

- `jev-latest` is `jev-1.13.0`, $0.042 per million input tokens, output free, 64k context, 80 requests per second.
- English is primary; other languages are "handled but not equally well". Persian is not mentioned.
- Choice confidence is `(pmax - 1/n) / (1 - 1/n)`. TypeSafe suggests below 0.6 for a human, at least 0.6 for low-stakes actions and above 0.85 for high-stakes ones.

## What was built

- `docs/spikes/jev-routing/prompts.json`: 104 labeled prompts against an eight-feature todo app, 52 English and 52 Persian. Each Persian prompt is paired with its English counterpart, which is the "translated" input. Labels are intent, feature and change kind; 36 new features, 48 changes and 20 questions.
- `cli/src/spike/jev.ts` and `kargah spike jev`: asks Jev the router's own three questions for every prompt, applies the router's rules and thresholds, and reports top-1 accuracy, accepted share, misroutes at the current thresholds, a threshold sweep per language and mode, and every accepted misroute.
- The router's questions and decision logic are shared with the spike through `routingQuestions` and `decideFromAnswers` in `core/src/router/router.ts`, so the spike measures exactly what production runs.

## Evidence so far

`node --import tsx cli/src/bin.ts spike jev --out docs/spikes/jev-routing/results-fake-keyword-classifier.md` runs end to end on the keyword fake. Its numbers are a floor, not a result: the fake cannot read Persian at all, which shows up as 0% Persian feature accuracy in raw mode.

## How to finish

```
TYPESAFE_API_KEY=... node --import tsx cli/src/bin.ts spike jev --out docs/spikes/jev-routing/results-jev-1.13.0.md
```

Then pick the mode with fewer accepted misroutes and set per-action thresholds in `DEFAULT_ROUTER_CONFIG` so the sweep's misroute rate stays under 2%. If translated wins, add a translation step before the classifier tier.

## Decision for now

Keep thresholds at new 0.85, change 0.85, question 0.6, feature 0.85. A deferred prompt only costs a planner call, while a misroute starts the wrong session, so the thresholds lean toward deferring.
