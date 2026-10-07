# Attention budget, digests, hold queue and consent-first probes: Phase 1, measured (2026-10-07)

Spec: [docs/design/2026-10-07-experience-design.md](../design/2026-10-07-experience-design.md), section 1 and Phase 1 of section 8, with the founder defaults D1-D18 ("the doc"). Builds on [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md) ("v1.2"). **No LLM calls, $0.** Tests run with keys unset and without `LIVE_TESTS`.

## Result in one paragraph

Everything in Phase 1 is built as specified, unit-tested, and holds every invariant in the simulator: 0 minor contacts, 0 canary leaks, 0 quiet-hour sends, **0 over-cap sends** (v1.2 today: 63 over 8 seeds) and **0 interruptions sent past the Blooio reservation** (v1.2: 365 interruptions sent with two or more outbound messages unanswered, 21 outbound messages past Blooio's third unanswered). Auto-pauses fall from 3.6 to 0.3 per 100 member-months. **But with the founder defaults it delivers far less value in a 30-day simulation:** met + worthwhile 10.3 per seed against 25.5 (-15.3, about 11 standard errors), at 0.44 interruptions per member-week against 0.70, and value per interruption falls too (0.040 vs 0.062 met + worthwhile per interruption). The doc's Phase 1 success bar (met + worthwhile >= 19.6 at <= 0.6 interruptions per member-week) is **not met**; the best variant that keeps every invariant (D2: partner probes may use any remaining cap, no shadow price) reaches 16.1 at 0.58. Consent-first probes (C) cost a further 6 per seed in this simulator, mostly from a simulator asymmetry (approximation 5). What costs value, in order: the shadow price refusing single-item messages (+3.3 when removed, B2), the partner probe waiting for the partner's digest or a scarce break-in (+2.1 when it may use any remaining cap, D1), and the weekly cadence itself. Menus add little here (+0.7, B vs B1, inside noise) because the engine produces only member items, so a digest holds at most 2. **Recommendation:** adopt the send-time invariants now (cap counted in interruptions at send time, the Blooio streak, hold queue revalidation, the probe leak gate); do not replace today's dispatch with weekly digests until the founder revisits λ (D1 send rule) and partner-probe timing (D4), and the simulator gets outside-world items and a probe model with ask priming.

## What was built

| Design (doc section, decision) | Code |
|---|---|
| 1.1 unit of account: interruptions, not opportunities (D1) | `AttentionLedgerEntry.countsAgainstCap`; `attention.ts interruptionsUsed` counts unique message ids in a rolling 7 / 30-day window |
| 1.2 data model | `types.ts`: `ItemKind`, `Effort`, `AttentionItem`, `HeldItem`, `CadencePrefs`, `Responsiveness`, `AttentionLedgerEntry` (additive). `attention.ts`: `MemberAttention`, `Conversation` |
| 1.3 item value V = Ê x sqrt(P̂acc) x w_kind x w_m x u (D13) | `itemValue`, `kindWeight` (profiling capped by EVI), `itemAcceptance` (cold pair: product of both members' P̂acc, i.e. sqrt(P(mutual accept)); partner probe: the partner's own), `knotCalibrator` / `DEFAULT_ENJOY_KNOTS` (Ê, see below). `EngineProposal.acceptance` (new, additive, `engine.ts`) carries P̂acc per participant from `world.ts acceptanceOf` |
| 1.3 cost A(M), shadow price λ, annoyance r | `attentionCost`, `shadowPrice` (newcomers 0.20, minors 0.25), `annoyance` (x1.25 unanswered, x1.5 "less"/STOP, x0.8 "more", 30-day half-life), `messageUtility` |
| 1.3 send rule | `composeMessage`: gates (paused, two-unanswered, Blooio streak, quiet hours, cap, break-in limit), packing (best V first, <= 3 items, <= 2 member-involving, never two items about one person, an item joins only if V_i > λ e_i (1 - Ê_i)), θ_bar, U(M) > 0 |
| 1.4 digest slots (D2), break-ins (D4) | `nextDigestSlot`, `lastDigestSlot`, `digestDue`, `digestJitter` (2-hour spread); `composeMessage(mode: "break_in")` (expires before the next slot, V >= 1.5 x median digest V); `breakInLimit` (Normal 1/7d, Open 2/7d, Quiet 0, minors 0, newcomers 1) |
| 1.5 silence below the bar | `qualityBar` per state; nothing is sent below it (no filler) |
| 1.6 hold queue | `addToHold` (10 per member, evict lowest V, partner probes last; same opportunity replaced only if V is higher by 0.10; "seen and passed" keys refused for 30 days), `revalidateHold` (expiry first, then the existing send-time check `filters.ts eligibilityFor` for the member and every other member, then runtime checks), `holdExpiry` (intro 14 d, events start - 24 h, partner probe 2 d) |
| 1.7 per-state defaults | `config.ts DEFAULT_ATTENTION` (+ `resolveAttention`, `attentionConfigHash`). Separate from `EngineConfig`: `runEngine` output and config hash are unchanged |
| 1.8 consent-first probes (D5) | `firstToProbe`, `itemsForProposal` / `partnerItem`, `ProbeFlow` (`startProbeFlow`, `toProbe`, `recordProbeAnswer`, `canReveal`, `revealFor`), `buildProbe` (activity, time, area, at most one shareable interest/skill/goal; never a name, employer-like fact, matchable or agent_private text; every candidate text passes `judgeCommon.ts checkMemberFacing` with `explain.ts privateVocabulary` of the other people, plus a name-token check; falls back to a generic activity, then returns null), `digestText` |
| 1.9 Blooio coupling, re-engagement (D6) | `Conversation.outboundSinceInbound`, `canInterrupt` (<= 1), `canSendLogistics` (<= 2), `unansweredInterruptions`, `reengagement` (auto-paused only, >= 30 days silent, once per silence, item above the member's 75th percentile, `REENGAGE_SUFFIX` "Want me to keep sending these?") |
| D9 members aged 13-17 | `capFor` (1/7d), `breakInLimit` (0), `maxItemsFor` (2), `itemGate` (events, places and solo plans only), `inMemberQuietHours` (20:00-08:00 on school nights, Sun-Thu evenings), `buildProbe` returns null |
| D10 romance alone | `composeMessage` compares the best romance-only message with the best romance-free digest; `romanceInDigest` opt-in |
| D11 learning never increases frequency | `applyLearnedCadence` (every frequency field is the quieter of explicit and learned), `annoyance` (learned positives only undo annoyance, floor 1), `capFor` clamps explicit overrides to the state cap |
| D1 engine supply | `config.ts engineSupplyBudgets`: with the attention layer on, the engine's per-member proposal budget becomes cap x items per message (Normal 6/7d); the cap itself is enforced at send time |
| 1.10 / 3.3 metrics | `attentionMetrics` (interruptions per member-week, unanswered rate, auto-pause per 100 member-months, STOP per 1,000 interruptions, items per interruption, value events per interruption, time to value, V14), `v14` |
| Audit P2-12 / P2-13 (outreach.ts) | `BUDGETS` now read the attention caps (one set of numbers); an over-budget deferral counts messages already deferred into the target window |

Tests: `test/attention.test.ts` (35 tests: cost function, cap math, packing, romance and minors rules, Blooio and two-unanswered gates, quiet hours and school nights, digest slots, hold capacity / hysteresis / dismissal / expiry / revalidation, item construction, probe order and reveal, probe leak gate including a random-world property test, D6, D11 including a 300-case property test, V14 and the ledger metrics), `test/attention-sim.test.ts` (end-to-end: a 14-day simulator run in both modes with 0 minor contacts, 0 canary leaks, 0 quiet-hour sends, 0 over-cap, every interruption sent with <= 1 outbound outstanding, logistics <= 2, <= 3 items per message, romance alone, no partner name in any probe), `test/outreach.test.ts` (P2-12, P2-13).

## How it was measured

`packages/engine/experiments/attention.ts` (harness) drives the simulator (150 personas, 30 days, seeds 1-8, engine-v1.2.0 defaults, v1.2 snapshot, the Network's records fed back) with `experiments/attentionNetwork.ts`, a subclass of the sim's `StubNetwork`:

- **A** is today's behaviour: the sim's own `StubNetwork`, one item per interruption, each engine proposal dispatched the next morning, the partner asked as soon as the first member says yes. **A'** is the subclass in `v12` mode; it reproduces A exactly on every seed (the check that the harness network does not change the baseline).
- **B** is the attention budget + digest + hold queue with the founder defaults: every engine proposal becomes an item in the first member's hold queue; weekly digest Thursday 18:00 local; break-ins under D4; the shadow price and quality bar; the Blooio streak (interruptions only with <= 1 outbound outstanding, logistics <= 2); the partner's item goes into the partner's hold queue after the first yes (2-day deadline: next digest if it lands in time, else a break-in, else it lapses). Items are named, as in A, so B isolates the attention layer.
- **C** is B plus consent-first probes (full Phase 1): anonymous probe text from `buildProbe`, the partner probed only after the first yes, then a reveal message (logistics, not an interruption) that each side confirms.
- **B1-B5, D1-D3, E1** change one thing each (see the table).

What the Network reports to the engine (`AttentionNetwork.engineView`, the integration ask below): items never shown are unsent (not billed, `unsentProposalIds`); held pairs are reported as a pending interaction so the engine proposes the next-best partner instead of the same pair every night; shown items are billed like a sent invite; a shown item the member passed on is "cancelled" (no decline cooldown, D: "none is not a decline of any person"); probe "no" answers are declines; live probe flows are open opportunities. The engine runs with `engineSupplyBudgets()` in the attention arms (B5 shows the unchanged budget).

**Approximations (harness only, documented here because they shape the numbers):**

1. *Menus.* The persona agents cannot read a menu. When a digest carries several items, the harness asks the oracle, offline, which item the member would value most (highest oracle acceptance probability for that member) and attaches that item to the message; the persona agent then decides on it exactly as on a single invitation (accept, decline, or ignore). One pick per digest ("1 and 3" is not modelled), so menus are credited conservatively. B3 replaces the oracle pick with "take the top-V item" (no oracle): the gap between B and B3 is the value of the member's own choice.
2. *Review.* The simulator has no reviewer (the stub has none either); member-involving items are approved on arrival.
3. *Ê calibration.* Ê is an isotonic fit of persona "worth a text?" judgments on the engine score from v1.2 runs on seeds 101-104, disjoint from the evaluation seeds (`attention.ts --fit`; pooled base rate 58.7%, 1,650 labels; per-category knots where n >= 100). It is shipped as `DEFAULT_ENJOY_KNOTS` / `DEFAULT_ENJOY_BY_CATEGORY` and should be refit on production labels (5.3).
4. *Only member items exist in the simulator.* The engine produces no outside-world items (events, places), no profiling questions and no plans, so every item involves another member and the "at most 2 member items" rule caps a digest at 2 items. The third slot the doc reserves for low-effort items is never exercised. Members aged 13-17 never get any item in the simulator (they get no proposals), so D9 is covered by unit tests only.
5. *The sim's probe model.* A persona answers a probe (`oracle.probe`) with the plain acceptance model, but answers a named proposal with "ask priming" (`evaluatePrimed`: about 0.96 acceptance when the persona recently asked for this kind of thing and the match meets that want). So, in this simulator, a member who asked for something says yes to a named invitation far more often than to an anonymous probe for the same thing. That is a simulator asymmetry, not a property of probes, and it is the main reason C is below B (ask below).
6. *Logistics copy.* The stub's own acknowledgements ("Thanks, noted.", "No problem at all...") are kept. Each is an outbound message on Blooio's per-conversation streak; E1 measures the variant that does not send them as separate messages.
7. *Quiet hours.* The stub only texts 09:00-20:00 local; the attention arms use the union of that window and the member's quiet hours, so both arms are held to the same window.
8. *V14 in a 30-day run.* Tenure >= 14 days means V14 is averaged over days 14-30 only, and members joined in days 0-7. It is reported because the doc asks for it; the 85% sim target assumes a steady-state network.
9. *Interruptions in A* are every proactive message (invitations to either side). In B/C they are digests, break-ins and re-engagements; partner probes are interruptions for the partner in both arms.

## Results (8 seeds, `bun packages/engine/experiments/attention.ts`)

### Value and interruptions (mean over seeds; met + worthwhile ± standard error)

| variant | met + worthwhile /seed | per seed | interruptions /member/wk | items /interruption | met+worthwhile /interruption | value events /interruption | V14 | time to value (median days) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A v1.2 defaults (stub network: one item per interruption) | 25.5 ± 1.2 | 27 30 23 28 20 28 26 22 | 0.70 | 1.00 | 0.062 | 0.185 | 24.8% | 11.5 |
| A' v1.2 via the harness network (must equal A) | 25.5 ± 1.2 (+0.0) | 27 30 23 28 20 28 26 22 | 0.70 | 1.00 | 0.062 | 0.185 | 24.8% | 11.5 |
| B attention budget + digest + hold queue (founder defaults) | 10.3 ± 0.6 (-15.3) | 10 12 12 9 10 11 7 11 | 0.44 | 1.44 | 0.040 | 0.121 | 10.0% | 11.0 |
| C B + consent-first probes (full Phase 1) | 4.3 ± 0.9 (-21.3) | 1 6 4 7 4 8 2 2 | 0.42 | 1.48 | 0.017 | 0.057 | 5.1% | 9.3 |
| B1 B, one item per message (no menu) | 9.6 ± 1.5 (-15.9) | 5 15 6 6 16 7 12 10 | 0.44 | 1.00 | 0.037 | 0.116 | 10.8% | 12.2 |
| B2 B, cap only (no price, no quality bar) | 13.6 ± 1.1 (-11.9) | 14 18 12 16 15 9 15 10 | 0.58 | 1.26 | 0.040 | 0.133 | 14.2% | 10.7 |
| B3 B, member takes the top-V item (no oracle choice) | 9.9 ± 1.3 (-15.6) | 9 17 7 11 8 13 7 7 | 0.42 | 1.46 | 0.039 | 0.128 | 10.0% | 10.2 |
| B4 B, partner probes wait up to 7 days (next digest) | 11.9 ± 1.7 (-13.6) | 3 18 8 16 10 12 16 12 | 0.41 | 1.39 | 0.049 | 0.152 | 12.7% | 13.8 |
| B5 B, engine supply budget unchanged (2 proposals /7d) | 12.9 ± 1.4 (-12.6) | 10 14 11 21 10 12 9 16 | 0.40 | 1.37 | 0.055 | 0.153 | 11.5% | 12.4 |
| D1 B, partner probes may use any remaining cap | 12.4 ± 1.0 (-13.1) | 15 16 8 14 12 13 9 12 | 0.45 | 1.44 | 0.047 | 0.143 | 12.9% | 9.7 |
| D2 D1, cap only (no price, no quality bar) | 16.1 ± 1.5 (-9.4) | 15 23 10 17 16 12 20 16 | 0.58 | 1.25 | 0.047 | 0.145 | 16.0% | 9.7 |
| D3 C, partner probes any remaining cap, cap only | 10.0 ± 0.9 (-15.5) | 8 12 7 10 6 13 12 12 | 0.55 | 1.23 | 0.031 | 0.081 | 7.8% | 9.5 |
| E1 D1, no separate acknowledgement messages | 13.0 ± 1.0 (-12.5) | 13 18 11 12 9 12 16 13 | 0.46 | 1.42 | 0.048 | 0.143 | 12.4% | 10.7 |

### Annoyance

| variant | unanswered rate (72h) | auto-pause /100 member-months | STOP total (per 1,000 interruptions) | persona worthwhile |
| --- | --- | --- | --- | --- |
| A v1.2 defaults (stub network: one item per interruption) | 8.1% | 3.6 | 0 (0.0) | 59.2% |
| A' v1.2 via the harness network (must equal A) | 8.1% | 3.6 | 0 (0.0) | 59.2% |
| B attention budget + digest + hold queue (founder defaults) | 8.7% | 0.3 | 0 (0.0) | 60.2% |
| C B + consent-first probes (full Phase 1) | 8.7% | 0.1 | 0 (0.0) | 40.5% |
| B1 B, one item per message (no menu) | 8.8% | 0.3 | 0 (0.0) | 54.2% |
| B2 B, cap only (no price, no quality bar) | 7.9% | 0.4 | 0 (0.0) | 57.3% |
| B3 B, member takes the top-V item (no oracle choice) | 8.1% | 0.3 | 0 (0.0) | 57.3% |
| B4 B, partner probes wait up to 7 days (next digest) | 9.2% | 0.5 | 0 (0.0) | 59.3% |
| B5 B, engine supply budget unchanged (2 proposals /7d) | 8.5% | 0.3 | 0 (0.0) | 62.9% |
| D1 B, partner probes may use any remaining cap | 8.1% | 0.2 | 0 (0.0) | 60.5% |
| D2 D1, cap only (no price, no quality bar) | 8.6% | 0.6 | 0 (0.0) | 57.5% |
| D3 C, partner probes any remaining cap, cap only | 8.1% | 0.5 | 0 (0.0) | 39.1% |
| E1 D1, no separate acknowledgement messages | 8.4% | 0.9 | 0 (0.0) | 61.6% |

### Match quality and spread (engine proposals / items actually delivered)

| variant | engine proposals /seed | precision (all proposals) | proposals delivered /seed | precision (delivered) | no proposal: all / delivered | Gini: all / delivered |
| --- | --- | --- | --- | --- | --- | --- |
| A v1.2 defaults (stub network: one item per interruption) | 349 | 39.2% | 271 | 39.7% | 2.9% / 11.1% | 0.346 / 0.379 |
| A' v1.2 via the harness network (must equal A) | 349 | 39.2% | 271 | 39.7% | 2.9% / 11.1% | 0.346 / 0.379 |
| B attention budget + digest + hold queue (founder defaults) | 660 | 35.7% | 301 | 36.4% | 2.0% / 20.4% | 0.395 / 0.467 |
| C B + consent-first probes (full Phase 1) | 693 | 35.8% | 302 | 35.6% | 1.4% / 21.1% | 0.396 / 0.469 |
| B1 B, one item per message (no menu) | 786 | 34.6% | 193 | 34.6% | 0.9% / 18.6% | 0.400 / 0.399 |
| B2 B, cap only (no price, no quality bar) | 600 | 36.5% | 333 | 36.9% | 1.1% / 16.1% | 0.385 / 0.439 |
| B3 B, member takes the top-V item (no oracle choice) | 671 | 35.2% | 296 | 37.2% | 1.8% / 20.1% | 0.397 / 0.464 |
| B4 B, partner probes wait up to 7 days (next digest) | 572 | 36.1% | 259 | 36.3% | 1.8% / 21.1% | 0.375 / 0.458 |
| B5 B, engine supply budget unchanged (2 proposals /7d) | 522 | 37.2% | 255 | 37.1% | 2.7% / 24.6% | 0.393 / 0.486 |
| D1 B, partner probes may use any remaining cap | 670 | 35.7% | 299 | 36.4% | 1.7% / 18.6% | 0.398 / 0.458 |
| D2 D1, cap only (no price, no quality bar) | 591 | 36.3% | 322 | 36.5% | 1.8% / 14.5% | 0.390 / 0.439 |
| D3 C, partner probes any remaining cap, cap only | 559 | 36.6% | 310 | 36.9% | 1.6% / 15.4% | 0.383 / 0.448 |
| E1 D1, no separate acknowledgement messages | 677 | 35.6% | 302 | 36.7% | 1.4% / 18.5% | 0.402 / 0.462 |

### Invariants (summed over seeds)

| variant | minor contacts | canary leaks | over state cap | quiet-hour sends | interruptions with >= 2 outstanding | outbound with >= 3 outstanding (Blooio 4th) | judge invariants |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A v1.2 defaults (stub network: one item per interruption) | 0 | 0 | 63 | 0 | 365 | 21 | 0 {} |
| A' v1.2 via the harness network (must equal A) | 0 | 0 | 63 | 0 | 365 | 21 | 0 {} |
| B attention budget + digest + hold queue (founder defaults) | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |
| C B + consent-first probes (full Phase 1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |
| B1 B, one item per message (no menu) | 0 | 0 | 0 | 0 | 0 | 0 | 1 {"duplicate_send":1} |
| B2 B, cap only (no price, no quality bar) | 0 | 0 | 0 | 0 | 2 | 0 | 0 {} |
| B3 B, member takes the top-V item (no oracle choice) | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |
| B4 B, partner probes wait up to 7 days (next digest) | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |
| B5 B, engine supply budget unchanged (2 proposals /7d) | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |
| D1 B, partner probes may use any remaining cap | 0 | 0 | 0 | 0 | 0 | 0 | 2 {"duplicate_send":2} |
| D2 D1, cap only (no price, no quality bar) | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |
| D3 C, partner probes any remaining cap, cap only | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |
| E1 D1, no separate acknowledgement messages | 0 | 0 | 0 | 0 | 0 | 0 | 0 {} |


Notes on the table:

- **Significance** (as in v1.2): over 8 seeds a met + worthwhile difference under about 4 per seed, or a precision difference under about 2.5 points, is noise. Every attention variant is significantly below A on met + worthwhile; among attention variants only B2 / D2 (no price) and D1 (partner probes on any remaining cap) are clearly above B.
- **Interruptions** stay far below the cap (0.44 per member-week against 2). The binding constraints are, per slot: the price rule (a single average item, V about 0.25, does not pay for its own interruption at λ = 0.25: λ A = 0.25 x 1.18 = 0.30), members already committed (waiting on a partner, a meeting ahead), and the conversation streak. The streak binds more than the doc expected because each content-free acknowledgement ("Thanks, noted.") is an outbound message on the same counter: after one, a single unanswered digest pauses the member until they write in. Not sending them as separate messages (E1) moved met + worthwhile by +0.6 only, so it is a cheap fix but not the main one.
- **Partner probes.** After the first member's yes, the partner's probe lands just after the partner's own Thursday digest (same city, same slot), so it needs a break-in (1 per 7 days, V >= 1.5 x median) or waits a week. About 40% of partner probes lapsed at a 2-day deadline (B); a 7-day deadline (B4) keeps them but adds a week of latency (time to value 13.8 days); letting them use any remaining cap (D1) is better than both.
- **Engine supply (B5).** Billing the engine for shown items and letting it supply cap x 3 items is not better than leaving its budget at 2 proposals per 7 days (B5 12.9 vs B 10.3, inside noise); precision of delivered items is 36-37% either way against 39.7% today. More supply mostly adds lower-scored partners for the same members.
- **Member choice (B3).** Taking the top-V item instead of the oracle's pick changes nothing measurable (9.9 vs 10.3): V already orders items about as well as the member would in this simulator.
- **Spread.** The share of adults with no item delivered rises from 11.1% to about 20%, and the delivered Gini from 0.38 to 0.47: fewer, weekly decision points reach fewer people in 30 days.
- **V14** (3.3) is 24.8% today and 10.0% for B; both are far from the 85% target in a 30-day run with no outside-world items (approximation 8). Time to value is about the same (11.0 vs 11.5 days) because the first digest arrives on day 3.
- **STOP** is 0 everywhere: the persona STOP rule (more than 3 + 4 x capacity proactive messages a week) never triggers at these volumes, so the simulator cannot show the attention layer's main benefit (fewer opt-outs). Unanswered rate is 8-9% in every arm.
- The 2 "interruptions with >= 2 outstanding" in B2 are an ablation-only artefact (`capOnly` changes the price and bar, not the streak gate; they come from same-timestamp ordering of a member's reply and a send in the record-based count). The founder-default arms have 0. The 1-2 `duplicate_send` are the stub's repeated acknowledgement (v1.2 P5), not this layer.

## Defaults

The founder defaults D1-D18 are in `config.ts DEFAULT_ATTENTION` unchanged: caps Open 4/7d, Normal 2/7d, Quiet 1/30d, Receiving 2/7d (support only), Paused 0; up to 3 items per message (Quiet and Receiving 2, minors 2), at most 2 member-involving; weekly digest Thursday 18:00 local (Open Tue + Thu, Quiet the first Thursday of the month); break-ins Normal 1/7d, Open 2/7d, Quiet 0; λ_state 0.15 / 0.25 / 0.50 / 0.25 / ∞; θ_bar 0.22 / 0.30 / 0.42; Quiet and only-when-great items need Ê >= 0.6; probes reveal activity, time, area and at most one shareable fact; one re-engagement at >= 30 days; members 13-17: 1/7d, events, places and solo plans, quiet 20:00-08:00 on school nights; romance alone; learning never raises frequency; V ordered by Ê x sqrt(P̂acc).

Choices the doc left open, made here: partner probe deadline 2 days (`expiry.partnerProbeDays`; B4 measures 7 days); hold expiry 14 days for intros and groups; a "seen and passed" item is not offered again for 30 days; break-in reference median 0.25 before a member has any digest history; w_kind for re-confirmations 0.5, "worth a text?" 0.3, "nothing yet" 0.2; Ê calibrated as above. The engine default `acceptance.exponent` stays 0 (D13 is applied at send time, in V; the engine-side ordering was measured as no win in v1.2, S4).

## Integration note for the network / dispatcher owner (packages/network, Blooio queue)

The engine side is pure functions in `packages/engine/src/attention.ts` (exported as `attention` from `@thenetwork/engine`) with config in `DEFAULT_ATTENTION`. `experiments/attentionNetwork.ts` is a working reference of the whole send path on top of the stub network (about 400 lines). What the Network runtime needs to adopt:

1. **Send path.** Engine proposal -> `itemsForProposal(p, { now, reviewState })` -> `addToHold(queue, item, prefs, now, { dismissed })` per member. Every tick: `digestDue(member, now, lastServedSlot)` (serve a slot missed for a transient reason later in the week), or, for items that expire before `nextDigestSlot`, a break-in. Before a send: `revalidateHold(queue, now, eligibilityFor(world, optedOut), extra)` (extra = partner already committed, listing gone), `buildProbe(world, spec, member, others, now)` for each candidate (drop null), `composeMessage({ member, items, ledger, conversation, now, mode })`, send `digestText(lines)`, push one `AttentionLedgerEntry` per message (`countsAgainstCap: true`). On a reply: set `repliedAt` / `replyKind` on the open entries, resolve the pick or "none", `recordProbeAnswer`; on the first yes create `partnerItem` into the partner's hold queue; after `canReveal`, send `revealFor` names as logistics.
2. **One streak counter, shared with the Blooio queue** (1.9): `Conversation.outboundSinceInbound` counts every outbound message and resets on any inbound or tapback. Interruptions need `canInterrupt` (<= 1), logistics `canSendLogistics` (<= 2); a member who stops answering mid-plan is not messaged a fourth time. Do not send content-free acknowledgements as separate messages (E1).
3. **Numbers to align in `packages/network/src/outreach.ts`** with the founder defaults (or tell me if the network numbers are deliberate): unanswered after **72 h** (network: 48 h; the engine's outreach and the doc use 72 h); re-engagement once at **>= 30 days** and only for a high-value held item (D6; network: 14 days); Receiving **2/7d support-only** (doc 1.7; network: 0). Both use rolling windows; the engine's `outreach.ts BUDGETS` now read the same caps (P2-13).
4. **What to report to the engine** (extends v1.2's P1/P2): items never shown -> `unsentProposalIds` (not billed); held items -> block their pair without billing (the harness reports a pending interaction; a first-class `EngineInput.heldProposalIds` would be cleaner, and needs a small additive change in `world.ts`, which I did not make); shown items are billed; a shown item the member passed on -> outcome `cancelled` (no decline cooldown); probe "no" -> `declinedBy`; live probe flows -> `openOpportunities`. With the attention layer on, pass `engineSupplyBudgets()` as engine config overrides (B5 says the default budget also works).
5. **P̂acc**: read `EngineProposal.acceptance` (new, additive) instead of estimating it in the network.
6. **Review gate**: member-involving items start `reviewState: "pending"` and `composeMessage` refuses them until "approved"; the reviewer queue must flip it (the simulator auto-approves).
7. **Measured choices for the founder before this becomes the default send path:** λ_state (B2/D2: the price costs 3-4 meetings per seed), partner-probe timing (D1: let a partner probe use any remaining cap rather than only the D4 break-in), and digest cadence.

**For the simulator owner (packages/sim):** (a) `oracle.probe` should apply the same ask priming as `evaluatePrimed`, otherwise every consent-first comparison is biased against probes (approximation 5); (b) persona agents that read a menu ("1 and 3", "none") would remove the harness chooser; (c) outside-world items (events, places) and profiling questions are needed to exercise the third digest slot and V14. **For the judge owner:** `attentionMetrics` and `v14` are pure and can back `packages/judge/src/metrics.ts`.

## Files

- New: `packages/engine/src/attention.ts`, `packages/engine/test/attention.test.ts`, `packages/engine/test/attention-sim.test.ts`, `packages/engine/experiments/attention.ts`, `packages/engine/experiments/attentionNetwork.ts`, this document.
- Changed (additive): `src/config.ts` (attention section: `AttentionConfig`, `DEFAULT_ATTENTION`, `resolveAttention`, `attentionConfigHash`, `engineSupplyBudgets`), `src/types.ts` (attention data model, `EngineProposal.acceptance`), `src/engine.ts` (fills `acceptance`), `src/index.ts` (exports), `src/outreach.ts` (caps from the attention config, P2-12 deferral), `test/outreach.test.ts`, `experiments/lib.ts` (`runSim({ network, onWorld })`, `acceptance` in traced proposals; `verify.ts` still byte-identical).
- Not touched: `opportunity.ts`, `filters.ts`, `judge*.ts`, `world.ts`, `packages/network`, `packages/sim`, `packages/observatory`, `packages/evals`.

---

# Iteration 2: a fair baseline, a design search, simulator fixes (2026-10-07)

## Result

**Against a fair baseline, no attention design wins on meetings; the best one ties and doubles value per interruption once outside-world items exist.**

- **The fair baseline (R)** is today's daily dispatch with every hard send-time rule: the cap counted in interruptions, at most 1 outbound outstanding for a new interruption, the Blooio limit (logistics at most 2 outstanding), quiet hours, hold revalidation and the probe leak gate. It keeps **23.1 met + worthwhile per seed** (A: 25.5; the -2.4 is inside noise) with **0 over-cap sends** (A: 63) and **0 messages past Blooio's 3rd unanswered** (A: 21). The rules are cheap: the bar is high.
- **Without the simulator fixes**, the best design that keeps every rule (I8: rolling daily slot, no shadow price, partner probes on any remaining cap, acknowledgements folded) reaches **21.3** (R - 1.8, inside noise) at the same interruption rate (0.70 vs 0.67 per member-week), with value per interruption 0.052 vs 0.058. It does not beat R.
- **With both simulator fixes** (ask-primed probes, outside-world event items), the best design (G-J4: I8 + unpicked items requeued + events only as companions of a people item) keeps meetings within noise of R (**21.1** vs 23.1) at the same interruption rate (0.69 vs 0.67) and **almost doubles value events per interruption (0.325 vs 0.171)** and V14 (**29.8% vs 21.1%**), with unanswered rate 7.3% (R 7.2%) and auto-pauses 1.0 vs 0.5 per 100 member-months. This is the one place menus earn their keep: a message carries a people item plus the events a member might act on, and today's one-item-per-message dispatch has no slot for them.
- **Consent-first probes** still cost 6-9 meetings per seed after the priming fix (J1 21.0 vs probes 15.5; I8 21.3 vs 12.5): three answers are needed instead of two (probe, partner probe, reveal), and each can be ignored.

## What was added

- `attentionNetwork.ts` options: `lambdaScale` (price; quality bar kept), `cadence` ("weekly", "twice", "rolling" = a daily 18:00 slot used only when the best held item clears the bar and the member has cap, everything else ready batched in; "immediate" = as items arrive), `suppressAcks` (content-free acknowledgements folded, i.e. not sent as their own message), `ackExempt` (sent but not counted on the Network's streak), `learnedCadence` (D11: digest hour learned from the member's own messages; weekly and at most 2 items for 14 days after an unanswered interruption; through `applyLearnedCadence`, so never more frequent), `requeueUnpicked` (items shown next to the one picked go back to the hold queue: picking one is not a pass on the others), `outsideWorld` + `eventsAlone` (event items; alone or only as companions), `passedAs` (a passed item now blocks its pair for about 28 days instead of being re-proposed nightly; no measurable effect, kept as the default).
- **A+rules (R)** is the same send path configured as today's dispatch: `cadence: "immediate"`, one item per message, no price and no bar, partner probes on any remaining cap, the engine's default budget, named invitations.
- **Fix 1, ask priming for probes (harness only, `primeProbes`)**: a persona that asked for this category in the last 7 days answers a specific probe through `oracle.evaluatePrimed(..., "ask")`, exactly as the persona agent answers a named proposal.
- **Fix 2, outside-world items (harness only)**: each day the network takes the snapshot's public listings (`publicEvents(snapshot, 6)`), starting 1-8 days ahead in the member's city, and offers each to members who stated a matching interest (engine-visible facets only): `event_suggestion`, effort glance, Ê 0.5, P̂acc prior, expiry start - 24 h, no review needed, allowed for members aged 13-17 (D9). Whether the member acts on it is decided offline (`eventActor`): P = `oracle.probe` without participants (spare capacity this week x fatigue x appetite for events x presence) x (1 if the tag is a hidden interest, else 0.2) x (1 - the member's ignore probability). An acted-on event is a value event (3.3: "Event or place: the member acted on it") for V14 and value per interruption; it is not a meeting.
- **Engine fix found by the minors check**: `revalidateHold` ran the send-time check, which refuses anyone under 18 (`underage`) for every item. That is right for people items and wrong for D9's outside-world items, so a member aged 13-17 never got an event. Items that involve no other member now pass `underage` (D9 limits stay in `itemGate`); unit test added, and `test/attention-sim.test.ts` now runs an iteration-2 configuration with 10% minors and checks that minors get only event messages, at most 2 items, at most 1 per 7 days and never on a school night after 20:00.

## Results (8 seeds, `bun packages/engine/experiments/attention.ts --only "<variant>"`)

Met + worthwhile per seed ± standard error; over 8 seeds a difference under about 4 is noise. "Value / int." = value events (attended a held meeting, or acted on an event) per interruption. All variants below except A have 0 minor contacts, 0 canary leaks, 0 over-cap sends, 0 quiet-hour sends and 0 messages past Blooio's 3rd unanswered, unless the last column says otherwise.

| Variant | Met + worthwhile | Interruptions /member-wk | Items /int. | Met+w /int. | Value /int. | V14 | Unanswered | Auto-pause /100 m-mo | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A today (no rules) | 25.5 ± 1.2 | 0.70 | 1.00 | 0.062 | 0.185 | 24.8% | 8.1% | 3.6 | 63 over-cap, 365 interruptions with >= 2 outstanding, 21 past Blooio's 3rd |
| **R A+rules (fair baseline)** | **23.1 ± 2.0** | 0.67 | 1.00 | 0.058 | 0.171 | 21.1% | 7.2% | 0.5 | |
| B Phase 1 founder defaults | 10.3 ± 0.6 | 0.44 | 1.44 | 0.040 | 0.121 | 10.0% | 8.7% | 0.3 | |
| *(a) price* I1 B, no price | 14.4 ± 1.7 | 0.56 | 1.27 | 0.043 | 0.133 | 13.9% | 7.8% | 0.5 | |
| I2 B, half price | 15.0 ± 0.8 | 0.53 | 1.31 | 0.049 | 0.139 | 14.4% | 8.0% | 0.3 | |
| *(b) partner* I3 I1 + partner probes on any remaining cap | 17.0 ± 1.8 | 0.57 | 1.26 | 0.050 | 0.162 | 17.5% | 8.2% | 0.4 | |
| I4 I2 + partner on any cap | 16.9 ± 1.2 | 0.53 | 1.30 | 0.054 | 0.157 | 15.7% | 7.9% | 0.3 | |
| *(c) cadence* I5 I3, twice weekly | 17.3 ± 2.1 | 0.62 | 1.20 | 0.046 | 0.148 | 16.9% | 7.7% | 0.7 | |
| I6 I3, rolling | 17.9 ± 1.6 | 0.65 | 1.15 | 0.047 | 0.152 | 17.2% | 7.9% | 0.5 | time to value 8.2 days |
| I7 I3, immediate (batched) | 17.4 ± 1.6 | 0.67 | 1.14 | 0.044 | 0.142 | 17.0% | 8.1% | 0.7 | |
| *(d) acks* **I8 I6, acknowledgements folded** | **21.3 ± 1.5** | 0.70 | 1.14 | 0.052 | 0.159 | 20.8% | 8.4% | 1.4 | best without the fixes |
| I9 I6, acknowledgements exempt from the streak | 22.0 ± 1.7 | 0.68 | 1.14 | 0.055 | 0.162 | 20.9% | 7.7% | 1.1 | **96 interruptions with >= 2 outstanding on Blooio's count**: breaks the reservation |
| *(e) learned* I10 I8, learned cadence (D11) | 19.1 ± 1.3 | 0.68 | 1.15 | 0.048 | 0.141 | 18.6% | 8.0% | 1.2 | |
| I11 I8, engine supply unchanged | 20.6 ± 1.6 | 0.63 | 1.07 | 0.055 | 0.162 | 20.1% | 7.6% | 0.6 | |
| J1 R + acknowledgements folded | 21.0 ± 1.8 | 0.69 | 1.00 | 0.052 | 0.162 | 20.8% | 7.7% | 1.3 | |
| J2 R + acknowledgements exempt | 23.9 ± 1.1 | 0.70 | 1.00 | 0.058 | 0.175 | 22.0% | 8.1% | 1.3 | **109 with >= 2 outstanding on Blooio's count** |
| J4 I8 + unpicked requeued | 18.5 ± 2.0 | 0.69 | 1.16 | 0.045 | 0.149 | 19.9% | 7.8% | 2.0 | |
| J5 immediate menus + folded + requeued | 16.5 ± 1.2 | 0.71 | 1.16 | 0.040 | 0.136 | 17.8% | 8.1% | 1.6 | |
| **Fix 1 only (ask-primed probes)** | | | | | | | | | |
| C Phase 1 with probes (no fix) | 4.3 ± 0.9 | 0.42 | 1.48 | 0.017 | 0.057 | 5.1% | 8.7% | 0.1 | |
| P-C C, priming fix | 8.3 ± 1.1 | 0.42 | 1.46 | 0.033 | 0.099 | 9.7% | 8.7% | 0.6 | |
| P-Rp A+rules with probes, priming fix | 14.5 ± 1.4 | 0.62 | 1.00 | 0.040 | 0.116 | 14.5% | 8.4% | 1.0 | |
| P-J1p J1 with probes, priming fix | 15.5 ± 0.9 | 0.66 | 1.00 | 0.040 | 0.118 | 15.0% | 8.2% | 1.2 | |
| P-I8p I8 with probes, priming fix | 12.5 ± 1.2 | 0.62 | 1.12 | 0.034 | 0.113 | 14.0% | 7.8% | 1.0 | |
| **Both fixes, events only alongside a people item** | | | | | | | | | event value events /seed in brackets |
| G-B B | 11.4 ± 1.4 | 0.47 | 1.96 | 0.041 | 0.284 | 22.0% | 8.3% | 0.5 | (46) |
| G-I8 I8 | 18.3 ± 0.7 | 0.69 | 1.70 | 0.045 | 0.304 | 29.7% | 7.8% | 1.0 | (66) |
| **G-J4 I8 + unpicked requeued** | **21.1 ± 1.8** | 0.69 | 1.73 | 0.052 | **0.325** | **29.8%** | 7.3% | 1.0 | (69) best with the fixes |
| G-I8p I8 with probes | 12.4 ± 1.1 | 0.63 | 1.66 | 0.033 | 0.271 | 25.1% | 7.6% | 0.9 | (59) |
| G-J4w G-J4, weekly Thursday digest (D2) | 16.8 ± 1.1 | 0.57 | 1.74 | 0.049 | 0.287 | 25.8% | 7.9% | 1.1 | (45); time to value 12.6 vs 9.8 days |
| G-J4λ G-J4 with the doc's shadow price | 17.3 ± 0.8 | 0.59 | 2.07 | 0.050 | 0.376 | 30.5% | 8.0% | 1.7 | (78) |
| G-J4b G-J4, partner probes on break-ins only (D4) | 18.3 ± 1.6 | 0.69 | 1.73 | 0.045 | 0.307 | 29.4% | 7.2% | 1.1 | (70) |
| **Both fixes, events allowed alone** | | | | | | | | | |
| F-R A+rules + event-only messages | 7.8 ± 1.2 | 0.88 | 1.00 | 0.015 | 0.238 | 24.3% | **36.8%** | **29.3** | (99) |
| F-B B | 10.3 ± 1.3 | 0.60 | 1.79 | 0.029 | 0.343 | 30.2% | 25.3% | 4.5 | (92) |
| F-I8 I8 | 13.0 ± 1.2 | 1.06 | 1.43 | 0.021 | 0.318 | 35.9% | 34.5% | 39.2 | (160) |
| F-J4 J4 | 9.6 ± 1.0 | 1.06 | 1.46 | 0.015 | 0.319 | 34.3% | 33.3% | 36.8 | (167) |

Precision of delivered items is 38-40% for R, I8, J1 and G-J4 (A: 39.7%); the share of adults with nothing delivered is 16% for R and G-J4 (A: 11%). The full tables (every variant, every column, including precision, Gini and per-seed values) are printed by `bun packages/engine/experiments/attention.ts --merge <json files>`; the JSON for this run is reproducible with `--json`. The 1-3 "interruptions with >= 2 outstanding" in R, I1, F-R and F-I8 are the record-ordering artefact noted in iteration 1 (a reply and a send with the same timestamp); the 1-3 `duplicate_send` are the stub's repeated acknowledgement.

## What the search says

1. **The rules are not what costs value; the Phase 1 send rule is.** R keeps 23.1 of A's 25.5 with every hard rule. Phase 1 with the founder defaults keeps 10.3. The difference is the design's own choices, which the search undoes one by one: the shadow price (+4.1, B → I1), partner probes waiting for a break-in (+2.6, I1 → I3), weekly cadence (+0.9, I3 → I6, inside noise; but +4.3 on the final combination, G-J4w → G-J4), and acknowledgements on the streak (+3.4, I6 → I8).
2. **Acknowledgements matter more than the doc expected.** Each "Thanks, noted." is an outbound message on Blooio's per-conversation streak, so after one, a single unanswered message pauses the member until they write in. Folding them (not sending a content-free message on its own) is worth about 3 meetings per seed and keeps every rule. Exempting them from the Network's counter is worth as much but sends 96-109 interruptions per run that Blooio would count with two outbound messages outstanding: it breaks the reservation the design relies on. **Fold, don't exempt.**
3. **Learned cadence (D11) does what D11 says: it only makes the Network quieter, and quieter costs meetings** (I10 19.1 vs I8 21.3, inside noise) without lowering unanswered rate or auto-pauses in this simulator (whose personas do not get annoyed below 3 + 4 x capacity texts a week, so nothing STOPs in any arm). It needs a real annoyance signal to pay off.
4. **Menus pay only when there is something cheap to put next to a people item.** With only people items, every menu variant is at or below one-item-per-message (I7 17.4, J5 16.5 vs R 23.1): a member picks at most one, and requeueing the rest does not recover it. With outside-world items, the menu carries events at almost no attention cost (glance effort) and value per interruption nearly doubles (G-J4 0.325 vs R 0.171).
5. **Event-only messages are harmful under the two-unanswered rule.** Members rarely reply to "here's an event", so a message carrying only events counts as an unanswered interruption: unanswered rate rises to 25-37% and auto-pauses to 4-39 per 100 member-months, which then blocks people items (F-R 7.8, F-I8 13.0). **Events should ride along with a people item (or a member's pull), never alone**, or the reply rule needs a "no reply expected" class of message, which the doc does not have.
6. **The doc's price is a dial, not a bug.** On the final combination it trades 3.8 meetings per seed (17.3 vs 21.1) for 15% fewer interruptions (0.59 vs 0.69) and higher value per interruption (0.376 vs 0.325) with the same met + worthwhile per interruption (0.050 vs 0.052). With the simulator's personas never STOPping, the simulator cannot show what those saved interruptions are worth; it can only show their cost in meetings.
7. **Consent-first probes cost meetings even with ask priming** (about -6 to -9 per seed). Three answers instead of two, and the reveal arrives a step later. If D5 stays, it is a cost the founder is choosing for privacy, not one this simulator can make back.

## Recommended defaults (for the founder)

Every recommendation below keeps the hard rules (cap in interruptions, <= 1 outstanding before a new interruption, Blooio limit, quiet hours, revalidation, leak gate), which cost little (R vs A: -2.4, noise) and remove 63 over-cap sends and 21 Blooio breaches per 8 seeds.

| Decision | Founder default | Recommendation | Evidence (8 seeds, both fixes unless stated) |
|---|---|---|---|
| **D2** digest cadence | Weekly, Thursday 18:00 local | **Change: a rolling daily slot** (18:00 local, sent only when the best held item clears the bar and the member has cap; whatever else is ready is batched in). Members can still ask for a weekly digest. | G-J4 rolling 21.1 vs G-J4w weekly 16.8 met + worthwhile (+4.3, about 2 SE); value events per interruption 0.325 vs 0.287; V14 29.8% vs 25.8%; time to value 9.8 vs 12.6 days; unanswered and auto-pauses equal (7.3% / 1.0 vs 7.9% / 1.1). Interruptions rise from 0.57 to 0.69 per member-week, still well under the cap of 2 |
| **D4** break-ins | Expiring high-value items only: Normal 1/7d, Open 2/7d, Quiet 0 | **Change for partner probes only**: a partner probe (the first member already said yes) may use any remaining cap, within the state cap; keep D4 for everything else | G-J4 21.1 vs G-J4b 18.3 (+2.8); no-fixes I3 17.0 vs I1 14.4 (+2.6); unanswered 7.3% vs 7.2% |
| **D1 send rule** (1.3) | Cap + shadow price λ (0.15 / 0.25 / 0.50) + θ_bar | **Keep the cap and θ_bar; set λ_state to 0 at launch** and treat it as the dial to turn up once a real annoyance signal exists | G-J4 21.1 vs G-J4λ 17.3 (+3.8) at 0.69 vs 0.59 interruptions per member-week; same met + worthwhile per interruption (0.052 vs 0.050). D1's unit (interruptions) and caps stay |
| **D1 items per message** | Up to 3 | **Keep, with outside-world items only as companions of a people item (never alone)** | G-J4 (companions) 21.1, unanswered 7.3% vs F-J4 (alone) 9.6, unanswered 33.3%, auto-pause 36.8 per 100 member-months |
| Acknowledgements (1.9, not a D-decision) | Counted on the streak | **Fold them into the next message; do not send content-free acknowledgements alone; do not exempt them** | I8 21.3 vs I6 17.9 (+3.4, no fixes); exempt (I9, J2) breaks the Blooio reservation 96-109 times |
| **D6** re-engagement | Once, >= 30 days, high-value item | **Keep.** It never fires in a 30-day run (0 re-engagements in every arm), so the simulator has no evidence either way; unit-tested only | - |
| **D11** learned cadence | Never increases frequency | **Keep the rule; do not turn learned cadence on yet** | I10 19.1 vs I8 21.3 (inside noise), no annoyance benefit measurable here |
| **D5** probes | Reveal only after both say yes | **Founder call: it costs 6-9 meetings per seed** even with the priming fix | P-J1p 15.5 vs J1 21.0; G-I8p 12.4 vs G-I8 18.3 |
| D3, D9, D10, D13 | | Keep | D9 now exercised in the simulator (minors get events only, within 1/7d and school-night quiet hours) |

## Integration note, additions for the network / dispatcher owner

On top of the iteration-1 note:

1. **Ship the hard rules on today's dispatch now** (variant R): count the cap in interruptions at send time over rolling windows, require `canInterrupt` (<= 1 outbound outstanding) for every proactive message and `canSendLogistics` (<= 2) for logistics, revalidate before every send, gate every member-facing text. This is a small change to the existing send path and costs no measurable value.
2. **Do not send content-free acknowledgements as separate messages.** Fold "Thanks, noted." into the next real message, or drop it. Keep them on the streak counter (Blooio counts them).
3. **Outside-world items never travel alone** unless the member pulled them ("anything this weekend?"). `revalidateHold` now lets members aged 13-17 keep outside-world items.
4. If the founder adopts the recommendations: rolling daily slot (`CadencePrefs.digestDays = [0..6]`), `lambda` 0 for open / normal / receiving / quiet, partner probes allowed on any remaining cap, items shown beside a picked one returned to the hold queue.

**For the simulator owner:** both harness fixes should move into `packages/sim`: (1) `oracle.probe` with the same ask priming as `evaluatePrimed`; (2) outside-world suggestions with an acted-on model, and persona replies to them (a tapback or "thanks" would count as an answer). Without (2), any design that sends events alone is punished by the two-unanswered rule in a way real members may not cause.

## Files (iteration 2)

- `packages/engine/src/attention.ts`: `revalidateHold` lets items that involve no other member pass `underage` (D9).
- `packages/engine/test/attention.test.ts` (+ the D9 revalidation case), `packages/engine/test/attention-sim.test.ts` (+ the iteration-2 configuration with minors).
- `packages/engine/experiments/attentionNetwork.ts` (the options above), `packages/engine/experiments/attention.ts` (variants R, I1-I11, J1-J5, P-*, G-*, F-*; `primeProbes`, `eventActor`; `--merge`, `--no-baseline`).
- Not touched: `opportunity.ts`, `filters.ts`, `judge*.ts`, `world.ts`, `packages/network`, `packages/sim`, `packages/observatory`, `packages/evals`.
