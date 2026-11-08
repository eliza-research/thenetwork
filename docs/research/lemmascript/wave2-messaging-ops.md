# LemmaScript wave 2: messaging-ops

Hand-written. Tools: lsc 0.6.6 and Dafny 4.11 through the throttled shim. No LLM calls. Base: a0ed7bc. Every number below is from a real run.
Scope: the messaging-ops report, and the observatory and judge items the coordinator added from coverage-gaps.md.

## Proved files

Each file has 0 `assume`, 0 `havoc`, 0 `extern` and 0 `{:axiom}`. Only `credit.dfy` has proof additions (2 asserts).

| File | lsc result | Production call site | Mutation (error reported) |
|---|---|---|---|
| packages/blooio/src/gate.ts | 7 verified, 0 errors | `OutboundQueue.dispatch` (`preCapGate`, `takesSlot`, `finalGate`), `end` (`isNotSent`), `applyStatus` (`nextStatus`), `NOT_SENT` shim | 6 mutations, each gives an error: no leak step, no cap step, no STOP step, no `pass` re-check in `finalGate`, `failed_unknown` added to `isNotSent`, `<=` changed to `<` in `nextStatus` |
| packages/blooio/src/quiet-window.ts | 5 verified, 0 errors | `isQuietAt`, `nextAllowedAt`, sim `inHourWindow` (judge and personas) | `end - mins - 1`: 2 errors |
| packages/blooio/src/blooio/client.ts | 1 verified, 0 errors, in place | `classifyFailure` as shipped | Conversation code changed to `retryable`: 1 error |
| packages/notify/src/decide.ts | 6 verified, 0 errors | `Notifier.plan` (`capFilter`), `Notifier.build` (`countsTowardCap`), `resolveDelivery` (`explicitRoute`) | `>=` changed to `>`: 1 error. Ignored-streak step removed: 1 error |
| packages/capital/src/credit.ts | 13 verified, 0 errors | `CapitalLedger.credit` (`creditAmount`, `catMultOf`), `effortTier` (`tierOf`), `vouchCapacity` (`capacity`), `organizingReach` (`reachOf`) | Tier 4: error. No room check: 2 errors. `v.max + 1`: error |
| packages/observatory/src/staff-roles.ts | 5 verified, 0 errors | `rolesFor`, `allowed`, `hasEverywhere`, `canCrossApp` | Engineer counts in real mode: 1 error |
| packages/observatory/src/console-gate.ts | 3 verified, 0 errors | `ageView`, `minorAt` (`consoleMinor`), `loginProblem` (`loginVerdict`), `deployGuard` (`deployVerdict`) | Record-age step, superuser step and remote step removed: each gives errors on its `ensures` |
| packages/observatory/db/numbers.ts | 2 verified, 0 errors | `checkNumbers` (`dupAt`) | Duplicate return removed: 1 error (loop invariant) |
| packages/sim/src/judge/predicates.ts | 6 verified, 0 errors | `computeMetrics`: `over_budget`, `two_unanswered`, new `person_cap` | Re-engagement without the once-only check: 1 error |

The mutations ran on copies in the scratchpad. A copy has no .dfy additions, so the credit copies also show the known error at the `base` bound. Each named mutation adds its own error. "N verified" counts Dafny obligations; the mutation shows that a spec has force.

### How the composition is proved

`capTake` is a side effect between the gates. So `dispatch` calls `preCapGate`, then takes the slot, then calls `finalGate`. `finalGate` runs `preCapGate` again on the same facts. Its `ensures` cover the whole chain of steps 0 to 10 and do not depend on the order of the calls in `dispatch`:

- `send` implies not expired, not stale, and live.
- `send` implies leak clean or released by staff.
- `send` and not compliance imply not opted out and recipient ok.
- A reply has a recent inbound.
- An agent-initiated row has a valid zone and is not in quiet hours.
- A proactive row took a slot, through `takesSlot`.
- The send is under the caps.
- A row over the streak passes only as the one re-engagement.
- The line is not in review.

`takesSlot` proves that a row an earlier step stopped never takes a slot. A row that a gate refuses gets the gate's own answer (`preCapGate(f).tag !== "pass" ==> result === preCapGate(f)`). `decideGate` is not shared with the judge. The judge shares only `isQuietMinute` and the window and streak predicates, with its own limits (PRD_BUDGETS, PRD_PERSON_DAILY_CAP = 3).

Behavior change from the extraction: `dispatch` now reads every fact before it decides. A row that an early step stops therefore reads more facts than before, at most 2 SQL reads and the hooks. The hooks are read-only: `rt.optedOut`, the recipient `policy`, `queuePolicy`/`stillNeeded`, `notificationCurrent`. The decisions and their order did not change.

## Defects fixed (fail-closed), each with a case that failed first

| Defect | Fix | Case | Before the fix |
|---|---|---|---|
| 16: one bad photo row stops the drain of the app | `rowOf` moved into the `try`. `shellOf` (no photo parse, never throws) for `expireHeld`, `reconcileUnknown`, `applyStatus`, `decideLeak` | outbound-queue.test.ts "one row whose stored photos do not parse..." | "Invalid persisted approved photos" thrown from `drain`. The bad row also made the 2 later tests in the file fail. |
| messaging-ops 3: `stale` fails open | `guarded(stale, true)` (the comment already said fail closed) | "a stale hook that throws fails closed..." | Expected "expired", received "sent" |
| journeys B8: `failed_unknown` releases a cap slot | `NOT_SENT` regex replaced by `isNotSent` over a closed `OutboundStatus` union. An unknown status keeps its slot. | "a row whose acceptance stayed unknown keeps its person-cap slot..." | `capRelease` was called for `cap-unknown` |
| messaging-ops 5: `Notifier.dispatch` aborts the tick | A person erased between `plan` and `dispatch` is cancelled; the others go | wiring.test.ts "a person erased between plan and dispatch..." | Fail (build of undefined) |
| messaging-ops 9: a .sql file with a bad name is skipped with no error | `numberedFiles` refuses it | migrations.test.ts "the migration runner" | Fail (not refused) |
| coverage-gaps 1: an analyst gets member names through opportunity events | The counts view maps events to `{t, type, text: type}` | staff.test.ts (security suite), analyst opportunity detail | Fail: 91 lines of named events |
| coverage-gaps 2: the console login check fails open | A check query that throws refuses the source and closes the connection | real-fixes.test.ts "a login that cannot be checked is refused..." | Fail: with a0ed7bc real.ts the source went on to `load()` on the unchecked login and the test timed out after 300 s |
| coverage-gaps 4: `ageView` above 120 says adult and disagrees with `minorAt` | Both call `consoleMinor` with core's `isMinor` | real-fixes.test.ts age case (200) | Fail: ageView(200) was `false` |
| coverage-gaps judge: no person cap rule | Judge rule `person_cap`, 3 in any 24 hours, check-ins excluded | packages/sim/test/judge.integration.test.ts | Fail: rule undefined |
| coverage-gaps 6 (part): `minor_reported` does not flag a member for the judge | Added to the flagging kinds | same file | Fail: 0 minor contacts |

Also added: `localMinutes` throws on a value outside 0 to 1439. Before, NaN read as "not quiet". No input that reaches it can fail today, so this change has no failing case. It is the runtime backing of the `requires` of `minutesUntilAllowed`. `ledgerProblems` (packages/capital/src/levers.ts) is a run-time check of reversal conservation. It runs as a blocking gate in the capital block (scripts/sim/capital.ts, as the coordinator asked) and passes on 4 quick seeds.

## Runs (with heavy)

- `lsc check` on each of the 9 files: the numbers in the table, 0 errors.
- `bunx tsc --noEmit -p .`: no error in blooio, notify, capital, observatory, sim or scripts/sim/capital.ts. Errors that other areas had during the run were in engine, mcp and network files.
- `bun run sim --only pipeline`: 15/15. `ops`: 11/11. `safety`: 17/17. `audit`: 16/16. The first audit run crashed with a Bun SIGTRAP; the rerun passed. `network`: 61/61. The first run failed 1 trust gate; that gate reads network logs only, and it passed on the rerun after the other areas finished. `capital --quick`: 2/2 blocking, including the new ledger gate.
- outbound-queue.test.ts 8/8. notify wiring 8/8. store-contract 10/10. migrations 7/7. staff 18/18. staff-apps 9/9. judge.integration 2/2.
- real-fixes.test.ts: the 4 non-Postgres cases pass, and so does the new login case. 5 Postgres cases fail because the source's `load()` fails ("Could not read the network schema: Failed to read data"). The same failure happens with real.ts from a0ed7bc ("bind message supplies 2 parameters, but prepared statement ... requires 1"), so this change did not cause it. I did not find the cause; it is in a load query or in the test schema.
- Before evidence: the queue, notify, migration, staff, age and judge rows in the table above show the failures before the fixes, run against a0ed7bc versions of the changed files.

## Skipped, and why

- `liveSendAllowed` (candidate 3): the network-service area owns channel.ts.
- Bug 2 (the per-recipient hourly cap does not count ended rows to non-members): the fix keeps an address or a hash of it after the row ends. That is a retention decision for the founder.
- Bug 4 (`sent_at` on a provider "failed" receipt): it can only over-count, so the current behavior is already fail-closed.
- Bug 6 (weekly cap not atomic, `until` hint): concurrency, which is out of scope. The hint changes no send.
- Bugs 7, 8, 10: founder or retention questions, as the area report says.
- Dead code (`dedupeKeysFor`, `isE164`): no safety effect. Removal is left to the owner.
- Judge `flaggedMinor` clear on `age_resolved` (coverage-gaps bug 6, first half): the fix would loosen the judge, not make it fail closed. Reported, not changed.
- Coverage-gaps bugs 3 (wrangler.sh), 5 and 8: not in this area.
- `viewClass`, `dueAt`, `parseGrant`: one-liners of little value.

## Changes needed in files I do not own

- packages/network/service/runtime.ts:592 and scripts/sim/pipeline.ts:309 use `NOT_SENT.test(status)`. It now calls `isNotSent` through a shim object. The owners should import `isNotSent` and drop the shim.
- `package.json` `test:integration` already covers packages/sim/test/judge.integration.test.ts (it runs ./packages).
- LemmaScript-files.txt: 9 lines appended.
- trust.json: 0 for each count in these files.

## What the proofs do not cover

- Every fact in `GateFacts` is trusted. The proof says what the gate does with a fact, not that the fact is true.
- `capTaken` is true when a queue has no `capTake` hook. A member with no `person_id` gets an uncapped slot in SQL (founder item).
- `capacity` and `reachOf` model the config as integers. `isQuietMinute` is modelled on integers, and the judge calls it with fractional minutes. Daylight saving, NaN and rounding are outside the proofs.
- The collected-reply seam does not run `dispatch`.
- The SQL fences (the admission transaction, `person_cap_take`, the line caps' counts) stay with the integration tests and the pipeline block.
