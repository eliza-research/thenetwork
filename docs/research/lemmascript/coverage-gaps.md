# Coverage gaps: files that earlier reports only skimmed

Scope: the files that `messaging-ops.md` marked skimmed, partly read or read by header, and the files `engine-packs.md` read in part.

## 1. Files reviewed (complete: no row is S or P)

### packages/engine/src/packs/network (read in full)

| File | Verdict | Why |
|---|---|---|
| generators.ts | NOT APPLICABLE | 11 generators over `World`, cosine scores and closures. All pair, member and minor rules repeat in `candidateReason` (filters.ts:164), which runs on every candidate at engine.ts:129. That function is the proof target and engine-core.md covers it. Generators with no `pairReason` of their own (`secondEncounter`, `expansion`, `eventAnchor` group arm via group.ts) are safe for this reason. |
| judgeContext.ts | NOT APPLICABLE | JSON assembly with byte identity. `summarizeConnectedSources` is `typeof` over `unknown`. `validAt` is one line. |
| prompts.ts | NOT APPLICABLE | Strings. |
| vocabulary.ts, activities.ts | NOT APPLICABLE | Data. `wine_bar` has `ageMin: 21`; plans.ts:304,317 enforces it through `ageOk`. |

How to read the "Depth" column in the tables below. Every file named by the brief has a row.

- **F**: read every line, at full width.
- **W**: read every line, cut at 150 to 190 columns. Long copy and data lines were not seen to their end.
- **P**: read in part. The row says which part.
- **S**: scan only: gate titles and grep for hidden truth, ages, keys, live flags and blocking state. These files are not line-reviewed by this report.

The first pass left simulator and script files at S or P. A second pass (2026-11-08) read every one of them line by line; no row is S or P now. All of these files are harness code: personas, world physics, oracles, baselines and gate bodies. None runs in production, so none is a LemmaScript target except the judge predicate in section 6. The defects that pass found are bugs 9 to 11 in section 3.

### packages/observatory/src

| File | Depth | Verdict | Why |
|---|---|---|---|
| store.ts | F | NOT APPLICABLE | In-memory view with delta tracking. No decision. |
| engineCapture.ts | F | NOT APPLICABLE | Summary of a run. Passes no pack: see bug 5. |
| people.ts | F | NOT APPLICABLE | SQL read of the cross-app view. Hides private apps as documented. `isPrivateApp` filter is a one-line test. |
| ops.ts | W | NOT APPLICABLE | Cost SQL and arithmetic. |
| runDiff.ts, report.ts | F | NOT APPLICABLE | Reports. |
| takeover.ts | F | NOT APPLICABLE | Game mode. It uses `parseYesNo` from the Network. |
| lab.ts | W | NOT APPLICABLE | `validateLab` is `unknown` narrowing. `labEnv` is one loop over an allow list and a good runtime check. Proof adds nothing. |
| health.ts | W | NOT APPLICABLE | Alert and scorecard arithmetic. It reports and enforces nothing. `reportQueue`, `metric` are provable but no invariant rests on them. |
| events.ts | W | NOT APPLICABLE | Row mapping and copy. `payloadOf` drops `text`, `body`, `message` keys; `describe` keeps codes only. `onTimeline` is pure but needs `Record` of unknown. |
| projector.ts | W | NOT APPLICABLE | Dashboard projection of run records. Game mode only. |
| server.ts | W | EXTRACT `deployGuard` core | Trial below. The rest is routes. `checkSafety` and `auditDetail` are `typeof` over input. Route checks call `allowed` (messaging-ops trial 5). See bug 1. |
| sources/source.ts | F | NOT APPLICABLE | Interface and error tables. |
| sources/service.ts | W | NOT APPLICABLE | HTTP client. `serviceAlerts` is arithmetic. The `textHidden` flag is set by the service, and real.ts has its own check. |
| sources/real.ts | W | EXTRACT `ageView`/`minorAt` core; EXTRACT `loginProblem` core | Trials below. See bugs 2 and 4. Rest is SQL. `mergeStateRows` uses `typeof` on `unknown`. |
| sources/game.ts | W | NOT APPLICABLE | Game driver. Never loaded by the real-only image. |
| types.ts | F (declarations; comments skimmed) | NOT APPLICABLE | Types and three constant lists (`REVIEW_REASONS`, `STAFF_ROLES`). No logic. |

### packages/observatory/db

| File | Depth | Verdict | Why |
|---|---|---|---|
| dev-pg.ts, seed.ts, writer.ts | W | NOT APPLICABLE | Dev tooling. `isLocalUrl` guards the seed path. `writeRows` truncate is in one transaction and reachable only behind that guard. |
| migrations 0003-0006, 0010, 0011, 0014, 0020-0026, 0030-0041 | W | NOT APPLICABLE | SQL. No defect found. Points worth keeping: 0038 `least(...)` ignores NULLs, which is what the floor wants, and a member with no age at all stays NULL, which `isMinor` fails closed on. 0039 uses `enable` without `force` on RLS, unlike 0004, but only `network_service` has grants and the policy binds it. |

### packages/sim/src

| File | Depth | Verdict | Why |
|---|---|---|---|
| judge/metrics.ts | W | EXTRACT (as messaging-ops trial 11) | Now read in full. See section 4 and bug 6 (fixed: the clear now calls `clearsMinorFlag`). |
| judge/rules.ts | F | NOT APPLICABLE | Regex. |
| judge/llmJudges.ts | W | NOT APPLICABLE | LLM calls; parsers fail closed. |
| time.ts | F | EXTRACT (small) | Same as messaging-ops. |
| agent/availability.ts, engineAdapter.ts, network.ts, index.ts, taxonomy.ts, apps/gates.ts | F | NOT APPLICABLE | Harness and data. |
| world.ts | F | NOT APPLICABLE | Event loop and outcome recording. Line 137 `new Date()` names the run only. `unanswered` counts `meta.proactive` sends (the persona side, not a gate). |
| snapshot.ts | F | NOT APPLICABLE | Public-side snapshot. Bug 7 (romance opt-in reads the hidden adversary label). `inviteAnswer` reads a counter as a yes for interaction history only, not for consent. |
| stubNetwork.ts | F | NOT APPLICABLE | Push baseline by design (no review, no leak check). Its minor refusal and quiet hours are its own; it shares `parseYesNo` with the persona policy. |
| agent/policy.ts | F | NOT APPLICABLE | Persona choice model and template voice from hidden truth. `parseYesNo` wraps core `parseReply` (a counter is not a yes). |
| agent/llmAgent.ts | F | NOT APPLICABLE | LLM voice only; every decision comes from policy.ts. Falls back to templates on error. |
| agent/types.ts | F | NOT APPLICABLE | Types and `newMemory`. |
| plans.ts | F | NOT APPLICABLE | Plan oracle, check-in and crew models; `parsePlanPicks` and `planAgainAnswer` are sim reference parsers, not the Network's. |
| oracle.ts | F | NOT APPLICABLE | Hidden-truth outcome model. `unsafe` uses TRUE age, so age liars count. |
| persona.ts | F | NOT APPLICABLE | Persona types and intent liveness (`intentRecordTiming`), harness only. |
| generator.ts | F | NOT APPLICABLE | Seeded persona generator. Minors: honest 13-17 and lying 15-17 claim 18-21. |
| llmGenerator.ts | F | NOT APPLICABLE | LLM bio texture; scrubs the canary. |
| sources.ts | F | NOT APPLICABLE | Richness tiers and simulated connected sources; minors restricted to three sources, sensitive facets agent_private. |
| scenario.ts | F | FIXED (bug 11) | Scenario grading. A `metric` expectation with a mistyped path read 0 and passed. |
| cli.ts | F | NOT APPLICABLE | Operator CLI. Prints `llmCalls=undefined` for a policy agent (cosmetic). |
| judge/predicates.ts | F | PROVED (section 6) | Now also holds `clearsMinorFlag` (bug 6). |
| apps/slop/packEval.ts | F | NOT APPLICABLE | Arms, presets, `gates3`. `scammerMedianReach` takes the lower median for an even count (lenient by half a rank; noted, not changed). Minor and filter gates use `every` over seeds. |
| apps/slop/metrics.ts | F | NOT APPLICABLE | Flow metrics; `minorContacts` counts every proposal with a claimed minor, even one the harness dropped (strict). |
| apps/slop/world.ts | F | NOT APPLICABLE | Probe-first harness. The harness does not enforce holds or blocks; the matcher must (conformance checks the engine). |
| apps/slop/snapshot.ts | F | NOT APPLICABLE | Snapshot, verification, rater and review models; no hidden truth (the block's perturbation gate proves it). |
| apps/slop/relay.ts | F | FIXED (bug 10) | Relay exchange and scoring. The contact-leak counter used the relay's own guard. |
| apps/slop/oracle.ts, persona.ts, behavior.ts, baselines.ts, visible.ts, geo.ts, bodyType.ts | F | NOT APPLICABLE | Hidden-truth model, personas, behaviour and baselines. |
| apps/slop/adversarial.ts | F | NOT APPLICABLE | Relay and photo adversarial scenarios; every scenario needs controls and a minimum case count, so none passes empty. |
| apps/slop/enginePack.ts | F | NOT APPLICABLE | Snapshot to EngineInput and back; reads no hidden truth. |
| apps/slop/clefSynth.ts, cli.ts | F | NOT APPLICABLE | Synthetic Clef data; baseline CLI. |
| apps/peon/gates.ts | F | NOT APPLICABLE | `median([])` is 0, so `scam_reach` passes when no scam got an intro (stated in the gate value). |
| apps/peon/metrics.ts | F | NOT APPLICABLE (note) | The automated four-fifths stage uses the pack's own `assessed` set as its pool; a pack that dropped a group before scoring would not show. Matches LL144 "assessed"; `offered|active` (ungated) covers it. |
| apps/peon/world.ts, oracle.ts, persona.ts, snapshot.ts, baselines.ts, arms.ts, skills.ts, audit.ts, cli.ts | F | NOT APPLICABLE | Hiring harness. No age liars (declared age = true age). `auditCompanies` is a sim model of the monitor, not production code. |
| apps/friends/gates.ts, metrics.ts | F | NOT APPLICABLE | `knownAdversary` uses the sim's `visibleRedFlag`, a model of what staff can see. `holdAt` ignores a hold's end (strict). |
| apps/friends/world.ts, oracle.ts, persona.ts, snapshot.ts, baselines.ts, packMatcher.ts, visible.ts, arms.ts, cli.ts | F | NOT APPLICABLE | Friends harness. Declared minors are refused for invitees and alternates. |
| apps/gates.ts, apps/README.md | F | NOT APPLICABLE | Type and docs. |

### scripts

| File | Depth | Verdict | Why |
|---|---|---|---|
| wrangler.sh | F | MODEL ONLY, fix by hand | Bash. See bug 3. |
| inspect-network-backend.py | W | NOT APPLICABLE | Python, GET only. |
| require-pg.ts, check-contract-mirror.ts | F | NOT APPLICABLE | Dev tools. |
| platform-dev.ts | F | NOT APPLICABLE | Dev tool. Refuses production, needs the :54339 cluster, deletes `NETWORK_CHANNEL`; it only warns on `BLOOIO_ALLOW_SEND` (sends stay dry-run without the channel). |
| sites-dev.ts | F | NOT APPLICABLE | Dev server; backend paths go through the production router code when a proxy secret is set. |
| relay-clef-lib.ts | F | NOT APPLICABLE | Corpus loader and the base relay context shared by the relay block and the CLI. |
| relay-eval.ts | F | NOT APPLICABLE | Operator CLI. `--live` and `fit` refuse without the Cloudflare env and over budget; reports are aggregates. |
| clef-fit.ts | F | NOT APPLICABLE | Operator CLI. Only `features --live` calls Workers AI; `audit` exits 3 on a flag. |
| sim/gate.ts | F | NOT APPLICABLE | Assertion helper. Every `b.run` is awaited except slop-live.ts:174, which returns the promise to an awaited caller. |
| sim/pipeline.ts, sim/pipeline/harness.ts, sim/safety.ts | W | NOT APPLICABLE | Gate bodies. They back up each proof. I found no gate here that passes without doing its work. |
| sim/ops.ts | F | NOT APPLICABLE | Alert, dispatcher, cost and deploy-guard gates. Checked that `importGraph` resolves workspace packages to real paths (it does), so the "imports nothing from the simulator" gate can fail. |
| sim/network.ts | F | GATE ADDED (bug 6) | The trust gate reads the world's persona list after the run (the earlier fix holds). New gate: an `age_resolved minor:false` clears the judge's minor flag. |
| sim/slop.ts | F | GATE ADDED (bug 10) | Launch, relay-world, world and conformance gates. `minor_signal` and `bad_consent` "every item blocked" pass when n is 0 (they print n). The stable-assignment gate counts blocking pairs only between two matched members, narrower than the pack's comment (noted). New gate: the contact counter is independent of the relay guard. |
| sim/slop-live.ts | F | NOT APPLICABLE (note) | "Consent before reveal" skips a booked message whose opportunity left `net.opps` (only a forgotten member removes one; none in this world). The person-cap gate counts `meta.proactive`, the system's own label. |
| sim/audit.ts, sim/conformance.ts, sim/relay.ts, sim/peon-seats.ts, sim/clef.ts, sim/evals.ts, sim/peon.ts, sim/friends.ts, sim/onboard.ts, sim/capital.ts | F | NOT APPLICABLE | Gate blocks. Each gate has a minimum count, a negative control or a corpus floor. The friends "adversaries held" gate and conformance's minor-generator check use production readers (`friendsInfo`, `candidateReason`) as the oracle; they check consistency, the output checks stand on their own. |
| synthetic/common.ts, names.ts, load.ts, validate.ts, generate.ts | F | NOT APPLICABLE | Dataset tools. generate.ts:245 has bug 7's pattern (romance opt-in skips `adversarial === "minor"` by hidden label), so the NYC world's age liars are kept out of romance by the generator. |

## 2. Candidates ranked by value

All trials are in the scratchpad at `research/coverage-gaps/`. Each used `lsc check --backend=dafny`.

### 1. The console's age view. packages/observatory/src/sources/real.ts:73-97, `recordMinor`, `ageView`, `minorAt`. EXTRACT `consoleMinor`

- Property: a missing or invalid stored age, with no Network view, is treated as under 18. A stored age that core calls minor is a minor here. `ageView` and `minorAt` give one answer.
- Sketch:
  ```
  //@ ensures !hasAge && !netKnown ==> \result
  //@ ensures hasAge && isMinorAge(age) ==> \result
  //@ ensures netKnown && netMinor ==> \result
  ```
- Protects: the held-text filter at real.ts `held()`, the minors list in the safety console, the real-mode `minor_contacts` count.
- Blockers: `validAge` takes `unknown`. Use a `number` overload beside it. Optional fields in the return type: return a boolean from the core.
- Effort: S.
- Trial: `console.ts` verified (6 functions, 0 errors). `failclosed.ts`, which states the same property on the shipping `recordMinor` body, failed: 2 verified, 2 errors. The failing case is age above 120. That is bug 4.

### 2. The console's login check. real.ts:100, `loginProblem`. EXTRACT `loginOk`

- Property: `ok` implies a read-only connection, the app role for an app login, and no superuser or RLS bypass outside this machine.
- Sketch: `//@ ensures \result && !local ==> !su && !bypass`
- Protects: app isolation in the console (PRD 40.3).
- Blockers: none in the boolean core; the string message stays outside.
- Effort: S. The value is small until bug 2 is fixed, because the caller can skip the check.
- Trial: verified, in `console.ts`.

### 3. The console's start guard. packages/observatory/src/server.ts:168, `deployGuard`. EXTRACT `deployAllowed`

- Property: real data needs `PLATFORM_ENV`; staging and production need SSO; a remote database needs SSO; a local game server needs nothing.
- Sketch:
  ```
  //@ ensures (realOnly || remote) && (env === 2 || env === 3) && !sso ==> !\result
  //@ ensures remote && !sso ==> !\result
  ```
- Protects: a deployed console that holds real data never starts on static tokens.
- Blockers: `remoteDb` uses `new URL`: keep it outside and pass a boolean. Model `env` as a small enum.
- Effort: S.
- Trial: verified, in `console.ts`. The ops block already runs this guard, so the proof adds the case split only.

No candidate here outranks the messaging-ops, network-service or core lists. These three are small additions.

## 3. Bugs

Severity is for this repo's invariants. None of these sends a message.

### Bug 1 (medium). An analyst receives member names through opportunity events.

- Where: packages/observatory/src/server.ts:548 strips `opportunity`, `members` and `messages` for the counts view, and returns `...d`, which keeps `events` and `run`. `sources/real.ts` `opportunity()` and `sources/game.ts` `opportunity()` build `events` with `describe(row, name)`. `describe` writes names: `"${name(actor)} said yes"`, `"${name} blocked ${name}"`, `reported ${name}`.
- Rule broken: the comment at that line ("never the people in it") and shape.ts ("an analyst sees counts and the shape of the network, never a person").
- Reproduce: as an analyst token, GET `/api/opportunity/<id>` for an opportunity with a `member_accepted` event. Read `events[].text`. In real mode it gives "First L."; in game mode, the full name.
- Why it was missed: staff.test.ts:215-217 checks `messages` and `members` only.
- Fix: in the counts branch, map events to `{ t, type }` (or `events: []`), and add the check to `packages/observatory/test/staff.test.ts`, which is in the security suite.

### Bug 2 (low to medium). The login check fails open.

- Where: real.ts:207. If the check query throws, the `catch` sets an error and `init()` continues to `load()` and starts the timers. The next good `load()` clears the error, so nothing shows.
- Rule broken: the comment at real.ts:200 ("The login is checked, not assumed"), and `loginProblem` as a gate.
- Reproduce: make the first query fail once (a brief connection loss at start) on a superuser login. The source then reads through that login with no refusal.
- Fix: treat a failed check as `this.refused`, close the connection and return, or retry the check before the first load.

### Bug 3 (medium for the deploy rule). `scripts/wrangler.sh` lets some deploys past the read-only list.

- Where: `decide()`. It knows `--dry-run` and `--no-dry-run` only. `--*=*` words are ignored. Any `--help` makes the command allowed.
- Reproduce: on a copy of the guard with the final `exec` removed (`research/coverage-gaps/guard.sh`, `t.bash`), with no `NTWRK_ALLOW_DEPLOY`:
  ```
  deploy --dry-run                   ALLOWED (correct)
  deploy --dry-run --no-dry-run      refused (correct)
  deploy --dry-run --dryRun=false    ALLOWED
  deploy --dry-run --no-dryRun       ALLOWED
  deploy --dryRun false --dry-run    ALLOWED
  versions upload --dry-run --dryRun=false   ALLOWED
  --help --help=false deploy         ALLOWED
  --help --no-help deploy            ALLOWED
  deploy --help --no-help            ALLOWED
  ```
- Limit: I did not run wrangler on these, and I will not. That wrangler reads `--dryRun` as `--dry-run` and takes the last value is from yargs defaults (camel-case expansion) and from the script's own comment on last-value-wins. Confirm with a stub or a `--help` of the pinned version, not a deploy. `--dry-run=*` and `--no-dry-run` show that the author wanted this handled.
- Rule broken: CLAUDE.md "refuses deploy (except --dry-run) ... unless NTWRK_ALLOW_DEPLOY=1", and the header claim that the guard fails closed.
- Fix: normalize each flag first (lower-case, drop `-`). Any flag whose normal form is `dryrun`, `nodryrun`, `help`, `nohelp` or `remote` is counted, in any spelling and with any `=value`. Allow on help only when no `help=false` or `no-help` form is present. Add the rows above to deploy/wrangler.integration.test.ts, which already stubs `bunx`.

### Bug 4 (low). `ageView` does not fail closed for an out-of-range stored age, and it disagrees with `minorAt`.

- Where: real.ts:73. `recordMinor = validAge(age) && isMinor(age)`. For age 200: `validAge` is false, so `recordMinor` is false and `ageView(200)` gives `{ minor: false }`. `minorAt(..., 200, t)` gives true. The comment at real.ts:86 says the two agree. core/policy.ts says an invalid age is unknown and fails closed.
- Reach: `network.members.age` has no check constraint (schema.sql:23). Join checks should stop such a value, so this needs bad data. The Network's own view (`net`) wins when it is there.
- Fix: `recordMinor = recordAge !== null && isMinor(recordAge)`, or use `consoleMinor`.

### Bug 5 (low to medium). A real-mode shadow run uses the wrong pack.

- Where: engineCapture.ts `runEngineSummarized` calls `runEngine(snapshot, cfg)` with no `deps`, so engine.ts:82 uses `networkPack` for every app. real.ts `shadowRun` also fixes cities to `["sf", "nyc"]` and seed 1.
- Effect: a shadow run on slop, peon or friends shows what the network pack would propose, not what that app's pack would. PRD 34.6 uses shadow runs to judge an engine before matching goes on. The proposals are ghosts, never sent, and the shadow precision metric needs a person's decision, so no count changes without a reviewer. The panel misleads.
- Fix: pass the app's pack from the same table the service uses, or refuse `shadow_run` for an app that is not ntwrk.

### Bug 6 (low). The judge never clears `flaggedMinor`.

- Where: packages/sim/src/judge/metrics.ts:330 clears the flag only if `!isMinorAge(d.age)`. network.ts:714 logs `age_resolved` with `{ memberId, minor }` and no `age`, so `isMinorAge(undefined)` is true and the flag stays. `age_confirmed` is not logged by packages/network/src.
- Effect: an adult who first has an unknown age stays a minor to the judge. The error is in the safe direction, but a run with such a persona that is later matched reports a false `minor_contact`. real.ts reads the same event correctly (`e.payload.minor`).
- Fix: `d.minor === false`. Also add `minor_reported` to the set that flags a member: the Network takes such a member out of matching, and the judge does not hold it to that.
- Status (2026-11-08): `minor_reported` was already added. The clear is fixed: metrics.ts calls `clearsMinorFlag` (predicates.ts, proved), which clears on `minor: false` or an adult age and never on `minor: true`. Evidence: records with `age_unknown`, then `age_resolved {minor: false}`, then a probe to that adult gave `minorContacts 2` before and 0 after; with `minor: true` it stays 2. The same records are now a gate in the network block.

### Bug 7 (low, harness validity). The NYC snapshot reads a hidden label to protect the matcher.

- Where: packages/sim/src/snapshot.ts:91. The romance opt-in is inferred from `p.hidden.romance.optIn` only if `p.hidden.adversarial !== "minor"`. So an age-lying minor is kept out of the romance lane by the simulator, not by the Network. Production has no such signal.
- Effect: `undisclosedMinorProposals` is low in that lane. The founder accepts age lying as out of scope (decision 9), so no rule breaks. The number must not be quoted as a measured defence. scripts/sim/slop.ts:121 has a perturbation gate that the slop snapshot carries no hidden truth; the NYC world has no such gate.

### Bug 8 (low). A forgotten adult shows as "Declined member", and the store keeps old edges and feed lines.

- Where: real.ts `load()`: `declined = account_status === 'removed' && name === null`. runtime.ts sets those two fields for any forgotten member, so an adult who deleted their data reads as declined under 13. `Store` has no way to drop an edge, and feed lines keep "First L." until restart.
- Effect: console text only, for staff who may see it, until the process restarts.

### Bug 9 (low, gate strength, not changed). The slop relay world's age-slip gate rests on one item.

- Where: scripts/sim/slop.ts, "every slip blocked" is `stopped === n` for the `minor_signal` class, true at n = 0. On the pinned seeds (13-16) the run had n = 1 (slips 1/1), so the gate checks one item. The adversarial block (relay.ts, `minor_in_relay`, at least 400 cases) covers the same rule with volume, so no fix here; requiring n > 0 would make the gate flaky on other seeds.

### Bug 10 (low to medium, gate validity). The slop relay world counted contact leaks with the relay's own guard.

- Where: packages/sim/src/apps/slop/relay.ts `score()`. A delivered item counted as a contact leak only if `relayGuard().check()` found a contact. `relayItem` holds every text that the same guard flags, so a delivered text could never count: the gate "0 rating, contact or private-fact leaks" could not fail on contacts.
- Evidence: "two one two five five five, then zero one four seven", "two12 five55 o147" and "I'm sam r at gmail" all pass `relayItem`, and the old counter read 0 for each.
- Fix: the counter also calls `contactShaped` (the judge's own check: 7 or more digits as digits or words, an email or handle, "at gmail"). It flags all three, and none of the 50 non-contact templates or the 221 lines of evals/network/benign-adult.txt. New blocking gate in the slop block. The production guard is unchanged (it is not this report's scope; the corpus gates measure its recall).

### Bug 11 (low, gate validity). A scenario `metric` expectation with a mistyped path passed.

- Where: packages/sim/src/scenario.ts `getPath`. A missing path read as 0, so `"path": "safety.minorContact", "op": "==", "value": 0` passed against a run with 3 minor contacts.
- Fix: a missing path is NaN (fails every comparison), except under `invariants.byRule.` where a rule never violated has no entry. The nine scenario files use only valid paths (checked), so no gate result changes.

## 4. Runtime guards

| Predicate | Where it would run | Gate or test that exercises it |
|---|---|---|
| `consoleMinor` | `ageView`, `minorAt` | Add a case for an out-of-range age to the observatory Postgres tests (suggestion; I did not read those tests). |
| `loginOk` | `loginProblem` | Add a case for a failed check query (suggestion; I did not read an existing test for it). |
| `deployAllowed` | `deployGuard` | `scripts/sim/ops.ts` deploy guard gates |

Judge gap (closed since: metrics.ts now has a `person_cap` rule on the proved `inWindow` / `underBudget`). At the time, `computeMetrics` had no person cap rule. The 3-a-day cap is judged only in `scripts/sim/slop-live.ts:269`, on one app. The main NYC run, the scenario runs and game mode do not check it. Add a rule `person_cap` to `onMessage`: count delivered proactive messages per member in a sliding 24 hours against `PERSON_DAILY_CAP`, over `l.state` lanes. This is the trust-boundary style the file already uses (it decides "proactive" from timing, not `meta.proactive`). A cross-app version needs person ids in `LoggedPersona`. The window filter can share the proved cap predicate from messaging-ops.

## 5. What not to verify

- Generators (network pack): the safety rules repeat in `candidateReason`. Prove that function.
- judgeContext.ts: the rule is byte identity of JSON, which a golden test holds better.
- Migrations: LemmaScript has no SQL model. The Postgres suites are the right check.
- wrangler.sh: a TypeScript port would be a shadow model. Fix it and extend the integration test.
- Persona, oracle, world and app-world code: a proof of the harness proves nothing about production. Fix the two judge items above with gates.

## 6. Proof added in this pass

`clearsMinorFlag` in packages/sim/src/judge/predicates.ts (already in LemmaScript-files.txt; proofs/packages/sim/src/judge/predicates.dfy regenerated with `lsc regen`). Contract: a clear never happens on `minor: true`; a clear needs `minor: false` or an age from 18 to 120; `minor: false` always clears. `lsc check --backend=dafny`: 7 verified, 0 errors. Force: changing `if (l.saysMinor) return false` to `if (l.saysMinor && l.hasAge) return false` gives 6 verified, 1 error. The judge calls it; no production function is shared with it. Every other file in this pass is harness code (section 5).

