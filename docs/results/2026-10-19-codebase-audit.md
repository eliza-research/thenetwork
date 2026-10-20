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
| Current-main integration, e2e and build checks | In progress |

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
