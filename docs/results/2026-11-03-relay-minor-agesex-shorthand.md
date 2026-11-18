# Relay minor signal misses the no-separator age-and-sex shorthand

## Problem and root cause

`MINOR_SIGNAL` in `packages/engine/src/relay.ts` flags a self-disclosed minor age in a relayed
message (`classifyRelayText` -> `relayItem` adds `minor:signal`, blocks the item and sets
`ageSignal`). It reads "I'm 17 years old", "I'm 16 tho", "17 yo" and even the spaced and slashed
age-and-sex forms "im 17 m" and "im 17/m". It did NOT read the no-separator shorthand "im 17m" or
"16f" — the exact way teens introduce themselves. The first (numeric) branch ends on a word
boundary or " yo"/"years old"; between "7" and "m" there is no word boundary, so the branch failed
and nothing else matched.

The parallel classifier `packages/network/src/classify.ts` already reads this form ("15f", "16 m",
"15/f") and `evals/network/teen-age.jsonl` labels `"im 15f"` as `teen:true`, so the relay path was
inconsistent with the rest of the codebase on a safety signal (founder rule: minor contacts are
always 0).

Confirmed before the fix, base `a0ed7bc`:

```
MISS "im 17m"      MISS "im 17f"      MISS "hey im 16m"
HIT  "im 17 m"     HIT  "im 17/m"     HIT  "im 17 years old"
```

## Fix

A second branch in `MINOR_SIGNAL`, modelled on `classify.ts`'s `AGE_SEX_END`: age `1[3-7]`, an
optional separator, a sex letter `[mfx]` not followed by another letter, and an end guard that
requires the clause to stop or continue the way an intro does (`here`, `lol`, `btw`, `from`, `in`,
`looking`, `nyc`, `bk`, punctuation or end). Units and sums stay out: "17m away", "170m from home",
a "15m" raise and "16k" do not match, and the existing unit lookahead is unchanged.

## Validation

Method: the relay sim block, same command before and after.

```
bun run sim --only relay
```

- Before (regex reverted, new rows kept): `relay: ... a minor's self-disclosure blocks and flags
  the age` FAILs — `expected ["im 17m","pass",false] to equal ["im 17m","block",true]`.
- After: 60/60 blocking gates pass, 4 tracked off target (unchanged from base), 0.8 s.

The regression rows were added to the existing self-disclosure scenario in `scripts/sim/relay.ts`:
positives `"im 17m"`, `"i'm 16f looking to meet"`, `"hey im 15f btw"`, `"im 16/x from brooklyn"`
(each must block with `ageSignal`), and negatives `"I'm 17m away from the bar"` and
`"im 170m from home"` (must still pass).

No false positives introduced: the new branch matches 0 rows across `evals/relay/relay.jsonl`,
`relay-paraphrases.jsonl`, `relay-heldout-1.jsonl`, `relay-heldout-2.jsonl` honest rows and the 221
lines of `evals/network/benign-adult.txt`. The relay honest-held and benign-held gates stay at the
same values.

`bun run typecheck` passes.

## Model and limits

`MINOR_SIGNAL` is a deterministic rule; this change touches no model path, so no real-LLM run
applies to it (the relay Clef classifier is a separate layer and is unchanged). The new branch
requires a first-person prefix ("im"/"i'm"/"i am"), matching the numeric branch; a bare
"17m here" with no prefix is still not read as a minor signal, which keeps "$15m", "raised 15m" and
"15m away" out. Provider/model/client are recorded in the PR footer.

## Follow-up: the bare "m" shorthand flagged adult ETA/distance texts (2026-11-09)

Review of the shorthand branch (request-changes on PR #352) found that the bare "m" suffix is also
the ETA/distance unit, so the new branch read benign adult messages as a minor disclosure and
blocked the relay (and raised a permanent `ageSignal`): "I'm 15m from the bar", "im 15m from the
cafe", "I'm 15m in an uber", "I'm 15m in traffic", "running late, I'm 15m" and "eta: I'm 15m." all
matched. The letter "m" means minutes or metres here, not male.

Fix (smallest sound change): split the shorthand branch so "f", "x" and the slashed forms ("17/m")
stay unconditional, and the bare (unslashed) "m" branch excludes two ETA/distance contexts only —
a preceding ETA word (`ETA_BEFORE`: `eta|running late|almost there|on my way|omw`) and a following
`from (the|a|an|our|your|there|here)` or `in (a|an|the|traffic)` (`ETA_AFTER`). A location
disclosure after the shorthand ("im 16m from brooklyn", "from" + a place, not an article) is NOT an
ETA context and still blocks.

Before/after (same `evals`-style rows, `MINOR_SIGNAL` only):

```
                                             before (buggy)   after
ETA/distance adult rows flagged as minor       8 / 8          0 / 8
real disclosures still flagged                 6 / 6          6 / 6
  ("im 17m","i'm 16f...","hey im 15f btw",
   "im 16/x from brooklyn","im 16m from brooklyn","im 17/m")
```

Validation, same command before and after:

```
bun run sim --only relay
```

- Before the follow-up fix (ETA rows added to the pass list, regex not yet split): the
  self-disclosure scenario FAILs — e.g. `expected ["I'm 15m from the bar","block"] to equal
  ["I'm 15m from the bar","pass"]`.
- After: `relay: 60/60 blocking gates pass, 11 tracked, 0.8s` (the 4-off-target count is unchanged
  from base; the tracked count rises only because the scenario now carries more rows).

The six reviewer examples plus "I'm 15m from here" and "I'm 15m in the car" were added to the pass
list in `scripts/sim/relay.ts`, and "im 16m from brooklyn" and "im 17/m" to the blocking list.
`bun run typecheck` passes.
