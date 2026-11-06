# Friends split-table proposal metrics — 2026-11-06

## Problem and scope

The Friends report counted additional tables from one proposal as new proposals.
Those tables also increased the quorum numerator without increasing its denominator.
The existing `pack-options3` arm therefore overstated both metrics.

This is a reproduced simulation defect under the approved project scope.
PRD 34.1 and 34.4 require simulation validation and accurate proposal measurements.
The existing arm and split-table behavior are documented in `2026-10-08-friends-pack.md`.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for service validation.
The branch starts from that current main revision, without other open PRs.

## Cause and implementation

`runFriendsWorld` creates one flow for each planner proposal.
If the proposal fills another table, it appends another flow with zero probes.
Previously, `friendsMetrics` counted every flow as a proposal.
It also counted every table that reached quorum against the number of probed proposals.

Additional tables now carry `splitFrom`, the original proposal key.
Proposal totals count original flows, including proposals that were never probed.
Quorum rates count original probed proposals that reached quorum, divided by all original probed proposals.
Table records remain available for attendance, meetups, contacts, harms and other outcomes.

The first table always reaches quorum before the harness can form another table.
Its flow therefore records whether the original proposal reached quorum.
Later backouts and no-shows retain their existing meaning in this metric.

Other implementations considered:

1. Parse the `:tN` suffix from flow keys. That couples metric semantics to the diagnostic key format.
2. Count only flows with probes. That loses original proposals dropped before probing.
3. Store proposals and tables in separate collections. That changes more consumers and record handling than this correction needs.

## measurement

The committed integration case uses the existing `pack-options3` arm unchanged.
It runs the real engine planner, seeded persona oracle, booking flow and metric collector.
It observes proposal keys when the planner returns them, before the harness creates extra table records.
No matcher, response, attendance result or flow record is fabricated.

Each run uses 400 personas and eight weeks.
The primary seeds are 5–8. The additional seeds are 9–12.
No policy or population parameter was tuned.

| Seed | Planner proposals | Reported before | Reported after | Split tables | Probed proposals | Reached quorum | Rate before | Rate after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 627 | 631 | 627 | 4 | 618 | 231 | 38.0259% | 37.3786% |
| 6 | 633 | 640 | 633 | 7 | 617 | 201 | 33.7115% | 32.5770% |
| 7 | 605 | 609 | 605 | 4 | 593 | 215 | 36.9309% | 36.2563% |
| 8 | 645 | 653 | 645 | 8 | 628 | 226 | 37.2611% | 35.9873% |
| 9 | 557 | 562 | 557 | 5 | 544 | 183 | 34.5588% | 33.6397% |
| 10 | 624 | 630 | 624 | 6 | 609 | 225 | 37.9310% | 36.9458% |
| 11 | 578 | 586 | 578 | 8 | 560 | 184 | 34.2857% | 32.8571% |
| 12 | 582 | 588 | 582 | 6 | 567 | 200 | 36.3316% | 35.2734% |

Primary totals: 2,533 reported proposals became the correct 2,510.
Mean per-seed quorum rate changed from 36.4824% to 35.5498%.
All 54 original proposals without probes remain in the proposal total.

Additional totals: 2,366 reported proposals became the correct 2,341.
Mean per-seed quorum rate changed from 35.7768% to 34.6790%.
All 61 original proposals without probes remain in the proposal total.

The integration case runs all four primary worlds before asserting the report values.
Copied unchanged onto the base, it fails: 0 pass, 1 fail, three assertions, 15.72 seconds.
With the fix, it passes: 1 pass, 0 fail, three assertions, 15.61 seconds.
It also requires actual split tables and original proposals without probes, preventing vacuous coverage.

The larger comparison runs `pack-options3`, `pack`, `random` and `oracle` on seeds 5–12 at both revisions.
That is 32 worlds per revision, each with 400 personas and eight weeks.
It observes each real matcher's proposals through the same wrapper used by the regression case.
The wrapper returns the planner's proposal array unchanged.

For every world, the comparison checks:

- Reported proposal count against the captured planner count.
- Quorum rate against original probed flows whose groups reached quorum.
- SHA-256 equality of serialized flows, excluding only the new `splitFrom` metadata.
- SHA-256 equality of serialized meetups, contacts and value-day entries.
- Exact equality of every metric except `proposals` and `quorumRate`.

All checks pass after the fix.
Only those two metrics change in the eight `pack-options3` worlds.
All metrics in the 24 default-pack, random and oracle control worlds remain identical.
These controls form no split tables on the tested seeds.
All other flow fields, meetups, contacts and value-day entries match across all 32 worlds.

These are exact accounting corrections in deterministic runs, not estimated improvements in matching quality.
No confidence interval or quality improvement is claimed.

## safety_gates

Run the same command on both revisions:

```text
bun run sim --only friends --json ../friends-proposal-gates.json
```

Both pass 18/18 blocking gates, with three tracked records and one tracked miss.
All 21 gate records match after excluding elapsed time.
The pack/random/oracle fingerprint remains `e5bf70e069eaa7e9`.
Runtime was 49.7 seconds before and 49.4 seconds after.

The existing tracked miss remains: undetected-adversary harms are 17.5 versus 10.5 per seed, or 1.67x against a 0.5x target.
No threshold, gate classification, matching decision or persona behavior changes.
Every safety metric also remains identical in the 32-world comparison.

The full simulation was not repeated.
AGENTS.md permits at most one full run per agent; that allowance was used earlier on PR #355.
That earlier run is not evidence for this revision.

## Service validation

`bun run typecheck` passes all four configurations.

`bun run test:integration`, including the security suite, reports:

```text
676 pass
8 skip
6 fail
13744 expect() calls
Ran 690 tests across 69 files. [543.83s]
```

The new regression passes in that run in 18.12 seconds.
All six failure names match the saved clean-base reproduction after removing durations.
The underlying errors also match: missing `/bin/bash`, SIGTERM exit 143 instead of 0, and four Windows path-separator assertions.
The eight skips belong to the optional PostgreSQL completed-cleanup reconciliation suite.
The full integration command exits 1; a green integration suite is not claimed.

`bun run test:e2e` reports 42 pass, 1 skip, 0 fail and 654 assertions in 71.64 seconds.
The optional browser SDK case is skipped because `PLAYWRIGHT_MODULE` is not configured.
Both service commands used the isolated local PostgreSQL cluster at port 54339.
After validation, no client connections remained and the cluster was stopped.

## llm_evidence

N/A: the change corrects deterministic reporting in the model-free Friends world.
The planner and persona oracle used here make no model calls.
Real-model calls: zero. Cost: $0. No model-backed behavior is claimed.
Live-send and deployment flags were disabled.

## agent_clients

N/A: this changes simulator records and developer reports, with no member-facing agent flow.
Codex desktop 26.1029.7803.0 drove Bun 1.4.2.
Provider: OpenAI. The exact assistant model identifier was unavailable.
The attribution helper supports `unavailable` for disclosure.
No other agent client, browser or computer control was used.

## Reproduction

Copy the regression case unchanged to a base checkout for the before measurement.
Use the repository's audited dependency setup on both checkouts.
Run this command at both revisions:

```text
bun test --conditions eliza-source packages/sim/test/friends-proposal-metrics.integration.test.ts
```

Expect the base to fail on proposal totals and quorum rates.
Expect the fixed revision to pass one case with three assertions.
The per-seed values are in the table above.

To print the same four arms through the existing CLI:

```text
bun run --conditions eliza-source packages/sim/src/apps/friends/cli.ts --seeds 5-8 --n 400 --weeks 8 --only pack-options3,pack,random,oracle --json ../friends-proposals.json
```

Use seeds 9–12 for the additional corpus.
The comparison measurements above call these same world and metric functions through a temporary observer.
They do not claim that the additional corpus passes the official launch gates.

## Risks and limits

The optional `splitFrom` field adds one parent key per additional table.
Consumers that serialize complete flow records will see that metadata.
Old serialized flows without it are not migrated; rerun the world to obtain corrected reports.
Metric collection makes two small filtered arrays and remains linear in the number of flow records.

This correction does not validate the oracle's calibration or resolve other open Friends changes.
It does not change UI, production services, dependencies or member-facing text.
Only synthetic populations were used. No raw persona data, run logs or credentials are committed.
