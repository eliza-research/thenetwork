# LemmaScript research: messaging-ops

Scope: packages/blooio, packages/notify, packages/capital, packages/observatory/src, packages/observatory/db, packages/sim/src, scripts/.
Commit a0ed7bc. Hand-written. Tools: lsc 0.6.6 and Dafny 4.11 through the throttled shim.
All experiments are in `/private/tmp/claude-501/-Users-nubs-thenetwork/71ebb7fb-9e02-4dbf-b300-9c31fec118b5/scratchpad/research/messaging-ops/`. No repository code changed.

Short result: the queue, notify and staff decisions are good targets after small extractions. 12 trial files verify with 0 errors. The proved cores cover one send seam only: the queue. The collected-reply seam (docs/research/lemmascript/journeys.md) does not run `dispatch`, so a proof here says nothing about it. SQL-side limits (caps, leases, advisory locks) stay out of reach of LemmaScript. Integration tests and the pipeline block must keep those.

## 1. Files reviewed

Verdicts: PROVE (annotate in place), EXTRACT (extract a pure core that production calls, then prove), MODEL ONLY, N/A (not applicable).
"Read" means read in full. "Skimmed" means I read the header and the exported functions, not every line. Skimmed files are all simulator or tooling files, except where the line says otherwise.

### packages/blooio

| File | Verdict | Why |
|---|---|---|
| src/outbound-queue.ts | EXTRACT | `dispatch` mixes SQL and decisions. Extract the gate chain, `isAgentInitiated` (PROVE), and the status transition from `applyStatus`. Trials 1 and 4. |
| src/quiet-hours.ts | EXTRACT | `Intl` is out of the fragment. The minute arithmetic is pure. Trial 2. |
| src/blooio/client.ts | PROVE (`classifyFailure` only) | Body verifies unchanged, sets included. Trial 8. `readErrorBody` and `send` do I/O: N/A. |
| src/blooio/webhook.ts | N/A | HMAC, regex and `JSON.parse` of unknown data. The `security` tests and the pipeline block cover it. `dedupeKeysFor` has no callers (section 3). |
| src/phone.ts | N/A | Regex and `normalize("NFKC")`. High value (bans key on it) but blocked. Use a corpus gate. |
| src/line.ts | N/A | Reads env, thin wrapper over `toE164`. |
| src/types.ts | N/A | Types and an error class. |
| src/index.ts | N/A | Re-exports. |
| src/adapters/blooio-adapter.ts | N/A | I/O wrapper. Dry-run is structural. |

### packages/notify

| File | Verdict | Why |
|---|---|---|
| src/scheduler.ts | EXTRACT | Async class. Extract the weekly cap filter and `countsTowardCap`. Trial 6. `dueAt` is simple: PROVE if wanted. |
| src/surface.ts | EXTRACT | `new Map(signals.map(...))` and `localeCompare` sort block the whole function. Extract the explicit-choice branch. Trial 12. `score` is arithmetic with no useful property. |
| src/links.ts | N/A | `URL`, regex. Small runtime guard already. |
| src/tokens.ts | N/A | Regex, random. I compared `ALPHABET` with `TOKEN_PATTERN` by hand: they agree. |
| src/compose.ts | N/A | Text assembly. Property is "no name in link", which is by construction. |
| src/store.ts | MODEL ONLY | `MemoryNotifyStore` is a test double of the Pg store. Not worth a proof. |
| src/pg-store.ts | N/A | SQL. |
| src/wiring.ts | N/A | Adapters. |
| src/types.ts, src/index.ts | N/A | Types, re-exports. |
| db/schema.sql, db/retention.sql | N/A | SQL. `forget_data` and triggers are covered by notify-retention.pg.test.ts. |
| scripts/link-test-page.ts | N/A | One-off page writer. |

### packages/capital

| File | Verdict | Why |
|---|---|---|
| src/ledger.ts | EXTRACT | Class with `Map`, `Object.freeze`, template ids. Extract the amount and the two multipliers. Trial 7. Reversal conservation: see "What not to verify". |
| src/levers.ts | PROVE plus EXTRACT | `effortTier` in place (trial 9). Lists and `Set` of reversals are in the fragment but the clamp is the only useful part: extract `capacity` and `reachOf`. |
| src/detect.ts | N/A | Graph code (Tarjan, union-find), Map iteration, sort. Output goes to a human reviewer. No safety property. |
| src/validate.ts | N/A | `typeof` over `unknown` on every line. |
| src/config.ts | N/A | Object merge and `Object.entries`. Runtime range checks are the right tool. |
| src/view.ts | N/A | Copy. |
| src/store.ts | N/A | File I/O. |
| src/types.ts, src/index.ts | N/A | Types, re-exports. |
| experiments/run.ts, experiments/world.ts | N/A | Harness (skimmed). |

### packages/observatory/src

| File | Verdict | Why |
|---|---|---|
| staff.ts | EXTRACT | `rolesFor`, `allowed`, `canCrossApp` trial 5. `parseGrant` uses `.includes`, could be PROVE later. JWT verification (`AccessVerifier`) is crypto: N/A. |
| shape.ts | PROVE (`viewClass` only) | One expression on a set. `stripOracle` and name masking use spreads and regex: N/A. |
| apps.ts | N/A | Registry and env parsing. |
| appProfile.ts | N/A | Regex on facet tags. `photosAllowed` depends on `validAge` (core agent). |
| scrub.ts | N/A | Regex. Test with corpora. |
| health.ts | N/A | Alert and scorecard arithmetic (read in part). It reports minor contacts and leaks but enforces nothing. |
| scoring.ts | N/A | Game scoring, not a safety path. |
| projector.ts | N/A | Event projection for a dashboard (read the first part and the export list only). |
| events.ts, types.ts | N/A | Labels, types (export lists only). |
| server.ts | N/A | HTTP routes (read header, auth and origin parts). Route role checks call `allowed`. |
| store.ts, engineCapture.ts, runDiff.ts, ops.ts, people.ts, takeover.ts, report.ts, lab.ts | N/A | Dashboard state, SQL or simulator control. `lab.ts` read in part: `labEnv` is an allow list that keeps keys out of child runs. `store.ts`, `engineCapture.ts` and the end of `people.ts` were not read line by line. |
| sources/source.ts, sources/real.ts, sources/game.ts, sources/service.ts | N/A | SQL read paths, game driver, staff API proxy. Partly read: header, reveal rules and auth headers. `game.ts` by export list only. A later reader should not treat these as line-reviewed. |

### packages/observatory/db

| File | Verdict | Why |
|---|---|---|
| migrate.ts | EXTRACT | `checkNumbers` is the stated repo rule. Trial 10. The rest is SQL. |
| dev-pg.ts, seed.ts, writer.ts | N/A | Dev tooling (skimmed). |
| schema.sql | N/A | SQL. |
| migrations/0003 to 0041 (0003, 0004, 0005, 0006, 0007, 0010, 0011, 0012, 0014, 0015, 0020, 0021, 0022, 0023, 0024, 0025, 0026, 0030, 0031, 0032, 0033, 0034, 0035, 0036, 0037, 0038, 0039, 0040, 0041) | N/A | SQL. LemmaScript has no SQL model. 0007 `person_cap_take` and 0012 `person_cap_release` carry the person cap; I read those two and 0015 in full, the others by header line. They are one row here because the verdict is the same for each. |

### packages/sim/src (skimmed unless noted)

| File | Verdict | Why |
|---|---|---|
| judge/metrics.ts | EXTRACT (small) | Read the invariant part in full. `over_budget` window, `two_unanswered` streak and `inWindow` can use proved predicates. Trial 11. The rest uses regex and persona state. |
| time.ts | EXTRACT (small) | `inHourWindow` is a third copy of the quiet window test. |
| judge/rules.ts | N/A | Read. Regex only. |
| judge/llmJudges.ts | N/A | LLM calls. |
| scheduler.ts | MODEL ONLY | Read. Binary heap is provable but it is a harness. No payoff. |
| channel.ts | N/A | Read. Simulated bus. |
| stubNetwork.ts | N/A | Baseline with no review or leak check, by design. |
| world.ts, cli.ts, index.ts, network.ts, engineAdapter.ts, scenario.ts, snapshot.ts, plans.ts, oracle.ts, persona.ts, generator.ts, llmGenerator.ts, sources.ts, taxonomy.ts | N/A | Simulator, hidden truth, personas. A proof of the harness proves nothing about production. |
| agent/policy.ts, agent/llmAgent.ts, agent/availability.ts, agent/types.ts | N/A | Persona behaviour. |
| apps/README.md, apps/gates.ts | N/A | Docs and one interface. |
| apps/slop/: adversarial, baselines, behavior, bodyType, clefSynth, cli, enginePack, geo, metrics, oracle, packEval, persona, relay, snapshot, visible, world | N/A | App world harness. |
| apps/peon/: arms, audit, baselines, cli, gates, metrics, oracle, persona, skills, snapshot, world | N/A | App world harness. Gates are float thresholds on measured data. |
| apps/friends/: arms, baselines, cli, gates, metrics, oracle, packMatcher, persona, snapshot, visible, world | N/A | Same. |

### scripts (skimmed unless noted)

| File | Verdict | Why |
|---|---|---|
| sim.ts, sim/gate.ts | N/A, integration point | Read. See section 4 for the `formal` block. |
| sim/pipeline.ts, sim/pipeline/harness.ts, sim/safety.ts, sim/ops.ts, sim/audit.ts | N/A | These gates run the cores proposed here, so they back up each proof. |
| sim/conformance.ts, sim/network.ts, sim/peon-seats.ts, sim/relay.ts, sim/slop.ts, sim/slop-live.ts, sim/clef.ts, sim/evals.ts, sim/peon.ts, sim/friends.ts, sim/onboard.ts, sim/capital.ts | N/A | Gate blocks. |
| clef-fit.ts, relay-eval.ts, relay-clef-lib.ts | N/A | Operator CLIs. |
| platform-dev.ts, sites-dev.ts, require-pg.ts, check-contract-mirror.ts | N/A | Dev tools. `require-pg.ts` is the pattern to copy for `REQUIRE_DAFNY`. |
| wrangler.sh, inspect-network-backend.py | N/A | Not TypeScript. |
| synthetic/: common, generate, load, names, validate | N/A | Dataset tools. |

## 2. Candidates ranked by value

Results are from real `lsc check --backend=dafny` or `dafny verify` runs. A "VC" count below is the number Dafny printed as verified.

### 1. Queue send gate. packages/blooio/src/outbound-queue.ts:364-435, `dispatch`. EXTRACT `decideGate`

- Property: a row reaches the provider only if it is not expired, the live flags are on, the leak guard is clean, and (not compliance) the person has not opted out and the recipient check passed. A reply needs a recent inbound. Agent-initiated kinds need a valid zone and not quiet hours. Proactive needs a person-cap slot. Caps hold. A row over the unanswered limit passes only as the one re-engagement.
- Sketch:
  ```
  //@ ensures \result.tag === "send" ==> !f.tooOld && !f.stale && f.live && f.leakClean
  //@ ensures \result.tag === "send" && f.kind !== "compliance" ==> !f.optedOut && f.recipientOk
  //@ ensures \result.tag === "send" && isAgentInitiated(f.kind) ==> !f.quiet && f.zoneValid
  //@ ensures \result.tag === "send" && f.kind === "proactive" ==> f.capTaken
  //@ ensures \result.tag === "send" && f.kind !== "compliance" && f.hasConv && f.unanswered >= f.maxUnanswered ==> isAgentInitiated(f.kind) && !f.reengagementUsed && f.quietForEnough && \result.reengagement
  ```
- Protects: STOP, leak check on every outbound, person cap, consent, dry-run. Journey: every queued send.
- Blockers: async hooks, and `capTake` is a side effect in the middle of the chain. All facts cannot be read first, or a refused row would take a slot. Split into `preCapGate(facts)`, then `capTake`, then `finalGate`, and prove the composition. Keep `leakReleased` as an explicit fact, so the spec says "clean or released by staff". The admission transaction in `send` stays SQL.
- Effort: M. The extraction changes the shape of the most sensitive function. Run `bun run sim --only pipeline` and the queue test.
- Trial: `dispatch.ts`, flat version. 2 verified, 0 errors. Mutation: with the leak and person-cap steps removed, 2 errors, one on each matching `ensures`. The spec has force.
- Limit: this is the queue seam only.

### 2. Quiet hours. packages/blooio/src/quiet-hours.ts:33-51. EXTRACT `isQuietMinute`, `minutesUntilAllowed`

- Property: the wait is 1 to 1440 minutes, every minute before it is quiet, and the minute it lands on is not quiet. For any window, wrapping or not.
- Sketch:
  ```
  //@ requires 0 <= w.startHour && w.startHour < 24 && 0 <= w.endHour && w.endHour < 24
  //@ requires 0 <= mins && mins < 1440 && isQuietMinute(mins, w)
  //@ ensures 0 < \result && \result <= 1440 && !quietAfter(mins, \result, w)
  //@ ensures forall(k: number, 0 <= k && k < \result ==> quietAfter(mins, k, w))
  ```
- Protects: PRD 32.2 quiet hours. Also used by notify and the judge.
- Blockers: `Intl` stays outside, so DST is not proved. `localMinutes` needs a runtime range check (section 4). The `forall` over `%` needs a named helper `quietAfter` plus a small companion proof in the `.dfy` file.
- Effort: S.
- Trial: first attempt 2 verified, 1 error (no trigger). With `quietAfter` and the companion proof: 4 verified, 0 errors.

### 3. Live gate. packages/network/service/channel.ts:94, `liveSendAllowed`. PROVE, one-token edits

- Property: true only with `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and the app's own flag.
- Sketch: `//@ ensures \result ==> env["BLOOIO_ALLOW_SEND"] === "1"`, the same for the other two.
- Blockers: `env.X` on a Record does not generate valid Dafny; use `env["X"]`. `Record<string, string | undefined>` gives a type error in specs, so the trial used `Record<string, string>`. That signature does not accept `process.env`, so the implementer must keep the shipping type (look at `//@ type` overrides in SPEC.md section on type aliases) or add a thin wrapper. Default arguments were removed for the trial.
- Effort: S. This file is in the network-service area; coordinate with that report. `deploy/backend/backend.ts:145` has a second copy of the first two flags. The queue re-checks `live()` at send time, so that copy does not weaken the gate.
- Trial: `live.ts`. 4 verified, 0 errors, after two failed attempts (the blockers above).

### 4. Delivery status. packages/blooio/src/outbound-queue.ts:612-632, `applyStatus`. EXTRACT `nextStatus`

- Property: a status never goes back. `read` and rows that did not go out never move. A failure only hits an in-flight row.
- Sketch: `//@ ensures \result.tag === "advance" ==> rank(cur) >= 1 && updateRank(\result.to) > rank(cur)`
- Protects: receipt ordering (a late receipt), which drives cap release.
- Blockers: `Record` rank table becomes a `switch`. A union tag `"none"` collides with `Option.None`; the trial used `"ignore"`. A const arrow helper must be a `function` with `//@ verify`.
- Effort: S.
- Trial: `status.ts`. 3 verified, 0 errors.

### 5. Staff roles. packages/observatory/src/staff.ts:180-202, `rolesFor`, `allowed`, `canCrossApp`. EXTRACT `roleCounts`

- Property: `cross_app_safety` never counts as a per-app role. `engineer` counts for nothing in real mode. A grant for another app counts for nothing. `canCrossApp` needs admin@* or cross_app_safety@*.
- Sketch: `//@ ensures \result && mode === "real" ==> g.role !== "engineer"`, `//@ ensures \result ==> g.app === "*" || g.app === app`
- Protects: PII access, dating membership privacy (PRD 40.3).
- Blockers: `u.grants ?? u.roles.map(...)` and the returned `Set`. Move the per-grant test into `roleCounts` and let `rolesFor` call it. Authentication itself (`sameToken`, JWT) is not provable.
- Effort: S.
- Trial: `staff.ts`. 5 verified, 0 errors.

### 6. Notify weekly cap. packages/notify/src/scheduler.ts:439-447, 475. EXTRACT `capFilter`, `countsTowardCap`

- Property: over the cap, only `requested` items remain. A delivery counts iff it has a non-requested item.
- Sketch: `//@ ensures forall(k: number, 0 <= k && k < \result.length ==> \result[k].urgency === "requested" || recent < cap)`
- Protects: PRD 32.9 interruption budget. It does not protect the 3-a-day person cap, which is SQL.
- Effort: S.
- Trial: `capfilter.ts`. 7 verified, 0 errors, first attempt.

### 7. Capital credit amount. packages/capital/src/ledger.ts:404-409. EXTRACT `creditAmount`, `catMultOf`

- Property: amount is at least 0, at most base, and fits the room in the period cap (or is 0). Category multiplier is in (0, 1].
- Sketch: `//@ ensures \result >= 0.0 && \result <= base`, `//@ ensures inPeriod + \result <= periodCap || \result === 0.0`
- Protects: the anti-gaming cap. Not a launch safety invariant.
- Blockers, all real: `number` is `int` unless `//@ type x real` is on each variable. Under `real`, `Math.min` and `Math.max` give a type error (their helpers are `int`). A literal `0` or `0.0` in a real branch is emitted as `int`, so the trial used `0 * base`. `Math.round` is not modelled, so `round()` stays outside and the proof is for the amount before rounding. `base * p * c <= base` needs two companion asserts. An implementer should weigh integer milli-NC instead (3 decimals is already the unit), which removes all of these.
- Effort: M.
- Trial: `credit.ts`. Three failed attempts, then 5 verified, 0 errors.

### 8. Failure class. packages/blooio/src/blooio/client.ts:88, `classifyFailure`. PROVE in place

- Property: conversation codes always wait for the recipient (never a timer retry). The result is never `unknown`.
- Blockers: none. Module-level `const` sets are captured.
- Effort: S.
- Trial: `failure.ts`, body unchanged. 1 verified, 0 errors.

### 9. Capital levers. packages/capital/src/levers.ts:530-577. PROVE `effortTier`, EXTRACT the clamps

- Property: tier in 0..3. Vouch capacity in [0, max]. Reach max at most `r.max`, and reserved slots never negative.
- Blockers: `balance` is a float but is modelled as `int` here. Order comparisons do not depend on that, but it is an argument, not a check. Add `//@ type balance real` when done.
- Effort: S.
- Trial: `levers.ts`. First attempt failed on tuple index bounds; with `length === 3`, 9 verified, 0 errors.

### 10. Migration numbers. packages/observatory/db/migrate.ts:56-66, `checkNumbers`. EXTRACT `dupAt`

- Property: -1 means no two ids share a 4-digit prefix.
- Blockers: `throw` is modelled as unreachable, so return the index and throw in the caller.
- Effort: S. Value is low: `migrate()` runs in many tests anyway.
- Trial: `numbers.ts`. 2 verified, 0 errors, with loop invariants.

### 11. Judge predicates. packages/sim/src/judge/metrics.ts:120, 524-546, packages/sim/src/time.ts:24. EXTRACT `inWindow`, `underBudget`, `stepStreak`

- Property: the window list holds only entries inside the span. The streak allows one re-engagement at exactly 2.
- Protects: the judges that report 0 violations. See section 4 about judge independence.
- Effort: S.
- Trial: `window.ts`. 7 verified, 0 errors.

### 12. Explicit surface. packages/notify/src/surface.ts:55-65. EXTRACT `explicitDelivery`

- Property: a link goes only to an assistant the member has connected and has not ignored twice.
- Blockers: `sig?.active` in a condition gives `Option<bool>`; write `sig !== undefined && sig.active`. Specs that narrow an optional field did not resolve; a helper `connected(sig)` works.
- Effort: S. Value is low.
- Trial: `surface.ts`. Two failed attempts, then 1 verified, 0 errors.

## 3. Bugs

Nothing below was run against Postgres (the brief forbids test runs). Each is from reading the code. A reproduction path is given so a later wave can confirm it first.

1. **Medium. One bad row stops all sends for the app on the line.** outbound-queue.ts:291: `this.rowOf(r)` is outside the `try` at :293, and `rowOf` throws "Invalid persisted approved photos" (:309). The comment at :296 says "One bad row never stops the drain". The same throw is at :325 (`expireHeld`), and at the two `rowOf` calls in `reconcileUnknown`, also outside a `try`. `applyStatus` (:615) would return 500 on a webhook for that row, and `decideLeak` (:723) fails too. `drain` runs `recover`, then `reconcileUnknown`, so a bad `unknown_acceptance` row blocks before `withLine`. Reach: `enqueue` validates, so this needs a parser change between deploys (the wire contract is a mirror that changes) or a manual write. Repro: set `approved_photos='[{"x":1}]'::jsonb` on a pending row, then call `drain()`: it rejects and no other row goes out. Fix: move `rowOf` into the `try`, and park the row by id.

2. **Low to medium. The per-recipient hourly cap does not count delivered rows to non-members.** Line 414 counts `to_address = row.to`, but `end()` (:343) and `applyStatus` (:629) set `to_address` to null when a row with no member ends. The cap is the "runaway-loop guard". A stranger or a bot that writes in a loop gets a reply per message with no cap, because each delivered reply stops counting. The unanswered streak does not help, because `inbound()` resets it each time. Repro: fake provider returns `delivered`, send 11 replies to a non-member with an inbound before each, in one hour: all 11 go, the expected result is 10. Fix: count on a hash kept after the row ends, or add an address hash column that survives the end of the row. Check first whether `platform.inbound` limits this upstream.

3. **Low. `stale` fails open, and the comment says every hook fails closed.** outbound-queue.ts:371: `guarded(() => c.stale?.(row) ?? false, false)`. Line 111: "Every hook fails closed when it throws." With a throw in `notificationCurrent` or in the stage lookup, a message about a closed item goes on to the send. Later gates still apply. Repro: a `stale` hook that throws; the row is sent. Either pass `true`, or fix the comment.

4. **Low. A provider "failed" receipt still sets `sent_at`.** outbound-queue.ts:549 sets `sent_at` for every status, and :570 then ends the row as failed. The row counts in the caps and joins the thread that the leak guard reads (:458), although it did not go out. This can only over-count or over-park.

5. **Low. `Notifier.dispatch` can abort a whole tick.** scheduler.ts:487: `(await this.directory.get(p.personId))!`. If the person is erased between `plan` and this line, and only part of the items are fresh, `build` gets `undefined` and throws. People later in the list wait for the next tick. Nothing is lost.

6. **Low. The weekly cap is not atomic across replicas.** `plan` reads `capSendsSince`, then `recordDelivery` writes later. The README says overlap is safe because "a delivery id is recorded once", but two overlapping plans with different item sets have different ids. A short overlap can send one over the cap. The `until` value at :443 also uses the oldest send, which is wrong when `recent.length > weeklyCap`.

7. **Documented gap, flag to the founder.** The person cap does not apply to a member with no `person_id`. 0007 `person_cap_take`: `if pid is null then continue`, so the id is not refused. The comment in service.ts says this is by design, but the invariant "person-level cap of 3 a day" has no such exception. `this.cap` unset also means no cap (service.ts `capRefused`).

8. **Decision for the founder, shown by the proof.** `decideGate` proves `send ==> safety !== "review"` for every kind, compliance included, and that `reply_only` holds a compliance text to a new address. So a STOP confirmation waits while the line is in review. That matches the code comment for caps, but "compliance texts always go" is true only for step 8. It may be the right behaviour, since sends are paused, but it should be a decision.

9. **Dead code and small mismatches.** `dedupeKeysFor` and `isE164` have no callers outside their own file. Dedupe works by other means (`inbox.receive`). phone.ts:25-26: the 11-digit branch gives the same result as the `else`. types.ts: the comment says `auth` is "401/403", but `classifyFailure` gives `blocked` for 403. migrate.ts:28: a file that does not match the pattern (for example `0042-fix.sql`) is skipped with no error, although the repo rule depends on the runner seeing every file.

10. **Not confirmed, for the retention reader.** I found no `delete from platform.outbound` in packages or deploy. Rows of members keep their text after they end. Check against the retention plan; I did not trace the erasure path.

Checked and found correct: `verifyBlooioSignature` (order, timestamp bound, constant-time compare, empty secret), the person-cap release on every not-sent path (`NOT_SENT` matches all end statuses, and the `person_cap` flag is set before the leak step), idempotent `capTake` (a repeat id is skipped in SQL), `nextAllowedAt` arithmetic, `ALPHABET` against `TOKEN_PATTERN`, minors and unknown ages in the capital ledger (each write path checks `isEligible`), the Clock rule in blooio, notify and capital (`Date` is only used with an argument). `Date.now()` in observatory and `new Date()` in sim/world.ts:137 are console and harness, not network code. `notify` could throw on a bad zone in `isQuiet`, but the only production directory resolves the zone first (service.ts:657).

## 4. Runtime guards and the `lsc check` gate

Keep every runtime check. A proof covers the pure function, not the facts passed in.

| Proved predicate | Keeps or replaces | Runtime backing | Sim gate or test on the same code |
|---|---|---|---|
| `decideGate` | Replaces the `if` chain in `dispatch`. Keep the SQL fences in `send` | `send` admission transaction, `acceptReceipt` conditions | `pipeline` (STOP mid-probe, restart, line safety, unanswered streak), packages/blooio/test/outbound-queue.test.ts |
| `isQuietMinute`, `minutesUntilAllowed` | Backs `isQuietAt`, `nextAllowedAt` | Add a check that `localMinutes` is an integer in 0..1439 and throw if not: NaN today reads as "not quiet", which fails open | `pipeline` quiet hours across a restart |
| `liveSendAllowed` | In place | `checks.live()` at send time | `pipeline` "dry run stays the default" |
| `nextStatus` | Replaces rank logic in `applyStatus` | SQL `status in (...)` conditions | `pipeline` receipts |
| `roleCounts` | Backs `rolesFor`, `allowed` | Route checks in server.ts | packages/observatory/test/staff.test.ts, `ops` deploy guards |
| `capFilter` | Replaces lines in `plan` | Queue caps at send time | packages/notify/test/wiring.test.ts |
| `creditAmount` | Backs `credit` | `capitalConfigProblems`, `validateCapitalEvent` | `capital` block (nightly only, so a capital proof is the only per-PR check) |
| `classifyFailure` | In place | None needed | `pipeline` outage |
| `dupAt` | Backs `checkNumbers` | Throw stays | Every migrated test database |

**Judges.** metrics.ts says the judge does not take the system's word. Using the production `isQuietMinute` in the judge removes that independence for that predicate. A proof is a fair replacement only for pure predicates with a full spec. So: share `isQuietMinute` for `inWindow` and `inHourWindow`, which removes two copies; share `underBudget` and `stepStreak` only if `PRD_BUDGETS` stays the judge's own input. Do not share `decideGate`: the judge must keep grading what went out from the log, because that also catches wrong facts passed to the proved function. Most judge rules are regex or use hidden truth: they stay as they are. The judge rule `two_unanswered` (2) and the queue limit (3) are different rules, so a shared predicate must take the limit as a parameter.

**Gate design** (`scripts/sim/formal.ts`, block name `formal`):

- Manifest: `proofs/manifest.json` lists the TS files. A gate fails if a file holds `//@ verify` and is not listed, or the reverse.
- For each file, `b.run("formal: <file>", ...)` spawns `lsc check --backend=dafny <file>`, one at a time, and fails on a non-zero exit. The one trial I timed took about 1 s under the shim limits (2 cores). The others returned quickly, but I did not time them. This fits the machine-load rule and `--only formal`.
- Companion proofs: keep `.dfy` files out of the source folders (lsc supports a configured root, TOOLS.md line 164).
- Ratchet gate: count `{:axiom}`, `//@ assume` and `//@ havoc` in the proved set against a stored number, so trust can only go down with a review.
- No Dafny: record one tracked "skipped" gate, as the Postgres blocks do. Add `REQUIRE_DAFNY=1` to the `offline` job, extend `scripts/require-pg.ts` or add a sibling, and add `"formal"` to the `IN(...)` list in the "No Postgres gate was skipped" step of ci.yml (line 98).
- Add `formal: b => formalBlock(b)` to `BLOCKS` in scripts/sim.ts and first in `DEFAULT`. The cost is small, and a failure stops nothing else since blocks run in series.
- ci.yml: add a pinned install step before "Simulations": Dafny release binary checked by SHA-256, and lsc as a pinned dev dependency. The CI policy pins actions and images by digest, so a floating install is not acceptable. No network or secret is needed after install.
- Do not use `bun run sim` to prove a mutation. A hand-run mutation like trial 1 belongs in the PR evidence.

## 5. What not to verify, and why

- **SQL limits**: per-line caps (:413-417), `person_cap_take`, leases, the advisory lock, RLS, `notify.forget_data`. LemmaScript has no SQL model. A TS model of them would be the shadow model the brief forbids. Postgres-backed integration tests are the right proof. If they need a formal model, that is TLA+ or Quint work.
- **Rolling windows in SQL**: the `count(*) filter` queries are the sliding windows. The decision on the numbers is covered by `decideGate`; the count is not.
- **Concurrency**: drain serialization, recover racing with a provider call. Out of the fragment.
- **Capital reversal conservation**: the pair "credit plus clawback sums to 0" is one line (`-orig.amount`) guarded by a `Set`. Proving it needs a model of the class with ghost state, for little gain. Add a runtime `ledgerWellFormed(entries)` check to the `capital` block instead: each `reverses` points at one entry of the same member, with an equal and opposite amount, at most once. The balance is a plain sum.
- **Regex-based code**: `phone.ts`, `scrub.ts`, `appProfile.ts`, judge rules, `links.ts`. Use the append-only `evals/` corpora. `normalizeAddress` idempotence is worth a corpus row set because bans key on it. I checked some cases by hand and found no failure.
- **Crypto and parsers**: webhook HMAC, JWT, `parseBlooioWebhook`, `validateCapitalEvent` (`typeof` over unknown).
- **Graph detection**: `detect.ts`. Output goes to a person, and the useful question is detection rate, which the sim measures.
- **Simulators, oracles, gates**: float thresholds on measured data. A proof of the harness says nothing about production.
- **`isAgentInitiated`, `viewClass`, `dueAt` alone**: one-liners. Include them only as helpers of a larger spec.

## Tool notes for the implementers

- `lsc check` output: "N verified" counts Dafny obligations, so it varies. Use a mutation to show a spec has force.
- Quirks found: union tag `"none"` collides with `Option`; `?.` in a condition gives `Option<bool>`; `env.X` on Record fails, use `env["X"]`; a `T | undefined` Record value does not compare in specs; a non-exported helper called from a verified function needs its own `//@ verify`; under `real`, `Math.min`, `Math.max` and integer literals give type errors; `forall` over `%` needs a named predicate as trigger.
- Line numbers are for this commit. journeys.md cites a different line for `dispatch`; check before edits.
