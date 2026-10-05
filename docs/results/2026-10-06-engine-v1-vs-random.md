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
