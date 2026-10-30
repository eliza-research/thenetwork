# Probe counter for unlisted named day (2026-10-30)

Date: 2026-10-30. Branch: fix/probe-counter-unlisted-day. Base: main a0ed7bc. Issue: #134.

## Problem

`parseProbeReply` in `packages/network/src/classify.ts` read a plain yes naming a day that was
not offered ("Friday works" against Thu/Sat/Sun options) as a yes to every offered time.
`onProbeAnswer` then booked a time the member never named.

## Cause

With no offered option matched, `picked` was empty and the `c.answer === "yes"` fallthrough
returned every open option. A named but unoffered day never became a counter.

## Fix

After the "any of those" branch, when nothing is picked and the reply is a yes, check every
`DAY_WORDS` day name absent from the offered labels. An unnegated match returns
`{ answer: "yes", keys: [], why: "counter" }`, so `onProbeAnswer` offers new times instead
of booking. Offered days, plain yes, "any of those", refusals, and unclear paths are unchanged.

Other implementations considered:

1. Treat every unpicked yes as a counter. Rejected: it would turn plain "yes" and
   "any of those" into retries instead of bookings.
2. Only check COUNTER_RX phrasing ("another day", "next week"). Rejected: "Friday works"
   carries no counter phrasing, so the issue cases would still book everything.

## Evidence

Same command, options Thu 7pm / Sat 11am / Sun 2pm:

| Reply | Before | After |
|---|---|---|
| Friday works | yes keys [a,b,c] affirm | yes keys [] counter |
| Friday works for me | yes keys [a,b,c] affirm | yes keys [] counter |
| I can do Friday | yes keys [a,b,c] affirm | yes keys [] counter |
| Yes, Friday works | yes keys [a,b,c] affirm | yes keys [] counter |
| Thursday is no good, Friday works | yes keys [b,c] affirm | yes keys [] counter |
| Thursday 7pm works for me | yes keys [a] affirm | yes keys [a] affirm |
| Saturday works | yes keys [b] affirm | yes keys [b] affirm |
| yes | yes keys [a,b,c] affirm | yes keys [a,b,c] affirm |
| any of those | yes keys [a,b,c] none | yes keys [a,b,c] none |
| Thursday works | yes keys [a] affirm | yes keys [a] affirm |
| no | no keys [] refusal | no keys [] refusal |

Added five corpus rows to `evals/network/consent-replies.jsonl` (all five issue cases,
`label yes` with empty `keys`).

Validation:

- `bun run sim --only evals`: 25/25 blocking gates pass, consent replies 327 lines at 100%,
  heldout 75 lines at 100%, no refusal or hedge read as yes.
- `bun run typecheck`: pass.
- `bun run test:integration`, `bun run test:e2e`, real-LLM runs: N/A per environment
  constraints for this draft staging.
- No UI change. No secrets, `.env`, `runs/`, or member data in the diff.
