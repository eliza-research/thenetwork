# Attention budget, digests, hold queue and consent-first probes, measured (2026-10-07)

Spec: [docs/design/2026-10-07-experience-design.md](../design/2026-10-07-experience-design.md), section 1 and Phase 1 of section 8, with the founder defaults D1-D18 ("the doc"). Builds on [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md). **No LLM calls, $0.** Tests ran with keys unset and without `LIVE_TESTS`.

The runs below used the engine experiment harness (`packages/engine/experiments/attention.ts`, `attentionNetwork.ts`) and the engine test suite, both since deleted. Validation on the current tree is `bun run sim`. This document keeps iteration 4 (the current design) in full. Iterations 1-3 are summarized below; their full text is in git history at commit `16cde70` (`git show 16cde70:docs/results/2026-10-07-attention-budget.md`).

## Earlier iterations (summary)

- **Iteration 1 (Phase 1 as specified):** every send-time invariant held (0 over-cap sends against 63 for v1.2, 0 sends past the Blooio reservation), but weekly digests with the founder defaults gave met + worthwhile 10.3 per seed against 25.5 for v1.2. Recommendation: adopt the send-time invariants, not weekly digests.
- **Iteration 2 (fair baseline R = daily dispatch plus every hard send rule):** R kept 23.1 met + worthwhile per seed. The best attention design (G-J4, rolling daily slot) tied it (21.1) and almost doubled value events per interruption (0.325 vs 0.171). Consent-first probes cost 6-9 meetings per seed.
- **Iteration 3 (founder decisions 1-4, `attention-v1.1.0`):** rolling sends at a learned per-member time (default 12:00 local), always probe first, only initial invites count against the cap, and 2-3 time options in every probe. Probe-first fell to 7.4 met + worthwhile per seed against R's 23.1 without the fidelity fixes; with fixes 1-3 it tied (7.3 vs 8.6). Time options halved meeting seats set at a not-free time (30% vs 59%).
- The simulator fidelity fixes used below: (1) ask-primed probes, (2) outside-world event items, (3) attendance depends on whether the member is free at the meeting time. "H" arms run with fixes 1-3.
- Every arm in iterations 1-3 kept every invariant: 0 minor contacts, 0 canary leaks, 0 over-cap sends, 0 quiet-hour sends.

# Iteration 4: making probe-first cheaper (2026-10-07)

The founder keeps "always probe first", so iteration 4 tests designs that stay anonymous until both members say yes but need fewer answers in sequence: (a) **parallel probes**, (b) **the reveal as a booked plan with an opt-out** instead of a third required yes, (c) **pre-commit**, where the probe's yes carries the time choice so the reveal is the booked plan at that time, and (d) combinations, plus **warm mentions** ("a friend of Sam"). Same simulator, seeds 1-8, no LLM calls, keys empty, against R (23.1) and N3 (7.4), with and without fixes 1-3. R, N3, H-R and H-N3 were rerun in the current tree and reproduce iteration 3 exactly.

## Result

- **(b)/(c), the reveal as a booked plan, is the win.** Dropping the third required yes takes N3 from **7.4 to 10.8-11.8** met + worthwhile per seed without fixes (+3.4 to +4.4, about 2.5 standard errors), and from **7.3 to 15.0** with fixes 1-3 (+7.7, about 6 SE). With fixes 1-3, **HQ-c (15.0 ± 1.0) beats R under the same fixes (H-R 8.6 ± 1.0) by 6.4**, about 4.5 SE, with half the meeting seats at a time the member is not free (29% vs 61%). Without fixes it is still well below R (10.8 vs 23.1): the anonymous probe is answered with the plain acceptance model, and the partner step loses most opportunities.
- **(a) Parallel probes do not help** (Q-a 7.9 vs N3 7.4; HQ-a 7.8 vs H-N3 7.3), and they make (c) worse (Q-ac 8.6 vs Q-c 10.8; HQ-ac 13.1 vs HQ-c 15.0). They spend **121-138 initial invites per seed on opportunities that die on the other member's no or silence**, against 75-86 for sequential probes. The engine also proposes about a third fewer pairs (272-285 vs 421-436 per seed): with both members holding the item, held pairs block more of the engine's candidates. Parallel probing does what it promises (no member waits for the other to answer first), but the simulator's members answer fast enough that latency is not the constraint.
- **(c) Pre-commit vs (b) inferred time: a tie on meetings** (with fixes 15.0 vs 15.0; without 10.8 vs 11.8). Pre-commit halves seats at a not-free time again (29% vs 47%), and inference alone already beats today's default time (47% vs 61%). (c) is the design that matches the copy ("you're both in, Thu 7pm"), so it is the recommendation; (b) is the fallback when no offered time fit.
- **Warm mentions**: about 14-15 probes per seed (3.5% of probes) qualify under the D5 rules below. With the simulator's own probe model (no warm effect) they change nothing (HQ-acw0 = HQ-ac exactly). With an assumed lift of 0.3 on the yes probability (harness-only sensitivity): HQ-acw 15.0 vs HQ-ac 13.1 (+1.9, inside noise). Coverage is the limit, not the lift.
- **Privacy cost.** Of the members who said yes and then learned who it was, **3-6% decided no on the named plan**, about the same with a required reconfirmation (N3 4.2%, H-N3 4.8%) as with the opt-out reveal (Q-c 4.1%, HQ-c 4.7%). Names are disclosed at the same moment in both designs (after both yeses), so the opt-out reveal adds no disclosure. What it changes is the default on silence: a member who ignores the booked plan is counted as in. Explicit "can't make it" replies cancel the plan: 2-6 per seed (about 1 in 7 booked plans with fixes, 1 in 8 without).
- Every arm keeps every invariant: 0 minor contacts, 0 canary leaks, 0 over-cap, 0 quiet-hour sends, 0 messages past Blooio's third unanswered, 0 judge invariants. Nobody is named in any message before both participants said yes (checked end-to-end in the engine's `attention-sim.test.ts` at the time; now validated by `bun run sim`).

## What was built

- `attention.ts`:
  - `startProbeFlow(p, { parallel })`, with `ProbeFlow.parallel`: both members of a pair are probed at once, either may answer first, the flow is revealed only when both said yes, and any no closes it. `toProbe` and `recordProbeAnswer` handle it.
  - `itemsForProposal(p, { parallel })`: items for both members.
  - `warmMention(w, via, recipient, others, consented, category)`: returns the mutual's first name or null.
  - `buildProbe` takes `spec.mutual`. The mention replaces the attribute and the text still goes through the leak gate. If the text with the mutual fails the gate, the probe falls back to the plain text.
- `config.ts`: `consent: { parallel, reveal: "confirm" | "opt_out", warmMentions, warmMinAnonymity: 3 }`. **Defaults: `reveal: "opt_out"`, `parallel: false`, `warmMentions: false`** (`attention-v1.2.0`).
- Harness (`attentionNetwork.ts`):
  - Options `parallelProbes`, `revealOptOut` and `warmConsent`.
  - The opt-out reveal sends one message per member: "You're both in: meet Sam, Thu 7pm near the Mission. <why> Reply if you can't make it." It is a logistics message that does not count against the cap, and it books the meeting at the slot both picked, or else at the best estimated joint slot. Silence for 48 hours means in; a "no" cancels the plan and tells the other member without saying why.
  - Parallel flows share one set of time options, so the two members' picks can meet. Picks are kept per member and the meeting time is their intersection.
  - Counts kept: wasted invites, back-outs, warm probes.
- Experiment (`packages/engine/experiments/attention.ts`, since deleted): variants Q-* (no fixes) and HQ-* (fixes 1-3), a "consent-first cost and privacy" table, and the harness-only warm model `warmProbes`. Under that model members consent to mutual mentions with p = 0.7, and a probe naming a mutual is answered yes with P' = P + lift x (1 - P).
- Tests (since deleted; now validated by `bun run sim`): parallel flow and warm-mention rules in `attention.test.ts`; an iteration-4 end-to-end configuration in `attention-sim.test.ts`, which checks every invariant plus "every reveal follows a yes from every participant".

## Do warm mentions stay within D5?

D5 says a probe shows the activity, the time, the area and **at most one shareable fact about the other person**, and never a name, photo or employer until both say yes. "A friend of Sam" names Sam (not the other person) and states a fact about the other person, their connection to Sam. It fits D5 only under these rules, which `warmMention` enforces:

1. It is **the** one fact: the shareable attribute is dropped when the mutual is mentioned.
2. **Consent from both people whose information it is**: the mutual, to being named, and the person described, to their connection being mentioned. The edge itself is not a `shareable` facet, so consent stands in for the scope.
3. **No singling out**: the mutual must have at least 3 connections in the Network other than the recipient, so the mention narrows the recipient's guess to one of at least 3 people. With fewer, the recipient could work out who it is before both say yes, which D5 forbids in substance.
4. The recipient and the person described are each directly connected to the mutual. The mutual is an adult, not paused, and not on a safety hold. Never for romance.
5. First name only, as the mutual would be known to the recipient.

Under these rules it stays within D5. It needs a consent setting ("OK to mention me as a mutual friend") that does not exist yet, which is why it is off by default.

## Results (8 seeds)

| Variant | Met + worthwhile | Per seed | Int. /member-wk | Value /int. | V14 | Meetings /seed | Seats at a not-free time | Initial invites per meeting | Wasted invites /seed | Learned who, then no | Opt-out back-outs /seed |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **No fidelity fixes** | | | | | | | | | | | |
| R A+rules | **23.1 ± 2.0** | 11 28 23 24 25 20 26 28 | 0.67 | 0.171 | 21.1% | 43.5 | 62% | 9.1 | 81 | - | - |
| N3 (iteration 3 defaults) | 7.4 ± 1.2 | 2 8 4 9 5 12 10 9 | 0.64 | 0.063 | 8.1% | 16.3 | 25% | 23.1 | 76 | 4.2% | - |
| Q-a parallel | 7.9 ± 1.0 | 8 14 5 9 7 8 7 5 | 0.63 | 0.057 | 7.6% | 15.8 | 26% | 23.8 | 138 | 4.0% | - |
| Q-b opt-out reveal, time inferred | **11.8 ± 1.1** | 10 11 9 14 9 18 11 12 | 0.65 | 0.092 | 12.5% | 25.9 | 46% | 14.8 | 74 | 3.9% | 3.4 |
| Q-c pre-commit (time options + opt-out reveal) | **10.8 ± 1.3** | 11 18 8 8 10 14 9 8 | 0.64 | 0.086 | 11.7% | 24.0 | 31% | 15.8 | 75 | 4.1% | 3.1 |
| Q-ac parallel + pre-commit | 8.6 ± 1.4 | 2 13 12 10 11 10 3 8 | 0.61 | 0.080 | 10.2% | 21.1 | 30% | 17.0 | 134 | 3.2% | 2.3 |
| Q-acw Q-ac + warm (lift 0.3) | 7.9 ± 1.5 | 2 15 6 10 11 7 3 9 | 0.61 | 0.077 | 10.2% | 20.5 | 27% | 17.5 | 134 | 3.6% | 2.4 |
| Q-acw0 Q-ac + warm (no lift) | 8.6 ± 1.4 | = Q-ac | 0.61 | 0.080 | 10.2% | 21.1 | 30% | 17.0 | 134 | 3.2% | 2.3 |
| **Fixes 1-3** | | | | | | | | | | | |
| H-R | 8.6 ± 1.0 | 5 13 9 12 7 9 7 7 | 0.66 | 0.060 | 9.0% | 45.3 | 61% | 8.6 | 79 | - | - |
| H-N3 | 7.3 ± 0.9 | 8 8 6 10 6 11 4 5 | 0.67 | 0.220 | 21.3% | 27.1 | 30% | 14.6 | 82 | 4.8% | - |
| HQ-a parallel | 7.8 ± 0.9 | 4 7 10 9 8 7 5 12 | 0.62 | 0.244 | 21.0% | 25.5 | 30% | 14.3 | 121 | 5.9% | - |
| HQ-b opt-out reveal, time inferred | **15.0 ± 1.3** | 11 21 11 14 19 17 12 15 | 0.67 | 0.280 | 27.7% | 37.9 | 47% | 10.4 | 82 | 5.4% | 5.8 |
| **HQ-c pre-commit** | **15.0 ± 1.0** | 18 18 10 15 13 18 13 15 | 0.67 | 0.284 | 28.4% | 36.6 | **29%** | 10.8 | 86 | 4.7% | 5.5 |
| HQ-ac parallel + pre-commit | 13.1 ± 1.5 | 12 16 4 18 14 16 14 11 | 0.62 | 0.300 | 26.3% | 35.8 | 28% | 10.3 | 121 | 5.5% | 6.4 |
| HQ-acw HQ-ac + warm (lift 0.3) | 15.0 ± 2.3 | 5 22 6 19 14 16 21 17 | 0.63 | 0.326 | 28.4% | 39.8 | 31% | 9.3 | 122 | 5.0% | 6.1 |
| HQ-acw0 HQ-ac + warm (no lift) | 13.1 ± 1.5 | = HQ-ac | 0.62 | 0.300 | 26.3% | 35.8 | 28% | 10.3 | 121 | 5.5% | 6.4 |

Over 8 seeds a difference under about 4 is noise (about 3 under fixes 1-3). Unanswered rate is 7.2-8.9% and auto-pauses are 0.5-1.5 per 100 member-months in every arm; there are no STOPs. Column definitions:

- **Wasted invites:** initial invites sent to a member for an opportunity that then died on the other member's no or silence. In R and in sequential probes, almost all of these went to members who had said yes (the first member). In parallel flows, about half went to members who never got to answer.
- **Learned who, then no:** the share of reveal recipients whose decision on the named plan was no, whether or not they said so.
- **Opt-out back-outs:** explicit "can't make it" replies to a booked-plan reveal.

Why (b)/(c) works: N3's reveal asks a third question ("Want me to set it up?") and waits up to 48 hours for both answers. Anyone who ignores it, or whose reveal is held back by the Blooio logistics limit, ends the opportunity. With the booked plan, only an explicit no ends it.

Caveats:

- The persona's decision on the reveal is primed by its own probe yes (`evaluatePrimed`, basis "probe"), which is why only 3-6% back out. Real people may back out more once they see a name. That would cost both designs equally, apart from the silent no-shows the opt-out design accepts.
- A member who ignores the booked plan and would have said no simply does not come (the persona's decision is kept), so that no-show is already in the numbers.
- The warm-mention lift of 0.3 is an assumption. The simulator has no persona model for "a friend of Sam".

## Recommendation

1. **Ship (c): pre-commit plus the reveal as a booked plan with an easy opt-out** (`consent.reveal: "opt_out"`, now the default). The probe asks for a time ("Thursday 7pm or Saturday 10am?"), the partner chooses among the first member's picks, and both get "You're both in: meet Sam, Thu 7pm near X. Reply if you can't make it." It keeps D5 (no name before both yeses), discloses nothing extra, needs one fewer required answer, and is the only change here that moves meetings by more than noise: +3.4 without fixes, +7.7 with.
2. **Keep probes sequential** (member with the want first). Parallel probes add no meetings and spend about 60% more initial invites on opportunities that die.
3. **Warm mentions: allowed within D5 under the rules above, off until the consent setting exists.** Expected effect is small because about 3.5% of probes qualify.
4. **Even so, probe-first stays below today's named dispatch without the fidelity fixes** (10.8 vs 23.1). The remaining gap is the partner step: about 3 in 4 first yeses never get the partner's yes. Further work should target that step (better partner choice for the second probe, backfill with the next-best partner after a no) rather than message count.

## Integration asks for the network session (additions)

1. **Reveal = booked plan.**
   - When both said yes, send each member one message: names (first name and initial), the time both picked (or the best joint slot from `chooseTimeOptions` if none fit), the area, the shareable why, and "Reply if you can't make it."
   - It is logistics: it does not count against the cap and needs `outboundSinceInbound <= 2`.
   - Silence for 48 hours means confirmed. A "can't" cancels the plan, and the other member gets "that plan fell through on their side" without the reason.
   - Remove the separate "You're all set" scheduling message.
2. **Probe answers carry the time** (decision 4a). Parse "Thursday", "the first", "either" and "neither". The partner's probe offers only the slots the first member picked.
3. **Warm mentions** (later): a member setting "OK to mention me as a mutual friend", also used as consent for having one's connection mentioned. Then `warmMention(...)` before `buildProbe(spec.mutual)`.
4. Keep probes sequential (`consent.parallel: false`).

## Files (iteration 4)

- `packages/engine/src/attention.ts` (parallel flows, `warmMention`, `buildProbe` mutual), `packages/engine/src/config.ts` (`consent`, `attention-v1.2.0`).
- Deleted since: `packages/engine/experiments/attentionNetwork.ts`, `packages/engine/experiments/attention.ts`, `packages/engine/test/attention.test.ts`, `packages/engine/test/attention-sim.test.ts`. Validated by `bun run sim`.
- `docs/design/2026-10-07-experience-design.md` (1.8: booked-plan reveal, parallel probes, warm mentions).
- Not touched: `packages/network`, `packages/observatory`, `packages/sim`.
