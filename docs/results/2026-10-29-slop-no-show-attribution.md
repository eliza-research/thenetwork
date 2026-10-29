# Attribute a missed date to the member who missed it

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `3f4de8c07d57e08b8412c52de717d552ead9357f`.

## Requirement and defect

Reproduced matching defect under the approved bug-fix scope. PRD 15.2 forgives one no-show and
states that the person who was flaked on must receive no negative record. PRD 40.4 governs Slop.

The Network records one interaction per check-in answer. A self-reported absence produces a
`no_show` interaction containing both date participants. Slop counts every participant as absent.
After two different partners each say "I couldn't make it", an innocent member gets two no-shows
and the matching engine excludes them with `trust_review`. If both people miss one date and each
reports it, each gets two no-shows for that single date.

Add optional `InteractionRecord.noShowBy`. The Network writes only the member who reports their
own absence. The Slop simulator writes the members whose simulated attendance outcome was absent.
The profile reader counts that list, canonicalizing identifiers as before. The Peon seat view maps
the new participant list just as it maps the existing accepted/declined lists.

The trust threshold, review rules, attendance parser, feedback sentiment and membership remain
unchanged. Records without this metadata retain the legacy participant-based behavior. No migration.

Alternatives considered:
1. Remove the no-show review rule. That would let repeat absentees escape the existing policy.
2. Infer an absent person from feedback-row IDs or participant order. Neither is a generic interaction
   contract, and the simulator may have either or both members absent.
3. Write only the absentee in `participants`. That loses pair history and changes duplicate guards.

## measurement

One new gate runs four real backend workflows on seeds 1, 2 and 3: partner missed twice, self
missed twice, both missed once, and two completed dates. Each uses production Slop wiring,
ConsentNetwork, human review, real onboarding texts, both yeses, the actual check-in time and
answers, and JSON export/import between dates. Stored appearance ratings are synthetic fixtures;
no photo rater is invoked. It books 21 initial dates across the 12 workflows.

It then feeds each resulting `packInput` directly to `runEngine` with the production Slop pack.
No hand-written interaction fixture or modified review threshold is used. Reversing the interaction
list leaves counts unchanged. The record-backed simulation restart retains fixture rows; this is
not a new Postgres persistence test.

| Observation | Before | After |
| --- | ---: | ---: |
| Correct member-level no-show counts | 33/48 | 48/48 |
| Spurious no-show count increments | 18 | 0 |
| False trust-review holds | 9 | 0 |
| True repeat-absentee holds retained | 3/3 | 3/3 |
| A new match for the six wrongly held central members | 0/6 | 6/6 |
| Completed-date controls still get a match | 3/3 | 3/3 |
| Repeat absentees still get no match | 3/3 | 3/3 |

Paired commands: `bun run sim --only slop,network --json <file>`; the final version of the Slop
gate was rerun on unchanged base with `--only slop`. The first gate prototype attempted a third
staff proposal; the final gate measures the matching engine's decision directly. The Network
baseline is from the initial unchanged-base run.

Blocking gates: **100/101 before, 101/101 after**. Final Slop baseline: 39/40; after: 40/40.
Network: 61/61 both times; all 63 Network records are identical excluding runtime.
Baseline runtime: 270.0s (Slop 39.7s, Network 230.2s), final Slop baseline rerun 38.1s.
After: 270.4s (Slop 37.4s, Network 233.0s). Existing tracked misses change from eight to seven.

Combined with the preceding 24 contributions, including Peon seats: **122/122**
blocking gates; all 121 shared records match the isolated fix. All four typechecks pass.
The combined checkout is local only. Conflict resolution retains prior opportunity IDs, booked
meeting metadata and every prior gate, then adds this attribution field and gate.

## Pinned simulation tradeoff

The corrected simulator changes matching history and therefore later assignments. No parameters,
gate definitions or thresholds changed. Four seeds (13-16), four weeks, 300 personas per city,
with the same production pack/world configuration on both revisions:

| Metric | Before | After |
| --- | ---: | ---: |
| Second-date rate vs random | 1.733x | 2.088x |
| Second dates per seed vs random | 1.676x | 2.000x |
| Back-outs at reveal | 12.2% | 10.7% |
| Dates per member-month vs random | 1.005x | 0.993x |
| Worst gender/orientation group vs overall (gay men) | 0.506x | 0.377x |
| Same ratio, feasible members | 0.603x | 0.440x |
| Worst rating-quintile dates vs overall | 0.927x (q2) | 0.887x (q3) |
| Total dates | 475 | 470 |

The fairness decline is an actual loss, not only a denominator change. A separate paired rerun
of the same four world seeds exposes `runArm`'s group totals: gay men's date participations are
19 -> 14, with the same 125.201 member-months. Per seed: 10 -> 6, 1 -> 1, 6 -> 5, 2 -> 2.
The group's already-failing 0.7x targets remain tracked failures. The 0.85x rating-quintile gate
still passes. These are deterministic synthetic results, not statistical or live-user estimates.
The fairness regression is a material review concern; this change makes no general quality-win claim.

To reproduce the additional group-total readout from either checkout, run this through `bun -e`:

```ts
import { runArm } from "./packages/sim/src/apps/slop/packEval.ts";
const r = await runArm("slop", [13, 14, 15, 16], 4, 300,
  { $world: { rater: true } },
  { catfish: 0.005, bodyTypes: true, verification: true,
    relay: { engine: true }, review: 3, widen: true, checkin: true });
console.log(r.extra.map(x => x.groups["man:gay"]));
```

## safety_gates

All blocking safety gates pass on both revisions. Declared-minor contacts, stated-filter
violations, repeat harassment after the first report, rating/contact/canary leaks, relays involving
a known minor, and contact shares without consent stay zero. Scam/harassment and contact-fishing
content blocking stays 100%; honest-message blocking on content alone stays 0%.

Tracked age-liar contact reduction improves 76.5% -> 82.4%; adversary-contact reduction
45.4% -> 47.4%; harm-event reduction 94.9% -> 96.0% (five -> four non-deception harm events).
Honest in-thread holds rise 2.0% -> 2.3%; this companion metric is included in the report rather
than treated as unchanged. Explicit-consent shares change 401 -> 422; all 85 bad-consent items
are blocked in both runs. The live Slop invariants and fingerprint remain unchanged.

## Validation, llm_evidence and agent_clients

- Frozen dependency install: unchanged dependencies.
- Four typechecks pass on the isolated and combined branches.
- Integration including all 11 security files: **675 pass, 8 skip, 6 fail**; 13,741 assertions,
  689 tests in 68 files, 578.25s. The six failures match the prior branch: Windows `/bin/bash`,
  SIGTERM exit behavior and four Unix path-separator comparisons. Eight skips require the separate
  cleanup opt-in `NETWORK_RETRY_RECONCILIATION_TEST=1`.
- E2E: **42 pass, 1 skip, 0 fail**; 654 assertions, 64.99s. The optional browser check needs
  `PLAYWRIGHT_MODULE`. PostgreSQL 16.15 uses local port 54339.
- No validation LLM calls or cost. Attribution and matching inputs are deterministic. The optional
  LLM judge sees corrected counts but no model-quality or judge-acceptance result is claimed.
- Authoring: Codex desktop, OpenAI `gpt-6-astra` (operator supplied); app version not collected.
  No external agent-client acceptance run is claimed.

Draft pending maintainer review and hosted CI. The one full-simulation allowance was used earlier;
only affected blocks and the combined seat block ran here. Older records without attribution keep
their old behavior; historical false holds are not repaired. Third-party absence claims and
contradictory reports retain existing handling. No live messages, production data or deployment.
