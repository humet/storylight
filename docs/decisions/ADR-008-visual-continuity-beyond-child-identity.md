# ADR-008 — Visual continuity beyond child identity

Status: Proposed (2026-07-20)

## Context

M9 illustrations are live on the real gateway image models, and a hands-on review of one generated story ("Ivy and the Little Owl's Big Dark", 5 pages) exposed a class of defects that the current design does not prevent. The story's *text* was internally consistent (every illustration spec's `scene_description` correctly called the companion "a fluffy grey owlet"), so these are **image-layer continuity** failures, not writing failures:

| Page | Defect observed | Auto vision-review outcome |
| --- | --- | --- |
| 2 | Child in the **wrong outfit** (a mustard jumper, not her striped-top + patched-overalls reference) | **approved** — outfit mismatch not caught |
| 8 | Companion **Pip drawn as a red squirrel** (should be an owl); scene in **daylight** (bedtime story is night) | held, but for a cheerful *expression* — the species swap and time-of-day break were not caught |
| 12 | Page is "Pip takes his first flight" but shows the child in a tree with **no owl at all** | held on a footwear nitpick |
| 14 | **Two identical children** in frame | held (duplicate — correctly caught) |

The through-line: **the only visual invariant Storylight actually enforces is the child's facial identity.** ADR-003 ("reference-driven character identity") pins approved reference assets for **child characters only**. Everything else that makes a picture book feel like one continuous world is unanchored and, crucially, unchecked:

1. **Child wardrobe** — the outfit reference exists (`default-outfit` view) but is not forced through generation, and page-to-page the child changes clothes with no story reason.
2. **Recurring non-child characters** (companions, pets, family, recurring adults) — have **no visual anchor at all**. Pip is redrawn from prose on every page, so he can change species.
3. **World / setting** — location and **time of day** are not carried as canonical visual facts, so a night story renders a daytime page.
4. **Vision-review scope** — the review reliably checks child identity + count, but its outfit check is unreliable (missed page 2) and it does not check non-child characters or setting at all. It is not a safety net for (1)–(3).

A separate, encouraging finding from a controlled probe: when the generation prompt **explicitly described the required outfit and demanded exactly one child**, duplication and outfit drift both disappeared across models — i.e. prompt-level enforcement is a cheap, effective first lever, independent of the model chosen.

This is a scope gap, not a bug to patch. It warrants a decision because closing it touches the reference model (ADR-003), the illustration request builder, the continuity data model, and the vision-review contract.

## Decision

Extend Storylight's visual-continuity guarantees from "the child's face" to "the canonical scene" — the child's identity **and** wardrobe, every recurring named character's appearance, and the world/time-of-day — enforced at BOTH generation and review, and treated as canonical continuity data (never re-decided by a model). Five parts, ordered cheapest-first so value lands early:

1. **Deterministic wardrobe + cast in the prompt (cheap, do first).** The illustration prompt builder must spell out, verbatim from canonical data, each present character's required appearance and the child's required outfit, plus an explicit singular-count instruction ("exactly one child named X"). The probe shows this alone removes most duplication and outfit drift. No new storage, no new model.

2. **Force the wardrobe reference through generation.** The child's approved `default-outfit`/`full-body` reference is already selectable; make it a *required* reference part for every persistent-character scene (not optional behind the 8-step priority truncation), alongside the identity reference.

3. **Canonical visual anchors for recurring NON-child characters.** A recurring companion/pet/character gets a pinned canonical visual descriptor and, on first approved appearance, that page (or a generated establishing view) becomes its **reference asset**, reused as a conditioning reference on later pages — the same reference-driven mechanism ADR-003 uses for children, extended. For a one-off story this is "prior approved page as companion reference"; for a series it is a persisted companion visual profile pinned like the child's.

4. **Setting / time-of-day as canonical continuity.** Carry location + time-of-day (and other establishing world facts) from the plan / continuity state into every `illustration_spec` and into the prompt, so a bedtime story stays night. In a series these are continuity-state fields; in a one-off they are story-level constants.

5. **Broaden the vision-review contract.** The review must verify each scene against canonical facts, feeding the relevant reference/anchor images: child identity (have), child count (have), **child outfit vs the wardrobe reference** (make rigorous — explicit same-clothes comparison), **each expected non-child character present and the correct species/appearance**, and **setting/time-of-day**. Wrong child identity/count and wrong companion species are blocking (rule 7 class); outfit/setting deltas may be blocking or advisory-to-parent per a calibrated severity policy — the current all-or-nothing, child-only gate both over-rejects (page 12 footwear) and under-rejects (page 2 outfit, page 8 squirrel).

Parts 1–2 are near-term and low-risk. Parts 3–5 are the substantive work and should land with tests + fixtures (a "companion changes species", "child changes outfit", "night scene rendered in daylight" fixture set, judged like the M8 continuity tests).

## Consequences

- **Extends, does not contradict, ADR-003.** Reference-driven identity stays; its scope widens from child-only to "every canonical visual entity + wardrobe + world." ADR-003's blocking-identity rule (rule 7) gains a sibling: wrong companion species is likewise blocking.
- **Supersedes the M9 vision-review scope** (child identity + count + weak outfit) with the broader contract in part 5. `VisionReviewRequest` grows canonical expectations (expected non-child characters + species, required outfit, setting/time); the workflow already resolves reference bytes and can resolve companion/anchor bytes the same way.
- **New/changed data:** a companion visual anchor (reference asset or pinned descriptor) per recurring non-child character; setting/time fields on the illustration spec (and continuity state for series). Immutability/versioning follow the existing visual-profile rules.
- **Cost:** parts 1–2 are free (prompt/reference wiring). Part 5 adds no image calls (richer review prompt only). Part 3 may add establishing-image generation per new companion — bounded by the M9 per-workflow image-call cap.
- **Model choice is orthogonal.** A better image model (e.g. the Seedream evaluation) may reduce duplication/outfit drift, but it does not by itself give a companion a stable identity or keep the world consistent — those need the anchors + review above regardless of model.
- **Text layer is unaffected** — the writing was already consistent; the fix is in visual anchoring and review, not the story engine.

## Follow-ups / open questions

- Severity calibration for outfit and setting deltas (blocking vs parent-advisory) — needs the fixture set + a few real runs to tune, so the gate stops both over- and under-rejecting.
- Whether a one-off's companion anchor should be a dedicated establishing render or simply the first approved page reused (cheaper) — decide during part 3.
- Prior-page conditioning (feeding the previous approved page as a general style/wardrobe/companion anchor) is the cheapest whole-scene consistency lever and may partly substitute for a dedicated companion asset; evaluate it in part 3.
