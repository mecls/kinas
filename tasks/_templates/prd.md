# <Feature> — Implementation Spec

<!--
Gate 1 — Product. Saved as tasks/<feature-slug>/prd.md, tracked in git, so it is public:
nothing from scripts/private-names and no value from docs/external/ may appear in it.

Ask first, every time, even when the request looks complete. Three to five numbered questions
with lettered options, so the answer can be "1A, 2C, 3B"; each option must lead to a different
spec; say which option you would pick and why; keep one question for scope (what should this
deliberately NOT do?). Record the questions and the answers at the end, in §7.

Read the code before writing: the tables and columns the feature touches by their real names,
the helpers that already do part of the job, the conventions nearby. A rule that names a real
thing is worth ten that do not. No tech talk in §1–§4 beyond those names: databases, schemas,
endpoints and file names belong in architecture.md (Gate 2).
-->

## 1. Objective

<A paragraph. What changes for whom, and why now. Name the thing being replaced or fixed, if
there is one. Someone should be able to read only this section and know whether the rest is
relevant to them.>

## Announcement

<Three to six sentences announcing this feature to its user, written as the note that would go
out on the day it ships. If it cannot be written, the wrong thing is being built.>

## 2. Business rules (invariants — never violate)

<Numbered rules, each concrete enough to test: formulas as formulas, real names, real
thresholds, real dates. Where a rule exists because getting it wrong caused a real problem,
say so in a clause — a rule with a reason survives refactoring. Phrase each as something the
core enforces, not something the UI prevents: a disabled button is not an invariant.>

1. **<Rule name>.** <What is always true, the edge case, and why.>

## 3. Flows

<How data gets in and what happens to it, in order. Where a step can fail, say what happens:
retry, skip, alert or stop. Silence here becomes someone's guess later.>

## 4. Surfaces

<The pages, commands, jobs or messages this adds or changes: what each shows or does, and who
can reach it. Name the DESIGN.md §4 components each surface uses; a component that does not
exist there is added to DESIGN.md first.>

**Screens** — one line per mockup, or "no UI":
- `mockups/<screen>.html` — <what it shows>

<Mockups are plain HTML from tasks/_templates/mockup.html, one file per screen, throwaway by
design, styled with DESIGN.md's semantic tokens only. Review them in the reader with
`kinas open tasks/<feature-slug>/mockups/<screen>.html`; iterate until the captain says
"yes, that"; where DESIGN.md and a mockup disagree, DESIGN.md wins and the mockup is corrected
before approval. Nothing about a screen is decided in a component before it was decided in a
mockup.>

## 5. Validation

<How anyone knows it works, runnable where possible: the query to run and the number it
should return, the test that must pass. Include the number that proves it, not just the
instruction to check.>

## 6. Out of scope

<What this deliberately does not do, and one clause on why. This is the section that stops the
build growing sideways.>

## 7. Open questions

<What is still undecided and who decides it. An honest empty list is fine; a fake one is not.
Below it, the questions asked before writing and the answers given, dated.>
