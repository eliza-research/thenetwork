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
No real LLM, paid rater, live message, deployment, or real agent-client run has occurred in this audit.
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
