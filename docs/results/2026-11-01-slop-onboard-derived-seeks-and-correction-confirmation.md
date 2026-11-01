# Slop onboarding: derived seeks updates on orientation/gender corrections and robust read-back confirmation

## Context & Root Cause

Under the Slop dating onboarding contract (PRD 40.5), seeking preferences can be derived from orientation and gender labels (e.g. "straight guy" -> seeks women with confidence `0.7`) or defaulted to straight with confidence `0.6` when the seeking question has reached `MAX_ASKS_PER_QUESTION`. Furthermore, orientation labels like "bisexual", "pansexual", and "queer", as well as gender "nonbinary", must never have seeking preferences guessed or defaulted.

Two critical defects were present in `packages/engine/src/packs/slop/extract.ts` and `packages/engine/src/packs/slop/onboard.ts`:

1. **Derived and defaulted `seeks` was never cleared or recalculated on subsequent corrections to `orientation` or `gender`**:
   - In `extract.ts`, `mergeReading()` only evaluated `derived = p.seeks && p.seeks.confidence <= 0.7` when `r.seeks` was explicitly present in the message. If a member sent a correction altering orientation or gender without a target gender noun list (e.g., "no, I'm gay", "actually I'm bi", or "no, I'm a woman"):
     - `r.orientation` or `r.gender` was updated.
     - `p.seeks` was left untouched with its old derived/defaulted value (`["woman"]`).
     - In `finalize()`, lines 851–863 only run `if (!p.seeks && ...)`. Because `p.seeks` was still populated, seeking was never recomputed.
     - As a result:
       - A man who corrected to "gay" remained matched with women (`seeks: ["woman"]`).
       - A member who corrected to "bi" or "queer" was not asked who they seek and remained stuck seeking only women.
       - A member who corrected their gender to "woman" remained stuck with `seeks: ["woman"]` instead of straight seeking `["man"]`.

2. **`applyCorrection` confirmed profiles on negative replies starting with an affirmation word, and evaluated minor/declined status on the stale profile**:
   - In `onboard.ts`, `applyCorrection()` ran:
     `const yes = classifyYesNo(text) === "yes" || /^\s*(?:right|correct|exactly|that'?s (?:it|right)|you got it|perfect|yup|yep|ya|ye|100|👍)\b/i.test(text);`
     When a member answered with a negative reply that began with an affirmative or acknowledgment word (e.g. "right, no", "correct, wait no", "yep, no"), `classifyYesNo(text)` returned `"no"`, but the regex matched the leading word, evaluating `yes = true` and confirming the profile as accepted!
   - `applyCorrection()` checked `!p.minor && !p.declined` against the previous profile `p` rather than `!next.minor && !next.declined`. If the member revealed in the read-back reply that they were under 18, `confirmed` could still be marked `true`.
   - `view(p)` omitted `orientation`, `noDealbreakers`, `minor`, and `declined`, causing changes to these fields to be missed by the `changed` detection.

## Changes

- **`packages/engine/src/packs/slop/extract.ts`**:
  - In `mergeReading()`: when `r.gender` or `r.orientation` is updated without an explicit `r.seeks`, delete `p.seeks` if it was derived or defaulted (`p.seeks && p.seeks.confidence <= 0.7`). This enables `finalize()` to correctly recalculate seeking preferences or leave them unset for nonbinary/bi/pan/queer members.
  - In `stripMeta()`: include `orientation: p.orientation?.value` and `minor: p.minor` so orientation and minor changes trigger re-confirmation.
- **`packages/engine/src/packs/slop/onboard.ts`**:
  - In `applyCorrection()`: inspect `classifyYesNo(text)`. Only allow the affirmative regex fallback when `classifyYesNo(text)` is not `"no"`.
  - Check `!next.minor && !next.declined` on the updated profile.
  - In `view()`: include `o: p.orientation?.value`, `ndb: !!p.noDealbreakers`, `m: p.minor`, and `dec: p.declined`.
- **`packages/engine/test/slop-onboard-corrections.test.ts`**:
  - Added unit tests verifying:
    - Orientation correction from straight to gay updates derived `seeks` to `["man"]` and leaves profile unconfirmed.
    - Orientation correction to bisexual clears derived `seeks` so the member can be asked.
    - Gender correction updates derived `seeks` appropriately.
    - Negative replies starting with affirmative words ("right, no", "correct, wait no", "yep, no") do not confirm.
    - Minor revelation in correction leaves profile unconfirmed and marks `minor: true`.

## Verification

```sh
bun test packages/engine/test/slop-onboard-corrections.test.ts
bun run typecheck
bun run sim --only onboard,relay,friends,network,evals
```

All 5 unit tests pass (23 assertions). TypeScript typecheck passes across all 4 configs without error. Simulation passes 183/183 blocking gates.

## Slop contribution receipt
- **provider**: google
- **model**: gemini-2.5-pro
- **client**: antigravity
