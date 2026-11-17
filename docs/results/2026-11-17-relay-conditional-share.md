# A conditional share is not a share now

On November 17, 2026 the relay simulator passed 60 of 62 blocking
gates before the change and 62 of 62 after it. The two changed gates
are the member-request gates in `scripts/sim/relay.ts`: every row in
`evals/relay/requests.jsonl` read as labelled, and zero hedged,
negated or question requests read as a contact share or photo send.
The simulation uses a fixed clock and a synthetic match. The parser
calls no model and sends no live messages.

Run `bun run sim --only relay`. The pre-existing four tracked
targets stayed off target (relay-heldout-2 corpus recall for scam,
harassment, contact and rating, all tracked, never tuned on).

## Before

`bun run sim --only relay` failed 2 gates (exit 1, 60/62):

- `relay requests (n 62): every row read as labelled` — 5 rows shown,
  e.g. `"send them my number if she asks" -> contact_share (want none)`.
- `relay requests: 0 hedged, negated or question requests read as a
  contact share or photo send` — all 10 new conditional rows listed.

A probe of `parseRelayRequest` on HEAD read all 10 conditional
inputs as a share: 9 as `contact_share` and `send them this photo
if they ask` as `photo`. Controls were correct: `send them my number`
stayed `contact_share`, `send them my number tomorrow` and `don't
send them my number` stayed `none`, `ask them if 6:30 works` stayed
`text`.

## After

Same command passes 62/62 (exit 0, 2.1 s). The probe reads 20/20:
the 10 conditional inputs read `none`, and all 10 controls keep
their previous reading, including `send them my number, she already
asked` and `give him my number, he asked for it` (past ask, still a
share) and `ask them if 6:30 works` (`text`).

`bun run typecheck` passes. `bun run sim --only evals` passes 30/30,
the same as its baseline. The full `bun run sim` and
`test:integration` / `test:e2e` need the dev Postgres, which this
machine does not have; CI runs them.

## What changed

- `packages/engine/src/relay.ts`: one branch in `HEDGE` hedges a
  share conditioned on the other party asking or wanting it
  (`if`/`when` + she/he/they/my match/my date + asks/wants/requests/
  ready/interested/says so). A condition on the speaker (`if I say
  so`) still reads as a share, and a past ask (`she already asked`)
  still reads as a share.
- `evals/relay/requests.jsonl`: 12 rows (10 conditional rows with
  `want: "none"`, 2 past-ask rows with `want: "contact_share"`).

## Overlap check

Open PR #527 (`fix(engine): hedge time-deferred contact shares`)
was still open and unmerged when this was written, and its diff was
read in full: it hedges only time deferrals (`when we meet`,
`next week`, `on Friday`, `after our date`, `this weekend`,
`in a few days`). It has no conditional branch, so the two changes
compose. No other open PR covers conditional shares.
