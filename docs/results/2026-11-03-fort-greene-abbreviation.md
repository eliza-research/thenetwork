# Fort Greene abbreviation — 3 November 2026

The area reader did not know the short form of one neighborhood it serves.
A member who wrote "Ft Greene" or "Ft. Greene" was not matched to Fort Greene.

`packages/network/src/classify.ts`, function `areaOf` and the `AREA_ALIASES` table.
Base revision `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (current `main`).
**No LLM calls. Zero inference cost.** Every run kept the provider keys unset.
The validation layer on this tree is `bun run sim` (`docs/tests-policy.md`).

## Reproduced problem

Fort Greene is a neighborhood the Network knows (`packages/network/src/geo.ts`,
`NEIGHBORHOODS`). It has a meeting venue (Fort Greene Park). The `areaOf` reader
turns a member's text into this neighborhood when the member says where they live.

"Fort" has one common short form: "Ft" or "Ft.". The alias table gives the short
form of almost every multi-word neighborhood. It reads "Wash Heights" as
Washington Heights, "Crown Hts" as Crown Heights, "Bed Stuy" as Bed-Stuy, and
"St. George" as St. George. It did not read "Ft Greene" as Fort Greene.

A member in Fort Greene who wrote the short form got one of two wrong results:

- With a capital letter ("I live in Ft Greene"), the reader set `areaUnknown`.
  The agent then asked the member again for a neighborhood it already serves.
- In lower case ("based in ft greene"), the reader returned nothing. The member
  was dropped from area matching, with no question.

The lower-case miss had a second cause. The sentence splitter ends a sentence at
a period. "ft. greene" became two sentences, "ft." and "greene". The reader
protects "st." from this split (it changes "st." to "st " before the split), but
it did not protect "ft.".

## Cause

Two parts of the same abbreviation pattern were incomplete for "Fort":

1. `AREA_ALIASES` matched `fort greene` only. It did not match `ft greene` or
   `ft. greene`.
2. `areaOf` normalized `st.` to `st ` before the sentence split, so "St. George"
   stays one sentence. It did not do the same for `ft.`, so "ft. greene" split
   into two sentences and no alias matched.

St. George, the one neighborhood whose name holds "St.", had both parts. Fort
Greene, the one neighborhood whose name holds "Fort", had neither.

## Fix

Two small changes complete the pattern, each next to the code that already does
the same work for "St." / "Saint":

```ts
// AREA_ALIASES: accept the short form, like every other multi-word neighborhood.
[/\b(?:fort|ft\.?) greene\b/, "Fort Greene"],

// areaOf: protect "ft." from the sentence splitter, the same as "st.".
const t = normText(text).replace(/\b(st|ft)\.\s*/g, "$1 ");
```

No signature, type, config field, log shape, message copy, or UI changes. The
change touches the area reader only. It adds no new neighborhood; it reads the
short form of a neighborhood the table already holds.

## Two implementations not used

**A general "expand abbreviations" pre-pass.** Replace "ft"→"fort", "mt"→"mount",
"hts"→"heights", and more, on the whole text before the aliases run. This removes
the per-alias short forms. It was not used because the alias table is already the
one place that owns short forms (it holds "wburg", "lic", "fidi", "bed stuy"), and
a second expander would be a second owner for the same job. A broad text rewrite
also risks changing words that are not place names.

**A new `AREA_ALIASES` row that matches only `ft\.? greene`.** Keep the old
`fort greene` row and add a second row for the short form. This matches the short
form, but it leaves the period problem: the sentence splitter still cuts "ft."
from "greene", so "ft. greene" still fails. The chosen fix repairs the split at
its source, so both rows become one and the period case works.

## Reproduction and verification

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Bun 1.4.4, macOS.
The evals block scores hand-written corpora offline. It calls no model and needs
no database. The three phrasings in the new gate are hand-written. The block uses
its pinned inputs; this path has no seed and no clock.

```sh
bun install
bun run sim --only evals
bun run typecheck
```

New gate in `scripts/sim/evals.ts`, next to the existing area gates. It reads three
phrasings of the short form:

```
areas: the Ft/Ft. abbreviation of Fort Greene resolves
  "based in Ft Greene" | "I'm in ft. greene" | "live in ft greene near the park"
```

The fix adds this one check only (CONTRIBUTING 12.1). A row in
`evals/network/areas.jsonl` alone does not fail before the fix: the existing recall
gate has a 0.9 threshold, and it passes with three misses.

| | new gate | evals block |
|---|---|---|
| base `a0ed7bc` + gate | **FAIL** (3 phrasings miss) | 25/26 |
| this branch | **PASS** | 26/26 |

Before the fix the gate reports `based in Ft Greene | I'm in ft. greene |
live in ft greene near the park`. After the fix all three read as Fort Greene.

Edge cases checked by hand (each returns the correct result on this branch):

- "I'm at St. George" still reads St. George (the `st.` path is unchanged).
- "I work in ft greene" and "used to live in ft greene" return nothing
  (`NOT_HOME` context still wins; the member does not live there).
- "6 ft. tall, live in Chelsea" reads Chelsea, not Fort Greene (the short form
  needs "greene" after it).

## Executed evidence

`bun run typecheck`: exit 0.

`bun run sim` ran the full validation layer at commit `6b38971`. The dev PostgreSQL
on :54339 was present on this machine, so the safety, ops, pipeline and audit
blocks ran as well as the deterministic blocks. The summary line:

`PASS: 328/328 blocking gates, 15 tracked off target, 211.2s`

The branch adds exactly one gate (the Ft/Ft. gate), so the base `a0ed7bc` scores
327/327. No other gate changed state. Commit `6b38971` also had three corpus rows.
This branch removes them, so the change keeps one check. Only the evals block reads
`evals/network/areas.jsonl` (`scripts/sim/evals.ts:101`), so the evals block was run
again on this branch: 26/26, with `PASS areas: the Ft/Ft. abbreviation of Fort
Greene resolves`. The before and after of that block is the table above (25/26 ->
26/26, same command and data).

## Limits

- Provider / model / request settings: N/A for this deterministic path. The reader
  is a pure function of its text input. It calls no model. An LLM run cannot
  exercise it, so no provider, model, or cost is claimed.
- The change is a pure function of its text input in `classify.ts`. It touches no
  database, HTTP route, service, platform or client workflow. The full `bun run
  sim` above (PostgreSQL present) covers the safety, ops, pipeline and audit
  blocks. The separate `bun run test:integration` and `bun run test:e2e` HTTP
  suites exercise the service and platform, not the area reader, so they were not
  run on this machine; CI remains the gate for those suites.
- The fix repairs one neighborhood's short form. It does not add a new
  neighborhood, and it does not change the lower-case rule for an unknown place
  (an unknown lower-case place still returns nothing; that rule is unchanged).
