# Codebase audit: work in progress

This report records verified changes. It does not certify the whole codebase or production.
The first pass started at local `b9a6c20` on branch `codex/codebase-audit`.
A live GitHub refresh found newer merged work. The branch was rebased onto `24b8d3a`.
The existing scorecard repair from PR #101 was cherry-picked with its original commit attribution.
The original checkout's untracked `.claude/` and `prototypes/` folders remain untouched.

## Confirmed defect: repeated joins ignore a lower age

A signed-in member can submit the web join form again.
The existing membership returned before the service read the newly stated age.
A person who joined at 30 and then submitted 16 kept age 30 across their memberships.
This violates the person-level lowest-age rule in PRD 40.3 and AGENTS.md.

The existing-membership path now records the age through `Accounts.recordAge` before it returns.
This reuses the existing cross-app age hook. It does not create another membership or consent event.
An older age cannot raise the stored age.

Regression command:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source packages/network/test/service-platform.test.ts --test-name-pattern 'repeated web join'
```

Before: 0 pass, 1 fail. Expected age 16; actual age 30.
After: the regression passes in the full file: 17 pass, 0 fail, 201 assertions.
The case uses the public API and real Postgres, two app memberships, fictional phone numbers, and a simulated clock.
It checks the age in both network member records, stable member identity, and unchanged consent count.

Alternatives considered:

1. Reject every repeated join. This breaks successful retry behavior and still discards the age statement.
2. Recreate the membership. This risks duplicate consent and loses the existing member identity.

## Consolidation and dead code

- Core owns the app ID list, type, and predicate. Platform, engine, MCP, and site build code reuse it.
- Existing exports remain available. The import-free upstream service contract remains unchanged.
- MCP reads its known apps' join and age policies directly from the platform registry.
  The obsolete unknown-app fallback and unused join-mode override are removed.
- Photo attachment downloads use the existing capped stream reader used by uploads and HTTP bodies.
- Core owns the identical distance calculation and shared coordinate and borough types.
  Network and friends retain their own travel estimates and neighborhood data.
- The acceptance estimate takes only its two actual inputs. Four unused parameters are removed.
- Unused onboarding age-hit and busy-context declarations are removed.

Alternatives to shared ownership were keeping parallel copies or importing one app implementation from another.
Parallel copies can drift. App-to-app imports would invert the existing dependency direction.
Leaf core modules let browser code use the shared data without loading server code.

A TypeScript import scan found six source files without static importers.
All six are documented command-line entry points. None is deleted based on that scan.
The unused-symbol compiler scan found additional candidates which still need review.

## Validation so far

| Check | Result |
|---|---|
| Baseline typecheck | Pass |
| Service-platform integration after age fix | 17 pass, 0 fail |
| E2E baseline during audit | 37 pass, 0 fail, 448 assertions |
| MCP and OAuth after app consolidation | 42 pass, 0 fail, 306 assertions |
| Typecheck after consolidation | Pass |
| Four production site builds | Pass |
| Plugin snapshot check | Pass |
| Mixed-tree diagnostic integration run | 476 pass, 7 fail; not final evidence |
| Old-base targeted simulations | Interrupted to rebase; onboarding passed 19 blocking gates |
| Current-main typecheck, four site builds and plugin snapshots | Pass |
| Current-main e2e | 42 pass, 3 optional browser cases skipped, 0 fail, 609 assertions |
| Current-main optional browser cases, run separately | 3 pass, 0 fail, 71 assertions |
| Current-main integration | 569 pass, 0 fail, 12183 assertions |
| Targeted onboard, friends, network simulations with REQUIRE_PG=1 | 98/98 blocking gates pass; 2 tracked metrics off target |
| Notification changes: integration, retention, service and cloud outbound | 41 pass, 0 fail, 476 assertions |
| Typecheck after notification changes | Pass |

The full integration command started before edits, but loaded later files while edits were underway.
It is diagnostic evidence, not a final unchanged-base or final-head certification.
The scorecard failure already has an open repair, PR #101. The path-decoding repair is open as PR #99.
PR #101 is incorporated locally, not merged on GitHub. PR #99 remains separate.
Five module-load errors and the old age behavior came from changing files during the diagnostic run.
A fresh process on the rebased tree is required; no passing suite is claimed from that run.

All runs above use Bun 1.4.2. Database runs use local Postgres on port 54339.
The real-LLM run below uses synthetic personas. No paid rater, live message, deployment,
or real agent-client run has occurred in this audit.
The deterministic regression has one scenario; confidence intervals do not apply.
This report is hand-written. Counts come from command output in ignored `runs/audit/` logs.

## Remaining work

- Finish the source review of matching, review, relay, delivery, persistence, and operational flows.
- Review remaining dead-code, duplicate-type, and complexity candidates before changing them.
- Resolve or incorporate the existing baseline test repairs without duplicating open work.
- Run final integration, e2e, typecheck, plugin and site checks on the final tree.
- Run one full simulation at the end, with Postgres required.
- Record real-LLM evidence and applicable agent-client evidence separately from local tests.
- Keep deployed-provider and live-delivery claims separate from local acceptance.

The optional browser cases used the existing Playwright module at `/Users/shawwalters/v3/node_modules/playwright/index.mjs`.
They exercise built pages with controlled API/provider boundaries, not actual hosted agent clients.
Current validation logs: `runs/audit/integration-current.log`, `sim-current.log`, `browser-current.log`, and `e2e-current.log`.

## Confirmed defect: queued notifications outlive their source records

The queue could send an expired inbox item or a digest with content from an erased app.
The notification policy allowed a missing delivery record and checked only whether an item was unseen.
The service queue also did not call this policy.

The send-time check now requires the original item set, all records present, no expired item,
and at least one unseen item. A missing record fails closed. The service queue uses the same check.
The item-set hash detects retention changes without storing another copy of the text.

Real Postgres regressions cover full expiry, partial expiry, full erasure, and leaving one app.
All four failed before the fix and pass after it. A service regression failed by sending expired
content before the fix; after the fix it suppresses that content and still sends a current item.
The queue uses a recording provider, fictional numbers, and a simulated clock; no live sends occur.

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 packages/notify/test packages/platform/test/notify-retention.pg.test.ts packages/network/test/service-platform.test.ts packages/network/test/cloud-outbound.integration.test.ts
```

Result: 41 pass, 0 fail, 476 assertions. Logs are in `runs/audit/notify-suite-after.log`.
The narrow before/after logs are `notify-current-before.log`, `notify-current-after.log`,
`service-notify-before.log`, and `service-notify-after.log` in the same directory.
No model or random seed is used in these deterministic database cases.

Alternatives considered:

1. Rewrite the queued digest after erasure. This changes the body under an existing delivery identity.
2. Cancel rows only when an item is erased. This misses expiry while a message waits in the queue.

The fix cancels the immutable digest. Remaining items stay in the inbox; it does not make a new
digest for them. This preserves the existing policy that records notification intent before enqueue.

## Confirmed defect: an age propagation failure is not repaired on retry

The person-level age commits before the service updates each app. A failure in those updates left
one app at the old age. A later statement did not call the hook because the person-level age was
already lower. The retry returned success without repairing that app.

`recordAge` now calls the idempotent reconciliation hook with the stored minimum after each age
statement. This also repairs a retry that supplies the old, higher age. It removes one database read.

The regression uses a Postgres trigger to fail the slop member update after the person age commits.
The trigger is removed before the retry. Before the fix, slop stays at 30; after it, both apps are 16.
The person-level send fence remains a separate check; this regression does not claim a live minor contact.

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 packages/network/test/service-platform.test.ts packages/platform/test/number-change.pg.test.ts packages/mcp/test/signup-draft.test.ts
```

Result: 34 pass, 0 fail, 370 assertions; typecheck passes. Logs: `runs/audit/age-retry-before.log`,
`age-retry-after.log`, and `typecheck-age-retry.log`. No model or random seed is used.

Alternatives considered:

1. Put all effects in one transaction. Photo storage deletion cannot join a Postgres transaction.
2. Add a durable pending-hook table. This adds state when the existing lower-only updates can run again.

The chosen fix repeats reconciliation on age statements. It does not add a background retry worker.

## Real-LLM evidence: synthetic persona wording

Command: `bun run packages/sim/src/cli.ts --personas 6 --days 3 --seed 2 --llm`.
The launcher passes only basic process variables and the provider keys from the original checkout,
with `DEFAULT_LLM_PROVIDER=surplus` and `DEFAULT_LLM_MODEL=gpt-6-luna`.
No live-send, deployment, or channel settings are passed to the child.

Result: 8 logical LLM calls, 0 LLM failures, 117 simulation events, 21.429 seconds.
No provider fallback is reported. The persona caller requests JSON with a 3000-token budget,
temperature 0.8, and at most two structured-output attempts. The shared client controls wire settings,
HTTP retries, token growth, and deadlines.

The run reports 0 canary leaks, minor contacts, invariant violations, style failures, and network errors.
It contains six adults, no adversarial personas, one proposal, and no meetings. The network is the
stub baseline; the LLM supplies wording while policy controls decisions. These results do not prove
production matching, real client onboarding, or the safety of adversarial and minor cases.
There is no paired LLM quality claim or meaningful significance estimate from this small run.
Log: `runs/audit/llm-personas.log`; generated run: `runs/run-2026-10-20T01-13-26-827Z-s2-stub`.

## Matching helper cleanup

Removed unused world arguments from shareable-facet and provider-benefit helpers, and from peon
candidate construction. Removed an unused probe context, summary wrapper, and slate type.
The slate type had duplicated the match-check shape but had no consumer; deleting it avoids creating
a new shared abstraction for unused code. Searches include all tracked source and documentation.

`REQUIRE_PG=1 bun run sim --only peon --only evals` passes all 52 blocking gates before and after.
Reported gate output is identical after excluding durations. The official seeds and sample sizes
are those of the existing blocks; no model is called. Typecheck passes.
Logs: `runs/audit/engine-cleanup-before.log`, `engine-cleanup-after.log`, and `typecheck-engine-cleanup.log`.
The network block also passes all 61 blocking gates after cleanup, with no tracked metric off target
(`runs/audit/network-cleanup-after.log`).

Alternatives were retaining unused parameters or adding shared types for the unused slate.
Neither improves a live caller. The cleanup leaves matching arithmetic and copy unchanged.

An AST scan of non-test TypeScript function bodies found two exact duplicates of at least 180
characters: the friends/slop Gini calculation and the relay baseline context. The Gini calculation
remains a review candidate. This scan detects exact token matches, not every semantic duplicate.

## Relay fixtures and unused imports

The relay block now uses `baseCtx` and `textItem` from its existing shared relay library.
It no longer owns a second baseline context and text-item constructor. Alternatives were keeping
the copies or creating another fixture module. The existing shared library already supplies the
same data to the relay CLI, so it needs no new dependency layer.

`REQUIRE_PG=1 bun run sim --only relay` passes all 60 blocking gates before and after. Gate output
is identical except timing; four tracked metrics remain off target. No model is called.
Logs: `runs/audit/relay-dedupe-before.log` and `relay-dedupe-after.log`.
Unused imports confirmed by the compiler were removed from 17 source, harness, and test files.
Typecheck passes (`runs/audit/typecheck-import-cleanup.log`).

`bun run check:mirror` confirms both service contract files match upstream `elizaOS/eliza@develop`.
They remain unchanged. Evidence: `runs/audit/contract-mirror-current.log`.
The combined tree passes the full integration suite: 575 pass, 0 fail, 12212 assertions across
61 files (`REQUIRE_PG=1 bun run test:integration`, `runs/audit/integration-second-batch.log`).

## Confirmed defect: backup privacy checks accept server errors

An anonymous probe that returned HTTP 429 or 503 passed the privacy check. The job then uploaded
the backup even though that response did not establish whether anonymous access was refused.
The check now accepts only 401, 403, or 404. Other responses fail before the backup upload.
The existing probe cleanup still runs. Encryption and the documented R2 privacy-check limit remain.

The regression uses a real local Postgres dump and a local S3-compatible HTTP server. Both cases
uploaded before the fix (0 pass, 2 fail); after it, neither leaves backup objects in the bucket.
The full backup file passes 6 tests and 32 assertions, including encryption and a restore drill
that checks source-server roles are unchanged. Typecheck passes.

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 deploy/backup/backup.test.ts
```

Logs: `runs/audit/backup-privacy-before.log`, `backup-privacy-after.log`, and `typecheck-backup.log`.
No model, real bucket, or deployed database is used. The test fixture supplies the HTTP failures;
dumping, encryption, HTTP upload, and restore use the real implementations.

Alternatives considered:

1. Retry every error until a conclusive response. This adds delay and retry state to the daily job.
2. Continue because the backup is encrypted. This defeats the separate private-bucket requirement.

The job now fails the inconclusive run so its existing failure reporting can surface it.
The full 575-test suite above predates this last fix; the six backup tests and typecheck cover this batch.

## Next review candidates

- Consolidate the exact friends/slop Gini duplicate while preserving reported metrics and fingerprints.
- Consolidate proxy-header classification shared by the edge router and backend.
- Continue the remaining source review and unused-parameter review. Do not remove intentional fixtures,
  CLI entry points, upstream contract mirrors, or the founder-approved Clef placeholder weights.
- Refresh main before final validation: PRs #99 and #101 are no longer in the open PR list.
  The live list now includes #102, #103, and #104; website-account changes in #104 are separate work.

## Current-main refresh and deployed router consolidation

The audit branch is rebased onto `eeb9cfe`. Main now includes PR #99 (decoded file paths), #101
(scorecard observation time), #102 (recorded PRD decisions), and #103 (read-only Pages credential probe).
Git skipped the previously cherry-picked scorecard patch during rebase. No audit patch conflicted.

`platform/src/proxy.ts` contained a second router used only by its tests. The sites use
`deploy/router.ts`, which applies the current body cap and header rules. Removed the unused router,
its private header-strip helper, and its duplicate path expression. The platform HTTP integration
tests now call the deployed Pages router. Header classification has one owner in platform's proxy
module; the backend, Pages router, and local site server reuse it.

Before and after: 64 pass, 0 fail, 423 assertions across router, backend, and platform proxy tests.
The suite covers built Pages workers, spoofed headers, signed app routing, body caps, and OTP IP limits.
Typecheck passes. Commands and logs:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 deploy/router.test.ts deploy/backend/backend.test.ts packages/platform/test/proxy.test.ts
bun run typecheck
```

`runs/audit/proxy-dedupe-before.log`, `proxy-dedupe-after.log`, and `typecheck-proxy.log`.
Alternatives were keeping both routers aligned or moving the deployed router into platform.
The first retains duplicate behavior; the second moves working deployment code without a need.
The chosen change removes the unused path and tests the existing deployment owner.
