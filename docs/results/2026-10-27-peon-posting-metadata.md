# Preserve Peon posting update times and closure reasons

## Result and scope

The staff write response correctly reports a posting's update time and closure reason, but the next read loses both. An edited posting reports its original creation time as `updatedAt`; a filled or closed posting no longer reports why it closed. The fix persists those existing fields through reads and service restarts, and clears the old closure reason when the posting reopens.

This is a reproduced persistence bug in the existing Peon posting workflow (PRD section 40). Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `bae1cc7205a727e1aca98da30991374ef11bed39`. This branch is independent of the text-update and headcount fixes in PRs #144 and #145.

## Cause and implementation

`postingFacts` does not serialize `updatedAt` or `closedReason`. `postingFromFacts` reconstructs every update time from `intent.createdAt` and omits the closure reason. The API returns its in-memory write result, which hides the loss until the next load.

Store one `agent_private` facet tagged to the posting, containing its epoch-millisecond update time and, when closed, its supported closure reason. The existing transactional replacement of a posting's tagged facets saves the metadata and removes stale reasons when reopening. Read the metadata only from facts tagged to that posting. Older rows without metadata retain the existing creation-time fallback and no invented closure reason.

The metadata facet is not a matchable or shareable job fact; Peon's profile reader excludes it. Existing facet validity dates, public copy, API shape, matching rules and seat accounting remain unchanged. No database migration is required.

Alternatives considered:

- Repurpose every posting facet's `validFrom` as its update time and change the loader to retain it. That changes validity semantics and still needs separate closure-reason storage. Explicit revision metadata keeps the two meanings distinct.
- Add a dedicated table or a generic intent update-time column. That requires a migration and a broader storage contract for two fields already supported by the existing posting type. A private facet uses the posting's existing transaction and lifecycle.

## measurement

One new integration case uses NetworkService, the actual staff posting route handler, real Postgres, a simulated clock and dry-run messages. A fictional adult manager creates a job, edits its salary after five minutes and 123 milliseconds, creates a separate job, closes the first as filled, restarts, reopens it, closes it as closed, and restarts again. The route helper binds to the current runtime after each restart.

Six read observations of the first posting improve from **0/6 to 6/6 correct update times**. These are checkpoints in one deterministic lifecycle, not six independent statistical samples.

| Read checkpoint | Expected update time relative to creation | Before | After |
|---|---|---|---|
| After salary edit | +300,123 ms | Creation time | Correct |
| After another posting is created | +300,123 ms | Creation time | Correct |
| After filled closure | +420,123 ms | Creation time | Correct |
| Filled closure after restart | +420,123 ms | Creation time | Correct |
| After reopening | +480,123 ms | Creation time | Correct |
| Closed closure after another restart | +540,123 ms | Creation time | Correct |

The three closed read observations improve from **0/3 to 3/3 correct closure reasons** (`filled`, `filled`, `closed`). The creation time remains unchanged; the direct edit and close write responses are already correct on the base. Reopening returns no closure reason. Removing the new private metadata from the unrelated control posting verifies that legacy facts-only rows still load with their own creation time and do not inherit the first posting's metadata.

Same command on base plus the regression case and on the fix:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 ./packages/network/test/peon-postings.integration.test.ts
```

The file goes from **1 pass, 1 fail** to **2 pass, 0 fail**, with 51 assertions in both runs. Final baseline: 6.64 seconds; fixed: 7.43 seconds. No performance gain is claimed. One production implementation was tried. An initial baseline also failed (6.33 seconds); the legacy compatibility control was then added before rerunning the baseline and applying the fix. The metadata regression's expected results were unchanged after the final baseline.

Additional checks:

```sh
bun run typecheck
bun run sim --only peon --only peon-seats
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- Typecheck: all four configurations pass.
- Peon and job-seat blocks: **36/36 blocking gates** before and after, no tracked misses. All 37 gate records are identical excluding runtime. The pack/keyword/oracle fingerprint remains `b7736da857812394`. Baseline 32.0 seconds; fixed 35.6 seconds.
- Full integration including security: 676 pass, 8 skip, 6 fail; 13,760 assertions, 690 tests in 68 files, 569.08 seconds. The six failures match the unchanged Windows failures reproduced on main in the preceding contributions: absent absolute `/bin/bash`, SIGTERM exits 143 rather than 0, and four site tests expect Unix path separators. The eight skips require the separate cleanup-reconciliation opt-in, not missing Postgres. Linux CI remains required.
- E2E: 42 pass, 1 optional skip, 0 fail; 654 assertions, 43 tests in three files, 73.74 seconds.
- Combined with the preceding ten contribution PRs: all four typecheck configurations, 9/9 job-seat gates and all four posting integration cases pass (109 assertions, 7.10 seconds).

The combined checkout required preserving both tests at their shared insertion point. Its first posting run had 3 pass and 1 fail: PR #144's successful-update assertion compared every tag, including the newly persisted update time. That PR received a test-only follow-up (`32125f2d2aaff09aa3d1f23ae9672772af7cc6e9`) excluding only the revision-time tag in the confirmed-save comparison. It still compares all tags before confirmation and after cancellation. This new metadata case verifies the exact update times. PR #144's isolated two-test file and typecheck also pass after the adjustment. No production change was needed to combine the fixes.

Peon's existing pinned run uses seeds 13-16, eight weeks, 400 candidates and 80 jobs per city, the pack/keyword/oracle arms and realism v2. The job-seat block uses its existing service world. The general Peon simulator writes seats directly, so the new Postgres integration case proves the persistence fix. The one-full-simulation-per-agent allowance was already used for PR #136; these runs cover the affected blocks.

## safety_gates

Existing age, consent, review, closure, exclusion, capacity and leak gates retain their passing values. The added record is private metadata, excluded from Peon's matching profile. Synthetic members, local Postgres and dry-run messages only; no live sends or deployment.

## llm_evidence and agent_clients

N/A for model-backed behavior: deterministic serialization, zero validation LLM calls and $0 model cost. No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor. The signed webhook, staff route handler and persistence paths were exercised directly.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on local port 54339, frozen lockfile dependencies.

## Limits

This preserves metadata on subsequent saves. Historical update times and closure reasons that were never stored cannot be reconstructed; legacy rows keep the prior fallback until updated. The change does not add an audit history or concurrent-edit protection. Linux CI remains required before merge.
