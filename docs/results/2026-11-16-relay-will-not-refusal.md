# Relay refusal: will/should/must/shall + not read as a contact share

Date: 2026-11-16.
Base: `ebf3e61`.
Scope: `packages/engine/src/relay.ts`, `evals/relay/requests.jsonl`.

## 1. Defect

`parseRelayRequest` reads "I will not give him my number" (and the
`should not` / `must not` / `shall not` forms) as `contact_share`, because
neither `NEG` nor `SHARE_NEG` lists those forms. The refusal then becomes a
consent record in the sender's name (`relayItemFromRequest`) and the number
is shared when the item passes (`contactShared: true`). Follow-up completing
the merged #202 fix, which covered "not going to" and "can't" refusals.

## 2. Fix

Add `will not`, `should not`, `must not` and `shall not` to `SHARE_NEG`,
each with a `(?! wait)` guard so "I will not wait, send them my number"
still reads as a share. The forms went into `SHARE_NEG`, not `NEG`, so text
relays keep their content negation ("tell them I will not be long" still
reads as `text`). Corpus: 7 rows added to `evals/relay/requests.jsonl`
(50 → 57) — the 6 refusal forms labelled `none`, plus the "will not wait"
guard row labelled `contact_share`.

## 3. Verification

Same commands before and after; full `bun run sim` (pinned seeds).

- Before: 327/329 blocking gates pass. The two failing gates are both
  relay: "relay requests (n 57): every row read as labelled" (5 of the 6
  new rows read as `contact_share`, want `none`) and "relay requests: 0
  hedged, negated or question requests read as a contact share or photo
  send" (all 6 new rows read as a share). 1989.3s.
- After: 329/329 blocking gates pass, 21 tracked off target. 1789.7s.
  `bun run sim --only relay`: 62/62 blocking gates pass (6.3s).
- `bun run typecheck`: all 4 TypeScript projects pass, 0 errors.

Boundary probe (before and after, unchanged): "tell them I will not be
long" → `text`; "I will not wait, send them my number" → `contact_share`.

## 4. Limits

Refusal detection is message-wide, as it already is for "can't" and
"couldn't": a trailing "will not ..." clause after a real request ("send
them my number, I will not be long") now reads as `none`. Scoping refusals
to the request clause is open PR #283's (unmerged) approach for `NEG`.
#283's head still reads all 6 rows as `contact_share`; a merge conflict
with #283 is possible because both edit `parseRelayRequest`.
