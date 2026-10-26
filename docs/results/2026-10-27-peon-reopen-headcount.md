# Preserve posted headcount when a Peon job closes

## Result and scope

Closing a three- or five-opening job erased its posted headcount. Reading it back after a restart, or reopening it through the existing staff update route without an explicit replacement count, returned one opening. The fix preserves the original count while closed jobs continue to have zero available seats.

This is a reproduced persistence bug in the existing Peon posting workflow (PRD section 40). Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `b64634c69d6f771187ca4be63fdabd4d87fb840c`. This branch is independent of the partial-text-update fix in PR #144.

## Cause and implementation

`postingFacts` replaced `JobPosting.openings` with zero whenever the intent was closed. `postingFromFacts` then interpreted that zero using its legacy fallback of one. The staff update route reuses saved fields when they are omitted, so reopening silently changed the posted headcount to one.

Persist the posted count unchanged. The existing `peonSeats` projection already sets the seat count to zero for any non-active posting, and `peonSeatCapacity` still subtracts hires and in-flight candidates after reopening. No schema, matching rule, capacity rule, message template or API shape changes.

Alternatives considered:

- Add a second tag for the original headcount. This duplicates data that the existing openings field already represents; status already controls whether a seat is active.
- Require an explicit count on every reopen. This adds a new API restriction and still leaves the stored closed posting with the wrong headcount. Retaining the value fixes both reads and updates.

## measurement

One integration case in `packages/network/test/peon-postings.integration.test.ts` uses NetworkService, the staff route handler, real Postgres and the engine snapshot projection. An adult manager joins through the signed synthetic webhook. The test creates jobs with 1, 3 and 5 openings, closes each, restarts the service, reads the closed post, and reopens it without supplying a count. Both `closed` and `filled` closure reasons are exercised. The dry-run adapter sends no real texts.

| Originally posted | Closed post read after restart, before -> after | Reopened posting, before -> after | Reopened seat's posted count, before -> after |
|---|---|---|---|
| 1 | 1 -> 1 | 1 -> 1 | 1 -> 1 |
| 3 | 1 -> 3 | 1 -> 3 | 1 -> 3 |
| 5 | 1 -> 5 | 1 -> 5 | 1 -> 5 |

Correct round trips improve from **1/3 to 3/3**. In every case the closed seat has zero openings both before and after restart, on both code revisions. The one-opening control stays unchanged. These are deterministic regression cases, not a statistical hiring-quality estimate; the fixture has no filled or pending candidate seats to subtract.

Same command before and after, with the new integration case applied to the base first:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 ./packages/network/test/peon-postings.integration.test.ts
```

The file goes from **1 pass, 1 fail** to **2 pass, 0 fail**, with 68 assertions in both runs. Baseline: 6.70 seconds; fixed: 6.09 seconds. No performance gain is claimed. One implementation was tried; no assertion or threshold was adjusted after observing the baseline failure.

Additional checks:

```sh
bun run typecheck
bun run sim --only peon --only peon-seats
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- Typecheck: all four configurations pass.
- Peon and job-seat blocks: **36/36 blocking gates** before and after, no tracked misses. All 37 gate records are identical excluding runtime. The pack/keyword/oracle fingerprint remains `b7736da857812394`. Baseline 31.2 seconds; fixed 34.4 seconds.
- Full integration including security: 676 pass, 8 skip, 6 fail; 13,777 assertions, 690 tests in 68 files, 581.18 seconds. The six failures match the unchanged Windows failures reproduced on main in the preceding contributions: absent absolute `/bin/bash`, SIGTERM exits 143 rather than 0, and four site tests expect Unix path separators. The eight skips require the separate cleanup-reconciliation opt-in, not missing Postgres. Linux CI remains required.
- E2E: 42 pass, 1 optional skip, 0 fail; 654 assertions, 43 tests in three files, 74.50 seconds.
- Combined with the preceding nine contribution PRs: clean cherry-pick, all four typecheck configurations pass, 9/9 job-seat gates pass, and all three posting integration cases pass (90 assertions, 14.10 seconds).

Peon's existing pinned run uses seeds 13-16, eight weeks, 400 candidates and 80 jobs per city, the pack/keyword/oracle arms and realism v2. The job-seat block uses its existing small service world, including its close-by-text and capacity checks. The general Peon simulator writes seats directly; the new Postgres integration case is the evidence for the persistence fix. The one-full-simulation-per-agent allowance was already used for PR #136, so these runs cover the affected blocks.

## safety_gates

The integration case explicitly checks closed intent status and zero seat availability before and after restart. Existing job-seat gates for closure, double opt-in, review, exclusions and capacity retain their passing values. No change to completed or in-flight seat accounting, no live sends, no deployment.

## llm_evidence and agent_clients

N/A for model-backed behavior: deterministic serialization, zero validation LLM calls and $0 model cost. No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor. The webhook, staff route, persistence and snapshot paths were exercised directly.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on local port 54339, frozen lockfile dependencies.

## Limits

This prevents future headcount loss. It does not reconstruct original counts in previously closed rows that already stored zero; those postings need an explicit correct count when updated. The API's existing reopen behavior is unchanged. Actual remaining capacity can be below the posted headcount when candidates already occupy seats. Linux CI remains required before merge.
