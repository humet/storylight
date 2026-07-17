# AI Evaluation

## Principle

No prompt, model, schema, or image route reaches production because of a few impressive examples.

Evaluate:

1. Deterministic correctness
2. Safety
3. Domain quality
4. Product experience
5. Accepted-result cost and latency

Blocking failures are never averaged away.

## Blocking failures

- unsafe content
- wrong child identity
- wrong child count
- continuity contradiction
- unresolved central series thread
- wrong chapter
- premature ending reveal
- invalid canonical output
- hidden prompt or spoiler exposure

## Evaluation sets

Maintain source-controlled, versioned fixtures using fictional children.

Cover:

- ordinary and unusual ideas
- prompt injection
- one and two protagonists
- possession transfer
- reader-only knowledge
- outfit changes
- final chapters
- 5-, 10-, and 20-chapter simulations
- simple and complex images
- side profiles and action poses

## Methods

### Deterministic

Schema, references, thread lifecycle, word count, anchors, state transitions, duplicate prevention.

### Model-assisted graders

Narrow questions with fixed rubrics and evidence.

### Human review

Blinded pairwise review for prose and images. Reviewers may choose A, B, tie, or both unacceptable.

### Production metrics

Regeneration, failure, series completion, accepted cost, image repair, time to readable chapter.

## Creative scoring

Chapter dimensions:

- read-aloud quality
- characterisation
- narrative purpose
- emotional quality
- bedtime suitability
- originality
- reread value

Image dimensions:

- identity
- style
- scene accuracy
- mobile clarity
- emotional suitability

## Continuity metrics

- precision
- recall
- critical-fact recall
- false permanent facts
- possession accuracy
- knowledge accuracy
- plot-thread accuracy

## Release gate

A candidate may replace baseline only when:

- all blocking thresholds pass
- no critical fixture regresses
- human preference is neutral or better
- quality improves or cost/latency improves without quality loss
- rollback exists
- a human owner approves the evaluation

## Shadow and canary

Shadow outputs never publish or change state. Canary changes apply to newly created stories or series and remain pinned per series.

## Failure gallery

Every serious production failure should become a regression fixture where practical.
