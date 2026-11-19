# Save repeated job skills without duplicate database rows

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `80fb007d71894dfe27ee9e7ac0d50c2c8f73f53a`. Combined test code: `3aba2640ac521228c97e856751f6453ffcb1f138`.

## Requirement and cause

This fixes a reproduced defect in the Peon hiring scope (PRD 40.6).
`docs/network.md` section 1.4 describes job posting text intake, the staff API,
the confirmed save transaction, and persistent job seats with must-have and optional skills.

A repeated skill is accepted by posting validation, but `postingFacts()` creates one facet
per occurrence. Facet IDs use the posting ID and skill. Two SQL requirements therefore
produce the same primary key. PostgreSQL rejects the transaction with SQLSTATE `23505`
on `facets_pkey`. A manager can confirm the text read-back and still have no saved job.
The staff posting route throws for the same input. Repeated optional skills fail too.

Emit one required-skill facet per skill ID, with the highest required level. Requiring
SQL at levels 2 and 4 is equivalent to requiring level 4; order cannot weaken it.
Emit one optional-skill facet per skill ID. Required and optional lists keep separate
IDs, so the same skill can still occur in both. Emitted facets retain first-occurrence order.

Alternatives: rejecting repeats would discard an otherwise usable posting. Ignoring
database conflicts or taking the last occurrence could silently keep a weaker required
level. Renaming rows per occurrence would store redundant requirements and let matching
count them more than once. Canonical rows preserve the strongest stated requirement.
No schema, parser grammar, member copy or matching threshold changes.

## measurement

One added integration case runs the real NetworkService, signed local webhook intake,
the production staff posting handler under the test's admin context, PostgreSQL writes,
posting reads and seat snapshots after a service restart. The Network seed is 1; the
posting operations themselves are deterministic. Synthetic adults and fictional 555
numbers only, with the dry-run adapter. No model, persistence or posting logic is mocked.

| Case | Saved before -> after | Required skills after |
|---|---:|---|
| Distinct required and optional skills | 1 -> 1 | Python 2, SQL 3 |
| Empty skill lists | 1 -> 1 | None |
| SQL 3 repeated | 0 -> 1 | SQL 3 |
| SQL 4 then SQL 2 | 0 -> 1 | SQL 4 |
| SQL 2 then SQL 4 | 0 -> 1 | SQL 4 |
| SQL 0 repeated | 0 -> 1 | SQL 0 |
| Optional Excel repeated | 0 -> 1 | None; one optional Excel |
| SQL repeated in both lists | 0 -> 1 | SQL 4; one optional SQL |
| Text post: repeated SQL and Excel, then yes | 0 -> 1 | SQL 2; one optional Excel |

Successful saves increase **2/9 -> 9/9**. All six failing staff cases have the same
`23505` / `facets_pkey` cause on the base. The confirmed text post adds zero rows before
and one posting after the fix. All eight API postings become job seats after restart;
the text posting's canonical skill lists also survive restart.

Same targeted command before and after:

```sh
bun test --conditions eliza-source --timeout 120000 packages/network/test/peon-postings.integration.test.ts
```

Main plus new test: **1 pass, 1 fail**, 41 assertions, 3.82 seconds.
Fixed: **2 pass, 0 fail**, 49 assertions, 3.42 seconds.
The existing intake, confirmation, minor refusal, employer verification, restart and
closure test still passes. These are regression outcomes, not population estimates.

## Matching and safety_gates

`bun run sim --only peon,peon-seats` passes **36/36 before and 36/36 after**,
zero tracked misses, in 34.7 and 34.9 seconds. All 37 records are identical
excluding elapsed time. The pack/keyword/oracle fingerprint stays `b7736da857812394`.
Peon uses pinned seeds 13-16 over eight weeks; the seat block drives its pinned intake,
review, double consent, exclusions and restart flows.

Combined locally with the preceding 29 contributions, the same simulation passes
**42/42**, zero tracked misses, in 37.7 seconds. All 43 prior combined Peon
records match. The complete combined posting integration file passes **8/8 tests**,
356 assertions, 14.37 seconds, with the new case's results identical to isolation.
The combined fixture uses a separate fictional phone because an earlier test already
uses the isolated case's phone; production behavior and assertions are unchanged.
The combined branch is not pushed.

Required levels never decrease when duplicates are merged. Existing limits, manager
eligibility, review, consent, minor exclusions, verification, pay checks, protected-attribute
invariance and row-level access checks remain. No thresholds are lowered.

## Validation

Bun 1.4.2, native Windows, PostgreSQL 16.15 on local port 54339.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run sim --only peon,peon-seats
bun run test:integration
bun run test:e2e
```

- All four typechecks pass in isolation and combined.
- Integration, including all 11 security files: **676 pass, 8 skip, 6 fail**;
  13,758 assertions, 690 tests, 68 files, 429.11 seconds.
- The six failures match the prior Windows baseline exactly: missing `/bin/bash`,
  SIGTERM exit status and four site path checks. Eight skips are opt-in retry cleanup tests.
- E2E: **42 pass, 1 skip, 0 fail**; 654 assertions, 43 tests, three files,
  37.66 seconds. The optional browser case requires `PLAYWRIGHT_MODULE`.
- AGENTS.md limits each agent to one full simulation. That allowance was used earlier;
  this change runs the two affected blocks. Fresh full-suite simulation success is not claimed.

Postgres commands use `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339`, the local cluster
through `OBSERVATORY_PG_DIR`, and `PG_BIN_DIR` on this host. Apply only the new integration
case to the base to reproduce seven unsuccessful saves; apply the writer fix to get nine.
All runs use local synthetic data and dry-run delivery, with no live-send flags.

## llm_evidence

Zero validation model calls and $0 provider cost. This is deterministic posting persistence;
no optional LLM-judge acceptance is claimed.

## agent_clients

The backend text and staff posting paths are exercised directly. No external-client
acceptance claim. Authoring client: Codex desktop, OpenAI `gpt-6-astra`, self-reported;
client version was not collected. Other clients were not tested.

## Limits

This draft needs hosted CI and maintainer review. Only identical canonical skill IDs are
merged; no skill aliases or punctuation rules are added. The input draft and POST response
can still contain repeated entries; stored facts and subsequent posting reads are canonical.
No old messages are explicitly replayed. Slop registration remains unconfirmed after
prior sign-in failures; no new sign-in loop or scoring claim is made.
