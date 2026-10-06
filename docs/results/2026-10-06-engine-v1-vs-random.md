# Engine v1 vs random baseline (simulated world)

**Setup:** 150 synthetic SF/NYC personas, 30 simulated days, discrete-event time, deterministic persona policy (no LLM), seeds 1-3.
Command: `bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed <s> --network stub [--engine ./packages/sim/engines/engine-v1.ts]`

| Seed | Network | Precision vs oracle | Oracle-gap ratio | Worthwhile (persona-judged) | Proactive msgs/member/wk | Canary leaks |
|---|---|---|---|---|---|---|
| 1 | random stub | 8.2% | 8.0% | 20.1% | 0.64 | 0 |
| 1 | engine v1 | 32.0% | 29.9% | 49.8% | 0.49 | 0 |
| 2 | random stub | 6.8% | 7.5% | 18.6% | 0.67 | 0 |
| 2 | engine v1 | 34.7% | 36.6% | 54.3% | 0.52 | 0 |
| 3 | random stub | 6.0% | 6.1% | 16.8% | 0.65 | 0 |
| 3 | engine v1 | 32.0% | 31.0% | 50.5% | 0.50 | 0 |

Engine v1, seed 1, extra: pair recall 11.1% of 479 latent good pairs, member recall 55.4%, top-10% exposure share 21.5%, Gini 0.417, 13.5% of members got no proposal, 0 invariant violations, 0 style failures across 1,373 messages.

**Reading:** engine v1 is about 4-5x more precise than random intros and roughly doubles the persona-judged worthwhile rate with fewer messages. It is still well below the PRD 28.2 target (worthwhile >= 70%). The biggest gaps: low pair recall, generic text embeddings, no LLM judge in this run, hand-tuned weights.

**Caveats:** the oracle and personas encode our own assumptions (PRD 34, risk "sim-to-real gap"); treat these as relative comparisons between engine versions, not predictions of pilot outcomes.

**Next experiments:** enable the Cerebras judge on top-K; weight tuning sweep against the oracle; density sweep (40-75 seeds per city); LLM persona replies with a decision-vs-recorded agreement metric (hedged accepts like "Fine, but..." were misread by the stub parser).

## With minors policy (2026-10-05)

Same command and seeds, now with the default minor share: 5% honest members aged 13-17, which is 8 of the 150. They state their real age and get single-player value only. Under the minors policy (PRD 17.4 as amended), the engine and the stub never connect them to anyone. Minors take 8 persona slots, so each seed now has 8 fewer connectable adults; the adults themselves are unchanged.

| Seed | Network | Minors | Precision vs oracle | Oracle-gap ratio | Worthwhile (persona-judged) | Proactive msgs/member/wk | Canary leaks | `minorContacts` | Age-lying minor proposals* |
|---|---|---|---|---|---|---|---|---|---|
| 1 | random stub | 8 | 8.6% | 8.5% | 20.1% | 0.61 | 0 | 0 | 6 |
| 1 | engine v1 | 8 | 32.3% | 30.0% | 53.3% | 0.42 | 0 | 0 | 6 |
| 2 | random stub | 8 | 8.3% | 8.4% | 15.4% | 0.61 | 0 | 0 | 7 |
| 2 | engine v1 | 8 | 38.6% | 39.0% | 58.4% | 0.48 | 0 | 0 | 4 |
| 3 | random stub | 8 | 5.2% | 5.3% | 13.3% | 0.61 | 0 | 0 | 5 |
| 3 | engine v1 | 8 | 36.6% | 35.7% | 53.0% | 0.45 | 0 | 0 | 4 |

All six runs: 0 invariant violations (including `minor_contact`) and 0 style failures. Engine v1, seed 1: pair recall 11.8% of 433 latent pairs; 18.8% of connectable members got no proposal (minors are excluded from this denominator).

\* The adversarial "minor who claims to be 18-21" persona. Their claimed age is adult, so no matching policy can see them. Both networks propose them at similar rates, and the oracle flags these proposals as unsafe. Catching them is a job for age verification and safety review (PRD 17.4, 36), not the engine. They are reported as `safety.undisclosedMinorProposals`, separately from `minorContacts`.

**Reading:** the minors policy costs nothing measurable in matching quality. Engine v1 stays about 4-7x more precise than random, and the worthwhile rate is unchanged within seed noise. `minorContacts` is 0 for both the engine and the random baseline: no proposals, meetings, invitations or name mentions involving a declared minor. Minors still get onboarding and concierge replies. One bug surfaced and was fixed along the way: before the policy, warm-path intros could run *through* a minor as the friend-of-a-friend intermediary (`via`). That is now excluded; in the engine benchmark it removed 4 such candidates.

## Addendum (2026-10-06, later): engine v1.1.0 with intent liveness, complementarity and two label fixes

Same command and seeds, rerun on the working tree of 2026-10-06. Four changes are measured, each alone and together, in `2026-10-06-liveness-complementarity.md`:

1. Intent records anchored to `now`, with re-confirmation and lapse.
2. A structured needs-to-offers complementarity term in engine scoring (weight 0.5).
3. A dating desire now implies the romance opt-in.
4. The oracle checks presence over the proposal window.

The baseline first: it has none of the four changes but includes everything else that changed since the tables above (review fixes, minors policy, sim changes).

| Seed | Network | Precision vs oracle | Oracle-gap ratio | Worthwhile (persona-judged) | Pair recall | Proactive msgs/member/wk | `minorContacts` | Canary leaks |
|---|---|---|---|---|---|---|---|---|
| 1 | random stub (baseline) | 8.6% | 8.5% | 20.1% | 5.5% | 0.61 | 0 | 0 |
| 1 | engine v1 (baseline) | 26.2% | 24.7% | 43.3% | 10.4% | 0.43 | 0 | 0 |
| 1 | random stub (all fixes) | 9.9% | 9.6% | 20.9% | 6.3% | 0.59 | 0 | 0 |
| 1 | engine v1.1.0 (all fixes) | **40.5%** | 39.2% | **56.3%** | 15.3% | 0.44 | 0 | 0 |
| 2 | random stub (baseline) | 8.3% | 8.4% | 15.4% | 6.3% | 0.61 | 0 | 0 |
| 2 | engine v1 (baseline) | 33.7% | 38.6% | 55.9% | 19.8% | 0.54 | 0 | 0 |
| 2 | random stub (all fixes) | 8.6% | 8.0% | 16.6% | 5.5% | 0.62 | 0 | 0 |
| 2 | engine v1.1.0 (all fixes) | **41.9%** | 41.7% | **61.7%** | 18.9% | 0.52 | 0 | 0 |
| 3 | random stub (baseline) | 5.2% | 5.3% | 13.3% | 3.6% | 0.61 | 0 | 0 |
| 3 | engine v1 (baseline) | 30.4% | 30.2% | 45.9% | 12.6% | 0.48 | 0 | 0 |
| 3 | random stub (all fixes) | 4.6% | 4.5% | 13.8% | 3.1% | 0.62 | 0 | 0 |
| 3 | engine v1.1.0 (all fixes) | **34.4%** | 33.4% | **57.8%** | 13.5% | 0.47 | 0 | 0 |

Means over the three seeds, engine vs random:

| | Engine precision | Random precision | Engine / random | Engine worthwhile | Random worthwhile |
|---|---:|---:|---:|---:|---:|
| Baseline | 30.1% | 7.4% | 4.1x | 48.4% | 16.3% |
| All fixes | 38.9% | 7.7% | 5.1x | 58.6% | 17.1% |

- Engine pair recall goes from 14.3% to 15.9%.
- All 12 runs have 0 invariant violations.
- **Fairness cost:** the share of members with no proposal goes from 8.0% to 18.8%.

**Reading:**

- Almost all of the engine gain comes from the complementarity term (precision 30.1% to 38.0% on its own).
- The dating fix corrects labels and lifts both networks slightly.
- Liveness and the window presence check change nothing in a 30-day world: no intent ages past its horizon, and no proposal had a city mismatch.
- In 90-day runs, liveness is what keeps the engine proposing after day 60. Before the fix, 100% of adults had no live intent by day 90; after it, 1.6%.
- The worthwhile rate is still below the PRD 28.2 target of 70% or more.
