# Codebase audit: fixes and validation

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
Historical boundary at that run: PR #101 was incorporated locally and PR #99 was separate. Both are included in the later main base.
Five module-load errors and the old age behavior came from changing files during the diagnostic run.
A fresh process on the rebased tree is required; no passing suite is claimed from that run.

All runs above use Bun 1.4.2. Database runs use local Postgres on port 54339.
The real-LLM run below uses synthetic personas. No paid rater, live message, deployment,
or real agent-client run has occurred in this audit.
The deterministic regression has one scenario; confidence intervals do not apply.
This report is hand-written. Counts come from command output in ignored `runs/audit/` logs.

## Remaining work at the first checkpoint

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

## Review candidates at that checkpoint

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

## One Gini calculation

Core now owns the Gini calculation. Engine policy, the network experiment harness, the run-log
judge, and the friends and slop worlds import and re-export it. Existing import paths still work.
This removes five parallel implementations. The shared version uses the engine's weighted sum
and accepts a readonly input without changing it.

Numerical comparison: 518 arrays, seed 73921, five old implementations, 2590 comparisons.
Empty, zero, equal, concentrated, and generated count populations are included. The largest
absolute difference is 2.220446049250313e-16; 790 comparisons differ only in floating-point rounding.
The comparison is an ignored audit script, not a new unit-test suite.

Before and after `REQUIRE_PG=1 bun run sim --only slop --only friends`: all 56 blocking gates pass,
with the same nine tracked metrics off target. Typecheck passes. No model is called.
Logs: `runs/audit/gini-before.log`, `gini-after.log`, `gini-numeric-before.log`,
`gini-numeric-after.log`, and `typecheck-gini.log`.

Alternatives were sharing only the two exact copies or making the simulators import engine policy.
The first leaves three copies; the second couples a basic statistic to engine policy. A leaf core
module gives every existing caller the same mathematical definition without a policy dependency.
The reported gate output is unchanged except timing and raw fingerprints, which include the changed
floating-point representation: slop `17120ad1dac399a1` -> `445afd705328fe54`, friends
`fb2abeda7169b765` -> `e5bf70e069eaa7e9`. No golden expectation or threshold was changed.

## Observatory uses shared payload types

The browser store now reads `JudgeStats` directly from `ObsStats`, instead of a second partial type
and a cast. Its opportunity alias uses the server's `ObsOpportunity`. Removed the optional `wants`
payload branch: no server projector or source emits that field. Member requests still display their
existing requester objective. The default app order imports core's browser-safe app IDs.
No rendered copy, layout, or supported server payload changes.

The root `typecheck` command now runs the existing Observatory TypeScript configuration too.
Compiler file inventories confirm it adds nine UI TSX files and `held-photo-ui.test.tsx` that the
old command omitted. All three configurations pass. The Observatory browser bundle builds.
The app and held-photo HTTP/DOM integration files pass 15 tests and 175 assertions.

Evidence: `runs/audit/observatory-types-before.log`, `typecheck-observatory.log`,
`observatory-shared-after.log`, `observatory-build.log`, `root-type-files.txt`, and
`observatory-type-files.txt`. The browser bundle is a build check, not a visual acceptance claim.
Alternatives were adding the unsupported field to the server type or retaining the cast.
The first invents a payload; the second conceals drift. The browser now follows the existing server types.

## Matching reads the canonical age floor

A failed app-row update can leave a member age at 30 after the person age commits as 16.
The existing retry repair closes this gap only when another age statement arrives. Before that
retry, the matching snapshot still used 30. The real Postgres failure-injection case now reads the
snapshot before retry: it failed with expected 16, received 30, then passed with this change.
This is a matching-input defect; it does not prove a minor received a message past the separate
send-time fence.

Migration 0038 adds a service view with invoker permissions and app-specific console views.
The snapshot uses the lowest of member age, person age, and retained phone age floor. A missing
age stays unknown. App roles can read only their own matching-age view; the cross-app role cannot
read these views. The person summary still intentionally reads its existing lowest-age field.
The console's existing SQL adapter now selects both app-scoped blocks and age views.

The role integration case checks a phone floor of 15 with a person record of 16 and member record
of 30, access to each permitted view, and denial of other-app and raw age-floor access. The grant
inventory runs after reapplying the baseline schema, so a later baseline run must not reopen
these views. Existing console parity cases also cover members without linked people.

Alternatives: make every age write and network hook one transaction, or rely on retry reconciliation.
The first requires a wider change to the account-store and runtime transaction boundaries. The
second leaves an unsafe matching input until a retry. Reading the canonical floor keeps matching
safe during that gap without changing the service wire contract.

Evidence: runs/audit/snapshot-age-before.log, snapshot-age-after.log, snapshot-age-roles.log,
integration-age-floor.log, and typecheck-age-floor.log. The first role-test run found that the
person-summary role intentionally reads platform.people; its original assertion was too broad.
The final assertions preserve that existing feature while testing the new view boundaries.

Validation: all three TypeScript configurations pass. The full integration run finished with
577 passes and one failure: the catalog allowlist had not yet named the new app-specific views.
After adding those exact views to the allowlist, both affected migration suites pass:
16 tests, 142 assertions, no failures (runs/audit/age-floor-catalog.log). No application logic was
changed after that full run except renaming the local SQL adapter to appSnapshotSql. A final
whole-tree integration run remains part of audit closeout.

## Remaining unused inputs and reads

The strict unused-symbol compiler pass now passes. Removed the unused plan-probe timestamp and
updated both callers, the unused threshold label input, the unused persona prompt context input,
an extra oracle lookup, an unused hidden-truth read, a redundant relay clock read, an unused import,
and unused callback bindings. Required callback positions use an underscore name. No prompt text,
classification formula, or member-facing text changed.

An initial broad edit also removed bindings used by other callbacks and missed a caller in scripts.
TypeScript caught those errors; they were repaired before the clean unused-symbol result. The
corrected full typecheck passes (runs/audit/typecheck-final-corrected.log). The discarded first
typecheck log is not passing evidence. The e2e run with Playwright enabled passes 45 tests and 680
assertions. Four site builds, plugin snapshots, and the upstream contract mirror check pass.
Full simulation and integration are still running; these results also precede the newly merged
website-account removal in main c729bb2, which must be incorporated before closeout.

Alternatives were retaining unused bindings or enabling repository-wide unused errors immediately.
The first leaves misleading inputs; the second changes enforcement policy beyond this cleanup.
This change removes proven unused work without adding a new test policy.

## Shared type ownership

An AST scan of tracked production TypeScript interfaces and object type aliases with at least
three members found four exact field-shape pairs. Three describe the same contract and now share
an owner: OpenOpportunity in core (engine re-exports it; the simulator retains its alias),
MemberParticipation in a browser-safe platform type module (the site retains Participation),
and app-world GateResult in the simulator's apps directory (both app import paths still export it).

The fourth pair is intentionally distinct: core LocalParts numbers weekdays Monday-first,
while simulation LocalParts numbers them Sunday-first. Sharing that type would obscure different
semantics. The post-change scan finds only that pair. This scan covers exact field shapes, not
all semantically similar types. All three TypeScript configurations pass.

Evidence: runs/audit/duplicate-types.ts, duplicate-types.jsonl, duplicate-types-after.jsonl,
and shared-types-check.log. Alternatives were importing engine types into the generic snapshot
builder or keeping duplicate wire declarations. The shared owners retain dependency direction
and give producers and consumers one declaration. These edits erase at compile time.

## Staff safety reads fail visibly

The cross-app person view caught both state-query failures and substituted an empty array.
With both views unavailable, the HTTP summary still returned 200 and removed the held-person
marker. The real Postgres/HTTP regression failed before the fix (expected 500, received 200).
It now checks both summary and app panel failure, restores the views, and checks that the
restricted marker returns.

The person view now reads the migrated cross-app view directly. SQL failures reach the existing
sanitized HTTP error handler. There is no fallback to the broad legacy view or empty safety state.
The full app-console integration file passes 14 tests and 133 assertions. Typecheck passes.
Logs: runs/audit/people-failure-before.log, people-failure-after.log, typecheck-refreshed.log.

Alternatives were retaining the old view fallback but throwing on its failure, or adding a second
"unknown" safety-state representation throughout the UI. The first still hides a broken current
schema; the second adds a state that the existing HTTP error path already represents. The migration
is required on local and hosted databases, so the direct query is both simpler and accurate.

## Latest base and validation boundary

The branch is rebased onto main c729bb2 (#104), including the founder's removal of the standalone
website account portal. No conflict resolution was needed. The full simulation run finished:
328/329 blocking gates, with one friends plan-probe failure caused by the caller corrected during
the earlier run. The other blocks passed. Only the affected friends block and the main-change
safety/audit blocks are rerun; no second full simulation is launched.

The mixed-revision integration run finished 576 pass / 2 fail: both photo-relay failures used the
binding corrected during that run. Their corrected suites pass 26 tests / 467 assertions. A fresh
full integration run is in progress on the rebased source. Rebased e2e including browser cases
passes 45 tests / 676 assertions. These are local controlled-service tests, not hosted agent-client
acceptance. The user explicitly deferred hosted agent-client checks on 2026-10-19 ("skip it for now please"). They are not claimed as passed.

Rebased local results on c729bb2: full integration 578 pass, 0 fail, 12091 assertions across
61 files (126.53 seconds); e2e including browser cases 45 pass, 0 fail, 676 assertions. Refreshed
friends, safety and audit blocks: 51/51 blocking gates pass, one tracked metric off target.
Together with the unaffected blocks from the full run, all 329 blocking gates have passed.
The full run's 14 tracked off-target metrics remain research targets, not passing quality claims.
The final duplicate-function scan reports no exact bodies at its 180-character threshold; the
unreferenced-source scan lists only the same six documented command-line entry points.

The latest main adds #105 (Text Eliza app-specific links). It changes only site entry points and
site build/tests. The branch is refreshed again; site checks will be rerun. Removed one unused
callback input introduced by #104. Strict unused-symbol checks pass after that cleanup.
Hosted agent-client checks are deferred at the user's request. Real provider billing cost was
not recorded by the bounded LLM run; no zero-cost claim is made.

## Final local checkpoint

Base: main c9d2ec9. After that site's-only refresh, site integration passes 85 tests / 1310
assertions, browser-enabled e2e passes 45 tests / 676 assertions, the audit block passes 16/16,
and all TypeScript configurations pass. The last full integration run on c729bb2 passed all
578 tests; the subsequent upstream change touched sites only and those tests are repeated here.
AGENTS.md and CLAUDE.md remain byte-identical. The final diff has no whitespace errors.
Logs: sites-main-105.log, e2e-main-105.log, audit-main-105.log, typecheck-main-105.log.

The unused-symbol and duplicate-body candidates are resolved. Six standalone source roots remain
because they are documented CLIs. The local-time type pair remains distinct because weekday
numbering differs. The judge's independent quiet-hour window calculation remains independent:
sharing an implementation with the system it grades would weaken that check. Production defaults,
intentional simulation baselines, fitted-weight placeholders required by the founder, and real
deployment commands were not removed merely because they differ from local test code.

The full evidence includes real Postgres, routed HTTP, controlled browser flows, deterministic
simulations, and a bounded real-LLM run. Hosted agent-client checks are explicitly deferred by the
user. No production or live-message acceptance claim follows from these local results. Hosted CI
for the submitted head is pending when this checkpoint is written.

## Review repair: repeat signup below the join minimum

The repeated-join path recorded a lower age but returned a successful membership even for age 12.
It now applies the existing join-age policy after recording the floor. A later claim of age 30 still
receives `under_age`; it cannot raise the floor. Existing membership and consent are not recreated.

Before: the added real-Postgres case expected HTTP 400 and received 200.
After: `bun test --conditions eliza-source --timeout 120000 packages/network/test/service-platform.test.ts`
passes 19 tests with 224 assertions. The case verifies a 30 to 16 to 12 age correction, a later 30
claim, and unchanged consent-event count. This is deterministic API/database evidence, not a model run.

Alternatives: rejecting before recording the age loses the safety floor; accepting an idempotent join
without applying the minimum incorrectly reports signup success. No production records or messages changed.
