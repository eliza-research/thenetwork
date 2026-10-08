# StubNetwork baseline: the snapshot now carries the Network's history

Date: 2026-10-07. Hand-written by a Claude agent. The numbers come from a scratch script (not in the repository) and from the sim CLI. No LLM calls, $0.

## What changed

`packages/sim/src/world.ts` now passes the run's records to `buildSnapshot()` (`records: this.records`). The engine snapshot then also carries what the Network recorded: interactions (who said yes, who declined, who never answered), meeting feedback, open opportunities and unsent proposals (`networkStateFromRecords`, `packages/sim/src/snapshot.ts`). This is proposal P1 in [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md). It is on by default, and `packages/sim/test/engine-v12-proposals.test.ts` checks it.

The change moves every StubNetwork baseline that uses an engine. It does not move the consent arm: the ConsentNetwork builds the engine input from its own state ([2026-10-07-network-consent.md](2026-10-07-network-consent.md) section 11.1).

## Method

- Command (after): `bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed N --network stub --engine ./packages/sim/engines/engine-v1.ts --json --no-log`.
- Before: the same world and engine. A wrapper removes `interactions`, `feedback`, `openOpportunities` and `unsentProposalIds` from each engine snapshot. That is what the snapshot held before the change.
- Check: the "after" arm of the script gives the same metrics JSON as the CLI (seed 1, 30 days), apart from the run id.
- Seeds 1, 2 and 3. 30 days (the CONTRIBUTING command) and 14 days.
- Precision and worthwhile counts are rebuilt from the rounded rates. 95% Wilson intervals. Two-proportion z-tests on the pooled counts.

## Results

30 days (the CONTRIBUTING command):

| Seed | Proposals | Invites | Accepted | Meetings held | Precision | Pair recall | Worthwhile | Gini | Mean enjoyment |
|---|---|---|---|---|---|---|---|---|---|
| 1 before | 314 | 328 | 146 | 29 | 38.2% | 19.0% | 57.3% | 0.368 | 0.606 |
| 1 after | 317 | 372 | 170 | 38 | 34.4% | 19.3% | 55.6% | 0.377 | 0.633 |
| 2 before | 372 | 389 | 157 | 36 | 42.7% | 27.1% | 59.1% | 0.279 | 0.635 |
| 2 after | 364 | 445 | 188 | 44 | 42.3% | 29.4% | 61.1% | 0.316 | 0.634 |
| 3 before | 349 | 347 | 148 | 31 | 40.4% | 23.9% | 59.1% | 0.311 | 0.660 |
| 3 after | 366 | 430 | 186 | 32 | 35.5% | 22.7% | 54.0% | 0.349 | 0.629 |

14 days (seed 1 is the run in the review finding; it reproduces exactly):

| Seed | Proposals | Invites | Accepted | Meetings held | Precision | Pair recall | Worthwhile | Gini | Mean enjoyment |
|---|---|---|---|---|---|---|---|---|---|
| 1 before | 165 | 157 | 64 | 11 | 34.5% | 9.6% | 55.4% | 0.310 | 0.665 |
| 1 after | 195 | 204 | 84 | 18 | 32.8% | 11.6% | 51.0% | 0.335 | 0.615 |
| 2 before | 189 | 174 | 58 | 12 | 40.7% | 17.0% | 53.4% | 0.233 | 0.638 |
| 2 after | 211 | 227 | 84 | 18 | 41.2% | 18.1% | 57.3% | 0.285 | 0.644 |
| 3 before | 186 | 164 | 60 | 6 | 35.5% | 13.3% | 51.8% | 0.281 | 0.719 |
| 3 after | 206 | 228 | 89 | 10 | 36.4% | 13.5% | 51.8% | 0.336 | 0.616 |

Pooled over the three seeds:

| Run | Precision before | Precision after | p | Worthwhile before | Worthwhile after | p | Meetings held |
|---|---|---|---|---|---|---|---|
| 30 days | 40.6% (420/1035, 37.6-43.6) | 37.5% (393/1047, 34.7-40.5) | 0.15 | 58.6% (623/1064, 55.6-61.5) | 57.0% (711/1247, 54.3-59.7) | 0.46 | 96 → 114 |
| 14 days | 37.0% (200/540, 33.1-41.2) | 36.9% (226/612, 33.2-40.8) | 0.97 | 53.5% (265/495, 49.1-57.9) | 53.4% (352/659, 49.6-57.2) | 0.97 | 29 → 46 |

Canary leaks, invariant violations and minor contacts are 0 in every run, before and after.

## What it means

- With its history, the engine sends more invites and more meetings happen: +17% invites and +19% meetings held over 30 days, and +33% and +59% over 14 days. The engine no longer treats an unsent proposal as sent, and it sees who is already in an open opportunity.
- Precision and the worthwhile rate do not change significantly (p = 0.15 and 0.46 over 30 days). Seeds 1 and 3 lose 4-5 points of precision over 30 days; seed 2 does not.
- Exposure is less even: the Gini coefficient goes up on every seed (0.32 → 0.35 pooled mean over 30 days).

## Superseded numbers

These StubNetwork numbers were measured without the history in the snapshot. Use the "after" rows above in their place:

- The sim CLI numbers in [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md) under "The sim CLI as it runs today" (it says "no records fed").
- Any StubNetwork-with-engine run in [2026-10-06-engine-v1-vs-random.md](2026-10-06-engine-v1-vs-random.md) and [2026-10-06-liveness-complementarity.md](2026-10-06-liveness-complementarity.md). Those also used older engine versions.

The `push_baseline` rows in [2026-10-07-network-consent.md](2026-10-07-network-consent.md) (and `docs/results/network/arms-21d-seed*.json`) do not reproduce on the current working tree either. `bun run packages/network/harness/experiment.ts --days 21 --seed 1 --only push_baseline` now gives 342 proposals (stored: 327), 382 invitations (294), 35 meetings held (29) and precision 0.304 (0.346). The engine (`packages/engine`) is still changing in a parallel work stream, so this drift is not only the history change. Re-measure the `push_baseline` arm when that work lands. The before/after comparison above is valid: both arms ran on the same tree, and only the snapshot history differs.
