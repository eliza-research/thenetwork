# Recheck job constraints while an introduction is pending

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `6f9ee4a547881018b6d776240c49b1d7148ede9c`. Combined test code: `f7bdf6ef9375dac509706504981efb8dd484859f`.

## Requirement and cause

This fixes a reproduced bug in the Peon hiring scope (PRD 40.6), the hard-constraint
rule in PRD 33.1/33.5, and the posting-update and consent workflow in
`docs/network.md` section 1.4. Hard constraints must not be traded for a score.

A candidate has an $85k pay floor. A job initially offers $90k-$120k. The engine
creates a review item. Staff then changes the job to $50k-$60k. The old item can
still be approved, probed and introduced. The same failure occurs when the change
lands after the candidate's yes but before the manager's yes. Switching a job to
a refused work mode or outside the candidate's seniority band has the same cause.

The engine checks these pair constraints when it creates the proposal. The
Network's later approval and consent paths check reachability and consent state,
but assume that the earlier pack decision still holds.

Rebuild the current pack view and call the engine's existing `pairReason()` at
staff approval, before each anonymous probe, and before the mutual intro. The
current item's own proposal/open-item entries are omitted from this temporary
view: continuing that item is not a second introduction. Every other item's
history remains. The existing closure path ends a pending item that no longer
fits and clears its pending replies. No threshold, member copy or schema changes.

Alternatives: reimplementing pay and work-mode checks in the Network would create
two rule sets. Invalidating every posting edit would discard still-valid matches,
including a pay change that remains above the floor. Rerunning the entire engine
would add selection and ranking work to a consent reply. Reusing the pair rules
checks the existing constraint without choosing a new match or changing policy.

## measurement

One added simulation gate drives 21 backend workflows: seven conditions on seeds
7, 13 and 17. Each uses the real ConsentNetwork, Peon pack, posting text read-back
and confirmation, staff `applyPosting()` update, human review mode (approved by
the fixture), separate candidate and manager replies, recording channel, and
JSON process restarts. The existing SeatWorld supplies synthetic database rows
through the same posting-facts and seat-snapshot functions as the service.
This gate does not claim to exercise the staff HTTP route or PostgreSQL itself.

| Condition | Correct before -> after | Result after |
|---|---:|---|
| Unchanged job | 3/3 -> 3/3 | Both consent steps and both intro messages |
| Pay below floor before approval | 0/3 -> 3/3 | Approval invalidated; no probes |
| Pay below floor before candidate reply | 0/3 -> 3/3 | No manager probe or intro |
| Pay below floor before manager reply | 0/3 -> 3/3 | No intro |
| Pay changed to $85k-$90k, still above floor | 3/3 -> 3/3 | Both consent steps and both intro messages |
| Hybrid changed to refused remote work | 0/3 -> 3/3 | No manager probe or intro |
| Role seniority changed from 2 to 5 | 0/3 -> 3/3 | No intro |

Correct outcomes: **6/21 -> 21/21**. Ineligible introductions: **15 -> 0**.
Valid introductions remain **6/6**. Closed items have no pending candidate or
manager probe after restart. These exact regression counts are not population
estimates or evidence of improved hiring quality.

Same commands and seeds before and after:

```sh
bun run sim --only peon,peon-seats
bun run sim --only network
```

Peon and seats: **36/37 -> 37/37**, zero tracked misses,
36.1 -> 36.1 seconds. All 37 other gate records
are identical excluding elapsed time. Peon's pinned pack/keyword/oracle
fingerprint remains `b7736da857812394` (seeds 13-16, eight weeks).
Network: **61/61 -> 61/61**, zero tracked misses,
239 -> 255.4 seconds; all 63 records are identical.

The local combined tree includes the other 30 contributions. It passes
**109/109** gates with `bun run sim --only network,peon,peon-seats`, zero
tracked misses, in 304.2 seconds. The 21 new outcomes match this branch.
All 111 other records match the latest combined reports. The only
cherry-pick conflict joined adjacent simulation gates; all earlier gates remain.
The combined branch is local only and is not this PR's base.

## safety_gates

Existing minor, hold, review, double-consent, capacity, protected/proxy invariance
and fairness gates retain their values. This adds a check before progression;
it does not replace the existing recipient, review, consent or send guards.
No live messages, real member data, deployment or external resources were used.

## Validation

- `bun run typecheck`: all four TypeScript checks pass, isolated and combined.
- `bun run test:integration`: **675 pass, 8 skip, 6 known Windows failures**;
  13,741 assertions, 689 tests in 68 files, 517.24 seconds.
  All 11 security-suite files are included in this run.
- Failures match the established base failures: `/bin/bash` is unavailable to
  the Wrangler integration test; Windows SIGTERM exits 143 rather than the
  test's expected 0; four site-file assertions compare native backslashes with
  POSIX paths. No new failing test. Eight retry-reconciliation cases are opt-in.
- `bun run test:e2e`: **42 pass, 1 skip, 0 fail**; 654 assertions, 43 tests in
  three files, 40.57 seconds. The optional browser module is absent.
- The full-simulation allowance in `AGENTS.md` was used earlier in this session.
  These are affected-block runs, not a new full-suite or hosted-CI pass.

## llm_evidence and agent_clients

Validation makes zero model calls and costs $0. The defect and fix are in the
deterministic state and pair-filter paths. No optional model judge result is
claimed. The real backend workflow is exercised directly; no external-client
acceptance claim. Authoring client: Codex desktop, OpenAI `gpt-6-astra`;
app version not collected. Other clients were not tested.

## Test steps and limits

Run the affected-block commands above. The new gate prints
`PEON_POSTING_UPDATE_OUTCOMES`; all 21 rows must have `correct: true`.
On the base code with this gate, 15 rows fail while the six valid controls pass.
Then run typecheck, integration and E2E with local PostgreSQL on port 54339.

This rechecks pair constraints for pending job-seat intros. It does not introduce
a general posting-version consent policy: an update that still meets the existing
constraints can continue, as the $85k-$90k control shows. It does not undo booked
intros, revalidate every member-level rule, send new cancellation wording, or
reopen expired items. Closure retains the existing history behavior. Building
a current World adds work at these three boundaries; the deterministic seat
block remains small, but no production-scale latency claim is made.
Draft pending maintainer review and hosted CI.
