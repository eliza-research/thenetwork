# Keep closed jobs closed after delayed edit confirmations

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `460390bb1bb5b78bb989f0fe99fff0e76cc5a7d7`. Combined code: `aae2cb2fd16b34cba48fc703b6161f8a3d92f63e`.

## Requirement, cause and choice

This repairs the existing Peon posting lifecycle in `docs/network.md` 1.4,
under PRD 40.6 and the reproduced-bug scope. A manager requests an edit, then
staff closes that job before the manager answers the read-back. A later `yes`
currently writes an active posting and makes it eligible for matching again.
The same problem survives a service restart and applies to jobs marked filled.

The confirmation path already loads the latest manager-scoped posting before
saving. It previously passed a closed record to `postingFromDraft`, which builds
an active record for ordinary edits. Check its current status at confirmation:
an edit to a closed record is dropped with the existing response, and the draft
is cleared. A close confirmation still works. An explicitly reopened active
job can be edited normally. No schema, parser grammar, message template or
matching policy changes.

Alternatives considered: clearing drafts inside the staff closure write would
couple that write to conversation state and would not protect an imported stale
draft. Adding revision tokens would introduce a broader concurrency protocol.
The existing latest-record lookup provides the status needed for this defect.

## measurement

One new blocking gate drives the real ConsentNetwork, posting persistence
callback, posting-to-seat snapshot conversion and Peon engine. Synthetic members
and a recording channel replace the database and transport; parser output and
matching decisions are not mocked. Human review stays enabled, and no review
is approved. The gate requires zero probes, intros and meetings before review.

Ten hand-written workflows run on each of seeds 7, 13 and 17 (30 cases): staff
closure, filled closure, a subsequent draft correction, another open job,
cancellation, an ordinary active edit, explicit staff reopening, a new job,
an idempotent close confirmation, and a closure without a process restart.
The others cross JSON export/import boundaries before and after confirmation.
An eligible candidate then joins and the engine runs for two simulated days.

| Observation | Main plus identical gate | Fixed |
|---|---:|---:|
| Correct complete workflows | 15/30 | 30/30 |
| Closed jobs reopened by an old edit confirmation | 15 | 0 |
| New review proposals for those wrongly reopened jobs | 15 | 0 |
| Valid active edits, including explicit staff reopen | 6/6 | 6/6 |
| Other control workflows | 9/9 | 9/9 |
| Probes, intros or meetings before review | 0 | 0 |

These are deterministic workflow checks, not a statistical population estimate.
The salary is supplied explicitly so the gate does not require the separate
partial-update fix #144. An unrelated open posting must remain byte-identical.

Same command and settings before and after:

```sh
bun run sim --only peon --only peon-seats --json <results.json>
```

Main: **36/37** blocking gates, 0 tracked misses, 40.6 seconds.
Fixed: **37/37**, 0 tracked misses, 38.6 seconds. All 37 existing
gate records are identical, excluding runtime. The Peon fingerprint remains
`b7736da857812394`. Times are observations, not a performance claim.

The new gate first ran with a nonexistent message-type label in its no-send
check. Typecheck caught it. The final check uses the actual probe/proposal
metadata and meeting records; both baseline and fixed commands above were
rerun with that same final gate. No production alternative was tried.

## Combined compatibility and safety_gates

Locally combined with the other 36 contributions (including the documentation
follow-up to #144), the same 30 outcome rows are identical to the isolated fix.
The shared simulation-file conflict was resolved by retaining all existing
gates and appending this gate; the production change merged cleanly.

```sh
bun run sim --only network --only peon --only peon-seats --json <combined.json>
```

Combined: **115/115** blocking gates, 0 tracked misses, 340.4 seconds.
All 117 pre-existing records retain their values: Peon/seats compared
with the #197 combined run, and Network compared with the #195 combined run
(#196/#197 and the #144 evidence follow-up did not change Network code).
Consent, age, review, exclusions, capacity and leak gates remain passing.
Both standalone and combined branches pass all four typecheck configurations.
The combined branch is local only; this PR targets main independently.

The combined branch also passes the PostgreSQL posting integration file:
**8 pass, 0 fail, 356 assertions**, 11.99 seconds. Command:
`REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 ./packages/network/test/peon-postings.integration.test.ts`.
This checks the earlier posting regressions together on the real service/database
path. It is a focused integration run, not a full combined integration-suite claim.

## Integration, E2E, llm_evidence and agent_clients

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

Windows, Bun 1.4.2, local PostgreSQL 16.15 on port 54339; frozen dependencies.
`PG_BIN_DIR` and `PATH` point to its binaries, `USER=postgres`, and
`OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the local cluster.

- Integration including all 11 security files: **675 pass, 8 skip, 6 known
  Windows failures**, 13,741 assertions, 689 tests in 68 files,
  618.68 seconds. The same failure names remain: Wrangler requires
  `/bin/bash`, SIGTERM exits 143 instead of 0, and four site tests compare native
  and POSIX paths. Eight retry-reconciliation tests are opt-in.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions,
  43 tests in three files, 43.38 seconds.
- The full-simulation allowance was used earlier. Only the affected blocks
  above ran; no fresh full-suite or Linux CI pass is claimed.
- Zero validation model calls/$0. Deterministic confirmation handling;
  no model-backed behavior or external-client acceptance claim. Authoring:
  Codex desktop, OpenAI `gpt-6-astra`; app version not collected. Other clients
  were not tested.

## Reproduction and limits

Run the affected command and inspect `PEON_CLOSED_CONFIRMATION_OUTCOMES`:
all 30 rows must have `correct: true` and none may have `reopened: true`.
Main with the same gate has 15 incorrect rows. This reproduction needs no
database; integration and E2E above separately use PostgreSQL.

This checks status at confirmation, not a general revision/concurrency lock.
An active posting changed by staff can still be overwritten by a pending draft;
staff reopening makes a post active and therefore editable again. Previously
reopened jobs are not migrated. Existing close confirmations remain idempotent.
No live sends or deployment. Draft pending maintainer review and hosted CI.
