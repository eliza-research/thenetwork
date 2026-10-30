# Classify polite block/report request phrasing, pronoun targets, and trailing clauses

## Summary
When members text the Network asking to block or report someone using natural phrasing such as `"I want to block Ben"`, `"can you please block Ben"`, or `"block this guy"`, the inbound classifier in `packages/network/src/classify.ts` failed to match `kind: "block"`. Instead, it fell through to `kind: "other"`, skipping `handleBlock()` and leaving the member without protection.

This change expands `RX.block` and `RX.report` to recognize standard polite request prefixes and modal verbs (`"I want to"`, `"I need to"`, `"I'd like to"`, `"can you"`, `"could you please"`), allows pronoun targets (`"this/that guy/girl/person"`) supported by `network.ts`'s `PRONOUN_TARGET`, and strips trailing explanatory clauses and punctuation for block targets identically to reports.

## Impact & Requirements
- **PRD 40.5 (Safety, Blocking & Reports)**: A member can block any counterpart or member they name at any time; safety requests must take priority and execute immediately without being dropped or misinterpreted.
- **Root Causes**:
  1. `RX.block` anchored on `^\s*(?:please\s+)?block\s+`, omitting common intent phrasing (`"I want to block"`, `"I need to block"`, `"I'd like to block"`, `"can you block"`, `"could you please block"`).
  2. `RX.report` similarly missed modal question forms (`"can you report"`, `"could you please report"`) and missing-apostrophe variants (`"id like to report"`).
  3. The negative lookahead `(?!(?:...|the|this|that)\b)` indiscriminately rejected pronoun targets defined in `network.ts:PRONOUN_TARGET` (`(?:the|this|that) (?:guy|girl|person|dude|man|woman)`).
  4. Block target extraction in `classify()` did not strip trailing punctuation or explanatory clauses (`replace(/[,;:.!?].*$/, "")`), unlike report target extraction.

## Verification
- **Unit Tests**:
  - `packages/network/test/block-target-plan.test.ts` passes 4/4 tests with 43 assertions, covering:
    - Direct names: `"block Ben"`, `"please block Ben"`, `"I want to block Ben"`, `"I need to block Ben"`, `"I'd like to block Ben"`, `"can you block Ben"`, `"could you please block Ben"`, `"please can you block Ben"`.
    - Reports: `"report Ben"`, `"I want to report Ben"`, `"can you please report Ben"`, `"could you report Ben"`.
    - Pronoun targets: `"block him"`, `"I want to block him"`, `"block this guy"`, `"block that person"`, `"report this guy"`.
    - Clause stripping: `"block Ben, he was creepy"` -> target `"Ben"`; `"report Ben: he asked for money"` -> target `"Ben"`.
    - Non-targets: `"block time for focus"`, `"block out 2 hours"`, `"block this thing now"`, `"report back tomorrow"` correctly preserved as non-blocks.
    - End-to-end Mini network test verifying that `"can you please block Ben, he made me uncomfortable"` immediately records `blocks.has("a|b") === true`.
- **Typecheck**: `bun run typecheck` exits 0 cleanly.
- **Simulation**: `bun run sim --only network` runs all invariant and blocking gates.
